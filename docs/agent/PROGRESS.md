# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: BUG-038 watchlist search completed and tested; version 0.9.16 recorded
- Status: **✅ RECORDED**
- Timestamp: 2026-08-25 14:05:00 Asia/Taipei

---

## 📅 Log: 2026-08-25 14:05:00 Asia/Taipei (BUG-038 watchlist search: 28k-row list, 27k warrants, no sort/cap → DOM freeze)

- **Bug discovered and fixed**: `AddWatchModal` stock search on a 28,272-row list (1,094 real stocks + 27,043 warrants). User types `2330` — on intermediate keystroke `2`, search hits 8,115 warrants and forces `results.map()` to render 40,000 DOM nodes in full re-render on every keystroke. Browser locks and drops subsequent key events. Root cause: no sort and no render cap; data served in source order (warrants sort before stocks by ticker).
- **Two symptoms, one cause**: (1) Unresponsive input — DOM thrash on partial typed codes. (2) Warrants beat stocks in sort order — search "聯發科" hits 231 items, actual stock 2454 ranks #230 (last).
- **Fix**: `AddWatchModal.tsx` sorts results after matching and caps render to 50. Sort order: security type (4-digit `^\d{4}$` = 0, 5–6 digit `00*` = 1, else = 2) → match quality (code exact = 0, code prefix = 1, name exact = 2, name prefix = 3, name substring = 4) → ticker. Warrants stay searchable, sort to tail. Results >50 show "還有 N 筆，請輸入更完整的關鍵字" (new `.watch-results-more` style in `sources/src/index.css`).
- **Expected behaviour after deploy**: "聯發科" → first result is 2454. "台積" → first result is 2330. Typing `2` renders 50 nodes (no freeze).
- **Files changed**: `sources/src/components/StockDetail/AddWatchModal.tsx`, `sources/src/index.css`, `sources/src/components/StockDetail/AddWatchModal.test.tsx`.
- **Tests**: Fixture expanded to 7 rows (2 warrants 03xxx, 1 ETF 00878, 4 stocks). 3 new test cases: warrant sort order, code-exact priority, 50-cap + remainder text; 2 cases went red→green. Full suite: `npm test` 81 files / 1247 tests exit 0. `npx tsc --noEmit` exit 0. `npm run build` exit 0.
- **Version bumped to 0.9.16**: `sources/src/version.ts`, `sources/package.json`, `sources/package-lock.json`, `README.md` line 3.
- **Records finalized**: BUG-038 added to `FIXED_BUG.md`. CHANGELOG.md 0.9.16 section prepended. This entry added to PROGRESS.md.
- **Commit message**: `fix(watchlist): rank search results and cap the rendered list (0.9.16)`. Root cause: no sort/cap over 28k-row list (27k warrants). Fix: sort by security type + match quality + ticker, render cap 50 + remainder text.

## 📅 Log: 2026-08-25 11:33:57 Asia/Taipei (Task 133: MOPS probe sources never retire; code complete, deployment open)

- **Task 133 completion**: MOPS sources now probe all six daily slots, never retiring. Root cause: `REQUIRED_LANDED_COUNTS` set both MOPS sources to 1, so they retired on first landing at 12:00 slot. The MOPS aggregate tables re-issue throughout the day as companies file, so a source stopping after first landing misses later, larger issues.
- **Fix implemented**: `REQUIRED_LANDED_COUNTS.mops_revenue` and `.mops_profit` now set to `Number.POSITIVE_INFINITY`. `retiredSources()` compares `counts[id] >= required[id]`, so infinite requirement is never met — both sources probe all six slots every weekday. Daily sources (t86, bwibbu, margin, twt38u, bfi82u, borrow) keep existing `REQUIRED_LANDED_COUNTS = 3` and trailing-run retirement rule.
- **Files changed** (production code): `sources/supabase/functions/stock-report/sourceProbePlan.ts`, `sources/src/components/Admin/ProbeWarRoom.tsx`, `sources/src/components/Admin/MechanismGuide.tsx`.
- **UI updates**: MOPS cards now show `n/6 槽` progress (slots probed, not hits or landings); states flow `⏳ 待機中` → `🟢 探測中 (n/6 槽)` → `✅ 六槽跑完` (never `退休`). Daily source cards unchanged (still `n/3 次到位` → `✅ 已退休`). Summary tag `已退休 N 源` becomes `收工 N 源` (unifies retirement and 六槽跑完). MechanismGuide MOPS rows updated to show `不退休 (六槽全跑)`.
- **Verification**: From `sources/`: `npm test -- sourceProbePlan.test.ts ProbeWarRoom.test.tsx MechanismGuide.test.tsx` — all test cases pass. Full suite: `npm test -- --run` exit 0 (81 files / 1243 tests passed). `npm run lint` and `npm run typecheck:edge` exit 0.
- **Accepted cost** (trade-off, not risk): On a MOPS publication day, a hit now fires `generate-history` on each of six slots instead of once. Within existing envelope: `borrow` fires `generate-chips` 13× on a PROD day; `bfi82u` fires `sync-market` 6×.
- **Deployment status**: Code complete and tested. **Not deployed to PROD or DEV Edge** — awaits explicit user authorization.
- **New finding recorded**: PROD `borrow` probe on 2026-08-24 logged 31 ticks / 13 hits / 0 landed (never satisfies `sourceLanded`, never retires, probes full 21:00–23:30 window daily, fires `generate-chips` 13×). Added as new open finding to BUG_FIX.md; not investigated, no owner decision yet.
- **Unfinished**: Edge Function deployment to DEV and PROD.

- **Tests**: `backupPlan.test.ts` +4 cases for `describeError()`; `BackupsSection.test.tsx` +1 case. Total: `npm test` 81 files / 1239 tests exit 0.
- **Verification**: `npm test` exit 0; `npx tsc --noEmit` exit 0; `npx tsc --noEmit -p tsconfig.edge.json` exit 0; `npm run build` exit 0; `npx oxlint` 5 pre-existing warnings, no new.
- **Deployed**: code on both `dev` and `main` (commit 84502c6, version 0.9.13). Pages deploy covers admin UI. **Edge Function `backup-transactions` on PROD not deployed** — awaits explicit authorization.
- **Open work recorded in Task 132**: (1) PROD Edge deploy (2) DEV Edge redeploy (3) affected account manual re-run (4) CRON_SECRET rotation (exposed in transcript during postgres_logs query, seven PROD cron jobs embed it).
- **Unfinished**: All four PROD/DEV/recovery/security items above.

---
