# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Release 0.10.40** — ETF holdings for 0056, 中信 009828, 群益 00919 / 00685L; futures-exposure view.
- Status: ✅ `main` = `dev` = 0.10.40 `5834599`; Edge `stock-report` same bundle on DEV and PROD (`83c63180826c…`); Pages serving 0.10.40; Release 0.10.40 by CI.
- Timestamp: 2026-10-14 11:42:09 Asia/Taipei

---

## 📅 Log: 2026-10-14 11:42:09 Asia/Taipei (release 0.10.40)
- **Ask**: 「幫我直接合併到main去，合併前一樣再確認有無異狀」 (PROD Supabase authorized earlier, after DEV verification).
- **Pre-merge checks**: `npm test` 3,226 / 7 skipped, build, `typecheck:edge`, oxlint. CI for the `dev` head `b28e8ae` had been **cancelled** (the PR-merge run superseded the push run; the PR run on the same commit passed) → re-ran it: success. DEV redeploy from the clean tree kept hash `83c63180826c…` (DEV = `dev`). DEV `app_log` last 6 h: only the 3 warnings from before the release-2 fixes, no errors. DEV live sync: HTTP 200, all five unchanged.
- **Release**: CHANGELOG corrected before the push (two dev bullets were out of date: 「目前串接元大與中國信託」 and 「不持有股票的 ETF…先略過」 — contradicted by the futures view); `5834599 release: 0.10.40`, `main` fast-forwarded from `346c17b`, `dev` = `main`. CI + Sync GitHub Releases green; Release 0.10.40 body is the final entry.
- **PROD Edge**: only `stock-report` (plus `_shared/etfIssuer.ts`, `etfShape.ts`, used by it alone) changed; deployed from the clean tree: v8, `83c63180826c…`, identical to DEV; `verify_jwt=false`. First PROD sync: 0050 unchanged, 00919 / 0056 / 00685L written, **009828 skippedForBudget** (last in order, CTBC worst case 21 s); second run wrote it (3.2 s). PROD files: 009828 30 stocks, 0056 50, 00919 40, 00685L futures-only. Follow-up: TASK 200 item 5.
- **Pages**: live `AnalysisPage-a2GYBz_Y.js` contains 「期貨曝險」 and 「市場分布」.
- **Not verified**: the first scheduled 18:00 run on PROD; the tab logged in.

## 📅 Log: 2026-10-14 11:18:46 Asia/Taipei (Task 200 expansion release 2, 0.10.40-dev.3)
- **Ask**: 「幫我做下一家投信，且全部完成再和我回報，如果需要異動到supabase 我都授權給你，但是都先在dev進行驗證」.
- **Phase 0 (群益)**: passed — `CFWeb/api/etf/buyback` is the whole fund; Edge reachable. Details: spec § Release 2.
- **Done**: Capital source + session, futures-led validation / sync / 期貨曝險 view, per-call 3 s / 7 s, log detail on allowlisted keys.
- **Verified**: `npm test` 3,218 / 7 skipped; build, `typecheck:edge`, oxlint, impeccable detect. DEV: 00919 recreated, 00685L written, others unchanged. Preview (temporary, deleted) 00685L desktop light + 390 px dark, 00919 desktop: no errors / overflow.
- **Caught on DEV**: list parser read the wrong level (test fake was a hand-built array); web dropped no-stock days. Both fixed with tests on the real response shapes. Process slip: a `git stash` used for a red/green check also stashed the user's own `CLAUDE.md` edit — `stash pop` restored it, verified (`git diff --stat`, `docs/agents/` intact, empty stash list); not to be repeated.
- **Review by session 2** (PR #2): 1 BLOCKER (truncated stock response written as futures-led) + 6 RISK + 4 NIT, all verified; BLOCKER, 6 RISK and 1 NIT fixed as 0.10.40-dev.4 (spec § Release 2 review). Gates: `npm test` 3,226 / 7 skipped, build, `typecheck:edge`, oxlint, detect. DEV `stock-report` v24 `83c63180826c…`: 00919 and 00685L deleted and recreated by the sync, others unchanged.
- **Not verified**: Capital and CTBC same-day publish times; the tab logged in.
