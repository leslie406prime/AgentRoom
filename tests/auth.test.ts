import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { beginLink, consumeLink, findSession, identityOwner, listIdentities, unlinkIdentity } from "../src/server/auth-repository";
import { safeRelativePath } from "../src/lib/redirect";
import { assertMockOAuthEnvironment } from "../src/server/mock-oauth";
import { assertOrigin } from "../src/server/http-security";
async function fixture() {
  const id = randomUUID(), token = randomUUID();
  (await db.prepare('INSERT INTO "user" (id, name, created_at) VALUES (?, ?, ?)').run(id, "Test", Date.now()));
  (await db.prepare('INSERT INTO session (sessionToken, userId, expires) VALUES (?, ?, ?)').run(token, id, Date.now()+60000));
  (await db.prepare('INSERT INTO account (userId, type, provider, providerAccountId) VALUES (?, ?, ?, ?)').run(id, "oauth", "google", id));
  return { id, token };
}
describe("authentication boundaries", () => {
  it("accepts relative destinations and rejects alternate origins and backslashes", () => {
    for (const input of ["https://evil.test/", "//evil.test", "/\\evil.test", "javascript:alert(1)", " https://evil.test"]) expect(safeRelativePath(input)).toBe("/");
    expect(safeRelativePath("/invite/token?x=1")).toBe("/invite/token?x=1");
  });
  it("binds one-use linking intent to both session and provider", async () => {
    const a=(await fixture()), b=(await fixture());
    const intent=(await beginLink(a.token,"mock-google"));
    expect((await consumeLink(intent,b.token,"mock-google"))).toBe(false);
    expect((await consumeLink(intent,a.token,"google"))).toBe(false);
    expect((await consumeLink(intent,a.token,"mock-google"))).toBe(true);
    expect((await consumeLink(intent,a.token,"mock-google"))).toBe(false);
  });
  it("rejects expired and revoked sessions", async () => {
    const a=(await fixture()); expect((await findSession(a.token))?.userId).toBe(a.id);
    (await db.prepare('UPDATE session SET expires = 0 WHERE sessionToken = ?').run(a.token));
    expect((await findSession(a.token))).toBeUndefined();
    (await expect((async () => (await beginLink(a.token,"google")))()).rejects.toThrow());
  });
  it("refuses unlinking the final identity and scopes unlinking by user", async () => {
    const a=(await fixture()), b=(await fixture());
    (await expect((async () => (await unlinkIdentity(a.id,"google",a.id)))()).rejects.toThrow());
    (await db.prepare('INSERT INTO account (userId, type, provider, providerAccountId) VALUES (?, ?, ?, ?)').run(a.id,"oauth","google","second-"+a.id));
    (await unlinkIdentity(a.id,"google",b.id));
    expect((await identityOwner("google",b.id))).toBe(b.id);
    (await unlinkIdentity(a.id,"google",a.id));
    expect((await identityOwner("google",a.id))).toBeUndefined();
  });
  it("keeps legacy Microsoft identity rows but does not count them as a usable sign-in method",async ()=>{
    const a=(await fixture());
    (await db.prepare('INSERT INTO account (userId, type, provider, providerAccountId) VALUES (?, ?, ?, ?)').run(a.id,"oauth","microsoft-entra-id","legacy-"+a.id));
    (await expect((async () => (await unlinkIdentity(a.id,"google",a.id)))()).rejects.toThrow());
    expect((await listIdentities(a.id)).map(i=>i.provider)).toEqual(["google"]);
    expect((await identityOwner("microsoft-entra-id","legacy-"+a.id))).toBe(a.id);
  });
  it("rejects missing and foreign Origin on custom mutations", () => {
    expect(()=>assertOrigin(new Request("http://localhost:3000/api/profile",{method:"POST"}))).toThrow();
    expect(()=>assertOrigin(new Request("http://localhost:3000/api/profile",{method:"POST",headers:{origin:"https://evil.test"}}))).toThrow();
  });
  it("fails closed when mock OAuth is enabled in production", () => {
    const env=process.env as Record<string,string|undefined>;
    const mode=env.NODE_ENV, flag=env.AUTH_MOCK_OAUTH_ENABLED;
    try { env.NODE_ENV="production"; env.AUTH_MOCK_OAUTH_ENABLED="true"; expect(()=>assertMockOAuthEnvironment()).toThrow(); }
    finally { env.NODE_ENV=mode; env.AUTH_MOCK_OAUTH_ENABLED=flag; }
  });
});
