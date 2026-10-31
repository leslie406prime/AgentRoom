# PostgreSQL deployment verification

Production scope: one Render Free custom Node web service and a **fresh, empty Neon Free PostgreSQL database**. No SQLite importer or data transfer is required. Existing SQLite records, avatars and environment files remain local. No external resources have been created or deployed.

## Harness diagnosis and fixes

The four original integration tests and Vitest exited successfully. The hang was in `embedded-postgres.stop()` on Windows: it launches an unchecked `taskkill /F /T` and waits for an `exit` event. PostgreSQL remained running. A manual `pg_ctl stop -m fast -w` released the blocked harness, which then completed its restart assertion and stalled again at final shutdown. This localized the problem to cluster shutdown rather than leaked test pools or WebSockets.

The harness now uses PostgreSQL's own bounded, checkpointed fast shutdown on Windows. It propagates errors and exits naturally; it does not force a successful process exit. Other platforms retain the library's SIGINT shutdown. An observer checks `pg_stat_activity` after test children exit and fails if application connections remain.

Test teardown drains workers before closing the shared pool. The drain timeout is cleared on early completion. Browser-test shutdown now uses the normal server drain/close path; the browser harness waits for exit and fails if fallback termination is necessary.

The browser harness now logs its child PID and stage, limits readiness to 60 seconds, and passes Playwright a five-minute global timeout (including setup). Warmup HTTP requests have 30-second timeouts and dispose their request context in `finally`. The outer browser child has a seven-minute watchdog; exceeding it is a failure and cleanup targets only the PID tree created by this harness. Other integration/restart/smoke children have two-minute deadlines. Normal completion clears the watchdog timers. These limits do not depend on a browser test reaching its own assertions.

At the follow-up process inspection there was no stuck browser or PostgreSQL process: the saved browser result was passed, its harness had already exited, and the final production build subsequently returned exit code 0. The long task duration included successive runs that exposed and fixed different failures, rather than one browser child blocked for 30 minutes. No pre-existing Node or Edge processes were terminated.

The browser verification also caught duplicate failed-job history: the client kept a terminal job from the durable event and appended the same job from the authoritative queue snapshot. Queue updates now merge by job ID. The browser fixture warms the channel snapshot route before request timers and targets the composer's existing status role for validation messages.

## Restart coverage

`npm run test:postgres` creates a new loopback-only cluster under ignored `.tmp/postgres-tests`. It runs the integration suite, then a separate application process saves a synthetic user, Google account mapping, database session, workspace, channel, messages, artifact and durable event snapshot. All clients close before PostgreSQL stops and restarts. A fresh application process verifies the complete snapshot and session/identity mapping.

Queue recovery marks an expired interrupted request failed without repeating a possible upstream call, leaves another live worker's lease intact, and processes two queued requests in FIFO order using mocked responses. Tests guard the local test URL before importing database modules. Original SQLite and production Neon databases are never test targets.

## Compatibility changes

- `.node-version` selects Node 22 for Render. Install with `npm ci --include=dev` because `npm start` uses `tsx` and `cross-env`.
- Production requires `DATABASE_URL`, disables SQLite fallback, binds `PORT` on `0.0.0.0`, and shares one HTTP server with Socket.IO.
- The PostgreSQL pool has a maximum of three connections, a 10-second acquisition timeout and a 20-second client query timeout. Remote TLS requires certificate validation; URL SSL options cannot override it.
- Server-side statement timeouts use `SET LOCAL` inside transactions, including schema migrations. They are not sent as session startup options to Neon's transaction pooler. Transactions use checked-out clients and transaction-scoped advisory locks, never session advisory locks. The single shared write lock intentionally limits concurrency at portfolio scale.
- Auth.js database sessions, Google identity mappings and authenticated avatar bytes are stored in PostgreSQL. A stable `AUTH_SECRET` and canonical HTTPS `AUTH_URL` are required. Build and runtime origins must match because CSP is generated at build time.
- Startup applies versioned, checksum-checked schema migrations to the fresh database; it refuses an unrecognized non-empty database. No SQLite reset/import command belongs in deployment commands.
- Client and staged secret scanners now also check configured database connection strings.

## Evidence and remaining acceptance gates

Verification is performed with mocked AI. Integration tests cover authentication, invitations, workspace authorization, channel creation, concurrent message sequencing, replay, artifacts, FIFO and lease fencing, provider routing and usage, concurrent cross-channel quota reservations, avatar blobs, nested rollback and migration checksum enforcement. Unit tests cover the development SQLite path and production/TLS guards.

The local production smoke check passed HTTP health/sign-in, Google-only provider discovery, build/runtime HTTPS/WSS CSP agreement, WebSocket authentication rejection on the shared port, the production SIGTERM handler and zero remaining application database connections. An isolated test-only IPC preload delivers SIGTERM to the main process on Windows, where `child.kill('SIGTERM')` cannot exercise Node signal handlers. The test preload is never imported by application code. Idle RSS measured 164 MiB in the latest Windows smoke run (196 MiB in an earlier run); this is not a concurrent-load or Linux/Render memory measurement.

Completed checks:

| Check | Actual result |
| --- | --- |
| PostgreSQL integration | 5 passed; child and harness exited 0 |
| Engine and fresh application process restart | Passed; identity/session, workspace/channel, messages/artifacts/replay and safe FIFO recovery preserved |
| Bounded two-browser PostgreSQL scenario | 1 passed in 3.2 minutes; test body 1.2 minutes; exit 0 |
| Browser/process teardown | Graceful server drain, zero remaining application PostgreSQL clients, cluster stopped; no test browser/PostgreSQL processes remained |
| Unit suite | 121 passed, 2 opt-in live tests skipped; exit 0 |
| ESLint | Passed |
| TypeScript | `npx tsc --noEmit --incremental false` passed after browser/build generators stopped |
| Production build | Passed on Windows/Node 22 using isolated build settings |
| Production smoke | Passed, exit 0, graceful SIGTERM handler and no remaining database connections |
| Client secret scan | Passed across 49 generated client files |
| Working tree secret/data scan | Passed across 168 tracked/untracked non-ignored files; no staging or commit |
| Original SQLite preservation | Main database, WAL and SHM hashes unchanged; development driver close/reopen test passed on a new temporary fixture |

Release preparation re-ran the 121-test unit suite, five PostgreSQL tests plus restart/FIFO verification, TypeScript, lint and client secret scan successfully. The staged security scan passed across 100 release files. Static checks verified 143 source files' internal imports against the Git index with no missing files or case mismatches, all required runtime/migration files present, matching package/lockfile dependencies and a migration checksum matching the staged LF-normalized SQL. These checks do not substitute for Linux execution. Deployment settings are in the [release runbook](RENDER_NEON_RELEASE.md).

Linux execution is **unverified**: this computer has no Docker executable or installed WSL runtime. Do not infer native `better-sqlite3`/`sharp` installation compatibility or Render's memory fit from Windows success. Before deployment, run a clean Node 22 Linux installation/build and concurrent socket/stream checks within Render Free's limits. The [release runbook](RENDER_NEON_RELEASE.md) records exact settings for the fresh production database.

Actual Neon TLS/pooler connectivity, compute cold starts, final-domain Google OAuth/secure cookies, browser reconnect after hosted restart/redeploy and actual Render runtime resource usage remain unverified. Those require an approved hosted acceptance phase. Keep auto deploy off, use one instance, keep paid providers disabled, and do not add keep-alive traffic or paid infrastructure.

Commands for isolated local verification:

```text
npm run test:postgres
node scripts/test-postgres.cjs --browser
npx tsc --noEmit --incremental false
npm run lint
npm test
```

Build with `NEXT_DIST_DIR=.next-verify`, `DATABASE_PATH=:memory:`, an empty `DATABASE_URL`, disabled mock OAuth and a canonical HTTPS test `AUTH_URL`. After the build finishes, run `node scripts/test-postgres.cjs --production` and `npm run check:secrets` with `NEXT_DIST_DIR=.next-verify`. Do not rebuild that directory while the production smoke server is using it.

Sources reviewed: [Render service binding](https://render.com/docs/web-services), [Render WebSockets](https://render.com/docs/websocket), [Render Free lifecycle](https://render.com/docs/free), [Node version selection](https://render.com/docs/node-version), [Neon transaction pooling](https://neon.com/docs/connect/connection-pooling), [Neon connection errors](https://neon.com/docs/connect/connection-errors), and [node-postgres TLS configuration](https://node-postgres.com/features/ssl).
