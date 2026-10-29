# AgentRoom implementation audit

## Scope and method

This audit compares the PHASE 0–9 specification in the conversation with the
current implementation. The complete specification was available in context.
The review inspected the project structure, scripts and configuration,
custom server, Auth.js and mock OAuth, SQLite bootstrap, Socket.IO handlers,
queue/repositories, API routes, UI, tests, environment example, README, and
technical documents. No Git repository is present, so there is no trustworthy
diff or commit history to compare.

✅ is reserved for behavior supported by inspected implementation and a
relevant test/check. 🟡 means some code or an analogous room-level feature
exists, but the specified behavior is incomplete or not sufficiently tested.
❌ means the feature is absent. 🔴 means the implementation exists but a
behavioral test showed it broken. ⚪ means the claim could not be verified
safely or with available credentials.

Tests executed during this audit:

- `npm install`: succeeded; audit reported zero known dependency vulnerabilities.
- `npm run build`: succeeded after the fixes recorded below.
- `npm run lint`: succeeded with three unused-state warnings in
  `src/components/RoomClient.tsx`.
- `npm test`: 1 file passed, 5 tests passed after fixing legacy test-database
  initialization.
- `npm run test:e2e`: 1 Playwright test passed. It uses two independent browser
  contexts, mock Google OAuth identities, the local demo agent (no OpenAI
  credential), the custom server, Socket.IO, messages, the FIFO queue,
  artifacts, and refresh restoration.
- `GET /api/health`: returned HTTP 200 and `{"status":"ok","demoMode":true}`.
- `npm run start` with `NODE_ENV=production` and
  `AUTH_MOCK_OAUTH_ENABLED=true`: exited with status 1 before listening, as
  required.
- `npm audit`: zero known vulnerabilities at audit time.

The Playwright result is a mock-provider test, not evidence that Google,
Microsoft, or OpenAI production credentials work. No real external credentials
were supplied or used. Workspace, invitation, migration, and authorization
isolation test suites do not exist.

## Compliance matrix

| ID | Original requirement | Status | Evidence | Tests performed | Problem discovered | Required corrective action |
|---|---|---|---|---|---|---|
| P0.1 | Inspect the existing architecture. | ✅ IMPLEMENTED AND VERIFIED | `server.ts`, `src/server/db.ts`, `src/server/socket.ts`, and `src/server/queue.ts` were read; architecture is summarized in `docs/UPGRADE_PLAN.md`. | Direct source review. | None for inspection. | Keep the architecture summary current as the design changes. |
| P0.2 | Run the existing tests before modifications. | ✅ IMPLEMENTED AND VERIFIED | `docs/UPGRADE_PLAN.md` records pre-upgrade build, lint, Vitest, and Playwright baseline runs. | Historical baseline results are documented; current tests rerun during this audit. | The baseline predates the Auth.js implementation and is not a baseline for the current tree. | Preserve baseline provenance and rerun after each feature phase. |
| P0.3 | Record the baseline results. | ✅ IMPLEMENTED AND VERIFIED | Baseline commands/results are recorded in `docs/UPGRADE_PLAN.md`. | Compared recorded results with current command outputs. | Current results differ: current build/test failures were found and corrected. | Keep historical and current results clearly separated. |
| P0.4 | Create `docs/UPGRADE_PLAN.md`. | ✅ IMPLEMENTED AND VERIFIED | `docs/UPGRADE_PLAN.md` exists. | File reviewed. | Its original package-version note was stale; corrected to the installed Auth.js beta. | Update plan status and decisions as implementation progresses. |
| P0.5 | Document the original schema, Socket.IO events, authentication strategy, migration strategy, and implementation order in the upgrade plan. | ✅ IMPLEMENTED AND VERIFIED | `docs/UPGRADE_PLAN.md` contains the room schema/events, intended Auth.js/session design, legacy migration plan, and phased order. | File reviewed against the requested topics. | The documented future migration strategy is not implemented. | Keep documented intent distinct from delivered behavior; implement and test the planned migration. |
| P0.6 | Preserve existing functionality and data. | 🟡 PARTIALLY IMPLEMENTED | `src/server/db.ts` adds Auth.js tables and a nullable `members.user_id`; automatic `VACUUM INTO` backups were observed in `data/`. Existing room tables are retained. | Existing queue and collaboration E2E tests pass; no complete before/after production-data comparison or legacy migration test was performed. | There is no verified room-to-workspace/channel migration or exact historical data comparison. | Test migration on a verified copy, compare row counts, IDs, event sequence, messages, jobs, artifacts, and versions; then validate a backup before any real upgrade. |

### PHASE 1 — Authentication

| ID | Original requirement | Status | Evidence | Tests performed | Problem discovered | Required corrective action |
|---|---|---|---|---|---|---|
| P1.1 | Integrate Google OAuth. | 🟡 PARTIALLY IMPLEMENTED | `src/auth.ts` configures Google; the E2E uses the local mock Google provider. | Mock Google OAuth login succeeds in Playwright. | No real Google credentials or external callback were tested. | Test real Google OAuth in a controlled environment and verify registered redirect/callback configuration. |
| P1.2 | Integrate Microsoft Entra ID OAuth. | 🟡 PARTIALLY IMPLEMENTED | `src/auth.ts` configures Microsoft Entra ID and tenant/object identity mapping. | Source review only; no Microsoft mock or live-provider test. | Provider-specific callback/profile/check behavior is unverified. | Add a mock Microsoft OAuth integration test, then separately validate with real tenant credentials. |
| P1.3 | Use persistent database sessions with Auth.js. | ✅ IMPLEMENTED AND VERIFIED | Auth.js uses `strategy: "database"` and the Drizzle adapter; `session` table is in `src/server/db.ts`. | Mock-auth Playwright test creates sessions and queries `/api/auth/session` for each independent user; reload remains authenticated. | No production expiry lifecycle test. | Add explicit expiration and persistence regression tests. |
| P1.4 | Verify session expiry and sign-out. | 🟡 PARTIALLY IMPLEMENTED | Session expiry is checked in `src/server/socket.ts`; `src/auth.ts` handles sign-out. | Source review only; no expiry/sign-out E2E. | User sign-out behavior and active-session invalidation are not verified; session socket registry is process-local. | Add tests for expiry, sign-out, all active sockets, and restart behavior. |
| P1.5 | Reject unauthenticated access to protected routes. | 🟡 PARTIALLY IMPLEMENTED | `src/app/room/[id]/page.tsx` redirects without a session; `src/app/api/rooms/route.ts` returns 401. | Authenticated route behavior exercised in E2E; no automated unauthenticated rejection assertion. | The home page is public and the API response is not covered by a negative test. | Add route tests for unauthenticated page/API access and verify private room metadata is not disclosed. |
| P1.6 | Authenticate Socket.IO using actual sessions. | ✅ IMPLEMENTED AND VERIFIED | Socket middleware in `src/server/socket.ts` looks up the Auth.js cookie token and persisted session; room events recheck session and member association. | Two distinct mock-authenticated Playwright users joined a room and synchronized messages and agent results through Socket.IO. | Negative/unauthenticated socket rejection is not covered by automated tests. | Add explicit missing, expired, and revoked-session socket rejection tests. |
| P1.7 | Expired or revoked sessions must lose access. | 🟡 PARTIALLY IMPLEMENTED | `authorized()` and `authorizedSession()` requery session expiry; sign-out disconnects registered sockets. | Source review only. | No tests demonstrate expiry/revocation taking effect on an already-open socket; no administrator revocation exists. | Add active-socket revocation tests and a durable revocation path. |
| P1.8 | Configure OAuth callback protection. | 🟡 PARTIALLY IMPLEMENTED | Google/Entra configure PKCE, state, and nonce checks; mock OAuth validates state/PKCE exchange. | Mock Google OAuth completed in Playwright. | Real provider compatibility, nonce handling, and tampered/replayed callback rejection were not tested. | Add negative callback tests and real provider configuration tests. |
| P1.9 | Prevent open redirects. | 🟡 PARTIALLY IMPLEMENTED | `safeRedirect()` in `src/auth.ts` and `safeRelativePath()` in `src/lib/redirect.ts` restrict redirects. | Source review only; no adversarial redirect test suite. | Redirect edge cases are not behaviorally verified. | Add tests for protocol-relative URLs, alternate origins, backslashes, encoded paths, and valid relative callbacks. |
| P1.10 | Require explicit authorization for account linking. | 🟡 PARTIALLY IMPLEMENTED | `allowDangerousEmailAccountLinking: false` is set in `src/auth.ts`; no connect/unlink flow exists. | Source review; mock login attempted with a conflicting account and Auth.js rejected it. | There is no explicit account-linking workflow to authorize or manage links. | Implement authenticated connect/unlink UX and CSRF/state protections, or document account linking as unsupported. |
| P1.11 | Never automatically merge accounts by email. | ✅ IMPLEMENTED AND VERIFIED | Auth.js account-linking danger is disabled; provider identities are stored by provider/account ID. | Mock OAuth conflict produced `OAuthAccountNotLinked` rather than linking accounts. | The negative behavior is not yet a named automated regression test. | Add the observed no-auto-link behavior to the Auth.js integration test suite. |
| P1.12 | Restrict mock OAuth to development/testing and fail production startup if enabled. | ✅ IMPLEMENTED AND VERIFIED | Mock endpoints return 404 outside enabled non-production mode; `server.ts` now calls the production guard before starting. | `npm run start` with production mode and the mock flag enabled exited 1 before listening. | None found for this condition. | Keep the guard at the custom-server entry point and retain the startup test. |

### PHASE 2 — User Profiles

| ID | Original requirement | Status | Evidence | Tests performed | Problem discovered | Required corrective action |
|---|---|---|---|---|---|---|
| P2.1 | Persist user profiles. | 🟡 PARTIALLY IMPLEMENTED | Auth.js `user` table stores name, email, verified timestamp, and image fields. | Mock sign-in and session were exercised. | No profile domain/service or profile editor exists. | Implement profile repository, validation, and profile-management UI/API. |
| P2.2 | Use unique internal user IDs. | ✅ IMPLEMENTED AND VERIFIED | `"user".id` is the primary key; Auth.js creates provider-backed users. | Two independent mock identities authenticated in the collaboration E2E. | No adversarial ID collision test. | Retain opaque primary keys and add a focused adapter/schema test. |
| P2.3 | Store provider identities. | ✅ IMPLEMENTED AND VERIFIED | `account` table has provider and providerAccountId primary key and user foreign key. | Mock provider logins created distinct authenticated users used by the E2E. | Live provider identity claims are not verified. | Add provider-account persistence and duplicate-identity tests. |
| P2.4 | Validate display names. | ❌ NOT IMPLEMENTED | No profile-edit route or display-name schema is present. `room:join` derives the name from provider name/email. | Source review. | Provider names are truncated but not validated under the required 1–24 character rule. | Add a shared zod profile/display-name schema and enforce it at API and persistence boundaries. |
| P2.5 | Track verified email state. | 🟡 PARTIALLY IMPLEMENTED | Auth.js stores `emailVerified`; `src/auth.ts` writes `email_verified_by_provider`. | Source review; no provider-verification behavior test. | Provider claims are not tested for Google/Entra, and a boolean records only the last sign-in result. | Define verification semantics and add verified/unverified provider tests. |
| P2.6 | Persist profile images. | 🟡 PARTIALLY IMPLEMENTED | Auth.js user schema has `image`; OAuth profiles map Google image and Microsoft null. | Mock login only uses a null image. | No image upload, validation, storage, or profile-image test. | Add safe profile-image handling or explicitly scope images to provider-hosted URLs. |
| P2.7 | Track last-active timestamps. | 🟡 PARTIALLY IMPLEMENTED | `user.last_active_at` exists; room members have `last_seen`. | Source review only. | The user-level timestamp is not updated by app activity. | Add a repository operation that updates last-active time. |
| P2.8 | Throttle last-active updates. | ❌ NOT IMPLEMENTED | No user last-active update/throttle helper. | Source review. | No throttled updates exist. | Implement and test a bounded update cadence. |
| P2.9 | Restrict email visibility. | ❌ NOT IMPLEMENTED | No profile visibility policy or profile endpoint. | Source review. | No email visibility controls or authorization rules. | Define privacy rules and enforce them in scoped repository/API responses. |
| P2.10 | Support profile editing. | ❌ NOT IMPLEMENTED | No profile editing UI/API. | Source review. | Users cannot edit profile details. | Implement authenticated profile editing with validation and tests. |

### PHASE 3 — Workspaces

| ID | Original requirement | Status | Evidence | Tests performed | Problem discovered | Required corrective action |
|---|---|---|---|---|---|---|
| P3.1 | Authenticated workspace creation. | ❌ NOT IMPLEMENTED | `src/app/api/rooms/route.ts` creates a room, not a workspace; no workspace table exists. | Room creation in the MVP E2E only. | No workspace entity or workspace creation flow. | Add workspace schema/repository/API/UI and authenticated tests. |
| P3.2 | Assign creator OWNER automatically. | ❌ NOT IMPLEMENTED | No workspace member or role schema. | Source review. | No ownership assignment exists. | Create workspace and OWNER membership atomically. |
| P3.3 | Create `#general` automatically. | ❌ NOT IMPLEMENTED | No channel schema or channel creation. | Source review. | No general channel exists. | Create the default channel in the workspace transaction. |
| P3.4 | Initialize workspace transactionally. | ❌ NOT IMPLEMENTED | Room API inserts only a room; no workspace transaction. | Source review. | Workspace, owner, and channel cannot be created as one transaction. | Implement an all-or-nothing transaction and rollback test. |
| P3.5 | Support workspace switching. | ❌ NOT IMPLEMENTED | No workspace UI or listing endpoint. | Source review. | No workspaces exist to switch between. | Add authorized workspace listing and switching UI. |
| P3.6 | Invite members to a workspace. | ❌ NOT IMPLEMENTED | No invitations or workspace membership. | Source review. | Shareable room URL is not a workspace invitation. | Implement tokenized invitations and acceptance flow. |
| P3.7 | Enforce workspace isolation. | ❌ NOT IMPLEMENTED | No workspace IDs/scoped repositories. | Source review; cross-workspace tests cannot run. | Room-ID possession allows any authenticated user to join; no workspace boundary exists. | Implement repository and route scoping, then REST/repository/socket isolation tests. |
| P3.8 | Secure avatar uploads. | ❌ NOT IMPLEMENTED | No upload route or upload storage. | Source review. | No file type, size, content, or storage controls. | Add constrained image upload handling and security tests if uploads are in scope. |
| P3.9 | Manage workspace membership. | ❌ NOT IMPLEMENTED | No membership management routes/UI. | Source review. | No add/remove/list workflow. | Implement membership lifecycle with authorization and audit logging. |
| P3.10 | Transfer ownership. | ❌ NOT IMPLEMENTED | No OWNER role or transfer operation. | Source review. | No transfer behavior. | Implement transactional owner transfer and tests. |
| P3.11 | Protect the last OWNER. | ❌ NOT IMPLEMENTED | No workspace roles or owner controls. | Source review. | No last-owner safeguard. | Enforce last-owner invariants in the data layer and test concurrent changes. |
| P3.12 | Delete workspaces safely. | ❌ NOT IMPLEMENTED | No workspace deletion workflow. | Source review. | No data-retention, confirmation, or cascade policy. | Define and implement safe deletion/retention with explicit authorization and tests. |

### PHASE 4 — Channels

| ID | Original requirement | Status | Evidence | Tests performed | Problem discovered | Required corrective action |
|---|---|---|---|---|---|---|
| P4.1 | Create channels. | ❌ NOT IMPLEMENTED | No channels table, route, or UI. | Source review. | The app remains room-centric. | Add channel schema and authorized CRUD. |
| P4.2 | Normalize channel names. | ❌ NOT IMPLEMENTED | No channel-name logic. | Source review. | No normalization behavior exists. | Add canonical normalization and tests for case/whitespace/invalid characters. |
| P4.3 | Enforce unique channel names. | ❌ NOT IMPLEMENTED | No channel table or unique constraint. | Source review. | No channel uniqueness boundary. | Add workspace-scoped unique constraint and race tests. |
| P4.4 | Enforce channel permissions. | ❌ NOT IMPLEMENTED | No private/public channel or permission model. | Source review. | Room URL is the only access boundary. | Add channel authorization after centralized role policy exists. |
| P4.5 | Persist channel messages. | 🟡 PARTIALLY IMPLEMENTED | `messages` persist by `room_id`; the room messaging E2E passes. | Playwright verifies message delivery and refresh persistence in a shared room. | Messages are not channel-scoped. | Migrate room messages into channel IDs without changing IDs/order and test migration. |
| P4.6 | Deliver messages in realtime. | 🟡 PARTIALLY IMPLEMENTED | Socket `message:send` and `room:event` broadcast by room. | Two-user Playwright verifies realtime message visibility. | Delivery is room-level, not channel-level. | Rewire broadcasts to authorized channel rooms and test isolation. |
| P4.7 | Provide shared AI access in channels. | 🟡 PARTIALLY IMPLEMENTED | One agent worker/context runs per room. | Playwright verifies room-level shared demo response. | No channel-specific context or access control. | Scope agent context and workers to channel after channel model exists. |
| P4.8 | Use channel-specific FIFO queues. | 🟡 PARTIALLY IMPLEMENTED | `src/server/queue.ts` provides room-scoped FIFO and the E2E queues a second request. | Queue unit tests and collaboration E2E pass. | No channel queue partition exists. | Scope idempotency, claims, status, and execution by channel ID; add cross-channel concurrency tests. |
| P4.9 | Persist shared artifacts. | 🟡 PARTIALLY IMPLEMENTED | `artifacts` and `artifact_versions` are room-scoped. | Playwright verifies artifact collaboration and reload restoration. | No channel association. | Migrate artifact ownership to channels and test version history preservation. |
| P4.10 | Maintain channel-specific sequence numbers. | 🟡 PARTIALLY IMPLEMENTED | `rooms.next_seq` and `(room_id, seq)` provide room-local ordering. | Queue tests and Playwright exercise sequenced room events. | There is no per-channel sequence namespace. | Add channel sequence state and migration-preservation tests. |
| P4.11 | Replay missed events after reconnect. | 🟡 PARTIALLY IMPLEMENTED | `eventAfter()` and Socket.IO join return replay plus a complete snapshot. | E2E verifies reload/restoration; it does not assert a reconnect with a known last sequence. | Replay is room-level and no focused gap/duplicate replay test exists. | Add explicit last-sequence replay tests and channel-scope the event log. |
| P4.12 | Protect `#general`. | ❌ NOT IMPLEMENTED | No `#general` channel exists. | Source review. | No default-channel protection. | Implement and test immutable/default-channel rules. |
| P4.13 | Prepare private-channel schema without exposing incomplete private functionality. | ❌ NOT IMPLEMENTED | No channel schema or private-channel flag. | Source review. | Neither schema preparation nor channel behavior exists. | Add schema-only preparation and tests; do not expose private UI until permission checks are complete. |

### PHASE 5 — Authorization

| ID | Original requirement | Status | Evidence | Tests performed | Problem discovered | Required corrective action |
|---|---|---|---|---|---|---|
| P5.1 | Implement OWNER, ADMIN, and MEMBER permissions. | ❌ NOT IMPLEMENTED | No role column/table or policy definitions. | Source review. | No roles exist. | Add role schema and centralized policy tests. |
| P5.2 | Centralize authorization. | ❌ NOT IMPLEMENTED | Authorization is limited to inline session/member checks in `src/server/socket.ts` and route checks. | Source review. | No centralized role/permission module. | Add one policy module and remove duplicated ad hoc checks. |
| P5.3 | Enforce permissions server-side. | 🟡 PARTIALLY IMPLEMENTED | Session checks protect room routes and socket events. | Valid authenticated use exercised by E2E. | No role-based or workspace/channel policy exists; possessing a room URL is enough to join. | Enforce centralized workspace/channel policy on every data path. |
| P5.4 | Scope data access to the workspace in repositories. | ❌ NOT IMPLEMENTED | SQL is called directly from routes and socket handlers; no repositories. | Source review. | No workspace-scoped data-access layer. | Introduce typed repositories that require authorized workspace/channel scope. |
| P5.5 | Authorize Socket.IO events. | 🟡 PARTIALLY IMPLEMENTED | Session and current room membership are rechecked in handlers. | Valid socket interaction passed; denial cases not tested. | No channel/role authorization; join can create a room member for any authenticated user with the room ID. | Add per-event authorization and negative cross-scope tests. |
| P5.6 | Apply role changes immediately to active sockets. | ❌ NOT IMPLEMENTED | No roles or role-management operation. | Source review. | No role change or socket eviction logic. | Add live role revalidation/eviction and test an already-open socket. |
| P5.7 | Immediately revoke access for removed members. | 🟡 PARTIALLY IMPLEMENTED | `authorized()` rechecks persisted room membership on each data event. | Source review only; no member-removal workflow/test. | There is no removal operation, and no active socket revocation test. | Implement removal transaction, disconnect affected sockets, and test immediate denial. |
| P5.8 | Prevent ADMINs modifying OWNERs or other ADMINs. | ❌ NOT IMPLEMENTED | No roles or admin endpoints. | Source review. | No such policy exists. | Add explicit hierarchy checks and adversarial tests. |
| P5.9 | Prevent MEMBERs using administrative controls. | ❌ NOT IMPLEMENTED | No administrative controls or role gates. | Source review. | No admin feature/policy exists. | Add server-side role checks to each admin operation. |
| P5.10 | Restrict AI-provider settings to OWNER. | ❌ NOT IMPLEMENTED | No workspace AI provider settings. | Source review. | No settings or ownership. | Implement owner-only setting APIs/UI after roles are available. |
| P5.11 | Enforce OWNER-only model allowlists. | ❌ NOT IMPLEMENTED | Model is read from `OPENAI_MODEL`; no workspace allowlist. | Source review. | No allowlist or workspace configuration. | Add server-side allowlist validation and tests. |
| P5.12 | Encrypt workspace OpenAI credentials with AES-256-GCM and mask them. | ❌ NOT IMPLEMENTED | OpenAI key is process environment only; no workspace credential store/encryption/masking. | Source review; no frontend secret scan. | Required workspace credential encryption and UI are absent. | Implement key management, AES-256-GCM with authenticated metadata, secure masking, rotation, and tests; never return plaintext. |
| P5.13 | Track usage and enforce workspace limits. | ❌ NOT IMPLEMENTED | In-memory message/job rate limiting and a queue-length cap exist; no usage records or workspace quotas. | Queue and E2E tests do not test usage quotas. | Per-user rate limiting is process-local and not workspace usage enforcement. | Add durable usage records and atomic quota enforcement. |

### PHASE 6 — Invitations

| ID | Original requirement | Status | Evidence | Tests performed | Problem discovered | Required corrective action |
|---|---|---|---|---|---|---|
| P6.1 | Generate cryptographically secure invitation tokens. | ❌ NOT IMPLEMENTED | No invitation module/table. | Source review. | Room IDs are share links, not invitation tokens. | Implement high-entropy tokens with one-time/expiry semantics. |
| P6.2 | Store SHA-256 token hashes only. | ❌ NOT IMPLEMENTED | No invitation schema. | Source review. | No token storage or hashing. | Store only a cryptographic token hash and test that raw tokens are absent from persistence. |
| P6.3 | Support configurable expiry. | ❌ NOT IMPLEMENTED | No invitation expiry field or route. | Source review. | No expiry behavior. | Add configurable expiry and boundary tests. |
| P6.4 | Revoke invitations. | ❌ NOT IMPLEMENTED | No invitation state or management. | Source review. | No revocation workflow. | Add revocation and concurrent acceptance tests. |
| P6.5 | Enforce maximum use counts. | ❌ NOT IMPLEMENTED | No invitation use counter. | Source review. | No use limits. | Add atomic use-count enforcement. |
| P6.6 | Restrict invitation roles. | ❌ NOT IMPLEMENTED | No role or invitation schema. | Source review. | No role restriction. | Validate invited role against allowed roles and caller authority. |
| P6.7 | Require authentication before acceptance. | ❌ NOT IMPLEMENTED | No invitation acceptance route. | Source review. | No acceptance workflow. | Require session before consuming an invitation. |
| P6.8 | Restore the intended destination after login. | ❌ NOT IMPLEMENTED | Sign-in supports a safe relative callback, but there is no invitation destination flow. | Redirect helper source review only. | No saved invitation acceptance intent. | Bind safe invitation return paths to the authenticated callback state. |
| P6.9 | Accept invitations transactionally. | ❌ NOT IMPLEMENTED | No invitation/membership transaction. | Source review. | No atomic acceptance. | Implement acceptance, use increment, and membership insert in one transaction. |
| P6.10 | Safely handle simultaneous acceptance. | ❌ NOT IMPLEMENTED | No invitation concurrency logic. | Source review. | No race protection. | Add atomic conditional updates and concurrency tests. |
| P6.11 | Make existing-member acceptance idempotent. | ❌ NOT IMPLEMENTED | No acceptance endpoint. | Source review. | No idempotent behavior. | Return stable success for existing membership without consuming extra uses. |
| P6.12 | Avoid disclosing invitation details on error pages. | ❌ NOT IMPLEMENTED | No invitation route/error screen. | Source review. | No non-disclosing error behavior. | Add generic acceptance errors and prevent token/target leakage. |
| P6.13 | Provide invitation management UI. | ❌ NOT IMPLEMENTED | No invitation list/create/revoke UI. | Source review. | No management interface. | Add authorized invitation management and UI tests. |

### PHASE 7 — Database and Migrations

| ID | Original requirement | Status | Evidence | Tests performed | Problem discovered | Required corrective action |
|---|---|---|---|---|---|---|
| P7.1 | Create all required tables. | ❌ NOT IMPLEMENTED | `src/server/db.ts` has Auth.js and original room tables only; no workspace/channel/roles/invitation/usage/audit tables. | Schema review. | Most target schema is absent. | Add versioned schema migrations for every required entity. |
| P7.2 | Enforce foreign keys. | 🟡 PARTIALLY IMPLEMENTED | `db.pragma("foreign_keys = ON")`; current Auth/room relations declare references. | Queue/E2E execution confirms DB opens; no full FK integrity suite. | Target schema and delete/cascade rules are absent and enforcement is not explicitly asserted in tests. | Add schema integrity tests and verify `PRAGMA foreign_keys` plus invalid-reference failures. |
| P7.3 | Add appropriate indexes. | 🟡 PARTIALLY IMPLEMENTED | Room, event sequence, message sequence, jobs, members, artifacts, versions, and Auth indexes in `src/server/db.ts`. | Source review and queue tests. | No workspace/channel/invitation/usage indexes. | Add indexes alongside the missing schema and use query-plan checks where relevant. |
| P7.4 | Add unique constraints. | 🟡 PARTIALLY IMPLEMENTED | Primary keys, `(room_id, seq)`, job idempotency, and unique room/user index exist. | Queue tests cover duplicate idempotency behavior. | Required workspace/channel/invitation constraints do not exist. | Add scope-specific constraints and concurrent insert tests. |
| P7.5 | Use database repositories. | ❌ NOT IMPLEMENTED | Direct SQL in `src/server/db.ts`, `src/server/socket.ts`, and API route. | Source review. | No repository/data-access abstraction or scoped access boundary. | Add repositories and migrate call sites. |
| P7.6 | Use versioned migrations. | 🟡 PARTIALLY IMPLEMENTED | `schema_migrations` exists and version 1 is inserted. | Test initialization ran against a legacy-shaped test database. | This is one bootstrap version, not a sequenced migration runner with migration modules. | Implement ordered migration files and explicit version tracking. |
| P7.7 | Make migrations transactional. | ❌ NOT IMPLEMENTED | Schema bootstrap executes multi-statement SQL and an ALTER outside an encompassing migration transaction. | Source review. | Partial schema changes can survive a failure. | Run each migration atomically, with rollback tests. |
| P7.8 | Make migrations idempotent. | 🟡 PARTIALLY IMPLEMENTED | `CREATE TABLE/INDEX IF NOT EXISTS`, column inspection, and `INSERT OR IGNORE` are used. | `npm test` passed after fixing initialization ordering against an existing test DB. | No versioned migration replay/partial-failure test. | Add repeat, interruption, and resume tests for each migration. |
| P7.9 | Back up automatically before changing existing databases. | 🟡 PARTIALLY IMPLEMENTED | `VACUUM INTO` backup logic is in `src/server/db.ts`; timestamped backup files were observed. | Inspected generated backup filenames; no restore/integrity comparison was run. | Backup creation is not verified, and backup policy is not tied to migration transactions/version. | Verify backup integrity and contents before migration; test restore from backup. |
| P7.10 | Migrate legacy rooms without data loss. | ❌ NOT IMPLEMENTED | Existing rooms remain in room tables; only auth/member schema bootstrap was added. | No legacy migration suite. | No room-to-workspace/general-channel mapping or content migration. | Implement migration on a copied fixture and compare every data class before/after. |
| P7.11 | Preserve existing message order. | 🟡 PARTIALLY IMPLEMENTED | Existing `messages.seq` is retained; queries order by sequence. | Room E2E verifies ordering/display in the current schema, not migration. | No fixture proves order after a legacy migration. | Add migration invariant tests for IDs, timestamps, order, and ties. |
| P7.12 | Preserve existing sequence numbers. | 🟡 PARTIALLY IMPLEMENTED | Existing room sequence columns are not rewritten by current bootstrap. | Source review only. | No workspace/channel migration and no before/after sequence comparison. | Preserve sequence values in the migration and test exact equality. |
| P7.13 | Preserve artifacts and versions. | 🟡 PARTIALLY IMPLEMENTED | Existing artifact tables are retained; E2E verifies current persistence. | Playwright verifies create/reload; no migration fixture. | Migration preservation is not tested. | Test artifact IDs/content/version history across the legacy migration. |
| P7.14 | Resolve legacy links correctly. | ❌ NOT IMPLEMENTED | No legacy mapping table or redirect/claim flow. | Source review. | Legacy URLs still point directly at rooms; no workspace-channel mapping. | Add mapping and compatibility redirect tests. |
| P7.15 | Support legacy-room claiming. | ❌ NOT IMPLEMENTED | No claim state or flow. | Source review. | No claim workflow. | Implement first-claim owner assignment transaction and clear possession-of-link warning. |
| P7.16 | Protect legacy-room claiming from races. | ❌ NOT IMPLEMENTED | No claim operation. | Source review. | No concurrency protection. | Use a conditional transactional claim and race tests. |
| P7.17 | Pass migration tests. | ❌ NOT IMPLEMENTED | `package.json` has no dedicated migration test command or migration test file. | `npm test` runs only queue tests; Playwright is room collaboration only. | No migration test exists. | Add fixture-based migration, backup, rollback, and preservation tests. |

### PHASE 8 — Security

| ID | Original requirement | Status | Evidence | Tests performed | Problem discovered | Required corrective action |
|---|---|---|---|---|---|---|
| P8.1 | Use secure cookies. | 🟡 PARTIALLY IMPLEMENTED | Auth.js session cookie config in `src/auth.ts` sets HttpOnly, SameSite=Lax, and production Secure. | Source review; no production browser-cookie assertion. | Runtime HTTPS behavior is not verified. | Add production-config cookie tests behind HTTPS. |
| P8.2 | Set HttpOnly session cookies. | 🟡 PARTIALLY IMPLEMENTED | `cookies.sessionToken.options.httpOnly` is true. | Source review only. | No browser cookie assertion. | Assert session cookies are HttpOnly in integration tests. |
| P8.3 | Use HTTPS cookie behavior in production. | 🟡 PARTIALLY IMPLEMENTED | Production sets `useSecureCookies` and `secure` true. | Startup guard tested in production mode; no HTTPS session test. | Proxy/TLS deployment behavior is unverified. | Test behind the intended TLS proxy and verify cookie attributes. |
| P8.4 | Configure SameSite. | 🟡 PARTIALLY IMPLEMENTED | Session cookie is `sameSite: "lax"`. | Source review only. | No CSRF/browser behavior test. | Add a cookie configuration assertion and state-changing request tests. |
| P8.5 | Protect against CSRF. | 🟡 PARTIALLY IMPLEMENTED | Auth.js handles OAuth state/CSRF checks; no explicit CSRF protection for custom room-creation POST. | Mock OAuth flow exercises state; no custom API CSRF test. | Custom state-changing routes lack explicit origin/CSRF validation. | Enforce same-origin/CSRF policy for custom mutations and test cross-site requests. |
| P8.6 | Validate request origin. | ❌ NOT IMPLEMENTED | No origin-validation helper or API check found. | Source review. | Custom POST routes do not explicitly validate `Origin`. | Add same-origin validation at the mutation boundary. |
| P8.7 | Restrict Socket.IO origins. | ❌ NOT IMPLEMENTED | `server.ts` allows any origin in development and supplies no explicit production origin allowlist; no handshake Origin rejection. | Source review. | Production origin policy is not explicit; WebSocket origin must not rely only on CORS. | Implement explicit allowlisted Origin validation for polling and WebSocket handshakes. |
| P8.8 | Validate all API/socket inputs with zod. | 🟡 PARTIALLY IMPLEMENTED | Room creation and room Socket.IO messages/jobs/artifacts use zod. | Unit/E2E validates normal payloads only. | Not every Auth/mock/provider/health input has one uniform schema; invalid-input matrix missing. | Audit every boundary and add malformed/oversize input tests. |
| P8.9 | Limit request and payload sizes. | 🟡 PARTIALLY IMPLEMENTED | Socket.IO max HTTP buffer is 1 MB; event content fields have limits. | E2E normal-size payloads only. | No explicit HTTP request-body cap for room API; no boundary tests. | Add route body limits and test just-over-limit payloads. |
| P8.10 | Rate-limit requests. | 🟡 PARTIALLY IMPLEMENTED | In-memory per-room/member message/job/artifact rate tracking and a 20-job queue cap exist. | Queue/E2E exercise normal traffic, not limit boundaries. | Limits are volatile, single-process, and do not cover HTTP/auth endpoints. | Add durable/shared or documented single-process limits and test rate-limit reset/enforcement. |
| P8.11 | Configure Content Security Policy. | ❌ NOT IMPLEMENTED | No CSP found in `next.config.ts` or response middleware. | Source review. | No CSP policy. | Add a tested CSP compatible with Monaco and Auth.js. |
| P8.12 | Set X-Content-Type-Options. | ❌ NOT IMPLEMENTED | No response header configuration found. | Source review. | Header absent. | Set `X-Content-Type-Options: nosniff` and test responses. |
| P8.13 | Set Referrer-Policy. | ❌ NOT IMPLEMENTED | No response header configuration found. | Source review. | Header absent. | Set a restrictive policy and test responses. |
| P8.14 | Protect framing with frame-ancestors. | ❌ NOT IMPLEMENTED | No CSP/frame header configuration found. | Source review. | No framing protection. | Add CSP `frame-ancestors` and verify it on app and API responses. |
| P8.15 | Keep sensitive data out of logs. | 🟡 PARTIALLY IMPLEMENTED | App logs structured errors; there is no deliberate API-key logging. | Source review and normal tests; no log redaction test. | Agent/provider error strings are logged without a redaction policy; logs are not systematically tested. | Add structured redaction and tests for prompts, tokens, cookies, and provider credentials. |
| P8.16 | Keep credentials out of frontend bundles. | 🟡 PARTIALLY IMPLEMENTED | OpenAI client is instantiated in `src/server/socket.ts`; no `NEXT_PUBLIC_*` API key is configured. | Production build passes; no generated-bundle secret scan was run. | No explicit bundle leak check, and future workspace credentials are not implemented. | Add a bundle scan test and keep credential modules server-only. |
| P8.17 | Avoid disclosing private workspace data on authorization failures. | ❌ NOT IMPLEMENTED | There are no workspace boundaries or workspace-scoped authorization responses. | Source review. | Cross-workspace privacy cannot be established because workspaces do not exist. | Implement scoped authorization and verify non-disclosing 403/404 behavior. |
| P8.18 | Maintain security audit logs. | ❌ NOT IMPLEMENTED | No audit-log table or audit event repository. | Source review. | Administrative and security events are not durably recorded. | Add append-only audit events with redaction, retention, and tests. |
| P8.19 | Test a malicious authenticated member changing IDs to cross workspace boundaries. | ⚪ NOT VERIFIED | No workspace identifiers or authorization boundary exist to target. | Explicit attack test was not performed because the feature is absent. | The required isolation guarantee is not available. | Implement workspaces/scoping first, then test manipulated REST IDs and Socket.IO room/channel IDs. |

### PHASE 9 — Automated Testing

| ID | Original requirement | Status | Evidence | Tests performed | Problem discovered | Required corrective action |
|---|---|---|---|---|---|---|
| P9.1 | Test Google authentication. | ✅ IMPLEMENTED AND VERIFIED | Mock Google OAuth is wired into the Auth.js test provider path. | Playwright signs in two distinct mock Google identities and verifies `/api/auth/session`. | This is not a real Google integration test. | Keep mock/live results distinct and add credentialed staging validation. |
| P9.2 | Test Microsoft authentication. | ❌ NOT IMPLEMENTED | No Microsoft auth test. | Not run. | Provider behavior is untested. | Add mock Microsoft flow test and separate live tenant verification. |
| P9.3 | Test workspace creation. | ❌ NOT IMPLEMENTED | No workspace API/table/test. | Not run. | Workspace feature absent. | Implement then add transactional workspace integration tests. |
| P9.4 | Test OWNER assignment. | ❌ NOT IMPLEMENTED | No workspace roles. | Not run. | Ownership absent. | Add creation/OWNER assertion tests. |
| P9.5 | Test invitations. | ❌ NOT IMPLEMENTED | No invitation feature/tests. | Not run. | Invitation workflow absent. | Add authenticated acceptance and management tests. |
| P9.6 | Test invitation expiration. | ❌ NOT IMPLEMENTED | No expiry field or test. | Not run. | Expiry absent. | Add boundary-time tests. |
| P9.7 | Test invitation revocation. | ❌ NOT IMPLEMENTED | No revocation feature/test. | Not run. | Revocation absent. | Add revoked-token acceptance tests. |
| P9.8 | Test invitation use limits. | ❌ NOT IMPLEMENTED | No use counter/limit. | Not run. | Use limits absent. | Add parallel acceptance and max-use tests. |
| P9.9 | Test cross-workspace REST isolation. | ❌ NOT IMPLEMENTED | No workspace-scoped REST resources/test. | Not run. | Isolation absent. | Add adversarial ID-substitution tests for every REST resource. |
| P9.10 | Test cross-workspace repository isolation. | ❌ NOT IMPLEMENTED | No repositories/workspace scope. | Not run. | Data-access boundary absent. | Add repository scope tests before route integration. |
| P9.11 | Test cross-workspace Socket.IO isolation. | ❌ NOT IMPLEMENTED | No workspace/channel socket scopes. | Not run. | Isolation absent. | Add two-workspace socket tests with manipulated IDs. |
| P9.12 | Test role permissions. | ❌ NOT IMPLEMENTED | No roles or permission tests. | Not run. | Permission model absent. | Add a role/action matrix test suite. |
| P9.13 | Test last-OWNER protection. | ❌ NOT IMPLEMENTED | No OWNER role or transfer/removal functionality. | Not run. | Invariant absent. | Add single-owner and concurrent-removal tests. |
| P9.14 | Test immediate Socket.IO access revocation. | ❌ NOT IMPLEMENTED | Sign-out has socket-disconnect code; membership/role revocation test absent. | Source review only. | Immediate administrative revocation is unverified and there is no membership removal flow. | Add active socket revocation tests. |
| P9.15 | Test account-linking security. | 🟡 PARTIALLY IMPLEMENTED | `allowDangerousEmailAccountLinking` is false. | A mock conflict was observed to produce `OAuthAccountNotLinked`; no named automated test. | No explicit linking UI/security regression test. | Add formal account-linking/no-auto-merge test cases. |
| P9.16 | Test realtime messaging. | ✅ IMPLEMENTED AND VERIFIED | `tests/e2e/collaboration.spec.ts` uses independent authenticated contexts. | E2E confirms a message appears in the second client. | Only one collaboration E2E case. | Retain test and add reconnect/unauthorized-client cases. |
| P9.17 | Test agent FIFO execution. | ✅ IMPLEMENTED AND VERIFIED | `tests/queue.test.ts` and collaboration E2E cover queue order/second job waiting. | Five queue unit tests pass; E2E observes a second request queued while work runs. | Queue tests do not cover multiple processes or channel partitions. | Add failure/retry/restart and channel-queue tests when applicable. |
| P9.18 | Test artifact persistence. | ✅ IMPLEMENTED AND VERIFIED | Existing E2E creates an artifact, shares it, reloads both clients, and checks restoration. | Playwright passed. | Migration preservation and concurrent conflict handling lack tests. | Add conflict/version-history/restore tests. |
| P9.19 | Test conversation replay. | 🟡 PARTIALLY IMPLEMENTED | Room snapshots and `eventAfter()` replay exist. | Reload persistence was tested; no precise last-sequence replay assertion. | Snapshot restoration can pass without proving missed-event replay semantics. | Add gap, duplicate, ordering, and reconnect replay tests. |
| P9.20 | Test session persistence. | ✅ IMPLEMENTED AND VERIFIED | Auth.js database sessions and Playwright session checks. | Session endpoint reports each mock identity and authenticated room reload succeeds. | Expiry/revocation persistence is not covered. | Add expiry and sign-out cases. |
| P9.21 | Test sign-out. | ❌ NOT IMPLEMENTED | `SignOutButton` exists, but no sign-out assertion in tests. | Not run. | Sign-out navigation and active socket behavior are untested. | Add browser and socket sign-out tests. |
| P9.22 | Test legacy database migration. | ❌ NOT IMPLEMENTED | No migration suite exists. | `npm test` only runs queue tests. | No fixture asserts legacy data preservation or backup recovery. | Add copied legacy fixture migration suite. |
| P9.23 | Test unauthenticated socket rejection. | ❌ NOT IMPLEMENTED | Socket middleware rejects missing/invalid session tokens in code. | Not run as a negative test. | The security boundary is not regression-tested. | Add handshake rejection tests for absent, expired, and revoked sessions. |

## Definition-of-done checks

These are reported separately for clarity. They overlap with phase rows and are
not counted a second time in the phase compliance percentage.

| Check | Result | Evidence / remaining work |
|---|---|---|
| `npm install` succeeds | ✅ | Succeeded; npm audit reported zero vulnerabilities. |
| `npm run build` succeeds | ✅ | Succeeded after code fixes; three unused-state warnings remain. |
| `npm run lint` succeeds | ✅ | Exit code 0; three warnings in `RoomClient.tsx`. |
| Existing tests remain intact and pass | ✅ | Five queue tests plus the existing collaboration E2E pass; the E2E was adapted to authenticated mock OAuth rather than deleted. |
| All new tests pass | ✅ | The updated mock-authenticated collaboration E2E passes; this does not mean all requested phase tests exist. |
| Authentication works | 🟡 | Local mock Google login/session works; real Google and Microsoft are unverified. |
| Workspaces work | ❌ | Not implemented. |
| Invitations work | ❌ | Not implemented. |
| Roles and permissions work | ❌ | Not implemented. |
| Socket.IO authorization works | 🟡 | Session and room membership checks work on the happy path; channel/workspace isolation and negative revocation tests are absent. |
| AI agent functionality works | 🟡 | Demo responses, artifacts, and FIFO queue are tested; real OpenAI inference is unverified. |
| FIFO job queues work | ✅ | Queue unit tests and E2E pass for room-level FIFO. |
| Artifacts persist | ✅ | Playwright verified artifact sync and reload restoration. |
| Conversations persist | ✅ | Playwright verified message restoration after reload. |
| Legacy data survives migrations | ⚪ | No complete legacy migration was run or validated; only test DB bootstrap was exercised. |
| No sensitive secrets appear in frontend bundles | ⚪ | No generated bundle secret scan was run. |
| The application starts with one command | ✅ | Playwright started `npm run dev`, which launched the custom Next.js/Socket.IO server; health returned 200. |
| README is updated | ✅ | Updated for Auth.js configuration and clearly disclosed incomplete scope. |
| `docs/AUTH_AND_WORKSPACES.md` exists | ✅ | Added, with implementation and limitation statements. |
| `docs/UPGRADE_PLAN.md` exists | ✅ | Present and reviewed; Auth.js version note corrected. |
| `.env.example` is complete | 🟡 | Added Auth.js and existing app settings; provider values remain intentionally blank and deployment-specific setup must be supplied. |

## Fixes made during the audit

- Fixed Auth.js sign-out event typing so the production build type-checks.
- Fixed legacy test-database initialization ordering: member indexes are created
  after adding the compatibility `user_id` column.
- Added the missing socket session revalidation helper and fixed presence color
  reporting for existing members.
- Fixed mock OAuth code/token state to be shared across Next.js route bundles in
  the single server process.
- Fixed the mock sign-in UI to pass `login_hint` through Auth.js's actual third
  `signIn` argument.
- Changed the existing collaboration E2E to use two distinct mock-authenticated
  users and assert their Auth.js sessions, while retaining messaging, FIFO,
  artifacts, and persistence coverage.
- Added a production custom-server startup guard that rejects enabled mock
  authentication.
- Updated `.env.example`, README, `docs/UPGRADE_PLAN.md`, and added this
  authentication/workspace status guide.

No live OAuth, OpenAI inference, workspace migration, invitation flow,
cross-workspace attack, or production database migration was performed.

## Findings by severity

| Severity | Affected code / area | Finding and impact | Recommended correction |
|---|---|---|---|
| HIGH | `src/server/socket.ts`, `src/app/api/rooms/route.ts`, `src/server/db.ts` | Workspace and invitation authorization are absent. An authenticated user who obtains a room URL can join the room; there is no workspace boundary or membership approval. This does not satisfy the requested workspace isolation. | Implement workspace membership and invitation checks before exposing any workspace/channel content; test manipulated IDs across REST, repositories, and sockets. |
| HIGH | `src/server/db.ts`, `src/server/socket.ts` | The current bootstrap is not a transactional, ordered legacy migration. Extending it in-place risks partially applied schemas and unverified legacy data preservation. | Implement versioned transactions, verified backups, copied-fixture migration tests, and exact before/after data comparisons before touching a real database. |
| MEDIUM | `src/server/socket.ts`, `server.ts` | Socket.IO has no explicit production Origin allowlist/handshake validation. Default CORS behavior alone is not an explicit WebSocket origin policy. | Validate handshake Origin against a configured allowlist for both polling and WebSocket transports. |
| MEDIUM | `src/app/api/rooms/route.ts`, custom mutation routes | The room-creation POST relies on session checks and JSON parsing but has no explicit Origin/CSRF policy. | Enforce same-origin requests or an equivalent CSRF mechanism on all state-changing routes and test cross-site attempts. |
| MEDIUM | `src/server/db.ts`, `src/server/queue.ts` | No durable security audit logs or workspace usage/quota records exist. In-memory rate limiting resets on restart and is single-process. | Add append-only redacted audit events and durable usage/quota enforcement; define rate-limit storage requirements. |
| LOW | `src/components/RoomClient.tsx` | Lint reports three unused state variables (`readyToJoin`, `setReadyToJoin`, `setJoined`). | Remove stale state and rerun lint. |

## Priority corrective work

1. Implement versioned, transactional SQLite migrations and test them only
   against verified database copies; add and verify backups before any real
   database change.
2. Implement workspace/channel schema, repositories, membership, default
   `#general`, and legacy-room mapping/claiming while preserving event/message
   sequence and artifact history.
3. Implement centralized OWNER/ADMIN/MEMBER permissions and enforce workspace
   and channel scopes in all routes, repositories, and Socket.IO handlers.
4. Implement secure invitations (hashed tokens, expiry, revocation, use limits,
   concurrency safety, non-disclosing errors) and management UI.
5. Add profile/privacy controls, role management, ownership safeguards,
   workspace AI settings, AES-256-GCM credential encryption, usage tracking,
   and quotas.
6. Add security headers, explicit Origin/CSRF policy, Socket.IO origin
   allowlisting, payload limits, durable rate limiting as required, audit logs,
   and bundle/log leak tests.
7. Expand automated coverage for Microsoft, sign-out, expiry/revocation,
   permissions, cross-workspace REST/repository/socket isolation, invitations,
   migrations/backups, and unauthenticated socket rejection.
8. Validate real Google/Microsoft OAuth and real OpenAI only in controlled
   credentialed environments; report those checks separately from mocks.

## Completion calculation

There are **138 phase-specific requirements** in the matrix above. **16** are
✅ IMPLEMENTED AND VERIFIED, yielding **16 / 138 = 11.6%**. The numerator
includes only phase rows marked ✅; partial, missing, broken, and unverified
requirements receive no credit. Definition-of-done checks are shown separately
and excluded to avoid double-counting.

The criteria are therefore not met for overall completion.
