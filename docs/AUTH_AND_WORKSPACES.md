# Authentication and workspace architecture status

## What is currently implemented

- Auth.js v5 is configured with Google as the only OAuth provider and the Drizzle adapter over the existing SQLite connection.
- Auth.js database sessions are stored in the `session` table. Session cookies are HttpOnly, SameSite=Lax, and Secure in production.
- The room page and room-creation API require an Auth.js session. Socket.IO reads the session cookie, checks the persisted session, associates room members with the authenticated user, and rechecks session and room membership on data-bearing events.
- Mock Google OAuth endpoints are available only when `AUTH_MOCK_OAUTH_ENABLED=true` outside production. Production custom-server startup rejects that flag.
- The existing room collaboration, FIFO demo-agent queue, artifacts, and refresh restoration have a Playwright test using two independent mock-authenticated identities.

## Local configuration

Copy `.env.example` to `.env`. Set a random `AUTH_SECRET` and `AUTH_URL`. For local testing without external provider credentials, set `AUTH_MOCK_OAUTH_ENABLED=true`. Mock identities are test fixtures and are not an authentication service. For real OAuth, configure Google client credentials and the registered callback URL. Automated tests do not establish that Google is correctly configured or usable.

The OpenAI API key remains server-side. When it is absent, AgentRoom explicitly shows demo mode and uses deterministic local responses. The authenticated collaboration E2E test uses this demo mode; no live OpenAI inference is claimed.

## Important incomplete work

The current persistent model remains room-centric. There are no workspace, channel, workspace-membership, role, invitation, audit-log, AI-settings, or usage-tracking tables or workflows. A signed-in user holding a room URL can join that room; the URL is not an invitation with expiry, revocation, or use limits. No OWNER/ADMIN/MEMBER permissions or workspace isolation policy exists.

The Auth.js setup does not yet provide account connect/unlink controls or profile editing/privacy controls. There is no repository/data-access layer enforcing workspace scopes. The initial SQLite bootstrap is not the required ordered, transactional migration framework and does not migrate legacy rooms into workspaces/channels. OpenAI workspace credentials are not stored or encrypted.

These are known product and security gaps, not completed features. Refer to the requirement-by-requirement results in [IMPLEMENTATION_AUDIT.md](./IMPLEMENTATION_AUDIT.md).

## Authentication update (2026-10-27)

Account settings are at /profile. Connect-provider POST requires the configured Origin and a valid database session. It creates a random one-use intent whose SHA-256 hash is stored with the session and provider for five minutes; an HttpOnly SameSite=Lax cookie carries the raw value. The Auth.js signIn callback requires that intent before linking a previously unknown provider to the signed-in user. Provider identities already attached elsewhere are refused. Disconnect runs transactionally and refuses removal of the last identity. Provider email equality never authorizes linking. Idle sockets recheck session validity every second, in addition to per-event checks, so expiration and external revocation disconnect them.

### Google configuration

Create/select a Google Cloud project, configure its OAuth consent screen and test users, and create an OAuth client with application type Web application. Register http://localhost:3000/api/auth/callback/google locally and https://YOUR_DOMAIN/api/auth/callback/google in production. Put the client ID and secret in AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET; set AUTH_URL to the canonical app origin and AUTH_SECRET to a cryptographically random value. [Official Auth.js Google setup](https://authjs.dev/getting-started/providers/google).

### Microsoft (retired)

Microsoft sign-in was removed; AgentRoom is Google-only. Existing `account` rows with provider `microsoft-entra-id` are intentionally left in the database and are never merged by email. They are hidden from the profile page and do not count as a usable sign-in method. Users whose only identity is Microsoft cannot sign in until an operator-approved recovery plan is applied; list them with a read-only query such as `SELECT COUNT(*) FROM "user" u WHERE EXISTS (SELECT 1 FROM account a WHERE a.userId=u.id AND a.provider='microsoft-entra-id') AND NOT EXISTS (SELECT 1 FROM account a WHERE a.userId=u.id AND a.provider='google')`.
