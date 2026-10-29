# Homepage session and legacy access report

Inspection date: 2026-10-28. No private conversation content, credentials, or original room capabilities are included.

## Findings

The homepage rendered a static Sign in link and never requested the Auth.js session. Workspace pages already used the cookie-backed server-side session. The homepage was also eligible for static rendering. It now reads that same session on each request, renders only the current user's workspace memberships, and supplies the profile/account menu, workspace selection, opening, creation, and sign-out actions.

The original conversations are still in the application database. All 16 pre-workspace rooms have valid legacy mappings and dedicated unclaimed workspaces. They intentionally have no authenticated owner until someone proves possession of an original private room link. There are no broken mappings, unmapped rooms, foreign-key violations, or claimed workspaces without owners. Listing these rooms for every signed-in user would bypass workspace isolation.

The active and historical application database path is:

`C:\Users\lesli\.codex\project 1\data\agentroom.sqlite`

The pre-authentication backup `agentroom.sqlite.20261027T045946077Z.bak` contains 16 rooms, 10 anonymous members, 40 events, 15 messages, 6 AI jobs, 4 artifacts, and 3 artifact versions. Those rows remain in the active database. Every historical record in all 12 application migration backups was compared by primary key and original column values: zero missing or changed historical records. Test/smoke databases were identified separately and were not treated as application history.

## Application record counts

The Before column was recorded before implementation. The After column was checked after the build and isolated tests; every application record count is unchanged.

| Table / state | Before | After |
| --- | ---: | ---: |
| rooms | 18 | 18 |
| members | 12 | 12 |
| room_events | 52 | 52 |
| messages | 19 | 19 |
| agent_jobs | 8 | 8 |
| artifacts | 5 | 5 |
| artifact_versions | 4 | 4 |
| user | 1 | 1 |
| account | 1 | 1 |
| session | 1 | 1 |
| workspaces | 18 | 18 |
| channels | 18 | 18 |
| memberships | 2 | 2 |
| legacy_room_links | 16 | 16 |
| unclaimed legacy workspaces | 16 | 16 |

No application memberships or claims were added during this work. No records were recovered from backups, copied, overwritten, or fabricated. No application database path, authentication mechanism, Socket.IO handler, or migration was changed. Normal live presence/last-seen metadata can advance while the application is used; original legacy records remain unchanged.

## Accessing previous conversations

1. Sign in at `http://localhost:3000/sign-in` with the account that should own the old conversation.
2. Find its original `/room/<unguessable-room-id>` link in your browser history, bookmarks, or previously shared invitation.
3. Open that link, or paste it into **Original room link** under **Open a previous conversation** on the homepage.
4. The existing claim route grants this account ownership of that one unclaimed legacy workspace and redirects to its original channel. Existing messages, AI responses, timestamps, ordering, sequence numbers, jobs, artifacts, and versions are read from their original rows.
5. The workspace then appears in your homepage list and workspace selector.

If the application's hostname has changed, retain the complete original `/room/<id>` path and use the current `http://localhost:3000` origin. Another user's already-claimed workspace requires an invitation from its owner. Signing in alone does not prove ownership of anonymous legacy rooms. If you cannot locate an original link, the room is still preserved, but no ownership was assigned during this work.

## Verification

- `npm run build`: passed; the homepage is dynamically rendered.
- `npm test`: 73 tests passed across 14 files, including workspace isolation, legacy claiming, original history preservation, migration preservation, and link validation.
- `npm run lint`: passed.
- `npm run test:e2e`: all 8 browser scenarios passed on the final run. These cover session persistence, homepage profile/account state, workspace selection and opening, sign out, legacy original-link claiming, preserved historical messages/artifacts/version history, refresh, invitation behavior, cross-account denial, active-access revocation, and two-user Socket.IO collaboration.
- The first browser run exposed two stale selectors and an early native form-submit race in the newly added legacy-link form. The selectors were corrected, interactive controls were gated until hydration, and the entire browser suite was rerun successfully. The production build was also rerun successfully after the runtime fixes.
- Browser fixtures use the existing isolated test database, with explicit guards preventing fixture writes to the application database. No replacement application database is created.
- Final application database checks: schema version 5, integrity check `ok`, zero foreign-key violations, zero legacy claims made during this work, and zero missing or changed historical records across 1,128 row comparisons against 12 migration backups.
- The normal development server was restarted at `http://localhost:3000` with the existing real Google OAuth configuration (mock OAuth disabled). Live anonymous checks returned homepage 200 with Sign in/Get started and workspace API 401. Application record counts were checked again after restart and remained identical.

## Files changed

- `src/app/page.tsx`: server-side session and user-scoped homepage data.
- `src/components/HomeClient.tsx`: existing homepage presentation plus account and workspace actions.
- `src/components/WorkspaceList.tsx`: authorized, server-supplied workspace destinations.
- `src/components/LegacyRoomLink.tsx`: original-link entry using the existing claim route.
- `src/lib/legacy-room-link.ts`: strict same-origin original-room path validation.
- `src/server/workspace-repository.ts`: read-only membership-scoped homepage query.
- `tests/legacy-room-link.test.ts`: valid/invalid legacy-link tests.
- `tests/workspaces.test.ts`: homepage scoping and historical row preservation during claims.
- `tests/e2e/homepage.spec.ts`: signed-in/out homepage, profile image, selection, opening, refresh, and sign out.
- `tests/e2e/legacy-access.spec.ts`: original-link authentication, single claim, preserved messages/artifacts/versions, refresh, and foreign-account denial.
- `tests/e2e/test-database.ts`: fixture guard for the existing isolated test database.
- `tests/e2e/collaboration.spec.ts`: updated workspace-creation button selector.
- `tests/e2e/invitations.spec.ts`: uses the Google sign-in control instead of an obsolete pre-redesign headline.
- `docs/HOMEPAGE_AND_LEGACY_ACCESS.md`: this report.
