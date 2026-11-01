import { expect, it } from "vitest";
import { authFailure } from "../src/server/auth-diagnostics";
import { signInErrorMessage } from "../src/lib/sign-in-error";

it("logs stable Auth.js types despite minified names and finds wrapped SQLSTATE", () => {
  expect(authFailure({ name: "s", type: "CallbackRouteError", cause: { err: { type: "AdapterError", cause: { err: { code: "23505", message: "private data", detail: "private data" } } } } })).toEqual({ level: "error", event: "auth_error", type: "CallbackRouteError", cause_type: "AdapterError", code: "23505", sqlstate: "23505" });
});
it("never serializes credentials, profiles, arbitrary messages, names, types or codes", () => {
  const privateValue = "sensitive-fixture-value";
  const error = { name: privateValue, type: privateValue, code: privateValue, message: privateValue, stack: privateValue, cause: { err: { code: "OAUTH_JWT_CLAIM_COMPARISON_FAILED", token: privateValue, profile: privateValue } } };
  expect(authFailure(error)).toEqual({ level: "error", event: "auth_error", type: "AuthError", code: "OAUTH_JWT_CLAIM_COMPARISON_FAILED" });
  expect(JSON.stringify(authFailure(error))).not.toContain(privateValue);
  error.cause.err = error as never;
  expect(() => authFailure(error)).not.toThrow();
});
it("reports safe transport codes in Auth.js cause.err", () => {
  expect(authFailure({ type: "CallbackRouteError", cause: { err: { cause: { code: "ETIMEDOUT" } } } }).code).toBe("ETIMEDOUT");
});
it("does not present general configuration or callback failures as an identity collision", () => {
  for (const error of ["Configuration", "CallbackRouteError", "unknown-private-value"]) {
    expect(signInErrorMessage(error)).toContain("could not be completed");
    expect(signInErrorMessage(error)).not.toContain("unknown-private-value");
  }
  expect(signInErrorMessage("OAuthAccountNotLinked")).toContain("never merged");
  expect(signInErrorMessage("LinkRequired")).toContain("account settings");
  expect(signInErrorMessage()).toBeUndefined();
});
