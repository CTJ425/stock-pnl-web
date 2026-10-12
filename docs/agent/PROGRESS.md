# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Docs audit + archive** — project refs moved to the recreated DEV/PROD; README and docs corrected; hot files rolled.
- Status: ✅ on `dev` (docs/tooling only, no version bump); `main` still = 0.10.37 `1ed1835`. Frontend, Edge, DDL untouched.
- Timestamp: 2026-10-12 09:39:05 Asia/Taipei

---

## 📅 Log: 2026-10-12 09:39:05 Asia/Taipei (docs archive + accuracy audit)
- **Ask**: 「幫我做一下所有文件的歸檔與查證…」, then 「都按照你的建議」.
- **Archive** (`61c23e3`): TASK.md 23,918 → ~13.3 KB, BUG_FIX.md 9,139 → 8,370 B (both still over cap — the remaining entries are live). Tasks 188/178/179/181 moved verbatim to `TASK_ARCHIVE.md` (open items **not** done); BUG-103/107 accepted → `ACCEPTED_RISKS.md`.
- **Refs**: `supabase projects list` shows only DEV `accmczhrqsilzrtyhyxa` and PROD `zizndnzibubcqdvnuhwr`. Old refs replaced in CLAUDE.md, GEMINI.md, CLAUDE-tw.md, `supabase-ops`/`probe-ops`, six E2E scripts, `e2e-dev.yml`, E2E.md. Identity predicate checked live: true on DEV, false on PROD. `sources/` re-linked to DEV (was dead `ytbgtuqeeyxlvldbzgnl`). Task 198 item 5 done.
- **Docs fixed**: README test counts (186 files / 3,094 pass / 7 skipped, run today), `stock-report` 44 files (not 45), `stock-price` 8 (not 9), the 「未登入回 401」 claim (publishable key passes `verify_jwt`, Task 185 #12), removed `supabase start` steps, added 資金流向 / 休市日 / 保持登入 / Discord to features and tree; `sources/README.md` now deploys `backup-transactions` with `--no-verify-jwt`; CLAUDE-tw.md `ai-proxy` removed; GEMINI.md deploy flag; UNIT.md / E2E.md dead file names.
- **Verified**: `npm run build`, vitest, `node --check` on all scripts, workflow YAML parses.
- **Not done / not verified**: E2E scripts not run against the new DEV; `sources/.env` (gitignored) still points at dead `zyebvayngwrqzoaicbwd` — needs the new DEV URL + publishable key; `docs/architecture/system_design.md` (original design doc) still lists `database.types.ts`; code comments were checked only for references to missing files, not read line by line.
## 📅 Log: 2026-10-10 00:03:40 Asia/Taipei (BUG-119 fix, 0.10.37-dev.1)
- **Ask**: 「幫我修 BUG-119」.
- **Done**: `onRememberExpired()` in `authPersistence.ts`, called (deferred) from `expireRemembered()`; `AuthContext` signs out locally on it. New real-client test `AuthContext.expiry.test.tsx` E1 (failed before the fix, passes after) and `authPersistence.test.ts` P10/P11. Version 0.10.37-dev.1 in `package.json` (+lock), `version.ts`, README; CHANGELOG entry in zh-TW; BUG-119 moved to `FIXED_BUG.md`; spec 194 item 2 updated.
- **Verified**: Playwright re-run (faked Supabase HTTP, cap 20 s ahead): login page at t+50 s, was still signed-in UI at t+150 s before; the other three scenarios unchanged. `npm test` 3,094 pass / 7 skipped, `npm run build`, `typecheck:edge`, oxlint exit 0.
- **Gates (ship)**: first `npm test` run had 1 failure in `SectorFlowPage.test.tsx` (「opens a link to a sector with no tile…」) that passed 3× alone and on a full rerun (3,094 pass) — flaky under full-suite load; root cause found afterwards (test asserted `details.open` one commit before the effect sets it — fails 36/36 when run alone with `-t`), fixed in the test with `waitFor`; build, `typecheck:edge` pass.
- **Released**: user asked 「先幫我commit跟push到main」. `release: 0.10.37` fast-forwarded to `main`; `gh release view 0.10.37` body = CHANGELOG section; production `appLog-*.js` carries `0.10.37`.
- **Not done**: Task 194 item 5 on iOS Safari and Windows.
