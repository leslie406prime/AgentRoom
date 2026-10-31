# Render Free + Neon Free release runbook

Release branch: `feat/production-readiness`. This document prepares a deployment; it does not authorize creating cloud resources or starting a deployment. Production starts with a **fresh, empty PostgreSQL database**. Do not import, export, reset, upload or otherwise change existing local SQLite records. Keep local environment files, SQLite/WAL/SHM files, avatars, backups and temporary test clusters outside Git.

## Verified release scope

The release includes PostgreSQL pooling/TLS, versioned schema initialization, async repositories and Auth.js sessions, worker leases/FIFO/recovery, graceful shutdown, PostgreSQL avatar bytes, sidebar channel creation, persistent agent/model selection, Groq/Muse routing, ambiguous-mention validation, authorization/rate checks and deduplicated failure history. See [verification evidence](POSTGRES_READINESS.md) for actual results: 121 unit tests, 5 PostgreSQL integration tests, the bounded two-browser test, engine/application restart persistence, TypeScript, lint, production build and secret scans passed locally. Mock AI was used; two opt-in live tests were skipped.

Required release files include `package.json`, `package-lock.json`, `.node-version`, `next.config.ts`, `server.ts`, `public/`, `src/`, and `migrations/postgres/001_initial.sql`. The Node startup runs TypeScript directly, so the server source and development runtime tools must remain installed. `.gitattributes` keeps migration SQL in LF form so its checksum is stable across operating systems. Test code under `tests/postgres/` is source only; real temporary clusters under `.tmp/` are excluded.

## Remaining acceptance gates

Linux installation/build, actual Neon pooled TLS connectivity/cold starts, final-domain Google OAuth/secure cookies, hosted reconnect/redeploy behavior and Render runtime memory under concurrent sockets/streams are not yet verified. Windows smoke startup measured 164 MiB idle RSS; it is not evidence of Linux or loaded Render resource usage. Before deploying, validate a clean Node 22 Linux checkout with `npm ci --include=dev`, the isolated PostgreSQL tests, lint/type checks and production build. Supply validation-only server environment values and an in-memory build database; never use the original SQLite database or a real Neon production database for destructive tests.

## Neon setup, after cloud provisioning approval

1. Create one project on **Neon Free** with no upgrade or paid add-ons. Choose plain PostgreSQL and a region close to the intended Render region. PostgreSQL 18 matches the local embedded test major if it is offered. Verify a different target major separately before cutover.
2. Use a new empty database, with no sample data and no new authentication service. Preserve the application's existing Google/Auth.js authentication.
3. In the Connect dialog, choose that database/role and enable **connection pooling**. Copy the supplied pooled connection string privately, retaining its TLS options. Store it only as Render's server-side `DATABASE_URL`; never put its value in Git, a browser variable, a screenshot or logs. This application validates remote certificates.
4. No direct URL or SQLite importer is required by the normal service. Startup applies the checksum-checked PostgreSQL migration in a transaction before serving requests. It refuses an unrecognized non-empty public schema. Do not run `npm run reset` or the local SQLite migration command against production.

## Render setup, after deployment approval

1. Create a native **Node Web Service**, authorize only the private AgentRoom repository, and select `feat/production-readiness` at the reviewed release commit. Choose **Free**, one instance, repository root, no persistent disk and no Render database. Keep auto deploy **off**. Review the plan before confirming creation: creating a service may start its first deployment.
2. Determine the exact final `https://<service>.onrender.com` origin. Set the same `AUTH_URL` before build and runtime; CSP embeds its HTTP/WSS origins at build time. If Render assigns a different origin, update it and rebuild before OAuth acceptance.
3. Use these commands/settings:

   | Setting | Value |
   | --- | --- |
   | Build | `npm ci --include=dev && npm run build` |
   | Start | `npm start` |
   | Health check | `/api/health` |
   | Node | 22, selected by tracked `.node-version` (or explicit `NODE_VERSION=22`) |

   Keep dev dependencies installed: `tsx` and `cross-env` are runtime requirements. Do not replace the custom server with `next start`; it hosts Next.js, Socket.IO and queue workers together. Render supplies `PORT`; the server binds it on `0.0.0.0`.
4. Set server-side environment variables in Render:

   - `NODE_ENV=production`, `DATABASE_URL` from the empty Neon database, and the final HTTPS `AUTH_URL`.
   - A strong stable `AUTH_SECRET` (at least 32 characters), plus the matching existing `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. Keep the local secrets unchanged; enter approved values privately in Render.
   - `AUTH_MOCK_OAUTH_ENABLED=false` and the approved free-tier `GEMINI_API_KEY`/`GROQ_API_KEY` if AI is to be enabled.
   - Leave `OPENAI_API_KEY` unset and workspace `allowPaid=false`. `WORKSPACE_CREDENTIAL_KEY` is unnecessary for a fresh database without encrypted paid-provider credentials.
   - Leave `AGENTROOM_BUILD_ONLY`, `AGENTROOM_POSTGRES_TEST`, `AGENTROOM_MOCK_AI`, `AGENTROOM_E2E_SERVER_MANAGED` and `NEXT_DIST_DIR` unset. The build command sets build-only mode for its own process; production startup rejects that flag. No production SQLite path or avatar directory is required.
5. In the existing Google Web OAuth client, preserve localhost entries and add the exact callback `https://<service>.onrender.com/api/auth/callback/google`. Add the HTTPS origin if authorized JavaScript origins are configured. Check consent-screen/test-user access for the intended audience. Do not add another authentication provider.
6. After approval, perform the first deployment and verify `/api/health`, real Google sign-in/session refresh/sign-out, invitations/roles, two-browser collaboration, approved model restrictions, avatar persistence and restart/redeploy reconnect. Verify actual Neon TLS/cold starts and Linux/native dependencies from the hosted logs without exposing secrets. Do not run the destructive test harness against Neon.
7. Verify the selected plans remain Free and measure runtime memory/quotas before calling hosting accepted. Free services can sleep/restart; do not add artificial keep-alive traffic or upgrade automatically. Keep auto deploy off until hosted acceptance is complete.

Official references: [Render service setup](https://render.com/docs/web-services), [Render Free limits](https://render.com/docs/free), [Node version selection](https://render.com/docs/node-version), [Neon console setup](https://neon.com/docs/get-started/signing-up), [Neon application connections](https://neon.com/docs/connect/connect-from-any-app), and [Google Web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).
