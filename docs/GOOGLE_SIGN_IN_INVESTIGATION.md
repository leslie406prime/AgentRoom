# Google sign-in investigation

The production login failure is **not yet diagnosed**. The reported log
`{"level":"error","event":"auth_error","type":"s"}` contains a minified
constructor name, not the stable Auth.js error type. It cannot establish an
account collision, a database failure, or a provider validation failure.

## Confirmed defects and limited fix

`src/app/sign-in/SignInForm.tsx` displayed the same account-linking refusal for
every non-empty `error` query parameter, including configuration and callback
errors. It now distinguishes an explicit `OAuthAccountNotLinked` from general
failures, without rendering arbitrary query-string text.

`src/auth.ts` logged `error.name`. Installed Auth.js sets this to the constructor
name, which Next.js minifies. The logger now records allowlisted `error.type`,
nested Auth.js cause type, recognized transport/OIDC codes, and PostgreSQL
SQLSTATE. Traversal includes Auth.js's `cause.err` wrapper and is bounded.
Messages, stacks, profiles, adapter arguments, SQL details, tokens and environment
values are never serialized. Unknown metadata is omitted.

These are diagnostics and error-presentation fixes. They do not establish or fix
the cause of the live authentication failure.

## Authentication trace and schema review

1. Auth.js handles CSRF, PKCE, state and nonce, exchanges the authorization code,
   verifies Google's signed ID token, and maps the Google profile.
2. The application sign-in callback allows a login without a valid existing
   database session. With a session, an existing identity must belong to that
   same user. A new identity additionally requires a verified Google email and
   a one-use linking intent bound to that session and provider.
3. Auth.js resolves `(provider, providerAccountId)` using the adapter. For a new
   identity it refuses an existing email match; dangerous email linking remains
   disabled. A new application user ID is intentionally distinct from Google's
   subject ID. The adapter stores that subject as `providerAccountId`.
4. Successful signup creates a user, links the identity, and creates a database
   session. The sign-in event records verification. Session reads resolve the
   user and update activity. The production session cookie remains secure,
   HTTP-only, same-site lax.

The PostgreSQL schema has a user primary key, a composite account primary key
`(provider, "providerAccountId")`, and a session-token primary key. Account and
session user IDs reference the user table. Email is indexed, not unique; Auth.js
still refuses automatic linking by email. Camel-case adapter fields are quoted
by the database layer; timestamps are stored as epoch milliseconds.

Auth.js creates user/account/session through separate adapter calls, not one
transaction across the entire signup. A failure after user creation can therefore
leave a partial user. This is a possible failure mode, **not observed evidence
about production**. No production records were inspected, repaired or deleted.

## Isolated reproduction

`npm run test:postgres` adds four regression scenarios using the installed Auth.js
engine, real application Google provider configuration and PostgreSQL adapter:
first-time signup, returning login, separate accounts and cross-user refusal,
and equal-email collision without a partial user or automatic merge.

`node scripts/test-postgres.cjs --google-auth` runs the compiled production Next.js
routes and custom server with secure production cookies and the canonical Render
origin. Only Google discovery, token and JWKS HTTP responses are mocked; ID tokens
are signed with an ephemeral RSA test key. This test covers the same login and
security scenarios, database sessions, health and Socket.IO authentication.

Both commands create fresh loopback-only PostgreSQL clusters. The production
test requires an existing `.next-verify` build. Its outer deadline is 120 seconds,
individual OAuth HTTP requests are limited to 15 seconds, and shutdown is bounded
to 35 seconds. The harness checks for remaining database clients and stops the
cluster. No real Google or AI API requests or Neon credentials are used.

## Next production evidence

After a manually approved deployment, reproduce one login and inspect only the
sanitized `auth_error` record. The stable `type`, optional `cause_type`, `code`
and `sqlstate` will distinguish callback/provider validation, adapter/database,
and deliberate account-linking refusals. Do not infer a collision from the old
message or the old `s` name. Do not reset the database or merge accounts to bypass
an undiagnosed error.

Local SQLite files are excluded and untouched. No deployment is performed by
this investigation; commits use Render's `[skip render]` marker.

## Completed local validation

- Unit suite: 136 passed, two existing live-provider skips.
- PostgreSQL integration suite: nine passed, including four Google OIDC scenarios
  and refusal to link a new identity without an explicit intent.
- PostgreSQL engine restart, fresh application-process persistence and safe FIFO
  recovery passed; all clients disconnected and the cluster stopped.
- Compiled production HTTP Google OIDC flow passed, including returning sessions,
  separate accounts, missing linking intent, cross-user refusal and email collision.
  Its expected refusals logged stable `AccessDenied` and `OAuthAccountNotLinked`
  types despite production minification. Graceful shutdown passed.
- TypeScript, production build, lint and client secret scan passed.
