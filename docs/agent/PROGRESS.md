# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 深度稽核九項查證與修正、0.9.34 發布與雙環境部署
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-05 09:22:10 Asia/Taipei

---

## 📅 Log: 2026-09-06 16:40:00 Asia/Taipei (Task 146, 0.9.35 released)

**Live DEV verification of Spec 146, then the release.**

Six checks against the deployed DEV project, not against mocks:

1. **A real Edge exception is captured.** `POST /functions/v1/stock-price` with `{"action":"prices","symbols":[null]}` threw `Cannot read properties of null (reading 'market')` and returned 500. The row landed in `app_log`: `level=error`, `source=edge`, `action=prices`, message intact, a 479-character stack, and `detail` minus `stack` was `{}` — nothing extra leaked through the allowlist.
2. **`app-logs` is closed.** 401 with no credential, 401 with the anon key alone.
3. **The `null`-body defect stays fixed on the deployed bundle.** A POST body of literal `null` returns 400, not a dropped connection.
4. **The RPC reads and filters.** `admin_recent_app_logs` returned the rows and honoured the `level` filter.
5. **The RLS policy behaves as designed**, tested as the `authenticated` role carrying a real user's claims: own `web` row ALLOWED; own `web` row with `RETURNING` DENIED; own `edge` row DENIED; a row attributed to another `user_id` DENIED; `SELECT` returns nothing.
6. **The app boots against DEV.** Version badge `0.9.35-dev.2` at the time of the check, no console errors, no page errors, the ErrorBoundary fallback not triggered.

**Check 5 found a trap worth keeping.** The first run reported the user's own `web` insert as DENIED, which would have meant every client-side log failing silently in production. The cause was the test itself using `INSERT ... RETURNING`: PostgreSQL requires a `SELECT` policy for `RETURNING`, and this table deliberately has none. `supabase-js` adds `RETURNING` only when `.select()` is chained, and `appLog.ts` does not chain it — so the production path is correct. A regression test now pins it, because chaining `.select()` later would break every client log with no symptom: `logClient` swallows its own errors by design.

**Not verified, and stated plainly**: the admin panel's own UI, and a log written from a real browser session. Both need an admin login, which this session did not have. The panel's data layer is covered by unit tests and by check 4 above; its rendering is not covered by anything but `AdminConsolePage.test.tsx`'s panel-list assertion.

**Release**: `0.9.35-dev.1` and `-dev.2` are consolidated into one `0.9.35` section in `CHANGELOG.md`. Version synchronized across `version.ts`, `package.json`, `package-lock.json` and the README badge.

**Verification**: `npx vitest run` 103 files / **1732** tests passed, exit 0. `npm run build` exit 0. `npm run typecheck:edge` exit 0. `npx oxlint src` 0 errors.

---

## 📅 Log: 2026-09-06 16:21:13 Asia/Taipei (Task 146, 0.9.35-dev.2)

**Spec 146 Phases 2 and 3 — the capture layer now has something feeding it.**

Phase 1 built the table, the Edge capture and the admin panel. Nothing in the browser wrote to it yet. This entry closes that: the app's first ErrorBoundary, the 14 silent `catch` blocks in five service files, and the three transaction write methods.

**The transaction write path does not swallow — it throws.** `addTransactions`, `updateTransaction` and `deleteTransactions` already threw on failure, and every caller depends on that throw. The change records the PostgREST code and leaves the throw byte-for-byte identical: same message, same type, same condition. `detail` carries `code` only, never the row. The main session read that diff itself rather than delegating it, because a silent change there is a money bug.

**Two defects the reviewer caught, both in the new error handling itself:**

1. **`ErrorBoundary` read `error.message` with no type narrowing.** React passes the thrown value through unchanged, and `throw null` is legal. Reading `.message` off `null` throws a second time inside the outermost boundary, where no ancestor can catch it — reproducing the exact blank, unrecorded page the component exists to prevent. Now narrowed with `error instanceof Error`, with a test that throws `null`.
2. **The dedupe window matched the poll interval, so it deduped nothing.** `DEDUPE_MS` was 60 s; the app has two 60 s price-poll loops (`useStockPrices.ts`, `WatchSection.tsx`) that reach these log sites. Consecutive polls land exactly one window apart, so a sustained outage wrote one row per minute per open tab. The window is now 5 minutes, and the spec states the rule: it must stay longer than any poll interval that reaches a log site.

**Two accepted risks, recorded as RISK-006 and RISK-007 in `BUG_FIX.md`**: seven `action` values name module-private functions rather than public entry points, and `syncWorkspaceFees`'s catch sits inside a loop over workspaces.

**A third defect was in the failing tests this session wrote, and only `npm run build` could see it.** `JSX.Element` used bare no longer resolves under `@types/react@19` (the namespace moved under `React`), and a test component that always throws infers `never`, which stops being a valid JSX component (TS2786). Both builders correctly reported the red build and refused to edit the test files; the main session fixed them. `npx vitest run` was green throughout, because esbuild does not type-check.

**Verification**: `npx vitest run` 103 files / **1731** tests passed, exit 0. `npm run build` exit 0. `npm run typecheck:edge` exit 0. `npx oxlint src` 0 errors. `reviewer` verdict PASS with four RISKs; two fixed, two accepted and recorded.

