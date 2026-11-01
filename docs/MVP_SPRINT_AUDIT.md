# AgentRoom MVP audit — 2026-10-30

Starting state: clean `main` at `045ebe5`; GitHub `refs/heads/main` independently resolved to `045ebe5b423123886b5aa5b73a73857653fc016e`. Work continues on `feat/mvp-provider-hardening`. No prior uncommitted changes were present.

## Initial audit

COMPLETE below means implemented and supported by the passing baseline local tests, not live external-service certification.

| Feature | Initial status | Evidence |
|---|---|---|
| Google authentication | PARTIAL | `src/auth.ts`, `tests/auth.test.ts`; real Google OAuth not exercised |
| Microsoft authentication removal | COMPLETE | Google-only `src/auth.ts`, `src/app/sign-in/SignInForm.tsx`; legacy records retained |
| User profiles | COMPLETE | `src/server/profile-repository.ts`, `tests/profile.test.ts` |
| Workspaces | COMPLETE | `src/server/workspace-repository.ts`, `tests/workspaces.test.ts` |
| Channels | COMPLETE | `src/server/channel-repository.ts`, `tests/channels.test.ts` |
| Invitations | COMPLETE | `src/server/workspace-repository.ts`, `src/app/invite/[token]/`, `tests/workspaces.test.ts` |
| Real-time messages | COMPLETE | `src/server/socket.ts`, `tests/sockets.test.ts` |
| AI job queue | COMPLETE | `src/server/queue.ts`, `tests/queue.test.ts` |
| Shared artifacts | COMPLETE | `src/server/collaboration-repository.ts`, `tests/channels.test.ts` |
| White Slack-inspired UI | UNVERIFIED | `src/components/RoomClient.tsx`, `src/app/globals.css`; browser checks pending at audit |
| Gemini integration | PARTIAL | Official SDK adapter in `src/server/ai-providers.ts`, mocked `tests/providers.test.ts`; key missing |
| Groq integration | PARTIAL | Maintained SDK adapter in `src/server/ai-providers.ts`, mocked `tests/providers.test.ts`; key missing |
| Meta Llama integration | PARTIAL | Groq routing/catalog in `src/lib/ai-catalog.ts`; account eligibility unverified |
| Muse | PARTIAL | `src/server/muse.ts`, `src/server/agent-worker.ts`, `tests/providers.test.ts`; no live response |
| Model selection | COMPLETE | `src/components/RoomClient.tsx`, `tests/providers.test.ts` |
| Workspace model permissions | COMPLETE | `src/server/ai-workspace.ts`, `src/server/ai-repository.ts`, `tests/providers.test.ts` |
| API usage tracking | COMPLETE | `src/server/ai-repository.ts`, `tests/providers.test.ts` |
| Security and limits | PARTIAL | `src/server/http-security.ts`, `src/server/ai-providers.ts`; cross-channel rate-wait race found |

## Changes

- Recheck shared provider slots and cooldowns after asynchronous waits; preserve newer cooldowns during retries. Regression tests cover concurrent channels.
- Add a timeout to Gemini model discovery. Failed and empty model-list verification now blocks affected models; verification broadcasts updated availability to connected workspace members. Verification cache state is shared between separately loaded Next.js API and custom Socket.IO modules, with a regression test for that boundary.
- New workspaces approve Gemini 3.8 Flash / 3.5 Flash-Lite and Groq GPT-OSS 20B. A real API error revealed Gemini 2.5 Flash is unavailable to new users despite being listed, so the default was repaired. Llama is labeled account-dependent and requires owner approval; existing stored approvals are preserved.
- Explicitly clear provider keys for routine unit/browser testing. Live tests use Next.js environment-file precedence, including `.env.local`.
- Add staged-path/content security scanning and negative tests, plus browser coverage for saved owner controls, missing-key availability, and mobile panels.
- Replace contradictory README guidance and invalid environment placeholders. No authentication configuration or visual redesign was needed.

## Data and credentials

Read-only inspection found schema v6 and 2 users, 18 workspaces, 18 channels, 21 messages, and 5 artifacts. Final read-only checks confirmed identical counts and `quick_check=ok`. No application migration or database reset was required. No workspace had saved custom AI settings, so repaired defaults apply without database updates. Unit/live tests use in-memory databases; browser tests use `data/agentroom-e2e.sqlite`; production-build validation uses `DATABASE_PATH=:memory:`. Local environment files, SQLite files and backups are ignored, and only `.env.example` is tracked.

Initially Google credentials and `AUTH_SECRET` were configured, mock OAuth was disabled, and Gemini/Groq/OpenAI keys were missing. The user subsequently supplied Gemini/Groq keys; they were saved in ignored `.env.local`, and presence-only checks confirmed both load while all three Google authentication variables remain configured. Existing authentication secrets were preserved. OpenAI remains unconfigured. Keys were never returned in application responses, printed in command output, or staged. The user should rotate the supplied keys because they were shared in chat.

## Validation evidence

- Baseline `npm test`: 93 passed, 2 skipped (live providers).
- Final unit regression suite `npm test`: 101 passed, 2 skipped; 16 test files passed, 1 skipped. The two live tests are intentionally skipped during routine unit runs even when local keys are configured.
- Baseline existing browser suite: all 8 passed. Final `npm run test:e2e`: all 9 passed in 9.7 minutes, including the new owner-controls/mobile test. Covers mock Google sessions/sign-out, protected routes/sockets, shared collaboration/artifacts/reload, homepage/workspaces, invitations, legacy links, security boundaries, and access revocation. One intervening run concurrent with a production build had 4 navigation/authentication timeouts; the serial final run passed without weakening assertions or increasing timeouts.
- Initial `npm run test:live` skipped both providers while keys were missing; after configuration an environment-loader defect was fixed (Next.js omits `.env.local` under test mode). A first real Gemini request failed because the old model rejects new users. After updating the default, `npm run test:live -- -t 'live Gemini'` passed its real Gemini 3.8 Flash streaming/usage test; the other test was filtered out.
- `npm run test:live -- -t 'live Groq'` passed real Groq-backed Muse through FIFO execution, stored channel fact recall, streaming, response persistence, agent/provider/model labels and token usage; the other test was filtered out. No paid authorization or application-database writes were needed.
- The added owner-controls browser test passed after fixing cold-route warmup and an ambiguous test selector. Its desktop/mobile screenshots were visually inspected. The original white interface is preserved.
- `npm run lint` and `npx tsc --noEmit`: passed.
- Final production `npm run build` passed, including lint/type checks. `npm run check:secrets` passed across 48 browser files, checking the actual configured Gemini, Groq and authentication secrets without displaying values.
- Staged security scan passed on the reviewed source/test/documentation set; test fixtures prove it rejects local databases and credentials without echoing secret values.

## Outstanding verification

Real Gemini/Groq generation and Groq-backed Muse are verified. Real Google OAuth is still unverified; browser authentication tests use mock Google. Muse artifacts and isolation also have mocked regression coverage; Muse does not provide full-history date search or durable task management. Public hosting and access for two invited friends require a reachable server and Google OAuth access for their accounts. No billing activation, deployment, merge, data deletion, or history rewrite was performed.
