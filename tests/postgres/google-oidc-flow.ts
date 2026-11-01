// Exercise the installed Auth.js engine and real application Google configuration.
// Only Next request cookies/config construction and Google's HTTP endpoints are mocked.
import { expect, it, vi } from "vitest";
import type { NextAuthConfig } from "next-auth";
import type { OAuthConfig } from "next-auth/providers";
import { Auth, customFetch, type AuthConfig } from "@auth/core";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { randomUUID, createHash } from "node:crypto";
import { db } from "../../src/server/db";
import { authAdapter } from "../../src/server/auth-adapter";

const captured = vi.hoisted(() => ({ config: undefined as NextAuthConfig | undefined, cookies: new Map<string, string>() }));
vi.mock("next-auth", () => ({ default: (config: NextAuthConfig) => { captured.config = config;return {}; } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => captured.cookies.has(name) ? { value: captured.cookies.get(name)! } : undefined }) }));
type Identity = { sub: string; email: string; name: string; email_verified: boolean };
const origin = "https://auth.example.test", clientId = "google-fixture-client";
async function browser() {
  vi.stubEnv("AUTH_MOCK_OAUTH_ENABLED", "false");vi.stubEnv("AUTH_URL", origin);vi.stubEnv("AUTH_SECRET", "google-oidc-fixture-secret-12345678901234567890");
  await import("../../src/auth");
  const { privateKey, publicKey } = await generateKeyPair("RS256"), jwk = { ...await exportJWK(publicKey), kid: "fixture", alg: "RS256", use: "sig" };
  const jar = new Map<string, string>(), errors: string[] = [];
  let identity: Identity, nonce = "", challenge = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname.endsWith("/.well-known/openid-configuration")) return Response.json({ issuer: "https://accounts.google.com", authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth", token_endpoint: "https://oauth2.googleapis.com/token", userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo", jwks_uri: "https://www.googleapis.com/oauth2/v3/certs", response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"] });
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/certs")) return Response.json({ keys: [jwk] });
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
      const body = new URLSearchParams(String(init?.body));
      expect(createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url")).toBe(challenge);
      const idToken = await new SignJWT({ ...identity, nonce, picture: null }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer("https://accounts.google.com").setAudience(clientId).setIssuedAt().setExpirationTime("5m").sign(privateKey);
      return Response.json({ access_token: "fixture-access-token", token_type: "Bearer", expires_in: 3600, id_token: idToken, scope: "openid email profile" });
    }
    if (url.hostname === "openidconnect.googleapis.com" && url.pathname.endsWith("/userinfo")) return Response.json(identity);
    throw new Error("Unexpected endpoint in isolated Google fixture.");
  };
  const app = captured.config!;
  const google = app.providers[0] as OAuthConfig<Identity>;
  expect(google.id).toBe("google");expect(google.type).toBe("oidc");
  const config = { ...app, basePath: "/api/auth", providers: [{ ...google, options: { ...google.options, clientId, clientSecret: "fixture-client-secret", [customFetch]: fakeFetch } }], logger: { error: (error: Error) => { errors.push(error.name); }, warn: () => {}, debug: () => {} } } as AuthConfig;
  const request = async (route: string, options?: RequestInit) => {
    captured.cookies = new Map(jar);
    const response = await Auth(new Request(origin + "/api/auth" + route, { ...options, headers: { ...options?.headers, cookie: [...jar].map(([k, v]) => k + "=" + v).join("; ") } }), config);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0], pos = pair.indexOf("="), name = pair.slice(0, pos), value = pair.slice(pos + 1);
      if (/max-age=0/i.test(cookie)) jar.delete(name);else jar.set(name, value);
    }
    return response;
  };
  return {
    errors,
    async login(profile: Identity) {
      identity = profile;
      const csrf = await (await request("/csrf")).json();
      const begin = await request("/signin/google", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: origin + "/" }) });
      const authorization = new URL(begin.headers.get("location")!);
      expect(authorization.hostname).toBe("accounts.google.com");
      nonce = authorization.searchParams.get("nonce")!;challenge = authorization.searchParams.get("code_challenge")!;
      expect(nonce).toBeTruthy();expect(challenge).toBeTruthy();expect(authorization.searchParams.get("state")).toBeTruthy();
      const callback = await request("/callback/google?" + new URLSearchParams({ code: "fixture-code", state: authorization.searchParams.get("state")! }));
      return new URL(callback.headers.get("location")!);
    },
    async session() { return (await request("/session")).json(); },
  };
}
const identity = (email = randomUUID() + "@example.test"): Identity => ({ sub: randomUUID(), email, name: "OIDC fixture", email_verified: true });
export function googleOIDCRegressionTests() {
  it("creates a first-time Google OIDC user, identity and database session without partial records", async () => {
    const client = await browser(), profile = identity();
    const redirect = await client.login(profile);
    expect(redirect.searchParams.get("error")).toBeNull();expect(redirect.href).toBe(origin + "/");expect(client.errors).toEqual([]);
    const owner = await authAdapter.getUserByAccount!({ provider: "google", providerAccountId: profile.sub });
    expect(owner).toBeTruthy();expect(owner!.id).not.toBe(profile.sub);
    expect((await client.session()).user.id).toBe(owner!.id);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM "user" WHERE email=?').get(profile.email))!.n).toBe(1);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM account WHERE userId=?').get(owner!.id))!.n).toBe(1);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?').get(owner!.id))!.n).toBe(1);
  });
  it("returns to the same Google user ID without duplicating accounts", async () => {
    const profile = identity(), first = await browser();expect((await first.login(profile)).searchParams.get("error")).toBeNull();
    const firstId = (await first.session()).user.id, returning = await browser();
    expect((await returning.login(profile)).searchParams.get("error")).toBeNull();expect((await returning.session()).user.id).toBe(firstId);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM "user" WHERE email=?').get(profile.email))!.n).toBe(1);
  });
  it("keeps separate Google accounts isolated and refuses linking another user's identity", async () => {
    const a = await browser(), b = await browser(), ga = identity(), gb = identity();
    expect((await a.login(ga)).searchParams.get("error")).toBeNull();expect((await b.login(gb)).searchParams.get("error")).toBeNull();
    const aId = (await a.session()).user.id, bId = (await b.session()).user.id;expect(aId).not.toBe(bId);
    expect((await a.login(identity())).searchParams.get("error")).toBe("LinkRequired");
    expect((await a.login(gb)).searchParams.get("error")).toBe("AccessDenied");expect((await a.session()).user.id).toBe(aId);
    expect((await authAdapter.getUserByAccount!({ provider: "google", providerAccountId: gb.sub }))!.id).toBe(bId);
  });
  it("never merges Google identities by equal email or creates a new partial user for that collision", async () => {
    const first = identity(), a = await browser();expect((await a.login(first)).searchParams.get("error")).toBeNull();
    const b = await browser();expect((await b.login(identity(first.email))).searchParams.get("error")).toBe("OAuthAccountNotLinked");
    expect((await db.prepare('SELECT COUNT(*) AS n FROM "user" WHERE email=?').get(first.email))!.n).toBe(1);
  });
}
