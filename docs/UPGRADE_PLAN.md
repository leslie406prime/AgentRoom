# AgentRoom authentication and workspace upgrade plan

## Current architecture inspected

- The application is Next.js 15 App Router with strict TypeScript and a custom
  `server.ts` that serves Next.js and Socket.IO from the same HTTP server.
- `src/server/db.ts` opens the configured `better-sqlite3` database, enables
  WAL and foreign keys, and initializes `rooms`, `members`, `room_events`,
  `messages`, `agent_jobs`, `artifacts`, and `artifact_versions`. Room events
  use `rooms.next_seq` and `(room_id, seq)`.
- `src/server/queue.ts` claims one FIFO job per room in an immediate SQLite
  transaction. Jobs are identified by `(room_id, idempotency_key)`.
- `src/server/socket.ts` currently accepts `room:join` credentials supplied by
  the browser (room ID, member ID, and display name). Its `authorized` helper
  only checks socket-local room/member fields. It is not authenticated identity
  or a database membership check. The room page and room creation route access
  SQLite directly; there is not yet a repository/data-access layer.
- Current client-to-server socket events are `room:join`, `message:send`,
  `agent:request`, `agent:cancel`, `typing:update`, `artifact:save`, and
  `artifact:restore`. Server events include `room:event`, `presence:update`,
  `typing:update`, `agent:token`, `agent:done`, `agent:status`, and
  `queue:update`. Durable room events are replayed after a client-provided
  sequence, alongside a full snapshot.
- Existing room access is private-by-link only: anyone holding a room ID can
  open it and choose a member ID/name. The current schema has no users,
  sessions, workspaces, channels, roles, or invitations.
- `data/agentroom.sqlite` and SQLite WAL/SHM sidecars already exist. They are
  user data and must not be deleted or migrated in place without the automatic
  timestamped pre-migration backup.

## Baseline before upgrade changes

Recorded before editing application code:

- `npm run build`: passed.
- `npm run lint`: passed.
- `npm test`: passed, 1 test file and 5 tests.
- `npm run test:e2e`: initially failed at the existing artifact restoration
  assertion because the selected artifact was not restored after reload.
  Persisting the selected artifact per room fixed that regression; the test
  then passed.
- After that baseline-only fix, `npm run build`, `npm run lint`, `npm test`
  (1 file, 5 tests), and `npm run test:e2e` (1 test) all passed.
- No Git repository was detected, so phase commits are unavailable.

## Authentication and session strategy

- Use Auth.js v5 (`next-auth` 5.0.0-beta.32, the installed v5 package
  at inspection) with its official `@auth/drizzle-adapter` and Drizzle's
  `better-sqlite3` driver over the existing SQLite connection. Keep its users,
  accounts, and database sessions in the same SQLite file as application data.
- Configure Google and Microsoft Entra ID OAuth providers. Use Auth.js
  provider defaults for state/PKCE/nonce where the provider supports them;
  inspect the installed provider metadata and test the enabled checks rather
  than assuming. Use provider plus stable provider account ID for identity;
  Microsoft identity keys must include the tenant (`tid`) and object (`oid`)
  when supplied. Never use email to merge accounts.
- Use database sessions with a bounded expiry. Socket.IO connection middleware
  parses the Auth.js session cookie and looks up the session token in the
  database. Revalidate session and current workspace/channel membership for
  every data-bearing event; revoked or expired sessions disconnect their
  sockets. Auth.js owns OAuth callback/CSRF handling; custom state-changing
  routes validate method and same-origin `Origin`.
- Keep mock OAuth available only with an explicit development/test flag and
  fail startup if that flag is enabled in production. Never expose provider
  secrets or workspace credentials to browser code.

## Legacy-room migration and claim strategy

- Add versioned, ordered, transactional migrations with a `schema_migrations`
  table. Before the first migration against any existing database, create a
  timestamped SQLite backup using SQLite's backup API (so committed WAL data
  is included); test migrations against a separate fixture copy first.
- Preserve the existing room tables/data while migrating each room to a
  dedicated unclaimed legacy workspace and a public `#general` channel. Add a
  durable old-room-ID to new-channel-ID mapping. Copy messages, room event
  sequence numbers, agent jobs/queue state, artifacts, and artifact versions
  with their IDs, order, timestamps, and anonymous author labels unchanged.
  Keep the old `/room/[id]` route as the legacy entry point.
- Before claim, legacy content is reachable only through its original
  unguessable room link. The first authenticated user who opens that link is
  transactionally assigned OWNER and claims the workspace; afterward the link
  redirects to the workspace channel. Document that possession of an old link
  permits claiming. No existing data is dropped as part of this migration.

## Order of work and gates

1. Implement Auth.js providers, database sessions, safe linking/unlinking,
   validated redirects, protected routes, socket authentication, and
   development/test mock login, using the migration/repository foundations
   required by the auth tables. Run the focused tests and all baseline tests.
2. Implement profile privacy and profile editing; test validation and email
   visibility.
3. Implement workspaces, transactional OWNER/#general creation, membership
   management, and avatar handling.
4. Implement public channels and replay/agent/artifact state per channel; keep
   the legacy link compatibility path. Test queue isolation, replay, and data
   migration invariants.
5. Centralize permissions and enforce workspace/channel scopes on every route,
   repository operation, and socket event. Add immediate socket eviction,
   audit logs, owner AI settings, encrypted credentials, and usage limits.
6. Implement invitation creation, acceptance, expiration, revocation, and
   authenticated redirects with concurrency tests.
7. Finalize versioned migrations and test them against a legacy-schema fixture,
   including backup creation, exact history and sequence preservation, artifact
   versions, and legacy link mapping/claiming.
8. Complete security hardening: origin/CSP/security headers, rate limits, audit
   log, credential encryption, usage limits, and client-bundle secret checks.
9. Complete the functional authenticated UI, owner/admin views, profile and
   workspace switching, update README and `docs/AUTH_AND_WORKSPACES.md`, then
   run the full build, lint, unit, migration, and Playwright suites. Do not
   claim real OAuth is verified by mock-provider tests.

Each phase starts only after the prior phase's build and relevant existing/new
tests pass. Keep the existing SQLite data intact throughout; migration work is
not allowed to use the reset script or overwrite the production/local database.

## Current-session baseline (2026-10-27)

Build passed. Vitest: 5/5 passed. Lint: zero errors, three existing unused-state warnings. Playwright baseline failed waiting for initial mock OAuth navigation; investigate before the phase gate. No Git repository detected. Installed Auth.js is next-auth 5.0.0-beta.32; inspected its callback handler, Google and Entra provider implementations, and current official adapter/session documentation (https://authjs.dev/getting-started/migrating-to-v5). Auth.js automatically links while signed in; explicit link intent is therefore required in the signIn callback before handleLoginOrRegister. Real providers explicitly request PKCE, state and nonce; mock OAuth uses PKCE/state and userinfo, not OIDC nonce.

Phase 1 progress: explicit session-bound one-use linking intents, final-identity unlink protection, account settings, same-origin mutation checks for identity management, and one-second idle-socket session revalidation implemented. Unit tests 11/11 pass; original collaboration Playwright scenario passes; two new authentication Playwright scenarios pass (Microsoft mock, explicit Google linking, refresh, signout socket disconnection, unauthenticated sockets, protected destination). Browser navigation assertions now compare exact URLs and allow cold development route compilation. Migration initialization is serialized with BEGIN IMMEDIATE to prevent parallel Next build worker races. Auth.js internal same-origin absolute callback URLs are accepted after same-origin validation; external destinations are rejected and caller destinations are restricted to relative paths.

Workspace implementation detail: preserve the existing physical room/message/job/artifact tables and use each room storage ID as its channel ID, with a channels-to-workspaces mapping and a separate legacy_room_links table. This avoids copying or rewriting historical rows, event payload IDs, queue ordering or artifact versions. Application access resolves a workspace-scoped channel through the repository before any collaboration query. Existing integer artifact-version IDs are grandfathered to preserve user data; new domain IDs are text. The workspace creation phase needs the central permission function and initial invitation acceptance as supporting foundations so the existing two-user workflow remains testable; later permission and invitation phases complete those foundations and adversarial coverage.

Phase 3 implementation: migration 3 preserves physical history and maps legacy rooms into unclaimed dedicated workspaces. New workspace and OWNER/general creation is atomic. Central permissions, public channel scope checks and invitation primitives are introduced as prerequisite foundations; later phases extend channels, AI settings and security coverage. Added avatar decoding/re-encoding via direct dependency sharp 0.35.5, already in the installed Next dependency tree. Normal package fetch was unavailable in the sandbox; declaring the exact existing locked package and running npm install --offline --ignore-scripts --cache ./.npm-cache succeeded with zero audit findings. Unit tests now use isolated in-memory databases per Vitest file instead of concurrent shared-file writes. Multi-step queue writes use immediate transactions. Migration/backup and avatar tests pass; total 25 unit tests.

Preservation check against the actual application's pre-migration backup: 16 rooms, 40 events, 15 messages, 6 jobs, 4 artifacts and 3 artifact versions are byte-for-byte equal after migration 3; 16 legacy mappings exist and PRAGMA integrity_check returns ok. The custom server now loads .env via the already-installed @next/env package before importing database modules, avoiding split web/socket database configuration. It is declared directly (15.5.28) for that existing dependency. Browser tests use .next-e2e, own their server and warm protected application routes to avoid shared-cache corruption and cold-compilation timeouts.

Phase 4 gate: build and lint pass; 33 unit tests pass. Four browser scenarios pass, including the retained two-user FIFO/artifact workflow with invitation membership, repeated refresh, and REST/Socket.IO isolation plus immediate eviction on member removal. All collaboration SQL moved from socket handlers and the agent executor into scoped repository functions; health-route SQL moved into the database module. Channel names are normalized and workspace-unique; general cannot be renamed, archived or deleted. Snapshot seq is now explicit and corrupt saved sequence values reset to zero.

Phase 5 gate: build/lint pass; 43 unit tests pass, including mocked OpenAI streaming/usage, quota refusal before network calls, cross-channel reservations, encryption/authenticated decryption, approval changes and moderator replay redaction. Four browser scenarios pass including masked credential APIs, member settings refusal and live mode changes. Windows denied process-tree termination inside the sandbox; the specific owned test server was stopped with approved escalation, and the runner now uses a secret-protected shutdown request available only in explicitly managed development tests. A fresh authentication browser run exited 0 after cleanup.

Phase 6 gate: build/lint pass, 44 unit tests and five browser scenarios pass with exit 0. Added generic pre-accept invitation pages, corrected channel-header copy controls to issue actual invitations for authorized inviters, and tested Microsoft sign-in return, expiration, revocation, exhaustion, idempotence and simultaneous acceptance. Phase 7 gate: migration CLI applied version 5 after backup; 45 unit tests and five browser scenarios pass. All original fields in actual production-style history tables remain identical to the backup; no FK violations, integrity ok. Explicit enqueue_order removes live queue reliance on SQLite rowid and datetime; those SQLite details remain in migration code. Avatar metadata and best-effort post-commit file cleanup handle replacement and workspace deletion.
