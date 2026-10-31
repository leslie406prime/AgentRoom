# AgentRoom final limitations audit

> PostgreSQL follow-up: the opening classifications below are historical. See [current PostgreSQL verification](POSTGRES_READINESS.md) for implementation, restart/shutdown evidence and hosted acceptance gates. Production starts with an empty database; local SQLite records stay untouched.

Audit opened October 31, 2026, on `feat/production-readiness`. This is a source/test-based starting assessment; verification results and implementation status will be updated as work completes. Existing channel/agent UI edits were present before this task and are preserved. No local records are being copied to production.

| Area | Starting classification | Evidence and remaining work |
| --- | --- | --- |
| Single process / horizontal scaling | Intentionally deferred | `server.ts`, `session-sockets.ts`, `workspace-sockets.ts`, `socket.ts`: in-memory presence/socket registries and provider guards. One Render instance is intentional; deployment overlap still requires safe database worker ownership. |
| Workspace / channel authorization | Implemented and verified | `workspace-repository.ts:requireRole/channelScope`, `collaboration-repository.ts:channelMember`; `channels`, `workspaces`, `sockets`, `security` unit suites and security browser tests cover isolation. Private channel membership is not implemented; non-public channels are denied. |
| Invitations | Implemented and verified | 32-byte random tokens stored as SHA-256 hashes, expiry, revocation, use limits and strict input schemas; acceptance uses a transaction. PostgreSQL needs equivalent locking. Existing members are not removed by invitation expiry/revocation. |
| Account linking / unlinking | Implemented but insufficiently tested | Google-only active provider; explicit single-use link intent, verified Google identity checks, no dangerous email linking, last-login unlink protection in `auth-repository.ts` and `auth.ts`. Additional providers are deferred. Real-domain Google behavior remains a deployment gate. |
| Profiles | Implemented and verified | `profile-repository.ts`, profile page/forms, `profile.test.ts`: view/update name, Google profile image, connected identities and workspace memberships. Extra profile fields are deferred. |
| Workspace administration | Implemented and verified | Creation, settings, ownership transfer, leaving/removal and last-owner safeguards in `workspace-repository.ts` and `workspaces.test.ts`; browser UI coverage exists. |
| Channel administration | Partially implemented | Existing normalized, unique, role-checked backend and settings UI; new sidebar dialog is pending browser verification. Connected members do not yet receive channel-list updates. |
| Roles | Implemented and verified | `permissions.ts`, repository checks and workspace tests; see exact matrix below. |
| Google OAuth | Implemented but insufficiently tested | Auth.js database sessions, PKCE/state/nonce, secure cookies, Google identity matching. Automated OAuth mocks do not prove production Google login. |
| Shared artifacts | Implemented and verified | Version history, optimistic conflict checks, explicit overwrite and restore in collaboration repository; worker/collaboration browser tests. Conflict UI needs final review; CRDT editing is deferred. |
| SQLite / PostgreSQL | Partially implemented | SQLite v6, WAL, transactions and migrations work; PostgreSQL is not yet implemented at audit opening. Original SQLite files must remain untouched; production starts empty. |
| Moderation / reports | Partially implemented | Admin message deletion persists a tombstone/event and audit record. Own-message deletion and reporting/review are missing. |
| Presence | Implemented but insufficiently tested | Per-member socket sets and last-tab disconnect behavior in `socket.ts`; presence is deliberately ephemeral. Expand multi-tab/reconnect browser assertions. |
| Interrupted streams | Implemented and verified | Provider adapters cap retries before streamed output; worker preserves partial text and marks it incomplete. Provider/unit tests cover this. No exactly-once external API execution guarantee is made. |
| Job persistence / FIFO | Partially implemented | SQLite FIFO enqueue ordering, unique running-job index, idempotency and usage reservations exist and are tested. Startup requeues running jobs without worker ownership: unsafe for overlapping deployments; fix before PostgreSQL release. |
| Model selection / permissions | Partially implemented | Server allowlists, owner configuration, Gemini/Groq/Muse routing and quotas have unit/live evidence. New Groq/sidebar selection UI remains unverified in the full browser flow. |
| Socket authentication / replay | Implemented and verified | Session cookies, per-action membership checks, revocation watcher, durable sequence snapshots/replay; `sockets.test.ts`, collaboration/security browser tests. Awaited database checks must preserve these guarantees. |
| Session expiry / revocation | Implemented and verified | Database expiry checked at handshake and per action; idle sockets checked once/second; sign-out/member removal revoke sockets. Preserve behavior under async PostgreSQL queries. |

## Exact existing role matrix

All actions require membership in the addressed workspace and an accessible, non-private channel. Archived channels reject writes.

| Action | Owner | Admin | Member |
| --- | --- | --- | --- |
| Read/chat/use approved AI/edit shared artifacts | Yes | Yes | Yes |
| Create/rename/archive/delete non-general channels | Yes | Yes | No |
| Invite | Any permitted role | MEMBER only | No |
| List/revoke workspace invitations | Yes | Yes | No |
| Remove another member | Yes, retain an owner | MEMBER targets only | No |
| Change roles / transfer ownership | Yes, retain an owner | No | No |
| Leave own workspace | Unless last owner | Yes | Yes |
| Workspace settings/avatar/deletion | Yes | No | No |
| AI providers/models/defaults/Muse/usage settings | Yes | No | No |
| Delete another user's message / moderate | Yes | Yes | No |
| Read other members' email addresses | Yes | Yes | Own only |

Personal Google credentials and private API keys are never workspace-readable. No paid hosting, database, provider or moderation service will be introduced. The PostgreSQL, queue ownership and local integration/browser gates have now passed; see [verification results](POSTGRES_READINESS.md). Linux execution, actual Neon connectivity and hosted OAuth/redeploy/resource acceptance still remain before deployment.
