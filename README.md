# AgentRoom

AgentRoom is a shared realtime workspace where a team can talk, ask one room-wide AI agent for help, and edit shared code or document artifacts. Rooms are private-by-link, have persistent conversation history, and serialize agent work through a visible FIFO queue. If there is no `OPENAI_API_KEY`, the app clearly announces **DEMO MODE** and runs the same queue and artifact flow with deterministic sample output.

## Setup and run

Requirements: Node.js 20 or newer and npm.

```sh
npm install
Copy-Item .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Configure an Auth.js secret and either real OAuth credentials or the development-only mock provider before signing in. The custom `server.ts` entry starts Next.js and Socket.IO on the same port. `npm run build` creates the production Next.js build; `npm run start` serves it with the same custom server.

| Variable | Default | Description |
|---|---|---|
| `AUTH_SECRET` | unset | Required by Auth.js; use a random secret in every environment. |
| `AUTH_URL` | Auth.js inferred | Canonical application origin, including scheme and port. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | unset | Google OAuth client credentials. |
| `AUTH_MOCK_OAUTH_ENABLED` | `false` | Enables test identities only outside production; production startup rejects `true`. |
| `OPENAI_API_KEY` | unset | Server-only API key. Leave blank for explicit demo mode. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Chat completions model used by the server worker. |
| `PORT` | `3000` | HTTP and Socket.IO port. |
| `DATABASE_PATH` | `./data/agentroom.sqlite` | SQLite database file. Set `:memory:` for an ephemeral in-memory DB. |

For local development without external OAuth credentials, set `AUTH_MOCK_OAUTH_ENABLED=true` in `.env`. This mock is not suitable for production and production startup fails when it is enabled. Real Google OAuth credentials have not been verified by the project's automated tests. Never put an OpenAI key in a `NEXT_PUBLIC_*` variable. The browser only communicates with the app server; API requests are made by the server worker. If the key is missing, the UI displays a persistent demo banner and each generated response has a `DEMO` badge. Demo answers stream in chunks and create a sample TypeScript artifact so that the queue, streaming, persistence, and artifact paths remain usable without credentials.

The current upgrade is incomplete: authentication and authenticated room collaboration are present, but workspaces, channels, role-based permissions, invitations, workspace AI settings, and the complete legacy-room migration are not implemented. See [docs/IMPLEMENTATION_AUDIT.md](./docs/IMPLEMENTATION_AUDIT.md) and [docs/AUTH_AND_WORKSPACES.md](./docs/AUTH_AND_WORKSPACES.md) for audited scope and limitations.

Reset the local database with `npm run reset` while the server is stopped. This removes only the configured database and its SQLite WAL/SHM sidecars.

## Architecture

```text
Browser clients (Next.js UI, Monaco, Socket.IO client)
                 │ HTTP / Socket.IO on one port
                 ▼
Custom Node server (server.ts) ── Next.js App Router / API routes
                 │
                 ├── Socket.IO room handlers ── validated events, presence, replay
                 ├── Per-room worker ── FIFO jobs, demo or streamed OpenAI
                 └── SQLite (WAL) ── rooms, members, events, jobs, messages, artifacts
                                             ▲
                                             └──── OpenAI API (server-side only)
```

`src/server/db.ts` initializes the schema automatically and enables foreign keys and WAL. Persisted room events receive a monotonically increasing room-local sequence number in a transaction. The server persists messages, job state transitions, and artifact changes; on reconnect it returns the current durable snapshot and the events after the client's last sequence. The snapshot makes a complete reload reliable, while event IDs and client-generated message IDs make retries idempotent.

Each room has one worker loop. A SQLite transaction claims the oldest queued job only if there is no running job, and the status transition from queued to running is conditional. This is the single-process queue's atomic claim boundary. A per-room worker prevents duplicate local loops; database state prevents duplicate claims. Jobs are persisted with unique `(room_id, idempotency_key)` keys. Interrupted `running` jobs are requeued on startup. A failed job is marked failed and the worker proceeds to the next item.

AI context is assembled on the server from the latest stored messages, labeled with each author's display name, and bounded to 12,000 characters. OpenAI streaming tokens are broadcast to room members; the final response is persisted as a sequenced message. The model may create/update an artifact through a structured function call whose arguments are validated with zod before saving.

## Socket events

| Event | Direction | Purpose |
|---|---|---|
| `room:join` | client → server | Validate name and member, join room, return snapshot and missed events. |
| `room:event` | server → clients | Sequenced persisted message, job, or artifact update. |
| `presence:update` | server → clients | Online/offline member status. |
| `message:send` | client → server | Validated human message with client-generated dedupe ID. |
| `typing:update` | both | Ephemeral typing state. |
| `agent:request` | client → server | Idempotently enqueue an agent prompt. |
| `agent:token` / `agent:done` | server → clients | Transient streamed output and completion signal. |
| `agent:status` | server → clients | Working/idle status. |
| `queue:update` | server → clients | Current queued and running job order. |
| `agent:cancel` | client → server | Cancel the requester's own queued job. |
| `artifact:save` | client → server | Save artifact with optimistic version check. |
| `artifact:restore` | client → server | Restore a previous artifact version as a new version. |

All socket inputs are validated with zod and all room-scoped actions require an authenticated-in-room socket association. The room membership is intentionally link-based, not an authentication system.

## Data model

- `rooms`: room ID, name, and next sequence number.
- `members`: stable room member ID, display name, stable color, and last-seen timestamp.
- `room_events`: durable ordered event log, keyed by `(room_id, seq)`.
- `messages`: human and agent messages, author labels, timestamps, IDs, and sequence.
- `agent_jobs`: requester, prompt, idempotency key, lifecycle status, and friendly failure detail.
- `artifacts`: current code/document content, version, editor, and update time.
- `artifact_versions`: immutable prior versions for restore/history.

## Tests

```sh
npm test
npx playwright install chromium
npm run test:e2e
npm run lint
npm run build
```

Vitest covers FIFO claims, one-running-job enforcement, atomic duplicate claims, idempotency, failure continuation, cancellation, and restart recovery. The Playwright test creates two isolated browser contexts and exercises room creation/joining, cross-client messaging, streaming, queueing a second request while the first is running, artifact creation, and reload restoration in demo mode.

## Known limitations

- One Node process and one SQLite file; this design does not horizontally scale across server instances.
- Workspace/channel authorization and invitation-gated access are not implemented; room IDs still act as shareable access links.
- No complete account linking/unlinking, profile management, workspace, channel, role, or invitation UI.
- No real Google OAuth credentials were exercised in automated tests; only local mock OAuth is used.
- Artifact editing uses optimistic version checks and explicit reload/overwrite conflict handling, not CRDT or operational transform.
- SQLite write throughput is appropriate for a small workspace MVP, not high-write production workloads.
- No moderation or abuse-reporting workflow.
- Presence and transient stream tokens are ephemeral; durable room changes are sequenced and replayable.


## Multi-model AI (Gemini, Groq, Muse)
Set `GEMINI_API_KEY` and/or `GROQ_API_KEY` in `.env` (server-side only), then configure providers, approved models, Muse's model and limits under Workspace settings (owners). Mention `@Muse`, `@Gemini` or `@Llama` in a channel. See [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md).
