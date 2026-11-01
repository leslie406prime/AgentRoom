import { startupFailure } from "./startup-diagnostics";

// Auth.js error.name is a constructor name and changes during production minification.
// Only stable, allowlisted metadata is safe: causes can contain tokens and profiles.
const types = new Set("AuthError AccessDenied AdapterError CallbackRouteError Configuration DuplicateConditionalUI ErrorPageLoop EventError InvalidCallbackUrl InvalidCheck InvalidEndpoints InvalidProvider InvalidProviderId JWTSessionError MissingAdapter MissingAdapterMethods MissingAuthorize MissingCSRF MissingSecret OAuthAccountNotLinked OAuthCallbackError OAuthProfileParseError OAuthSignInError SessionTokenError SignOutError UnknownAction UnsupportedStrategy UntrustedHost".split(" "));
const oauthCodes = new Set("OAUTH_WWW_AUTHENTICATE_CHALLENGE OAUTH_RESPONSE_BODY_ERROR OAUTH_UNSUPPORTED_OPERATION OAUTH_AUTHORIZATION_RESPONSE_ERROR OAUTH_JWT_USERINFO_EXPECTED OAUTH_PARSE_ERROR OAUTH_INVALID_RESPONSE OAUTH_INVALID_REQUEST OAUTH_RESPONSE_IS_NOT_JSON OAUTH_RESPONSE_IS_NOT_CONFORM OAUTH_HTTP_REQUEST_FORBIDDEN OAUTH_REQUEST_PROTOCOL_FORBIDDEN OAUTH_JWT_TIMESTAMP_CHECK_FAILED OAUTH_JWT_CLAIM_COMPARISON_FAILED OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED OAUTH_KEY_SELECTION_FAILED OAUTH_MISSING_SERVER_METADATA OAUTH_INVALID_SERVER_METADATA".split(" "));
const row = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
const type = (value: unknown) => typeof value === "string" && types.has(value) ? value : "AuthError";

export function authFailure(error: unknown) {
  const queue: unknown[] = [error], seen = new Set<unknown>();
  let causeType: string | undefined, code: string | undefined, sqlstate: string | undefined;
  while (queue.length && seen.size < 12) {
    const value = queue.shift();if (seen.has(value)) continue;seen.add(value);
    const item = row(value), stableType = type(item.type);
    if (value !== error && stableType !== "AuthError") causeType ??= stableType;
    const diagnostic = startupFailure(value, "authentication_initialization");
    if (diagnostic.code !== "STARTUP_OPERATION_FAILED") code ??= diagnostic.code;
    sqlstate ??= diagnostic.sqlstate;
    if (typeof item.code === "string" && oauthCodes.has(item.code)) code ??= item.code;
    if (item.cause) queue.push(item.cause);
    if (item.err) queue.push(item.err); // Auth.js wraps the original exception here.
    if (Array.isArray(item.errors)) queue.push(...item.errors.slice(0, 4));
  }
  return { level: "error", event: "auth_error", type: type(row(error).type), ...(causeType ? { cause_type: causeType } : {}), ...(code ? { code } : {}), ...(sqlstate ? { sqlstate } : {}) };
}
