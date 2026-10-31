// All provider SDKs are mocked here. These tests prove AgentRoom's routing, permissions, limits and persistence;
// they do NOT prove that real Gemini/Groq/OpenAI requests succeed (see tests/live-providers.test.ts for that).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "socket.io";
const mocks = vi.hoisted(() => ({ gemini: vi.fn(), geminiList: vi.fn(), groq: vi.fn(), groqList: vi.fn(), openai: vi.fn(), keys: [] as string[] }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContentStream: mocks.gemini, list: mocks.geminiList }; constructor(o: { apiKey: string }) { mocks.keys.push(o.apiKey); } } }));
vi.mock("groq-sdk", () => ({ default: class { chat = { completions: { create: mocks.groq } }; models = { list: mocks.groqList }; constructor(o: { apiKey: string }) { mocks.keys.push(o.apiKey); } } }));
vi.mock("openai", () => ({ default: class { chat = { completions: { create: mocks.openai } }; } }));
import { db } from "../src/server/db";
import { createWorkspace, createInvitation, acceptInvitation } from "../src/server/workspace-repository";
import { joinMember, enqueueChannelAgent, channelSnapshot, sendChannelMessage } from "../src/server/collaboration-repository";
import { getAISettings, updateAISettings } from "../src/server/ai-repository";
import { AIConfigInput, getAIConfig, publicAIConfig, updateAIConfig } from "../src/server/ai-workspace";
import { ensureWorker } from "../src/server/queue";
import { runAgent } from "../src/server/agent-worker";
import { acquireProviderSlot, clearVerificationCache, resetProviderGuards, setProviderCooldown, sleep, streamWithRecovery, verifyProvider } from "../src/server/ai-providers";
import { ArtifactStreamFilter, extractArtifacts } from "../src/server/muse";
import { catalog, parseMention } from "../src/lib/ai-catalog";

const emitted: { event: string; payload: Record<string, unknown> }[] = [];
const io = { to: () => ({ emit: (event: string, payload: Record<string, unknown>) => { emitted.push({ event, payload }); } }) } as unknown as Server;
const GEMINI_KEY = "test-gemini-key-not-real", GROQ_KEY = "test-groq-key-not-real";

beforeEach(() => { sleep.fn = async () => {}; resetProviderGuards(); clearVerificationCache(); emitted.length = 0; });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const m of [mocks.gemini, mocks.geminiList, mocks.groq, mocks.groqList, mocks.openai]) m.mockReset(); mocks.keys.length = 0; });

function user(name = "User") { const id = randomUUID(); db.prepare('INSERT INTO "user"(id,name,created_at) VALUES (?,?,?)').run(id, name, Date.now()); return id; }
function fixture() { const actor = user("Alice"), w = createWorkspace(actor, { name: "Providers" }); joinMember(actor, w.id, w.channelId); updateAIConfig(actor, w.id, config()); return { actor, ...w }; }
function addMember(a: ReturnType<typeof fixture>, name: string, role: "MEMBER" | "ADMIN" = "MEMBER") { const id = user(name), invite = createInvitation(a.actor, a.id, { role }); acceptInvitation(id, invite.path.split("/").at(-1)!); joinMember(id, a.id, a.channelId); return id; }
const config = (over: Record<string, unknown> = {}) => ({ enabledProviders: ["gemini", "groq"], approvedModels: ["gemini:gemini-2.5-flash", "gemini:gemini-2.5-flash-lite", "groq:llama-3.3-70b-versatile", "groq:llama-3.1-8b-instant", "groq:openai/gpt-oss-20b"], defaultModel: "gemini:gemini-2.5-flash", museModel: "gemini:gemini-2.5-flash", allowPaid: false, userHourlyLimit: 30, workspaceDailyLimit: 300, ...over });
const ask = (actor: string, a: ReturnType<typeof fixture>, prompt: string, extra: Record<string, unknown> = {}) => enqueueChannelAgent(actor, a.id, a.channelId, { prompt, idempotencyKey: randomUUID(), ...extra }).result.job;
const status = (id: string) => db.prepare("SELECT status,error FROM agent_jobs WHERE id=?").get(id) as { status: string; error: string | null };
const finish = async (a: ReturnType<typeof fixture>, ...jobs: { id: string }[]) => { ensureWorker(io, a.channelId, runAgent); for (const j of jobs) await vi.waitFor(() => expect(["completed", "failed"]).toContain(status(j.id).status), { timeout: 8000 }); };
const agentMessages = (a: ReturnType<typeof fixture>) => (channelSnapshot(a.actor, a.id, a.channelId).messages as { kind: string; authorName: string; content: string; agent: string; provider: string; model: string; mode: string; seq: number }[]).filter((m) => m.kind === "agent");
function geminiReply(texts: string[], usage = { promptTokenCount: 20, candidatesTokenCount: 5, thoughtsTokenCount: 0 }) {
  return async () => (async function* () { for (const text of texts) yield { candidates: [{ content: { parts: [{ text }] } }] }; yield { usageMetadata: usage }; })();
}
function groqReply(texts: string[], usage = { prompt_tokens: 30, completion_tokens: 7 }) {
  return async () => (async function* () { for (const content of texts) yield { choices: [{ delta: { content } }] }; yield { choices: [], x_groq: { usage } }; })();
}
const apiError = (status: number, headers: Record<string, string> = {}) => Object.assign(new Error("raw provider text including " + GEMINI_KEY), { status, headers });

it("defaults new workspaces to Groq GPT-OSS when only Groq is configured, with Llama requiring owner approval", () => {
  vi.stubEnv("GROQ_API_KEY", GROQ_KEY);
  const actor = user(), w = createWorkspace(actor, { name: "Safe defaults" });
  joinMember(actor, w.id, w.channelId);
  expect(publicAIConfig(actor, w.id).models).toEqual(["groq:openai/gpt-oss-20b"]);
  expect(() => enqueueChannelAgent(actor, w.id, w.channelId, { prompt: "hi", agent: "llama", idempotencyKey: randomUUID() })).toThrow("No Llama model is approved");
  const job = enqueueChannelAgent(actor, w.id, w.channelId, { prompt: "hi", agent: "agent", idempotencyKey: randomUUID() }).result.job;
  expect(job.model).toBe("groq:openai/gpt-oss-20b");
});

it("runs the new-workspace default Muse on current Gemini without legacy 2.5 thinking options", async () => {
  vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY);
  const actor = user(), a = { actor, ...createWorkspace(actor, { name: "Current Gemini defaults" }) };
  joinMember(actor, a.id, a.channelId);
  sendChannelMessage(actor, a.id, a.channelId, { clientId: randomUUID(), content: "Decision: keep the white interface." });
  mocks.gemini.mockImplementation(geminiReply(["The team decided to keep the white interface."]));
  const job = ask(actor, a, "Summarize our decision."); await finish(a, job);
  const call = mocks.gemini.mock.calls[0][0];
  expect(call.model).toBe("gemini-3.8-flash"); expect(call.config.maxOutputTokens).toBe(2048);
  expect(call.config.thinkingConfig).toBeUndefined();
  expect(call.contents[0].parts[0].text).toContain("Decision: keep the white interface.");
  expect(agentMessages(a)[0]).toMatchObject({ agent: "muse", provider: "gemini", model: "gemini-3.8-flash" });
});

it("routes @Gemini to the Gemini SDK with the server key, shared context, token cap, and labels the response", async () => {
  vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); const a = fixture();
  sendChannelMessage(a.actor, a.id, a.channelId, { clientId: randomUUID(), content: "We should use a heap for the scheduler." });
  mocks.gemini.mockImplementation(geminiReply(["Use a ", "min-heap."]));
  const job = ask(a.actor, a, "Explain this algorithm.", { agent: "gemini" }); await finish(a, job);
  expect(status(job.id).status).toBe("completed");
  const call = mocks.gemini.mock.calls[0][0];
  expect(call.model).toBe("gemini-2.5-flash"); expect(call.config.maxOutputTokens).toBe(1024); expect(call.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
  expect(call.contents[0].parts[0].text).toContain("We should use a heap"); expect(mocks.keys).toEqual([GEMINI_KEY]);
  const [reply] = agentMessages(a); expect(reply).toMatchObject({ authorName: "Gemini", agent: "gemini", provider: "gemini", model: "gemini-2.5-flash", content: "Use a min-heap.", mode: "environment" });
  expect(emitted.filter((e) => e.event === "agent:token").map((e) => e.payload.token).join("")).toBe("Use a min-heap.");
  expect(JSON.stringify(emitted)).not.toContain(GEMINI_KEY);
});

it("routes @Llama to Groq with a Llama model and persists conversation metadata for replay", async () => {
  vi.stubEnv("GROQ_API_KEY", GROQ_KEY); const a = fixture();
  mocks.groq.mockImplementation(groqReply(["Try memoization."]));
  const job = ask(a.actor, a, "Suggest an optimization.", { agent: "llama" }); await finish(a, job);
  expect(mocks.groq.mock.calls[0][0]).toMatchObject({ model: "llama-3.3-70b-versatile", stream: true, max_completion_tokens: 1024 }); expect(mocks.keys).toEqual([GROQ_KEY]);
  expect(agentMessages(a)[0]).toMatchObject({ authorName: "Llama", provider: "groq", model: "llama-3.3-70b-versatile" });
  const replay = channelSnapshot(a.actor, a.id, a.channelId, 0).replay as { type: string; payload: { provider?: string; model?: string } }[];
  expect(replay.some((e) => e.type === "message" && e.payload.provider === "groq" && e.payload.model === "llama-3.3-70b-versatile")).toBe(true);
});

it("lets members pick another approved Groq model directly, and rejects mismatched or unapproved overrides", async () => {
  vi.stubEnv("GROQ_API_KEY", GROQ_KEY); vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); const a = fixture(); updateAIConfig(a.actor, a.id, config());
  mocks.groq.mockImplementation(groqReply(["ok"]));
  const job = ask(a.actor, a, "Use the OSS model", { agent: "agent", model: "groq:openai/gpt-oss-20b" }); await finish(a, job);
  expect(mocks.groq.mock.calls[0][0].model).toBe("openai/gpt-oss-20b"); expect(agentMessages(a)[0]).toMatchObject({ authorName: "Room agent", model: "openai/gpt-oss-20b" });
  expect(() => ask(a.actor, a, "x", { agent: "gemini", model: "groq:llama-3.3-70b-versatile" })).toThrow("only runs approved Gemini");
  expect(() => ask(a.actor, a, "x", { agent: "agent", model: "groq:qwen/qwen3.8-27b" })).toThrow("Not approved");
  expect(() => ask(a.actor, a, "x", { agent: "muse", model: "gemini:gemini-2.5-flash-lite" })).toThrow("cannot be overridden");
});

it("Muse answers from this channel's history only, using the owner-selected model, and labels the real model", async () => {
  vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); vi.stubEnv("GROQ_API_KEY", GROQ_KEY); const a = fixture(), other = fixture();
  updateAIConfig(a.actor, a.id, config({ museModel: "groq:llama-3.3-70b-versatile" }));
  sendChannelMessage(a.actor, a.id, a.channelId, { clientId: randomUUID(), content: "Decision: we ship on Friday." });
  sendChannelMessage(other.actor, other.id, other.channelId, { clientId: randomUUID(), content: "SECRET-FROM-OTHER-WORKSPACE" });
  mocks.groq.mockImplementation(groqReply(["You missed: shipping Friday."]));
  const job = ask(a.actor, a, "what did I miss yesterday?", { agent: "muse" }); await finish(a, job);
  const call = mocks.groq.mock.calls[0][0], system = call.messages[0].content as string, prompt = call.messages[1].content as string;
  expect(call.model).toBe("llama-3.3-70b-versatile"); expect(call.max_completion_tokens).toBe(2048);
  expect(system).toContain("You are Muse"); expect(system).toContain("Never invent"); expect(prompt).toContain("Decision: we ship on Friday."); expect(prompt).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
  expect(system + prompt).not.toContain("SECRET-FROM-OTHER-WORKSPACE");
  expect(agentMessages(a)[0]).toMatchObject({ authorName: "Muse", agent: "muse", provider: "groq", model: "llama-3.3-70b-versatile" });
});

it("is the default assistant only when its model is eligible, and otherwise says why", () => {
  const a = fixture(); expect(publicAIConfig(a.actor, a.id).defaultAgent).toBe("agent");
  const muse = publicAIConfig(a.actor, a.id).agents.find((x) => x.id === "muse")!; expect(muse.available).toBe(false); expect(muse.reason).toContain("GEMINI_API_KEY");
  vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); expect(publicAIConfig(a.actor, a.id).defaultAgent).toBe("muse");
  const queued = enqueueChannelAgent(a.actor, a.id, a.channelId, { prompt: "hi", idempotencyKey: randomUUID() }).result.job; expect(queued.id).toBeTruthy();
  expect(db.prepare("SELECT agent,model FROM agent_jobs WHERE id=?").get(queued.id)).toEqual({ agent: "muse", model: "gemini:gemini-2.5-flash" });
});

it("compares other agents' answers: Muse sees them labeled with agent and model, and saves a Markdown artifact without leaking the tag", async () => {
  vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); vi.stubEnv("GROQ_API_KEY", GROQ_KEY); const a = fixture(), b = addMember(a, "Bob");
  mocks.gemini.mockImplementation(async (p: { config: { systemInstruction: string } }) => p.config.systemInstruction.includes("You are Muse")
    ? (async function* () { for (const text of ["Comparison done.\n<arti", "fact title=\"Comparison\" type=\"document\" language=\"markdown\">\n# Gemini vs Llama\n- heap\n</arti", "fact>\nBye."]) yield { candidates: [{ content: { parts: [{ text }] } }] }; })()
    : geminiReply(["Use a heap."])());
  mocks.groq.mockImplementation(groqReply(["Use a sorted list."]));
  const j1 = ask(a.actor, a, "Explain this algorithm.", { agent: "gemini" }), j2 = ask(b, a, "Suggest an optimization.", { agent: "llama" }), j3 = ask(a.actor, a, "Compare the two responses.", { agent: "muse" });
  await finish(a, j1, j2, j3);
  const prompt = mocks.gemini.mock.calls[1][0].contents[0].parts[0].text as string;
  expect(prompt).toContain("Gemini [AI response, Google Gemini · Gemini 2.5 Flash]: Use a heap."); expect(prompt).toContain("Llama [AI response, Groq · Llama 3.3 70B]: Use a sorted list.");
  const tokens = emitted.filter((e) => e.event === "agent:token" && e.payload.jobId === j3.id).map((e) => e.payload.token).join("");
  expect(tokens).not.toContain("<arti"); expect(tokens).not.toContain("# Gemini vs Llama");
  const muse = agentMessages(a).find((m) => m.agent === "muse")!; expect(muse.content).toContain("Saved shared artifact: **Comparison**"); expect(muse.content).not.toContain("<artifact");
  expect(db.prepare("SELECT title,type,language,content,updated_by FROM artifacts WHERE room_id=?").all(a.channelId)).toEqual([{ title: "Comparison", type: "document", language: "markdown", content: "# Gemini vs Llama\n- heap", updated_by: "Muse" }]);
});

it("runs concurrent member requests to different agents strictly FIFO, one active job per channel, in message order", async () => {
  vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); vi.stubEnv("GROQ_API_KEY", GROQ_KEY); const a = fixture(), b = addMember(a, "Bob"), c = addMember(a, "Cy");
  let active = 0, maxActive = 0;
  const slow = <T,>(make: () => AsyncGenerator<T>) => async () => (async function* () { active++; maxActive = Math.max(maxActive, active); try { await new Promise((r) => setTimeout(r, 10)); yield* make(); } finally { active--; } })();
  mocks.gemini.mockImplementation(slow(async function* () { yield { candidates: [{ content: { parts: [{ text: "G" }] } }] }; }));
  mocks.groq.mockImplementation(slow(async function* () { yield { choices: [{ delta: { content: "L" } }] }; }));
  const jobs = await Promise.all([ask(a.actor, a, "one", { agent: "gemini" }), ask(b, a, "two", { agent: "llama" }), ask(c, a, "three", { agent: "gemini" })]);
  await finish(a, ...jobs);
  expect(maxActive).toBe(1); expect(agentMessages(a).map((m) => m.authorName)).toEqual(["Gemini", "Llama", "Gemini"]);
  const seqs = agentMessages(a).map((m) => m.seq); expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  expect((channelSnapshot(b, a.id, a.channelId).messages as unknown[]).length).toBe(6); // every member sees the same shared history
});

it("records provider token usage, including Gemini thinking tokens, per workspace", async () => {
  vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); vi.stubEnv("GROQ_API_KEY", GROQ_KEY); const a = fixture();
  mocks.gemini.mockImplementation(geminiReply(["hi"], { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5 })); mocks.groq.mockImplementation(groqReply(["yo"], { prompt_tokens: 40, completion_tokens: 8 }));
  await finish(a, ask(a.actor, a, "g", { agent: "gemini" }), ask(a.actor, a, "l", { agent: "llama" }));
  const records = getAISettings(a.actor, a.id).records as { provider: string; agent: string; inputTokens: number; outputTokens: number; reservedTokens: number; status: string; costMicros: number }[];
  expect(records.map((r) => [r.provider, r.agent, r.inputTokens, r.outputTokens, r.reservedTokens, r.status, r.costMicros]).sort()).toEqual([["gemini", "gemini", 100, 15, 0, "completed", 0], ["groq", "llama", 40, 8, 0, "completed", 0]]);
  expect(getAISettings(a.actor, a.id).usage.tokens).toBe(163);
});

it("enforces the workspace token quota before calling a provider", async () => {
  vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); vi.spyOn(console, "error").mockImplementation(() => {}); const a = fixture();
  updateAISettings(a.actor, a.id, { approvedModels: ["gpt-4o-mini"], pricing: { "gpt-4o-mini": { input: 0.15, output: 0.6 } }, monthlyTokenLimit: 500, monthlySpendUsd: 20 });
  const job = ask(a.actor, a, "blocked", { agent: "gemini" }); await finish(a, job);
  expect(status(job.id)).toMatchObject({ status: "failed", error: expect.stringContaining("monthly usage or spending limit") }); expect(mocks.gemini).not.toHaveBeenCalled();
});

it("enforces per-member hourly and per-workspace daily request limits and rolls the rejected job back", () => {
  vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); const a = fixture(), b = addMember(a, "Bob");
  updateAIConfig(a.actor, a.id, config({ userHourlyLimit: 1, workspaceDailyLimit: 2 }));
  ask(a.actor, a, "first"); expect(() => ask(a.actor, a, "second")).toThrow("1 AI requests per hour");
  ask(b, a, "bob first"); expect(() => ask(b, a, "bob second")).toThrow(); // blocked by the per-member limit
  const jobs = db.prepare("SELECT COUNT(*) AS n FROM agent_jobs WHERE room_id=?").get(a.channelId) as { n: number }; expect(jobs.n).toBe(2);
  updateAIConfig(a.actor, a.id, config({ userHourlyLimit: 10, workspaceDailyLimit: 2 })); expect(() => ask(a.actor, a, "third")).toThrow("daily limit");
  const dup = randomUUID(); updateAIConfig(a.actor, a.id, config({ userHourlyLimit: 10, workspaceDailyLimit: 100 }));
  const first = enqueueChannelAgent(a.actor, a.id, a.channelId, { prompt: "same", idempotencyKey: dup }).result.job, again = enqueueChannelAgent(a.actor, a.id, a.channelId, { prompt: "same", idempotencyKey: dup }).result;
  expect(again.duplicate).toBe(true); expect(again.job.id).toBe(first.id);
});

it("turns provider failures into safe messages, releases the quota reservation, and never leaks keys", async () => {
  vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); vi.spyOn(console, "error").mockImplementation(() => {}); const a = fixture();
  mocks.gemini.mockRejectedValue(apiError(429, { "retry-after": "45" }));
  const limited = ask(a.actor, a, "rate", { agent: "gemini" }); await finish(a, limited);
  expect(status(limited.id).error).toContain("45s"); expect(status(limited.id).error).not.toContain(GEMINI_KEY);
  expect(getAISettings(a.actor, a.id).usage.tokens).toBe(0); expect(mocks.gemini).toHaveBeenCalledTimes(1);
  const cooling = ask(a.actor, a, "again", { agent: "gemini" }); await finish(a, cooling);
  expect(status(cooling.id).error).toContain("recently reached"); expect(mocks.gemini).toHaveBeenCalledTimes(1); // cooldown: no further provider traffic
  resetProviderGuards(); mocks.gemini.mockRejectedValue(apiError(401));
  const unauthorized = ask(a.actor, a, "auth", { agent: "gemini" }); await finish(a, unauthorized); expect(status(unauthorized.id).error).toContain("GEMINI_API_KEY");
  expect(agentMessages(a)).toEqual([]); // a failed provider never produces a fake reply
  expect(JSON.stringify(db.prepare("SELECT * FROM agent_jobs").all())).not.toContain(GEMINI_KEY);
});

it("retries one transient provider failure, then recovers", async () => {
  vi.stubEnv("GROQ_API_KEY", GROQ_KEY); const a = fixture();
  mocks.groq.mockRejectedValueOnce(apiError(503)).mockImplementation(groqReply(["recovered"]));
  const job = ask(a.actor, a, "flaky", { agent: "llama" }); await finish(a, job);
  expect(status(job.id).status).toBe("completed"); expect(mocks.groq).toHaveBeenCalledTimes(2); expect(agentMessages(a)[0].content).toBe("recovered");
});

it("keeps partial output if a stream breaks midway and marks it incomplete", async () => {
  vi.stubEnv("GROQ_API_KEY", GROQ_KEY); const a = fixture();
  mocks.groq.mockImplementation(async () => (async function* () { yield { choices: [{ delta: { content: "Half an answ" } }] }; throw apiError(503); })());
  const job = ask(a.actor, a, "cut off", { agent: "llama" }); await finish(a, job);
  expect(status(job.id).status).toBe("completed"); expect(agentMessages(a)[0].content).toContain("Half an answ"); expect(agentMessages(a)[0].content).toContain("may be incomplete");
});

it("reports missing credentials clearly and never fabricates a provider response", async () => {
  const a = fixture();
  for (const agent of ["gemini", "llama", "muse"] as const) expect(() => ask(a.actor, a, "hello", { agent })).toThrow(/Not configured: (GEMINI|GROQ)_API_KEY is missing/);
  expect(db.prepare("SELECT COUNT(*) AS n FROM agent_jobs WHERE room_id=?").get(a.channelId)).toEqual({ n: 0 });
  const generic = ask(a.actor, a, "no providers"); await finish(a, generic); // legacy room agent keeps its labeled demo mode
  expect(agentMessages(a)[0]).toMatchObject({ mode: "demo", provider: null, model: null }); expect(mocks.gemini).not.toHaveBeenCalled(); expect(mocks.groq).not.toHaveBeenCalled();
});

it("restricts model and provider configuration to owners and approves only supported free-tier models", () => {
  vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); const a = fixture(), admin = addMember(a, "Ad", "ADMIN"), member = addMember(a, "Mo");
  for (const who of [admin, member]) { expect(() => updateAIConfig(who, a.id, config())).toThrow("not allowed"); expect(() => getAIConfig(who, a.id)).toThrow("not allowed"); }
  expect(AIConfigInput.safeParse(config({ approvedModels: ["gemini:gemini-2.5-pro-paid-only"] })).success).toBe(false);
  expect(AIConfigInput.safeParse(config({ approvedModels: ["openai:gpt-4o"] })).success).toBe(false);
  expect(AIConfigInput.safeParse(config({ museModel: "groq:llama-3.1-8b-instant", approvedModels: ["gemini:gemini-2.5-flash"] })).success).toBe(false);
  expect(AIConfigInput.safeParse(config({ defaultModel: "gemini:gemini-2.5-flash-lite", approvedModels: ["gemini:gemini-2.5-flash"] })).success).toBe(false);
  expect(catalog.filter((m) => m.family !== "llama").every((m) => m.tier === "free")).toBe(true);
  expect(catalog.filter((m) => m.family === "llama").every((m) => m.tier === "account-dependent")).toBe(true);
  updateAIConfig(a.actor, a.id, config({ enabledProviders: ["groq"] }));
  expect(() => ask(member, a, "x", { agent: "gemini" })).toThrow("disabled by a workspace owner");
  expect(publicAIConfig(member, a.id).agents.find((x) => x.id === "gemini")).toMatchObject({ available: false, reason: expect.stringContaining("disabled") });
});

it("blocks access to AI agents for non-members and keeps workspaces' settings independent", () => {
  vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); const a = fixture(), b = fixture();
  expect(() => enqueueChannelAgent(b.actor, a.id, a.channelId, { prompt: "x", idempotencyKey: randomUUID() })).toThrow("Not found");
  expect(() => publicAIConfig(b.actor, a.id)).toThrow("Not found");
  updateAIConfig(a.actor, a.id, config({ enabledProviders: [] })); expect(publicAIConfig(b.actor, b.id).agents.find((x) => x.id === "muse")!.available).toBe(true);
  expect(() => ask(b.actor, a, "x")).toThrow(); // b's owner cannot enqueue in a's channel
});

it("never uses OpenAI without explicit workspace authorization and never falls back to it when a free provider fails", async () => {
  vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real"); vi.stubEnv("GEMINI_API_KEY", GEMINI_KEY); vi.spyOn(console, "error").mockImplementation(() => {}); const a = fixture();
  expect(() => ask(a.actor, a, "x", { agent: "agent", model: "gpt-4o-mini" })).toThrow("Paid OpenAI usage has not been authorized");
  expect(publicAIConfig(a.actor, a.id).modelOptions.some((m) => m.provider === "openai")).toBe(false);
  updateAIConfig(a.actor, a.id, config({ allowPaid: true }));
  mocks.gemini.mockRejectedValue(apiError(500)); mocks.openai.mockImplementation(async () => { throw new Error("OpenAI must not be called"); });
  const job = ask(a.actor, a, "free provider is down", { agent: "agent" }); await finish(a, job);
  expect(status(job.id).status).toBe("failed"); expect(mocks.openai).not.toHaveBeenCalled(); expect(agentMessages(a)).toEqual([]);
});

it("verifies which catalog models the configured keys can actually reach and hides inaccessible ones", async () => {
  vi.stubEnv("GROQ_API_KEY", GROQ_KEY); const a = fixture();
  mocks.groqList.mockResolvedValue({ data: [{ id: "llama-3.3-70b-versatile", active: true }, { id: "llama-3.1-8b-instant", active: false }] });
  const result = await verifyProvider("groq", true); expect(result).toEqual({ ok: true, ids: ["llama-3.3-70b-versatile"] });
  const options = publicAIConfig(a.actor, a.id).modelOptions; expect(options.find((m) => m.key === "groq:llama-3.3-70b-versatile")!.available).toBe(true);
  expect(options.find((m) => m.key === "groq:llama-3.1-8b-instant")).toMatchObject({ available: false, reason: expect.stringContaining("Not accessible") });
  mocks.groqList.mockRejectedValue(apiError(401)); expect(await verifyProvider("groq", true)).toMatchObject({ ok: false, message: expect.stringContaining("GROQ_API_KEY") });
});

it("parses @mentions and filters streamed artifact blocks across chunk boundaries", () => {
  expect(parseMention("@Muse, what did I miss?")).toEqual({ agent: "muse", prompt: "what did I miss?" }); expect(parseMention("@llama optimize")).toEqual({ agent: "llama", prompt: "optimize" });
  expect(parseMention("hello @muse")).toBeNull(); expect(parseMention("@museum notes")).toBeNull();
  const filter = new ArtifactStreamFilter(); let out = ""; for (const part of ["a <", "art", "ifact title=\"t\">x</arti", "fact> b <b>bold</b>"]) out += filter.push(part); out += filter.flush();
  expect(out).toBe("a  b <b>bold</b>");
  expect(extractArtifacts("hi <artifact title=\"T\" type=\"code\" language=\"ts\">\nlet x\n</artifact>").artifacts).toEqual([{ title: "T", type: "code", language: "ts", content: "let x" }]);
  expect(extractArtifacts("bad <artifact type=\"code\">x</artifact>").artifacts).toEqual([]);
});

it("rechecks the shared rate window when concurrent channels wake for one available slot", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  await acquireProviderSlot("gemini", "gemini-2.5-flash");
  now = 10_000;
  for (let i = 0; i < 7; i++) await acquireProviderSlot("gemini", "gemini-2.5-flash");
  now = 45_000;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  sleep.fn = () => waiting;
  const first = acquireProviderSlot("gemini", "gemini-2.5-flash");
  const second = acquireProviderSlot("gemini", "gemini-2.5-flash");
  now = 60_000; release();
  const results = await Promise.allSettled([first, second]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  expect((results[1] as PromiseRejectedResult).reason.message).toContain("local rate guard");
});

it("honors a provider cooldown introduced while a channel is waiting for a slot", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  for (let i = 0; i < 8; i++) await acquireProviderSlot("gemini", "gemini-2.5-flash");
  now = 45_000;
  sleep.fn = async () => { now = 60_000; setProviderCooldown("gemini", 30_000); };
  await expect(acquireProviderSlot("gemini", "gemini-2.5-flash")).rejects.toThrow("recently reached");
});

it("makes models unavailable after an empty model list or failed credential verification", async () => {
  vi.stubEnv("GROQ_API_KEY", GROQ_KEY); const a = fixture();
  mocks.groqList.mockResolvedValue({ data: [] });
  await verifyProvider("groq", true);
  expect(() => ask(a.actor, a, "blocked", { agent: "llama" })).toThrow("Not accessible");
  mocks.groqList.mockRejectedValue(apiError(401));
  await verifyProvider("groq", true);
  expect(() => ask(a.actor, a, "blocked", { agent: "llama" })).toThrow("GROQ_API_KEY");
});

it("shares owner verification across separately loaded API and Socket.IO module instances", async () => {
  vi.stubEnv("GROQ_API_KEY", GROQ_KEY);
  mocks.groqList.mockResolvedValue({ data: [] });
  await verifyProvider("groq", true);
  vi.resetModules();
  const socketModule = await import("../src/server/ai-providers");
  expect(socketModule.cachedVerification("groq")).toEqual({ ok: true, ids: [] });
});

it("does not erase another channel's newer cooldown when retrying a rate-limited call", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  mocks.gemini.mockRejectedValue(apiError(429, { "retry-after": "1" }));
  sleep.fn = async () => { now = 1000; setProviderCooldown("gemini", 60_000); };
  const consume = async () => { for await (const event of streamWithRecovery("gemini", { apiKey: GEMINI_KEY, model: "gemini-2.5-flash", system: "test", user: "hi", maxOutputTokens: 16 })) void event; };
  await expect(consume()).rejects.toThrow("recently reached");
  expect(mocks.gemini).toHaveBeenCalledTimes(1);
});
