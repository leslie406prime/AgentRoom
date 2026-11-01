import { afterEach, expect, it, vi } from "vitest";
import { logStartupFailure, startupFailure, startupStage } from "../src/server/startup-diagnostics";
afterEach(() => vi.restoreAllMocks());
it.each(["28P01", "42501", "3D000", "42P01", "57014", "08006"])("reports SQLSTATE %s without PostgreSQL exception details", code => {
  const error = Object.assign(new Error("password and session-token-secret in postgres://private-user:private-password@private-host/db"), { code, detail: "oauth-secret", query: "select private-data", table: "private-table" });
  const result = startupFailure(error, "migration");
  expect(result).toMatchObject({ stage: "migration", error_name: "Error", code, sqlstate: code });
  expect(JSON.stringify(result)).not.toMatch(/private-|session-token-secret|oauth-secret|postgres:\/\//);
});
it("extracts a safe nested connection code without serializing aggregate errors or causes", () => {
  const cause = Object.assign(new Error("arbitrary API key"), { code: "ECONNREFUSED" });
  const error = new AggregateError([cause], "DATABASE_URL with credentials");
  expect(startupFailure(error, "database_connection")).toMatchObject({ error_name: "AggregateError", category: "database_connection_refused", code: "ECONNREFUSED" });
  expect(JSON.stringify(startupFailure(error))).not.toMatch(/arbitrary|credentials|DATABASE_URL/);
});
it("never prints arbitrary names, codes, messages, stacks or environment values", () => {
  const secret = "credential-canary-" + "x".repeat(40);
  const error = Object.assign(new Error(secret), { name: secret, code: secret, stack: secret, cause: new Error(secret) });
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  logStartupFailure(error, "authentication_initialization");
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0][0]).not.toContain(secret);
  expect(JSON.parse(spy.mock.calls[0][0])).toMatchObject({ stage: "authentication_initialization", error_name: "Error", code: "STARTUP_OPERATION_FAILED" });
});
it("reports exact migration guard failures using only fixed safe messages", () => {
  expect(startupFailure(new Error("Applied PostgreSQL migration checksum changed."), "migration")).toMatchObject({ category: "migration_checksum_changed", code: "migration_checksum_changed" });
});
it("does not mislabel five-character operating-system codes as SQLSTATE", () => {
  const diagnostic = startupFailure(Object.assign(new Error("private path"), { code: "EPERM" }), "port_binding");
  expect(diagnostic).toMatchObject({ code: "EPERM", category: "permission_denied" });
  expect(diagnostic).not.toHaveProperty("sqlstate");
});
it("retains the precise failing startup stage for the top-level handler", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const error = Object.assign(new Error("may contain bind address"), { code: "EADDRINUSE" });
  await expect(startupStage("port_binding", () => { throw error; })).rejects.toBe(error);
  expect(startupFailure(error)).toMatchObject({ stage: "port_binding", code: "EADDRINUSE", category: "port_in_use" });
});
