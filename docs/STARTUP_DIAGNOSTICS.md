# Production startup diagnostics

The confirmed public origin is `https://agentroom-m6aa.onrender.com`. Build and runtime must use that same `AUTH_URL`. This diagnostics release does not establish the cause of the current Render failure and does not authorize querying the production Neon database or deploying automatically.

## Why the previous record was insufficient

The final catch in `server.ts` discarded its exception argument and emitted only `level` and `event`. It could represent a database/migration failure, Next preparation, recovery or worker setup. Environment preloading and several static module/constructor initializations occurred outside that promise catch. `listen()` also reports some failures through an asynchronous `error` event rather than a rejected promise.

## Instrumented startup path

The environment preload validates configuration and logs a safe configuration failure before rethrowing only an allowlisted fixed message. Runtime startup emits `server_startup_stage` at each boundary:

1. `configuration`: runtime settings and HTTP security helpers.
2. `database_initialization`: driver/module load and pool configuration; development SQLite behavior is preserved.
3. `database_connection`: a bounded readiness query using the configured PostgreSQL pool.
4. `migration`: acquire a client, begin a transaction, set a local statement timeout, take the transaction-scoped lock, inspect/create migration metadata, reject unrecognized/newer schemas or changed checksums, read and apply versioned SQL, then commit/release (rollback on failure).
5. `server_initialization` and `next_preparation`: construct Next and prepare the production build, including Next's Node runtime initialization.
6. `authentication_initialization`: load the existing Auth.js/Google module after Next's runtime is ready, then load socket/worker modules under `server_initialization`. This is not a live Google OAuth credential check.
7. `job_recovery`: recover expired PostgreSQL worker leases.
8. `server_initialization`: construct the shared HTTP/Socket.IO server, register handlers and shutdown hooks.
9. `worker_startup`: resume eligible queued channels.
10. `port_binding`: await the HTTP `listening` event and catch binding `error` events. Only then emit `server_listening`.

Failures include `stage`, allowlisted `error_name`/`error_class`, a stable `category`/`code`, a fixed safe message, and PostgreSQL `sqlstate` when recognized. Nested causes/aggregate errors are inspected only for bounded safe metadata. Arbitrary exception text, stacks, causes, SQL, database/user/host details, environment values, credentials and tokens are never serialized by this logger. Unknown errors receive `STARTUP_OPERATION_FAILED`; no raw-message fallback exists. Startup failure closes owned resources and returns a failure exit status.

The next manually approved Render deploy should reveal the failing boundary and safe category/code. Examples include database authentication (`28P01`), migration permissions (`42501`), missing resources (`ENOENT`), schema guards (`database_schema_unrecognized`, `database_schema_newer`, `migration_checksum_changed`), TLS validation, native-module loading and port binding (`EADDRINUSE`). These examples are diagnostic categories, not claims about the current hosted failure. Collect the structured failure record and preceding stage records; do not paste connection strings or environment values.

## First deploy and migrations

PostgreSQL migrations already run **automatically before listening** through `initializeDatabase()` and `migratePostgres()`. A separate Render pre-deploy command is not required for this application. Keep the repository root as the working directory and include `migrations/postgres/001_initial.sql` in the release. Build with `npm ci --include=dev && npm run build`, then start with `npm start`. Build-only mode uses memory and does not initialize Neon; the start command requires PostgreSQL and applies the schema.

Use the approved fresh, empty database. No historical SQLite importer or seed upload is required. If the schema guard refuses a non-empty database, do not reset or delete it: inspect the safe failure and select an explicitly approved empty database. No migration SQL or production database was changed for this diagnostics task.

## Isolated validation

`node scripts/test-postgres.cjs --production` starts the production server against a fresh loopback-only database with mock OAuth disabled, provider keys empty, and the confirmed public origin used for build/runtime CSP. It checks `/api/health`, Google-only provider discovery, HTTP/WebSocket handling and clean shutdown.

`node scripts/test-postgres.cjs --startup-diagnostics` uses separate disposable PostgreSQL and child processes to exercise rejected database credentials, malformed configuration, a missing migration file and an occupied port. Each child has a 45-second timeout and must exit naturally with status 1, emit the expected safe stage/code, and omit credential canaries. The harness itself bounds its test child and checks database-client cleanup. No Neon credentials or original SQLite records are used.

Unit tests cover SQLSTATE categories, nested/aggregate errors, secret-canary omission, migration guard classification, stage tracking and operating-system codes that must not be mislabeled as SQLSTATE. See the release report for actual completed validation results; live Render root cause remains unconfirmed until new hosted diagnostics are available.

Completed local validation for this change: 132 unit tests passed (two opt-in live tests skipped), five PostgreSQL integration tests plus engine/application restart and FIFO recovery passed, TypeScript and ESLint passed, and the production build and client secret scan passed. The corrected production smoke check returned healthy HTTP and exited 0; all four real failure scenarios above emitted their expected stage/code and exited naturally with status 1. Both disposable PostgreSQL harnesses exited 0, verified zero remaining application clients and stopped their clusters. An early smoke run caught an import-order regression in the diagnostics refactor; loading Auth.js after Next preparation resolved it and the rerun passed. This local regression is not evidence of the original Render failure.
