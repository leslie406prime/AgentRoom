import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { PublicJobError, agentFailureDiagnostic, safeErrorMetadata, safeModel } from "./job-errors";
import { catalogModel, modelKey, providerInfo, type ProviderId } from "../lib/ai-catalog";

// Server-only. API keys are passed in per call by the caller and never stored on these objects.
export type StreamParams = { apiKey: string; model: string; system: string; user: string; maxOutputTokens: number; jobId?: string; openaiOptions?: { workspaceKey: boolean } };
export type StreamEvent = { text: string } | { usage: { input: number; output: number } } | { artifactArgs: string };
export interface AIProvider { id: ProviderId; stream(params: StreamParams): AsyncIterable<StreamEvent>; listModels(apiKey: string): Promise<string[]> }

export type ErrorKind = "auth" | "rate_limit" | "unavailable" | "bad_request" | "blocked" | "unknown" | "timeout" | "network";
export class ProviderError extends PublicJobError {
  constructor(message: string, public kind: ErrorKind, public retryAfterMs?: number, public diagnostics: { httpStatus?: number; errorCode?: string; attempts?: number; partial?: boolean } = {}) { super(message, ["auth", "rate_limit", "bad_request"].includes(kind)); }
}
const timeoutMs = 60_000;

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}
function retryAfter(error: unknown): number | undefined {
  const headers = (error as { headers?: unknown })?.headers as { get?: (name: string) => string | null } | Record<string, string> | undefined;
  const raw = typeof (headers as { get?: unknown } | undefined)?.get === "function" ? (headers as { get: (n: string) => string | null }).get("retry-after") : (headers as Record<string, string> | undefined)?.["retry-after"];
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 3600) * 1000;
  const match = /retry(?: in|Delay[":\s]+)\s*([\d.]+)\s*s/i.exec(String((error as { message?: unknown })?.message ?? ""));
  return match ? Math.ceil(Number(match[1]) * 1000) : undefined;
}
// Converts any SDK failure into a user-safe message. Raw SDK messages are never forwarded: they can echo request details.
export function classifyProviderError(provider: ProviderId, model: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const label = providerInfo[provider].label, meta = safeErrorMetadata(error), status = statusOf(error) ?? meta.httpStatus;
  const details = { httpStatus: status, errorCode: meta.errorCode };
  if (status === 401 || status === 403 || meta.errorCode === "API_KEY_INVALID" || meta.errorCode?.startsWith("API_KEY_")) return new ProviderError(`${label} rejected the server's API key or its restrictions. An owner should check ${providerInfo[provider].envKey}.`, "auth", undefined, details);
  if (status === 429) { const wait = retryAfter(error); return new ProviderError(`${label}'s rate or free-tier quota limit was reached${wait ? `. Try again in about ${Math.ceil(wait / 1000)}s` : ". Try again later"}.`, "rate_limit", wait ?? 30_000, details); }
  if (status === 404 || status === 400) return new ProviderError(`${label} could not run "${model}" with the configured key. Choose another approved model.`, "bad_request", undefined, details);
  if (meta.timeout) return new ProviderError(`${label} did not respond before the request timed out. Please retry; an owner can inspect the job's timeout diagnostics.`, "timeout", undefined, details);
  if (status !== undefined && status >= 500) return new ProviderError(`${label} could not serve "${model}" (temporary provider service error). Retry later or select another approved model.`, "unavailable", 2000, details);
  if (meta.errorCode || /fetch failed|connection error/i.test(String((error as { message?: unknown })?.message ?? ""))) return new ProviderError(`${label} could not be reached from the server. Please retry; an owner should check the server's network connection.`, "network", 2000, details);
  return new ProviderError(`${label} returned an unexpected error. Please retry.`, "unknown", undefined, details);
}

const openaiProvider: AIProvider = {
  id: "openai",
  async *stream(p) {
    const client = new OpenAI({ apiKey: p.apiKey, maxRetries: 0, ...(p.openaiOptions?.workspaceKey ? { organization: null, project: null } : {}) });
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [{ type: "function", function: { name: "save_artifact", description: "Create or update a shared code or markdown artifact in the room.", parameters: { type: "object", additionalProperties: false, required: ["title", "type", "language", "content"], properties: { title: { type: "string" }, type: { type: "string", enum: ["code", "document"] }, language: { type: "string" }, content: { type: "string" } } } } }];
    const stream = await client.chat.completions.create({ model: p.model, max_completion_tokens: p.maxOutputTokens, stream_options: { include_usage: true }, stream: true, messages: [{ role: "system", content: p.system }, { role: "user", content: p.user }], tools, tool_choice: "auto" }, { timeout: timeoutMs });
    let args = "";
    for await (const chunk of stream) {
      if (chunk.usage) yield { usage: { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens } };
      const choice = chunk.choices[0];
      if (choice?.delta.content) yield { text: choice.delta.content };
      const tool = choice?.delta.tool_calls?.[0];
      if (tool?.function?.arguments) args += tool.function.arguments;
    }
    if (args) yield { artifactArgs: args };
  },
  async listModels() { return []; },
};

const geminiProvider: AIProvider = {
  id: "gemini",
  async *stream(p) {
    const client = new GoogleGenAI({ apiKey: p.apiKey, httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } } });
    // 2.5 models count hidden "thinking" tokens against maxOutputTokens, which can truncate the visible answer; disable it for 2.5.
    const thinking = p.model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {};
    const stream = await client.models.generateContentStream({ model: p.model, contents: [{ role: "user", parts: [{ text: p.user }] }], config: { systemInstruction: p.system, maxOutputTokens: p.maxOutputTokens, ...thinking } });
    let usage: { input: number; output: number } | undefined, blocked: string | undefined;
    for await (const chunk of stream) {
      const text = chunk.candidates?.[0]?.content?.parts?.map((part) => (part.thought ? "" : part.text ?? "")).join("") ?? "";
      if (text) yield { text };
      if (chunk.promptFeedback?.blockReason) blocked = String(chunk.promptFeedback.blockReason);
      const meta = chunk.usageMetadata;
      if (meta) usage = { input: meta.promptTokenCount ?? 0, output: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0) };
    }
    if (usage) yield { usage };
    if (blocked) throw new ProviderError("Gemini blocked this request with its safety filters. Rephrase and try again.", "blocked");
  },
  async listModels(apiKey) {
    const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 15_000 } });
    const ids: string[] = [];
    for await (const model of await client.models.list()) if (!model.supportedActions || model.supportedActions.includes("generateContent")) ids.push((model.name ?? "").replace(/^models\//, ""));
    return ids;
  },
};

const groqProvider: AIProvider = {
  id: "groq",
  async *stream(p) {
    const client = new Groq({ apiKey: p.apiKey, maxRetries: 0, timeout: timeoutMs });
    const stream = await client.chat.completions.create({ model: p.model, max_completion_tokens: p.maxOutputTokens, stream: true, messages: [{ role: "system", content: p.system }, { role: "user", content: p.user }] });
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield { text };
      const usage = (chunk as { usage?: { prompt_tokens: number; completion_tokens: number } | null }).usage ?? chunk.x_groq?.usage;
      if (usage) yield { usage: { input: usage.prompt_tokens, output: usage.completion_tokens } };
    }
  },
  async listModels(apiKey) {
    const client = new Groq({ apiKey, maxRetries: 0, timeout: 15_000 });
    return (await client.models.list()).data.filter((m) => (m as { active?: boolean }).active !== false).map((m) => m.id);
  },
};
export const providers: Record<ProviderId, AIProvider> = { openai: openaiProvider, gemini: geminiProvider, groq: groqProvider };
export function providerKey(provider: Exclude<ProviderId, "openai">) { return process.env[providerInfo[provider].envKey]?.trim() || null; }

// ---- Process-local guards (a multi-process deployment would need a shared store) ----
const shared = process as typeof process & { __agentroomProviderState?: { calls: Map<string, number[]>; cooldowns: Map<string, number> } };
const state = shared.__agentroomProviderState ??= { calls: new Map<string, number[]>(), cooldowns: new Map<string, number>() };
export const maxQueueWaitMs = 20_000;
export const sleep = { fn: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };
export function resetProviderGuards() { state.calls.clear(); state.cooldowns.clear(); }
export function setProviderCooldown(provider: ProviderId, ms: number) { state.cooldowns.set(provider, Date.now() + Math.min(ms, 120_000)); }
// FIFO queues already serialize one job per channel; this additionally caps provider-wide request rate across channels.
export async function acquireProviderSlot(provider: ProviderId, model: string) {
  const label = providerInfo[provider].label, deadline = Date.now() + maxQueueWaitMs;
  const limit = catalogModel(modelKey(provider, model))?.localRpm ?? 20, key = provider + ":" + model;
  for (;;) {
    const now = Date.now(), cooldown = state.cooldowns.get(provider);
    if (cooldown && cooldown > now) throw new ProviderError(`${label}'s rate limit was recently reached. Try again in about ${Math.ceil((cooldown - now) / 1000)}s.`, "rate_limit", cooldown - now);
    // Re-read after every await: other channels may have claimed the released slot.
    const recent = (state.calls.get(key) ?? []).filter((time) => time > now - 60_000);
    if (recent.length < limit) {
      recent.push(now); state.calls.set(key, recent); return;
    }
    const wait = recent[0] + 60_000 - now;
    if (now + wait > deadline) throw new ProviderError(`AgentRoom's local rate guard for ${model} is full. Try again in about ${Math.ceil(wait / 1000)}s.`, "rate_limit");
    await sleep.fn(wait);
  }
}

// One retry for transient failures, only if nothing has streamed yet (so a response is never duplicated).
export async function* streamWithRecovery(provider: ProviderId, params: StreamParams): AsyncGenerator<StreamEvent> {
  for (let attempt = 0; ; attempt++) {
    let started = false;
    try {
      await acquireProviderSlot(provider, params.model);
      for await (const event of providers[provider].stream(params)) { started = true; yield event; }
      return;
    } catch (error) {
      const failure = classifyProviderError(provider, params.model, error);
      if (failure.kind === "rate_limit") setProviderCooldown(provider, failure.retryAfterMs ?? 30_000);
      failure.diagnostics = { ...failure.diagnostics, attempts: attempt + 1, partial: started };
      console.warn(JSON.stringify({ level: "warn", event: "agent_provider_attempt_failed", jobId: params.jobId ?? null, provider, model: safeModel(params.model), ...agentFailureDiagnostic(failure), stage: "provider" }));
      const retryable = failure.kind === "unavailable" || failure.kind === "network" || (failure.kind === "rate_limit" && (failure.retryAfterMs ?? Infinity) <= 8000);
      if (!started && attempt === 0 && retryable) { await sleep.fn(Math.min(failure.retryAfterMs ?? 1500, 8000)); continue; }
      throw Object.assign(failure, { partial: started });
    }
  }
}

// Live check of which catalog models the configured key can reach. Cached 10 minutes.
type Verification = { at: number; result: { ok: true; ids: string[] } | { ok: false; message: string } };
// Next.js API bundles and the custom Socket.IO server load separate module instances.
// Keep verification shared so an owner's check also governs subsequent socket requests.
const verificationProcess = process as typeof process & { __agentroomModelVerification?: Map<string, Verification> };
const verified = verificationProcess.__agentroomModelVerification ??= new Map<string, Verification>();
export async function verifyProvider(provider: Exclude<ProviderId, "openai">, force = false) {
  const key = providerKey(provider);
  if (!key) return { ok: false as const, message: `${providerInfo[provider].envKey} is not configured.` };
  const cached = verified.get(provider);
  if (!force && cached && Date.now() - cached.at < 600_000) return cached.result;
  let result: { ok: true; ids: string[] } | { ok: false; message: string };
  try { result = { ok: true, ids: await providers[provider].listModels(key) }; } catch (error) { const failure = classifyProviderError(provider, "model list", error); console.warn(JSON.stringify({level:"warn",event:"provider_verification_failed",provider,...agentFailureDiagnostic(failure),stage:"model_verification"})); result = { ok: false, message: failure.message }; }
  verified.set(provider, { at: Date.now(), result });
  return result;
}
export function cachedVerification(provider: ProviderId) { const hit = verified.get(provider); return hit && Date.now() - hit.at < 600_000 ? hit.result : undefined; }
export function clearVerificationCache() { verified.clear(); }
