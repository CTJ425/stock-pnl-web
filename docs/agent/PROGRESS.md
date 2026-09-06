# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 深度稽核九項查證與修正、0.9.34 發布與雙環境部署
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-05 09:22:10 Asia/Taipei

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

---

## 📅 Log: 2026-09-06 15:46:21 Asia/Taipei (Task 146, 0.9.35-dev.1)

**Spec 146 Phase 1 — the `app_log` capture layer and the admin "執行記錄" panel.**

The starting fact, from a codebase scout: nothing recorded causes. `stock-report/index.ts` had no `console.log` at all — an exception became an HTTP status and a response body nobody kept. The web services `catch` and `return null`, so a failure rendered an empty state. The four existing log tables (`batch_run_log`, `source_probe_log`, `source_probe_tick`, `admin_run_log`) store flags, durations and skip reasons. Spec 144 Feature 2 was already specified over exactly those four tables, which is why it could never have shown a front-end error: the data did not exist. Spec 146 adds the capture, and shares one panel with Spec 144.

**Applied to DEV** through `supabase db query --linked` with the `EXISTS (... command LIKE '%zyebvayngwrqzoaicbwd%')` identity guard inside the write. Verified on DEV: `is_dev=true`, table present, RLS on, `policies=1`, `select_policies=0`, `idx=4`, RPC present, `service_role` EXECUTE true, `authenticated` EXECUTE false, `cron_jobs=7`, `prune_job=1`. **DEV cron job count is now 7, not 6** — `CLAUDE.md` and older PROGRESS entries name 6. The count was never a valid identity check; the `EXISTS` predicate on the project ref is.

**Three defects found during the build, none of which any green gate could see:**

1. **`try { return promise }` does not catch a rejection.** The first version of the outermost catch covered 3 of 20 dispatch branches in `stock-report` and 0 of 5 in `stock-price`; the rest returned an unawaited promise whose rejection escaped the `try`. `npm run build` and `npm run typecheck:edge` were both green. All 24 handler returns are now `return await`.
2. **A POST body of the literal JSON value `null` produced no response at all.** `null` is valid JSON, so the parse `catch` never fires; `body.action` then throws a `TypeError`, and the new outermost catch threw a second time reading the same `body.action`, escaping `Deno.serve`. Reachable with no credential. Before this task's catch existed the same input produced an empty 500 — the new error handling made it strictly worse until the guard was added after the parse in both functions. Found by `reviewer`.
3. **`fetchAppLogs` omitted `timeout` on `functions.invoke`**, breaking the project's structural contract in `src/services/invokeTimeout.test.ts`. `supabase-js` has no default, so a hung Edge Function leaves the spinner turning forever. Now 20 s.

**Redaction is a key allowlist, not a denylist**, at every depth including inside arrays, with `stack` truncated to 2000 characters, other strings to 500, and arrays capped at 20 elements. The array cap exists because `app_log.detail` has no size CHECK in the database: `pg_column_size` is not immutable and does not belong in a CHECK constraint. A denylist fails open, and this project already has a precedent — a redaction regex once printed the DEV `CRON_SECRET` into a transcript.

**Verification**: `npx vitest run` 100 files / 1710 tests passed, exit 0. `npm run build` exit 0. `npm run typecheck:edge` exit 0. `npx oxlint src` 0 errors. `reviewer` verdict FAIL on the first pass (two BLOCKERs, both real), PASS after the fix.

**Not done**: Phase 2 (ErrorBoundary and service-level capture), Phase 3 (transaction write path), and the DEV Edge deploy. Edge-side capture exists in source only.
