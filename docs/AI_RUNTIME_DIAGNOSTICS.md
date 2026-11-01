# Application AI failures — October 30, 2026

## Confirmed failure point

Five recent original jobs were inspected read-only: three Gemini jobs and two Muse jobs, all resolved to `gemini:gemini-3.8-flash` and marked failed. No saved workspace AI configuration overrode the application defaults. API-key values and private prompts were not displayed.

The original generic messages did not retain HTTP codes, so their individual original HTTP responses cannot be reconstructed. A new isolated reproduction using the real Muse worker/context/output cap failed at **provider execution**, before any response text or agent message persistence, with **HTTP 503**, two attempts, and no streamed text. A fresh standalone-style 256-token request also timed out; the prior standalone success was no longer current evidence of availability. Changing the thinking level did not resolve the issue and that experimental change was removed.

With the same configured Gemini key, the application-shaped request succeeded on `gemini-3.5-flash-lite`. This isolates the current failure to the Gemini 3.8 endpoint/model service rather than missing credentials, workspace routing, SQLite persistence or the browser transport. It does not establish a global Google outage or explain Google's internal backend cause.

## Fix and model decision

- Keep provider HTTP status and allowlisted transport/status codes when converting SDK errors to safe public messages.
- Distinguish credentials/restrictions, invalid model requests, quotas, network errors, timeouts and upstream service errors. Timeouts no longer receive the automatic transient-service retry; SDK retries are explicitly limited so the application owns its single retry policy.
- Record stage, provider, safe model identifier, job/channel IDs, attempts, partial-stream flag, elapsed time, input size and output cap. Application permission/configuration/quota failures have their own codes. Raw messages, stacks, headers, API keys and conversation contents are not logged.
- Trace stages are deduplication, model selection, context, usage reservation, provider execution, artifact persistence and message persistence. Enqueue rejections are logged separately.
- Startup logs name the environment files loaded and show provider-key **presence only**.
- The user explicitly approved switching the default and Muse to `gemini:gemini-3.5-flash-lite` for workspaces without saved AI settings. Saved choices, provider permissions and output/request/token limits remain unchanged. No database migration or record rewrite is needed. There is no hidden per-request model substitution and no paid provider activation.

## Configuration comparison

Both standalone and custom-server paths use `.env.local` with Next.js environment precedence and the same server-side provider adapter. The old standalone Gemini probe capped output at 256 tokens; normal jobs cap it at 1,024 and Muse at 2,048, with bounded stored-channel context. The full application test now exercises these actual worker limits, authenticated sockets and persistence. The standalone probe follows the configured default model rather than the first catalog entry.

## Full browser evidence

`npm run test:live:app` uses port 3101, two mock-authenticated browser contexts, real provider APIs and a fresh `data/agentroom-live-e2e-<random>.sqlite` file. Mock OAuth is restricted to that isolated development process. Your Google-only configuration and application database are preserved.

The live application run verified five real replies: Gemini 3.5 Flash-Lite, Muse on Gemini 3.5 Flash-Lite, Groq GPT-OSS 20B, Muse on Groq, and a further Groq reply after the failing Gemini 3.8 request. Both channel members saw the replies. Reloading both browsers retained all five messages and their provider/model metadata. Five usage records contained actual completed token usage. The original-model probe failed with `CLIENT_TIMEOUT`, stage `provider`, no streamed text, and a useful visible failure. The queue then continued normally. The test passed in 5.8 minutes.

This is evidence from the real application execution path, not only a standalone SDK call. Gemini 3.8 remains subject to the upstream service issue and is not claimed repaired.

Final checks: 116 unit tests passed, with two opt-in live tests skipped; TypeScript, lint and the production build passed. The production client secret scan passed across 48 files. After restarting the normal server, health and authenticated workspace configuration returned HTTP 200, Google was the only OAuth provider, both provider keys were loaded, and default/Muse resolved to Flash-Lite with paid usage disabled. SQLite integrity was `ok`; no saved workspace AI configurations or historical records were rewritten.

## Using the application

Restart `npm run dev` after server-side changes; Next.js page hot reload does not reload the custom Socket.IO worker. After refresh, workspaces without saved AI settings use Flash-Lite for Gemini/Muse. Owners with saved settings can explicitly choose an approved model under Workspace settings. To use Groq directly, choose Room agent and GPT-OSS 20B. Owners can select GPT-OSS 20B for Muse. Existing failed jobs remain in history; submit a new request or explicitly retry them after changing models.
