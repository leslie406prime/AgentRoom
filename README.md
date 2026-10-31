# AgentRoom

**One workspace. Every AI. Your team.**

AgentRoom is a Google-authenticated team workspace with channels, invitations, shared messages, a FIFO AI queue, and versioned shared Markdown/code artifacts. The white, three-column interface includes a workspace sidebar, shared conversation, and artifact editor with mobile tabs.

## Start

Requires Node.js 20+ and npm. For a new checkout:

```powershell
npm install
Copy-Item .env.example .env.local
# Fill in the values below, then:
npm run dev
```

If `.env` or `.env.local` already exists, edit it in place. Do not overwrite it, regenerate a valid auth secret, or reset the database. `.env.local` overrides `.env`; inherited environment variables take precedence over both.

Open http://localhost:3000. The custom `server.ts` serves Next.js and Socket.IO on the same port. For production, run `npm run build`, then `npm run start` with `AUTH_URL` set to your public HTTPS origin and mock OAuth disabled.

## Environment

All credentials stay on the server. Never prefix them with `NEXT_PUBLIC_`, commit environment files, or paste keys into chat/artifacts.

| Variable | Purpose |
|---|---|
| `AUTH_SECRET` | Required, at least 32 random characters. Preserve the existing value. |
| `AUTH_URL` | Application origin, e.g. `http://localhost:3000`; required in production. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth web-client credentials. Register `${AUTH_URL}/api/auth/callback/google` as the redirect URI. |
| `GEMINI_API_KEY` | Google AI Studio API key; separate from Google OAuth credentials. |
| `GROQ_API_KEY` | Groq inference API key, not xAI Grok. |
| `AUTH_MOCK_OAUTH_ENABLED` | Default `false`. Local tests may use `true`; production rejects it. |
| `PORT` | Default `3000`. |
| `DATABASE_PATH` | Default `./data/agentroom.sqlite`; application records must be preserved. |
| `AVATAR_DIRECTORY` | Default `./data/avatars`; keep persistent alongside SQLite. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional paid OpenAI credentials/model; disabled for new workspaces until the owner explicitly authorizes paid usage. |
| `WORKSPACE_CREDENTIAL_KEY` | Optional 32-byte base64 encryption key for workspace-specific OpenAI credentials. Preserve it if already in use. Gemini/Groq do not need it. |

For a three-person test, Google OAuth must permit all three accounts. If your OAuth app is in testing mode, add your friends as test users. A remote test also needs a reachable HTTPS server, matching OAuth redirect URI, and persistent storage. AgentRoom does not deploy itself or enable provider billing.

## Providers and model selection

Gemini uses Google's official `@google/genai` SDK; Groq uses `groq-sdk`. The catalog contains Gemini Flash/Flash-Lite, Groq GPT-OSS and Qwen, and conditional Groq-hosted Meta Llama models. The exact IDs are in `src/lib/ai-catalog.ts`.

1. Configure `GEMINI_API_KEY` and/or `GROQ_API_KEY` in the project-root `.env.local`, then restart the server.
2. Open Workspace settings as an owner. Under **AI agents and models**, enable providers, approve individual models, choose the default and Muse models, and set request caps.
3. Use **Check available models** to check configured keys against provider model-list APIs. Listing confirms visibility, not successful inference or the account's billing tier.
4. In a channel, select an agent/model and ask it a question, or start a message with `@Gemini`, `@Llama`, `@Muse`, or `@Agent`. Select **Room agent** and a Groq GPT-OSS model to use Groq without Llama access. Responses display the actual provider/model.

New workspaces approve Gemini 3.8 Flash, Gemini 3.5 Flash-Lite and Groq GPT-OSS 20B. Llama requires an owner to approve it after checking account eligibility. Existing saved settings are preserved: owners can approve current Gemini/Groq models in settings if needed. Google rejects Gemini 2.5 Flash for new users even though model listing still includes it; legacy catalog entries remain for existing accounts, with no silent model substitution. Models must be enabled, approved and configured; restrictions are checked at enqueue and execution, not just in the UI. There is no retry on a different provider/model after a failed call. When no approved model is available, Room agent offers clearly labeled local **DEMO MODE**, not real AI.

Catalog models may have free-plan access, but account tier controls actual billing. Keep provider accounts on their free tier for this sprint. AgentRoom cannot determine a provider account's billing plan from a key and does not enable billing. Groq currently lists Llama 3.1/3.3 as enterprise access; use them only when your account permits the intended usage. GPT-OSS 20B/120B appear in Groq's free-plan limits. Check current [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [Groq models](https://console.groq.com/docs/models), and [Groq rate limits](https://console.groq.com/docs/rate-limits).

OpenAI requires configured credentials, approved models/prices, and explicit owner authorization. Claude, xAI Grok, and Meta Muse Spark are future integrations.

## Muse

Muse is AgentRoom's assistant persona, not Meta Muse Spark and not a separate foundation model. It uses the owner's approved Gemini or Groq model without a Muse API key. Gemini is preferred by default.

Muse receives up to 300 recent messages / 30,000 transcript characters from the current channel, timestamps, labeled AI responses, and bounded excerpts from up to five shared artifacts. It can summarize discussions, extract decisions/action items/open questions, compare model answers, explain progress, and create shared Markdown documents when requested. Its instructions prohibit inventing history and disclose missing context. This is bounded recent-history retrieval, not a complete historical search or task-management system; older conversations may be unavailable and summaries still need human review.

## Permissions and persistence

- Google is the only real OAuth provider. Database-backed sessions persist across reloads; sign-out revokes associated sockets. Microsoft identity records are preserved but Microsoft login is not offered.
- Owners manage workspace/model settings, roles and ownership. Admins can manage channels and invite members; members can chat, request approved agents, and edit shared artifacts. Invitation links have expiry, use limits, optional email restrictions, and revocation.
- Authenticated REST and Socket.IO actions enforce workspace membership. Channels currently share workspace membership; private-channel membership is not implemented.
- Each channel runs one AI job at a time, in FIFO order. Messages, job transitions and artifacts are sequenced in SQLite. Reconnection restores a durable snapshot and replay; transient stream chunks and presence are ephemeral.
- Shared artifacts have optimistic version checks and immutable version history; this is not simultaneous CRDT editing.
- Original room IDs retain their legacy mappings and require authenticated claiming/access. Do not delete these mappings.

SQLite uses WAL and schema v6. Existing migrations take timestamped backups before changing an older database. Before applying any future migration to real data, back up and test it on a copy. Never use `npm run reset` against data you need to preserve. Back up SQLite with a consistent SQLite backup operation, along with uploaded avatars and the credential encryption key.

## Limits and security

Prompts: 4,000 characters. Context: 12,000 characters, or 30,000 for Muse. Output: 1,024 tokens, or 2,048 for Muse. Defaults: 30 AI requests/member/hour and 300/workspace/day, plus monthly token reservations and owner-configured quotas. Socket agent requests are capped at six/minute/user; a channel can have at most 20 queued/running jobs.

Provider guards coordinate calls across channels in one process, recheck shared slots after waits, and honor cooldowns. Safe errors explain missing keys, inaccessible models, quotas and provider limits. Raw SDK errors and keys are not returned to clients. Failed providers never produce a fake AI reply. Token counts are recorded when supplied; otherwise reservations remain estimates. Gemini/Groq cost records are zero estimates for intended free-plan use, not billing reconciliation.

## Validation

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run check:secrets
npm run test:e2e
npm run test:live
npm run check:staged
```

`npm test` mocks providers for routing, Muse context/artifacts, usage, allowlists, workspace isolation, FIFO, failure recovery, authentication and data migrations. `npm run test:e2e` runs Chromium against an isolated database and mock Google login, with all provider keys explicitly cleared. Install the browser with `npx playwright install chromium` if required; stop any server on port 3000 first.

Only `npm run test:live` loads local provider keys and sends small real requests. It explicitly loads `.env.local` despite Vitest's test mode. Gemini lists models and streams one tiny response; Groq verifies Muse against a stored channel fact through the real queue in an in-memory workspace, including streaming, persistence and usage. Missing keys cause skips. Passing mocks or model listing alone does not establish live generation. Live tests do not validate real Google OAuth. `check:secrets` scans the production browser bundle; `check:staged` scans staged paths and content before a commit without printing secret values.

## MVP limitations

- One Node process and one SQLite file; provider/request guards and presence are process-local. Do not deploy multiple replicas with this architecture.
- Free quotas and model availability vary by account and can change. Successful generation must be checked with the actual configured key.
- Real Google OAuth, public HTTPS deployment and OAuth test-user access require environment-specific verification.
- Muse has bounded channel memory and can make model errors. It does not create durable tasks or search all historical messages by date.
- No private-channel permissions, moderation/reporting workflow, full-text history search, or CRDT editing.
- Automated browser tests use mock Google and demo AI; they do not prove external provider availability.
