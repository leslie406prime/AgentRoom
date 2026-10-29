import { touchUser } from "@/server/profile-repository";
import NextAuth from "next-auth";
import { cookies } from "next/headers";
import { consumeLink, findSession, identityOwner, recordVerification, sessionCookieName } from "@/server/auth-repository";
import Google from "next-auth/providers/google";
import type { OAuthConfig } from "next-auth/providers";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { drizzleDb } from "@/server/db";
import { authSchema } from "@/server/auth-schema";
import { assertMockOAuthEnvironment, mockOAuthEnabled } from "@/server/mock-oauth";
import { disconnectSessionSockets } from "@/server/session-sockets";

type MockProfile = {
  sub: string;
  name: string;
  email: string;
  email_verified: boolean;
  picture: null;
};

assertMockOAuthEnvironment();

function mockProvider(id: "mock-google", name: string): OAuthConfig<MockProfile> {
  const origin = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return {
    id,
    name,
    type: "oauth",
    clientId: `agentroom-${id}`,
    clientSecret: "agentroom-mock-secret",
    authorization: `${origin}/api/mock-oauth/authorize`,
    token: `${origin}/api/mock-oauth/token`,
    userinfo: `${origin}/api/mock-oauth/userinfo`,
    checks: ["pkce", "state"],
    allowDangerousEmailAccountLinking: false,
    profile(profile) {
      return {
        id: profile.sub,
        name: (profile.name?.trim() || "AgentRoom member").slice(0,40),
        email: profile.email,
        emailVerified: profile.email_verified ? new Date() : null,
        image: profile.picture,
      };
    },
  };
}

function safeRedirect(url: string, baseUrl: string) {
  const base = new URL(baseUrl);
  if (url.startsWith("//") || url.includes("\\")) return base.toString();
  try {
    const target = new URL(url, base);
    if (target.origin !== base.origin) return base.toString();
    return target.toString();
  } catch {
    return base.toString();
  }
}

const providers = mockOAuthEnabled()
  ? [mockProvider("mock-google", "Google")]
  : [
      Google({
        profile(profile) { return { id: profile.sub, name: (profile.name?.trim() || "AgentRoom member").slice(0,40), email: profile.email, image: profile.picture, emailVerified: profile.email_verified ? new Date() : null }; },
        checks: ["pkce", "state", "nonce"],
        allowDangerousEmailAccountLinking: false,
      }),
    ];

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(drizzleDb, authSchema),
  providers,
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  logger: { error(error) { console.error(JSON.stringify({level:"error",event:"auth_error",type:error.name})); }, warn() { console.warn(JSON.stringify({level:"warn",event:"auth_warning"})); }, debug() {} },
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  useSecureCookies: process.env.NODE_ENV === "production",
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: { signIn: "/sign-in", error: "/sign-in" },
  callbacks: {
    async signIn({ account, profile }) {
      if (!account) return false;
      const jar = await cookies();
      const token = jar.get(sessionCookieName)?.value;
      const session = token ? findSession(token) : undefined;
      if (!session) return true;
      const owner = identityOwner(account.provider, account.providerAccountId);
      if (owner) return owner === session.userId;
      // Auth.js normally links new identities whenever a session cookie exists.
      // Require a one-use intent from the explicit authenticated connect action.
      const intent = jar.get("agentroom.link-intent")?.value;
      const verified = profile?.email_verified === true;
      if (!verified || !intent || !token || !consumeLink(intent, token, account.provider)) return "/sign-in?error=LinkRequired";
      return true;
    },
    async redirect({ url, baseUrl }) {
      return safeRedirect(url, baseUrl);
    },
    async session({ session, user }) {
      if (session.user) session.user.id = user.id;
      touchUser(user.id);
      return session;
    },
  },
  events: {
    async signIn({ user, profile }) {
      const verified = profile && "email_verified" in profile && profile.email_verified === true;
      if (user.id) recordVerification(user.id, Boolean(verified), typeof profile?.email === "string" ? profile.email : undefined);
    },
    async signOut(message) {
      if ("session" in message && message.session?.sessionToken) {
        disconnectSessionSockets(message.session.sessionToken);
      }
    },
  },
});
