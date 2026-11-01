// Server-only diagnostics. Never serialize an exception, stack, cause, SQL or env.
export type StartupStage = "configuration" | "database_initialization" | "database_connection" | "migration" | "authentication_initialization" | "server_initialization" | "next_preparation" | "job_recovery" | "worker_startup" | "port_binding";
let currentStage: StartupStage = "configuration";
export async function startupStage<T>(stage: StartupStage, operation: () => T | Promise<T>): Promise<T> {
  currentStage = stage;
  console.info(JSON.stringify({ level: "info", event: "server_startup_stage", stage }));
  return operation();
}

const names = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AggregateError", "ReferenceError", "DatabaseError", "error", "AuthError", "MissingSecret", "AdapterError", "OAuthSignInError"]);
const sqlstateClasses = new Set("00 01 02 03 08 09 0A 0B 0F 0L 0P 0Z 20 21 22 23 24 25 26 27 28 2B 2D 2F 34 38 39 3B 3D 3F 40 42 44 53 54 55 57 58 F0 HV P0 XX".split(" "));
const isSQLState = (code: string) => /^[0-9A-Z]{5}$/.test(code) && sqlstateClasses.has(code.slice(0, 2));
const codes: Record<string, [string, string]> = {
  ECONNREFUSED: ["database_connection_refused", "Database connection refused."],
  ENOTFOUND: ["database_dns_failed", "Database hostname resolution failed."],
  EAI_AGAIN: ["database_dns_failed", "Database hostname resolution temporarily failed."],
  ETIMEDOUT: ["database_connection_timeout", "Database connection timed out."],
  ECONNRESET: ["database_connection_reset", "Database connection was reset."],
  EADDRINUSE: ["port_in_use", "The requested listening port is already in use."],
  EACCES: ["permission_denied", "Startup operation was denied permission."],
  EPERM: ["permission_denied", "Startup operation was denied permission."],
  EPIPE: ["connection_closed", "A startup connection was closed."],
  ENOENT: ["startup_file_missing", "A required startup file is missing."],
  ERR_MODULE_NOT_FOUND: ["startup_module_missing", "A required server module is missing."],
  MODULE_NOT_FOUND: ["startup_module_missing", "A required server module is missing."],
  ERR_DLOPEN_FAILED: ["native_module_failed", "A native server dependency could not be loaded."],
  ERR_INVALID_URL: ["configuration_invalid", "A configured URL is invalid."],
  ERR_SOCKET_BAD_PORT: ["port_invalid", "The configured listening port is invalid."],
  CERT_HAS_EXPIRED: ["database_tls_failed", "Database TLS certificate validation failed."],
  DEPTH_ZERO_SELF_SIGNED_CERT: ["database_tls_failed", "Database TLS certificate validation failed."],
  SELF_SIGNED_CERT_IN_CHAIN: ["database_tls_failed", "Database TLS certificate validation failed."],
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: ["database_tls_failed", "Database TLS certificate validation failed."],
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: ["database_tls_failed", "Database TLS certificate validation failed."],
  ERR_TLS_CERT_ALTNAME_INVALID: ["database_tls_failed", "Database TLS certificate validation failed."],
};
const knownMessages: Record<string, [string, string]> = {
  "Set AUTH_SECRET to at least 32 random characters in the project-root .env.local or server environment. Existing environment variables take precedence over .env files.": ["auth_secret_invalid", "AUTH_SECRET is missing or does not meet the required length."],
  "Set AUTH_URL to the canonical application origin.": ["auth_url_missing", "AUTH_URL is required in production."],
  "AUTH_URL must be the application origin.": ["auth_url_invalid", "AUTH_URL must be a valid application origin."],
  "Production requires DATABASE_URL for PostgreSQL; SQLite fallback is disabled.": ["database_url_missing", "DATABASE_URL is required in production."],
  "Build-only database mode cannot start a production server.": ["build_only_runtime_forbidden", "Build-only mode cannot run the production server."],
  "The test server cannot run in production.": ["test_server_runtime_forbidden", "Test server mode cannot run in production."],
  "AUTH_MOCK_OAUTH_ENABLED cannot be enabled in production.": ["mock_oauth_runtime_forbidden", "Mock OAuth cannot run in production."],
  "Connection terminated due to connection timeout": ["database_connection_timeout", "Database connection timed out."],
  "timeout exceeded when trying to connect": ["database_connection_timeout", "Database connection acquisition timed out."],
  "Query read timeout": ["database_query_timeout", "Database query timed out."],
  "Refusing to initialize an unrecognized non-empty PostgreSQL database. Use a fresh empty database.": ["database_schema_unrecognized", "Database schema is non-empty and is not recognized by this application."],
  "PostgreSQL schema is newer than this application.": ["database_schema_newer", "Database schema is newer than this application."],
  "Applied PostgreSQL migration checksum changed.": ["migration_checksum_changed", "An applied migration checksum does not match this release."],
  "DATABASE_URL must be a PostgreSQL URL.": ["database_configuration_invalid", "DATABASE_URL must use the PostgreSQL protocol."],
  "Remote PostgreSQL requires TLS.": ["database_tls_required", "Remote PostgreSQL requires TLS."],
};
function fields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
export function startupFailure(error: unknown, stage: StartupStage = currentStage) {
  const outer = fields(error);
  const errorName = typeof outer.name === "string" && names.has(outer.name) ? outer.name : "Error";
  const constructorName = typeof outer.constructor === "function" ? outer.constructor.name : undefined;
  const errorClass = typeof constructorName === "string" && names.has(constructorName) ? constructorName : errorName;
  const queue: unknown[] = [error], seen = new Set<unknown>();
  let code: string | undefined, known: [string, string] | undefined;
  // Inspect only bounded error metadata, including node:net AggregateError causes.
  while (queue.length && seen.size < 8) {
    const value = queue.shift();if(seen.has(value))continue;seen.add(value);
    const row = fields(value);
    if (typeof row.code === "string" && (Object.hasOwn(codes, row.code) || isSQLState(row.code))) code ??= row.code;
    if (typeof row.message === "string" && Object.hasOwn(knownMessages, row.message)) known ??= knownMessages[row.message];
    if (row.cause) queue.push(row.cause);
    if (Array.isArray(row.errors)) queue.push(...row.errors.slice(0, 4));
  }
  const sqlstate = code && isSQLState(code) ? code : undefined;
  let category = "startup_operation_failed", message = "Startup operation failed; inspect the stage and stable error code.";
  if (known) [category, message] = known;
  if (code && Object.hasOwn(codes, code)) [category, message] = codes[code];
  if (sqlstate) {
    category = sqlstate.startsWith("28") ? "database_authentication_failed" : sqlstate === "42501" ? "database_permission_denied" : sqlstate === "3D000" ? "database_missing" : sqlstate === "57014" ? "database_query_cancelled" : sqlstate.startsWith("42") ? "database_schema_error" : sqlstate.startsWith("08") ? "database_connection_failed" : "database_operation_failed";
    message = "PostgreSQL rejected the startup operation; inspect SQLSTATE and stage.";
  }
  return { level: "error", event: "server_startup_failed", stage, error_name: errorName, error_class: errorClass, category, code: code ?? known?.[0] ?? "STARTUP_OPERATION_FAILED", ...(sqlstate ? { sqlstate } : {}), message };
}
export function logStartupFailure(error: unknown, stage?: StartupStage) {
  const diagnostic = startupFailure(error, stage);
  console.error(JSON.stringify(diagnostic));
  return diagnostic;
}
