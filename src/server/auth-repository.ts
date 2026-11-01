import { db } from "./db";
import { randomBytes, createHash } from "node:crypto";

export const sessionCookieName = process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token";
export async function findSession(token: string) {
  return (await db.prepare('SELECT session.userId, session.expires FROM session JOIN "user" ON "user".id = session.userId WHERE sessionToken = ? AND expires > ?').get(token, Date.now())) as { userId: string; expires: number } | undefined;
}
export async function identityOwner(provider: string, account: string) {
  return ((await db.prepare('SELECT userId FROM account WHERE provider = ? AND providerAccountId = ?').get(provider, account)) as { userId: string } | undefined)?.userId;
}
export async function recordVerification(userId: string, verified: boolean, email: string | undefined) {
  if (verified) (await db.prepare('UPDATE "user" SET email_verified_by_provider = 1, emailVerified = COALESCE(emailVerified, ?) WHERE id = ? AND email = ?').run(Date.now(), userId, email ?? null));
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export async function beginLink(token: string, provider: string) {
  if (!(await findSession(token))) throw new Error("Authentication required.");
  const intent = randomBytes(32).toString("base64url");
  (await db.prepare("INSERT INTO account_link_intents (token_hash, session_token, provider, expires) VALUES (?, ?, ?, ?)").run(hash(intent), token, provider, Date.now() + 300_000));
  return intent;
}
export async function consumeLink(intent: string, token: string, provider: string) {
  return (await db.transaction(async () => (await db.prepare("DELETE FROM account_link_intents WHERE token_hash = ? AND session_token = ? AND provider = ? AND expires > ?").run(hash(intent), token, provider, Date.now())).changes === 1).immediate());
}
export async function unlinkIdentity(userId: string, provider: string, account: string) {
  return (await db.transaction(async () => {
    const count = (await db.prepare("SELECT COUNT(*) AS n FROM account WHERE userId = ? AND provider IN ('google', 'mock-google')").get(userId)) as { n: number };
    if (count.n <= 1) throw new Error("Connect another identity before removing this one.");
    (await db.prepare("DELETE FROM account WHERE userId = ? AND provider = ? AND providerAccountId = ?").run(userId, provider, account));
  }).immediate());
}

export async function listIdentities(userId: string) {
  // Legacy identity rows for retired providers stay in the database but are not offered in the UI.
  return (await db.prepare("SELECT provider, providerAccountId FROM account WHERE userId = ? AND provider IN ('google', 'mock-google') ORDER BY provider").all(userId)) as { provider: string; providerAccountId: string }[];
}
