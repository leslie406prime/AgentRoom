import { expect, it } from "vitest";
import { classifyProviderError } from "../src/server/ai-providers";
import { agentFailureDiagnostic, PublicJobError, safeErrorMetadata, safeModel, safeProvider, traceAgentError } from "../src/server/job-errors";
import { HttpError } from "../src/server/http-security";

const secret = "never-log-provider-secret-or-private-conversation";
it.each([[401,"auth"],[403,"auth"],[400,"bad_request"],[404,"bad_request"],[429,"rate_limit"],[503,"unavailable"]] as const)("keeps safe provider status %s and category %s without raw SDK details", (status, kind) => {
  const raw = Object.assign(new Error(secret), { status, headers: { authorization: secret }, stack: secret });
  const failure = classifyProviderError("gemini", "gemini-3.8-flash", raw);
  const diagnostic = agentFailureDiagnostic(traceAgentError(failure, { stage: "provider", startedAt: Date.now(), maxOutputTokens: 2048, inputChars: 123 }));
  expect(diagnostic).toMatchObject({ category: kind, stage: "provider", httpStatus: status, maxOutputTokens: 2048 });
  expect(JSON.stringify(diagnostic) + failure.message).not.toContain(secret);
});
it("distinguishes a nested connection timeout from an HTTP service failure", () => {
  const raw = Object.assign(new TypeError("fetch failed " + secret), { cause: { code: "UND_ERR_CONNECT_TIMEOUT", message: secret } });
  const failure = classifyProviderError("gemini", "gemini-3.8-flash", raw);
  expect(agentFailureDiagnostic(failure)).toMatchObject({ category: "timeout", httpStatus: null, errorCode: "UND_ERR_CONNECT_TIMEOUT" });
  expect(failure.releaseUsage).toBe(false);
  expect(failure.message).toContain("timed out");
});
it("recognizes Google's HTTP 400 invalid-key reason without exposing the envelope", () => {
  const raw = Object.assign(new Error(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: secret, details: [{ reason: "API_KEY_INVALID" }] } })), { status: 400 });
  const failure = classifyProviderError("gemini", "gemini-3.8-flash", raw);
  expect(agentFailureDiagnostic(failure)).toMatchObject({ category: "auth", httpStatus: 400, errorCode: "API_KEY_INVALID" });
  expect(failure.message).not.toContain(secret);
});
it.each(["MODEL_PERMISSION", "PROVIDER_VERIFICATION", "MISSING_ENVIRONMENT", "WORKSPACE_QUOTA", "ACCESS_DENIED"] as const)("identifies application rejection %s separately from provider HTTP errors", code => {
  expect(agentFailureDiagnostic(new PublicJobError("Safe explanation", false, code))).toMatchObject({ category: code, httpStatus: null });
  expect(agentFailureDiagnostic(new HttpError(400, "Safe explanation", code))).toMatchObject({ category: code, httpStatus: null, applicationStatus: 400 });
});
it("retains internal persistence stage without logging arbitrary properties or stack", () => {
  const raw = Object.assign(new Error(secret), { code: secret, headers: secret, stack: secret });
  expect(safeErrorMetadata(raw)).toEqual({});
  const diagnostic = agentFailureDiagnostic(traceAgentError(raw, { stage: "message_persistence", startedAt: Date.now() }));
  expect(diagnostic.category).toBe("internal"); expect(diagnostic.stage).toBe("message_persistence");
  expect(JSON.stringify(diagnostic)).not.toContain(secret);
});

it("logs catalog model IDs but never arbitrary model/provider strings", () => {
  expect(safeModel("gemini:gemini-3.8-flash")).toBe("gemini-3.8-flash");
  expect(safeModel(secret)).toBe("custom_or_unknown_model"); expect(safeProvider(secret)).toBeNull();
});
