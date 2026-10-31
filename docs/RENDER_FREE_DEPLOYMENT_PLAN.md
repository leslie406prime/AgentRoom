# AgentRoom: free Render deployment assessment

> Release preparation: use the [current Render + Neon release runbook](RENDER_NEON_RELEASE.md) for the passing PostgreSQL verification and exact fresh-database deployment settings. The assessment below is retained as historical planning evidence, not as the current deployment procedure.

> Current scope update: production will use a **fresh, empty Neon Free database**. Existing SQLite records stay local; no SQLite importer, export, upload or cutover is required. The assessment below is historical: PostgreSQL repositories, migrations, leases and avatar blobs have since been implemented. See [current PostgreSQL verification](POSTGRES_READINESS.md) for results and remaining gates. The copy-only migration section below does not apply to this deployment.

Reviewed October 31, 2026. Planning only: no deployment, external database provisioning, PostgreSQL implementation, or data migration has been performed.

## Recommendation and readiness

Use **one Render Free Node.js Web Service plus one Neon Free PostgreSQL project**, after porting the persistence layer and validating a copy-only migration. Keep the existing Next.js/custom Node/Socket.IO architecture, Google OAuth and Gemini/Groq/Muse integrations. Do not introduce another authentication service, paid AI provider, Redis service, or background-worker service.

**The current application can start as a Node web service, but is NOT ready for a durable Render deployment.** Its SQLite database and uploaded avatar files are local. Render Free cannot retain them across restarts, redeployments or idle spin-down. A `DATABASE_URL` environment variable alone changes nothing: the current database module only reads `DATABASE_PATH`.

Render Free is suitable for an intermittent portfolio demonstration, not a guarantee of continuous availability. It sleeps after 15 minutes without inbound HTTP/WebSocket traffic, has monthly usage limits, and can restart. Do not use artificial keep-alive traffic. Use the free `onrender.com` address and free managed HTTPS; no purchased domain is necessary. Keep the account on Free with no payment method or optional paid features. [Render free-service documentation](https://render.com/docs/free)

## Free database comparison

| Option | Current free offering | Fit for this project |
| --- | --- | --- |
| Neon Free PostgreSQL | $0, no card or time limit; 1 GB database storage/project, 100 CU-hours/project/month, 5 GB public transfer/project/month; compute sleeps after five idle minutes | Recommended. Storage survives compute suspension and Render restarts. Fits the present database comfortably. |
| Supabase Free PostgreSQL | 500 MB database, 1 GB file storage; two active projects; pauses after one inactive week | Viable alternative, especially if file storage is important. Pausing adds another portfolio availability concern; keep existing Auth.js/Google authentication rather than switching to Supabase Auth. |
| Render Free PostgreSQL | Expires after 30 days, then requires an upgrade to regain access | Unsuitable for a lasting, completely free portfolio database. |
| SQLite on the Render service | Ephemeral local file; no persistent disk on Free | Unsuitable for preserving records. |

Sources: [Neon pricing](https://neon.com/pricing), [Neon plan limits](https://neon.com/docs/introduction/plans), [Supabase pricing](https://supabase.com/pricing), [Render free database limits](https://render.com/docs/free). These are current published allowances, not a guarantee that providers will keep the same plans forever.

Neon's Free quota exhaustion suspends compute or blocks growth rather than charging Free-plan overages; it does not delete the existing records. Remain on Free. Do not click an upgrade or create chargeable snapshots/add-ons. Its short restore window is not a substitute for private, independently stored backups. [Neon free-limit behavior](https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md)

Remote SQLite/libSQL is not a drop-in substitute for `better-sqlite3`: its network calls would also require asynchronous repositories and transaction changes. PostgreSQL is the recommended migration target rather than adding a filesystem synchronization workaround to ephemeral Render storage.

## Verified server/build architecture

Evidence:

- `package.json`: `build` is `next build`; `start` is `cross-env NODE_ENV=production tsx --import ./src/server/environment.ts server.ts`.
- `server.ts`: reads `Number(process.env.PORT ?? 3000)` and binds `0.0.0.0` outside the isolated test mode. Next.js and Socket.IO share this HTTP server and port.
- `src/server/environment.ts`: loads environment before server/auth/provider imports; requires the existing strong `AUTH_SECRET` and production `AUTH_URL`; forbids production mock OAuth.
- `src/components/RoomClient.tsx`: connects Socket.IO to the current origin and reconnects; durable snapshots/replay are provided by the collaboration repository.
- `next.config.ts`: derives HTTP/WebSocket CSP origins from `AUTH_URL` **at build time**. Set the final HTTPS URL before BOTH building and starting. Changing it only at runtime leaves stale CSP headers; rebuild after domain changes.
- `src/auth.ts`: Google-only real OAuth, database sessions, secure production cookies and trusted reverse-proxy host handling already exist.

Render supports public WebSocket connections; clients use HTTPS/WSS publicly. Preserve Socket.IO's normal `/socket.io/` path, default heartbeat, authentication and strict origin checks. Keep one application instance. No separate socket server or static-site deployment is appropriate. [Render WebSockets](https://render.com/docs/websocket), [Render web-service binding requirements](https://render.com/docs/web-services)

### Proposed settings, after database blockers are resolved

| Render field | Value |
| --- | --- |
| Service type | Web Service; native Node runtime; Free instance |
| Repository | Existing private AgentRoom repository; authorize access to this repository only |
| Branch | A reviewed PostgreSQL-ready feature/release commit; do not assume `main` contains the current fixes |
| Root directory | Repository root |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check | `/api/health` |
| Auto deploy | Off until migration/cutover approval and tests pass |
| Persistent disk / managed Render database | None |

`tsx` and `cross-env` are currently **devDependencies used at runtime**. `--include=dev` is necessary with this unchanged start command; do not prune them after building. A later packaging improvement could move runtime tools to dependencies or compile the custom server, but `next start` must not replace this custom server because it would omit Socket.IO and job workers. Never run `npm run dev` on Render.

Pin the tested Node 22 major via `NODE_VERSION=22` (latest supported patch in that major). Local validation used Node 22.20.0. The repository currently has no Node engine/version pin. Render's default is a different major, so Linux compatibility of native `better-sqlite3` and `sharp` must be tested explicitly; the SQLite package may become local import tooling only after the port. Do not upload Windows `node_modules`. [Render Node version selection](https://render.com/docs/node-version)

Free runtime resources are small (512 MB / 0.1 CPU). Local startup/build success does not prove fit under Render's runtime memory limit or its Linux build environment. Measure production RSS and test concurrent sockets/AI streams before declaring the hosted service ready. If it does not fit, optimize it or keep deployment blocked; do not upgrade automatically. [Render compute plans](https://render.com/docs/compute-plans)

## Production environment variables

Set secrets only in the Render environment dashboard, not Git, browser code, a Blueprint containing values, or logs. The final public HTTPS origin must also be available during the build.

| Variable | Production value/purpose |
| --- | --- |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22`; pin a tested supported patch before release if exact reproducibility is required |
| `AUTH_URL` | `https://<your-service>.onrender.com`, with no path/query; build and runtime must agree |
| `AUTH_SECRET` | Existing valid secret, at least 32 characters. Preserve it; do not regenerate it during deployment. |
| `AUTH_GOOGLE_ID` | Existing Google web OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Matching client secret, server-side only |
| `AUTH_MOCK_OAUTH_ENABLED` | `false` |
| `GEMINI_API_KEY` | Server-side key for an account/project eligible for the intended free model; no billing activation |
| `GROQ_API_KEY` | Server-side Groq free-plan key; no paid xAI integration |
| `PORT` | Supplied by Render; do not hardcode `3000` in its dashboard |
| `DATABASE_URL` | **Proposed after the port**: pooled Neon connection string with TLS/certificate validation. Not supported by today's code. Never prefix it with `NEXT_PUBLIC_`. |
| `DIRECT_DATABASE_URL` | **Proposed migration-tool-only** direct connection URL, if required; not needed by normal request handlers. Keep off the web service if it is not used there. |
| `WORKSPACE_CREDENTIAL_KEY` | Preserve the existing key if encrypted workspace credentials are imported. Optional when there are no such credentials and paid OpenAI remains unavailable. Never replace it and strand ciphertext. |

Leave `OPENAI_API_KEY` unset and workspace `allowPaid=false`. Muse uses Gemini or Groq; no Muse key is needed. Leave `AGENTROOM_E2E_SERVER_MANAGED` and `AGENTROOM_MOCK_AI` unset. Leave `NEXT_DIST_DIR` unset for a normal `.next` build, or set the SAME value for build/start. `AUTH_TRUST_HOST` is not required by this code because it already sets `trustHost: true`.

`DATABASE_PATH` and `AVATAR_DIRECTORY` currently point to local files. They are useful locally, but are not a durable Render storage solution. Do not point `DATABASE_PATH` at a PostgreSQL URL. Do not deploy with an SQLite fallback when production `DATABASE_URL` is absent: the port must fail startup clearly instead of silently creating an empty local database.

## Google OAuth setup for Render

Once the final service address is known (no deployment/account changes have been made here):

1. In Google Cloud / Google Auth Platform, open the existing **Web application** OAuth client. Preserve its localhost entries.
2. Add the exact redirect URI `https://<your-service>.onrender.com/api/auth/callback/google`.
3. If authorized JavaScript origins are configured, add `https://<your-service>.onrender.com` with no callback path. Auth.js uses the server-side OAuth redirect flow; an origin entry does not replace the redirect URI.
4. Set Render's `AUTH_URL` to that same HTTPS origin before building. Use the matching client ID/secret; never the Gemini key or downloaded client JSON in a public folder.
5. For a consent screen in Testing, add the intended Google test users as applicable. For public portfolio access, review the consent-screen publishing requirements; domain/brand verification requirements depend on the chosen configuration. Do not request extra Google API scopes or bypass consent restrictions.
6. Verify real Google sign-in, secure session persistence after refresh, sign-out/socket revocation, and a second user's invitation acceptance over the actual HTTPS domain. Existing localhost cookies will not transfer to another domain; a fresh login should map to the preserved Google account/user ID.

Redirect URIs must match exactly, including scheme and path. No Microsoft credentials are required. [Google web-server OAuth instructions](https://developers.google.com/identity/protocols/oauth2/web-server)

## SQLite dependency audit

The source has roughly 214 direct `db.prepare/transaction/pragma/exec` call sites across 15 server files, plus the SQLite-specific Auth.js schema/adapter. This is a persistence-layer migration, not a one-line driver swap.

| Files | Persistent responsibility / necessary PostgreSQL work |
| --- | --- |
| `src/server/db.ts` | Opens `better-sqlite3`, creates directories, enables WAL/foreign keys/busy timeout and migrates on import. Replace production connection/migration lifecycle; port atomic event sequencing and replay queries. |
| `src/server/auth-schema.ts`, `src/auth.ts` | `sqliteTable`, SQLite timestamp/boolean modes, `drizzle-orm/better-sqlite3` adapter connection. Add PostgreSQL tables/driver without changing Google identity rules. |
| `src/server/auth-repository.ts`, `profile-repository.ts` | Session/identity linking, account safety checks, user profiles/activity. Make queries asynchronous and retain exact identity matching/transaction guarantees. |
| `src/server/workspace-repository.ts`, `channel-repository.ts` | Workspaces, roles, invitations, legacy room claiming, channel normalization and uniqueness. Preserve all IDs, membership enforcement and atomic invitation use/ownership checks. |
| `src/server/collaboration-repository.ts`, `db.ts` | Shared messages/artifacts/version history, snapshots, deletion/moderation events, channel sequence numbers and replay. Commit data and durable events atomically, then broadcast. |
| `src/server/queue.ts` | Persistent jobs, `MAX(enqueue_order)+1`, atomic claim/cancel/recovery and process-local running map. Replace immediate SQLite write locks with PostgreSQL row locking/worker ownership; preserve FIFO and the partial unique index allowing one running job/channel. |
| `src/server/ai-repository.ts`, `ai-workspace.ts` | Provider/model permissions, credential references, token reservations, usage and quotas. Lock quota/reservation rows so concurrent channels cannot bypass limits. |
| `src/server/muse.ts` | Fetches bounded channel history/artifacts directly. Await queries while maintaining channel/workspace isolation. |
| `src/server/avatar-repository.ts`, `avatar-storage.ts` | Database metadata plus real WebP files on disk. Moving metadata alone will still lose images. |
| `src/server/migrations.ts`, `workspace-schema.ts`, `ai-schema.ts`, `portable-schema.ts` | SQLite DDL, PRAGMA/schema introspection, `INSERT OR IGNORE`, `AUTOINCREMENT`, `datetime('now')`, backup logic and legacy mappings. Create versioned PostgreSQL migrations, not a replay of SQLite DDL. |
| `scripts/migrate.ts`, `scripts/reset-db.ts` | SQLite-specific operational commands. Preserve local tooling; never run reset against a deployment. Add separate explicit PostgreSQL tooling later. |
| Unit fixtures and `tests/e2e/test-database.ts` | Direct SQLite setup/SQL assertions. Retain local SQLite tests where useful and add PostgreSQL integration fixtures; mock-only/SQLite-only passes do not verify the port. |

API routes, server-rendered pages, socket authentication/handlers and `agent-worker.ts` depend indirectly on these synchronous repositories; callers need `await` and transaction-aware error handling throughout the async port. SDK provider adapters do not themselves need to change.

The audited local database is schema v6, passes `quick_check`, and has zero foreign-key violations. At audit time it contained 25 application/migration tables, 2 users, 18 workspaces, 19 channels, 56 messages, 27 agent jobs, 7 artifacts, 6 artifact versions and 16 legacy room links. These are a read-only snapshot, not an assertion that ongoing manual use cannot add records.

## PostgreSQL implementation plan (not executed)

1. Add a production PostgreSQL repository/connection path using `pg` and Drizzle's node-postgres driver, with a small shared connection pool, bounded acquisition/query timeouts, and TLS validation. Use Neon's supplied pooled URL. Keep the SQLite/local path intact during development; production must require PostgreSQL explicitly. [Drizzle PostgreSQL drivers](https://orm.drizzle.team/docs/get-started-postgresql), [Auth.js Drizzle adapter](https://authjs.dev/getting-started/adapters/drizzle)
2. Build versioned PostgreSQL schema migrations and async repositories. Preserve TEXT IDs: some existing IDs are NanoIDs/legacy strings, not UUIDs. Quote camel-case Auth.js identifiers or consistently map them. Convert `?` placeholders to parameterized `$1…`, `.run/.get/.all/.changes` to explicit result handling, and `.transaction(...).immediate()` to awaited transactions on the same checked-out client.
3. Deliberately map milliseconds, ISO timestamps, booleans and large counters. PostgreSQL `COUNT`/bigint values can be strings in Node. Do not silently change JavaScript sequence comparisons. Retain JSON as text initially or adapt every JSON parser if adopting JSONB. Replace SQLite-only defaults, introspection and autoincrement syntax; reset imported numeric sequences safely.
4. Serialize per-channel sequence/enqueue allocation with a locked channel/room row or equivalent atomic counter. Claim FIFO jobs transactionally with a durable worker/channel lease and retain the one-running-job constraint. Do not hold a database transaction open while waiting for an AI stream. `SKIP LOCKED` alone is insufficient to prevent two different jobs in one channel from running.
5. Account for old/new Render processes overlapping during a deployment. Today's `recoverJobs()` requeues **all** running jobs, which is unsafe against another live worker on a shared database. Recover expired/dead worker leases only. Keep job IDs, idempotency keys and completed-message deduplication; do not promise exactly-once upstream AI billing if a process dies after the provider accepts a request. Add bounded SIGTERM draining and honest interrupted-job recovery.
6. Do not use session-scoped advisory locks through a transaction pooler. Use transaction-scoped row locks and durable ownership fields, or a deliberately compatible connection strategy. [Neon pooling constraints](https://neon.com/docs/connect/connection-pooling)
7. For the small, re-encoded 256px workspace avatars, prefer bounded PostgreSQL `bytea` storage initially (separate image-content table, authenticated reads, existing validation). This avoids another service and filesystem dependency. Alternatively evaluate a free object-storage allowance separately; do not assume local upload paths survive deployment. Google profile-image URLs can remain URLs.
8. Rework `/api/health` for awaited PostgreSQL readiness. Its existing `demoMode` field checks OpenAI alone and does not accurately describe Gemini/Groq availability; do not use that field as AI readiness evidence. Avoid frequently polling the database merely to keep either free service awake.

## Copy-only migration and approval boundary

No existing records have been exported, uploaded or migrated for this assessment. Before any real migration:

1. Obtain explicit approval for the destination Free project, which records leave the computer, and whether this is an empty public demo or an approved copy of existing personal conversations. A private local workspace is not automatically appropriate portfolio seed data.
2. Take a consistent SQLite backup with the SQLite backup API (or a stopped-writer backup including WAL handling), privately outside Git. Check integrity and restore it into a separate local test copy. Do not copy only the main database file while ignoring live WAL changes. Preserve avatar files and any existing credential-encryption key separately.
3. Inventory all 25 tables, constraints and references. Import a copy into an isolated PostgreSQL database in dependency order, preserving users/accounts/memberships/IDs, legacy links, message sequences, job enqueue order/status, artifacts/version history, invitations, settings, usage and events. Handle session/verification/link-intent tokens as secrets; decide explicitly whether to expire them at cutover. Preserve user/account records even when sessions are invalidated.
4. Compare every table's row counts, deterministic content checksums, foreign keys, uniqueness, latest channel sequence and event ordering. Confirm each Google identity resolves to its original user ID. Restore/export/import testing must pass before production cutover.
5. Run real PostgreSQL integration and two-browser tests: login/invites, channel creation/roles, model permissions, two-channel isolation, FIFO under concurrency, quota reservation, artifacts/version conflicts, socket replay, restart recovery and reconnect to a replacement app process. Use mocked AI routinely; one minimal approved free-tier live request/provider only if separately needed.
6. With approval, freeze writes briefly, create/import the final consistent backup, validate it, then switch production to PostgreSQL. Keep the original SQLite file and the pre-cutover app/config for rollback. Do not dual-write or automatically reconcile new PostgreSQL records back into SQLite. A rollback after new writes requires an explicit reconciliation plan to avoid losing those new records.
7. Keep encrypted private backups outside Render's ephemeral disk and outside Git, and regularly verify restoration. A free database allowance does not remove the need for backups.

## Deployment blockers / acceptance gates

### Checks actually executed

| Check | Result / boundary |
| --- | --- |
| `npm test` | 117 passed; two opt-in live tests skipped; no real provider calls |
| `npm run lint` and `npx tsc --noEmit` | Passed |
| `npm run build` with `NEXT_DIST_DIR=.next-verify`, `DATABASE_PATH=:memory:` | Passed on Windows/Node 22; does not prove the Linux Render build |
| `npm start`, production mode, `PORT=3103`, isolated in-memory database | Started successfully on the requested port; smoke process cleaned up afterward |
| Production HTTP | Health, sign-in and auth-provider endpoints returned 200; only Google was offered |
| Production WebSocket transport | WebSocket handshake reached Socket.IO; missing-auth connection was correctly rejected. Real-domain authenticated collaboration still needs hosted verification. |
| Production CSP origin comparison | Detected a local build/runtime origin mismatch; confirms the need to build with the final `AUTH_URL`. No production-domain deployment was attempted. |
| `npm run check:secrets` with the verification build directory | Passed across 49 client files |
| SQLite read-only integrity / foreign keys | `ok`, zero foreign-key violations; no migration or data export |
| Git ignore checks | `.env`, `.env.local` and the local database are ignored; `.env.example` is the only tracked environment file |

The previous UI task's new browser test timed out during recompilation; a subsequent run was stopped after discovering an incorrect test snapshot URL, which has since been corrected. It is not a passing deployment acceptance test. Existing live-provider success from earlier work is not evidence of Render connectivity or PostgreSQL persistence.

1. **Blocking:** PostgreSQL is not implemented; production data would currently be lost on Render lifecycle events.
2. **Blocking:** async transaction/queue ownership and event ordering must be ported and tested against PostgreSQL, including overlapping deploy workers and interrupted AI requests.
3. **Blocking for uploaded images:** avatar bytes remain local; move them to durable storage before accepting uploads.
4. **Blocking for approval:** no authorization yet to create an external database, upload private records, migrate or deploy.
5. **Unverified:** Linux/native dependency installation, actual Render Free memory usage, external database connectivity/cold starts, real-domain Google OAuth, and restart/redeploy acceptance tests. Windows-local success is insufficient evidence for these.
6. **Operational limits:** free-service suspension/cold starts, monthly database/hosting/AI quotas and no always-on guarantee. Keep paid AI disabled; use Flash-Lite/Groq only within the account's eligible allowance.
7. **Release scope:** sidebar/channel/agent changes from the preceding task are still uncommitted and their new full browser test is not yet passing. Choose a reviewed, verified release commit before enabling deployment. Do not label this interface work complete based only on unit tests.

No Render Blueprint was added because it could misleadingly imply the current SQLite application is deploy-ready. This document is the reviewable plan; it does not provision or publish anything.
