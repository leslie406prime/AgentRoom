// Messages of this error type are safe to show to channel members. When releaseUsage is true the provider
// never consumed tokens, so the quota reservation is released instead of retained.
import { catalog, parseModelKey } from "../lib/ai-catalog";
import { knownModelPrices } from "../lib/ai-models";
export type JobErrorCode = "JOB_REJECTED" | "MODEL_PERMISSION" | "PROVIDER_VERIFICATION" | "MISSING_ENVIRONMENT" | "ACCESS_DENIED" | "CHANNEL_UNAVAILABLE" | "WORKSPACE_QUOTA" | "USAGE_RESERVATION_EXISTS" | "CREDENTIAL_DECRYPTION_FAILED";
export class PublicJobError extends Error { constructor(message: string, public releaseUsage = false, public code: JobErrorCode = "JOB_REJECTED") { super(message); } }

export type AgentTrace = { stage: "deduplicate" | "model_selection" | "context" | "usage_reservation" | "provider" | "artifact_persistence" | "message_persistence"; provider?: string | null; model?: string; maxOutputTokens?: number; inputChars?: number; startedAt: number };
const traces = new WeakMap<Error, AgentTrace>();
export function traceAgentError(error: unknown, trace: AgentTrace) {
  const failure = error instanceof Error ? error : new Error("Internal agent failure");
  traces.set(failure, { ...trace }); return failure;
}
// Explicit allowlists: SDK error messages, stacks, headers, arbitrary codes and causes are never logged.
const codes = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "ABORT_ERR", "API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED", "UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "INVALID_ARGUMENT", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED", "CLIENT_TIMEOUT", "SQLITE_BUSY", "SQLITE_CONSTRAINT_FOREIGNKEY", "SQLITE_CONSTRAINT_UNIQUE"]);
export function safeErrorMetadata(error: unknown): { httpStatus?: number; errorCode?: string; timeout?: boolean } {
  const result: { httpStatus?: number; errorCode?: string; timeout?: boolean } = {};
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const e = current as { status?: unknown; code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    if (typeof e.status === "number" && e.status >= 100 && e.status <= 599) result.httpStatus ??= e.status;
    if (typeof e.code === "string" && codes.has(e.code)) result.errorCode ??= e.code;
    if (e.name === "AbortError" || e.name === "TimeoutError" || e.name === "APIConnectionTimeoutError") result.timeout = true;
    // Google sometimes nests a JSON error envelope in its message. Read only allowlisted status/reason codes.
    if (typeof e.message === "string") {
      if (/timeout|timed out|aborted/i.test(e.message)) result.timeout = true;
      try {
        const envelope = JSON.parse(e.message)?.error;
        if (typeof envelope?.code === "number" && envelope.code >= 100 && envelope.code <= 599) result.httpStatus ??= envelope.code;
        for (const code of [envelope?.status, ...(Array.isArray(envelope?.details) ? envelope.details.map((d: { reason?: unknown }) => d?.reason) : [])]) if (typeof code === "string" && codes.has(code)) result.errorCode = code;
      } catch { /* Never forward raw provider text. */ }
    }
    current = e.cause;
  }
  if (/TIMEOUT|DEADLINE_EXCEEDED|ABORT_ERR/.test(result.errorCode ?? "")) result.timeout = true;
  if (result.timeout && !result.errorCode) result.errorCode = "CLIENT_TIMEOUT";
  return result;
}

export function agentFailureDiagnostic(error: unknown) {
  const trace = error instanceof Error ? traces.get(error) : undefined;
  const typed = error as { kind?: unknown; diagnostics?: unknown; code?: unknown; status?: unknown } | null;
  const categories = new Set(["auth", "rate_limit", "unavailable", "bad_request", "blocked", "unknown", "timeout", "network"]);
  const appCodes = new Set(["JOB_REJECTED", "MODEL_PERMISSION", "PROVIDER_VERIFICATION", "MISSING_ENVIRONMENT", "ACCESS_DENIED", "CHANNEL_UNAVAILABLE", "WORKSPACE_QUOTA", "USAGE_RESERVATION_EXISTS", "CREDENTIAL_DECRYPTION_FAILED"]);
  const providerFailure = typeof typed?.kind === "string" && categories.has(typed.kind);
  const category = providerFailure ? typed!.kind : typeof typed?.code === "string" && appCodes.has(typed.code) ? typed.code : [401, 403, 404].includes(Number(typed?.status)) ? "ACCESS_DENIED" : typed?.status === 429 ? "request_limit" : "internal";
  const details = typed?.diagnostics && typeof typed.diagnostics === "object" ? typed.diagnostics as Record<string, unknown> : {};
  const meta = safeErrorMetadata(error);
  return {
    category, stage: trace?.stage ?? "execution",
    ...(trace ? { elapsedMs: Math.max(0, Date.now() - trace.startedAt), maxOutputTokens: trace.maxOutputTokens, inputChars: trace.inputChars } : {}),
    ...(trace?.model ? { provider: safeProvider(trace.provider), model: safeModel(trace.model) } : {}),
    httpStatus: providerFailure ? (typeof details.httpStatus === "number" ? details.httpStatus : meta.httpStatus ?? null) : null,
    applicationStatus: !providerFailure && typeof typed?.status === "number" ? typed.status : undefined,
    errorCode: typeof details.errorCode === "string" && codes.has(details.errorCode) ? details.errorCode : meta.errorCode ?? null,
    attempts: typeof details.attempts === "number" ? details.attempts : undefined,
    partial: typeof details.partial === "boolean" ? details.partial : undefined,
  };
}

export function safeProvider(provider: unknown) { return ["gemini", "groq", "openai"].includes(String(provider)) ? String(provider) : null; }
export function safeModel(model: unknown) {
  if (typeof model !== "string") return null;
  const id = /^(gemini|groq|openai):/.test(model) ? parseModelKey(model)?.id : model;
  return id && (catalog.some(entry => entry.id === id) || Object.hasOwn(knownModelPrices, id)) ? id : "custom_or_unknown_model";
}
