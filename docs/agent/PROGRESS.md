# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.5 official release finalized; records updated; Task 124 moved to archive
- Status: **✅ 0.9.5 SHIPPED**
- Timestamp: 2026-08-20 15:07:12 CST

---

## 📅 Log: 2026-08-20 15:07:12 CST (0.9.5 official release — 損益試算成本基數精確度修正：舍入、費用、透明標籤)

- **Release**: Version 0.9.5 shipped to `main` branch; GitHub Pages deployment automatically triggered by `main` push; official GitHub Release created by `.github/workflows/release.yml`.
- **Scope**: Official release consolidating precision fixes for P&L simulator cost basis, confirmed via extended E2E verification (75 files / 1127 tests pass, E2E scripts cross-check).
- **What shipped**: (1) 買進價 rounding precision: 104.225's binary trap fixed with `roundPrice()` helper using `Math.round((value + Number.EPSILON) * 100) / 100`, used by both seed and ladder pricing. (2) 買進費用 no longer recalculated from workspace config: `whatIf()` gains optional `buyFee` override, WhatIfTab supplies real fee, achieving exact parity with 庫存總覽 (−3,298 on reference position). (3) 帳單標籤 transparency: buy side shows 成交均價（未含費）& 實付手續費; sell side shows 現價; sources stated in hints.
- **E2E coverage added**: Two new test artefacts closed gaps in prior dev.1 (75 files, 1127 tests vs 74/1125): (1) `sources/src/components/StockDetail/AnalysisPage.whatif.test.tsx` (jsdom) — real prop chain holding → StockDetailPage → WhatIfTab against reference position; (2) `sources/scripts/verify-whatif-e2e.cjs` (Playwright) — cross-checks sell price = quote case, credentials from env vars only.
- **Testing verified**: `npx vitest run` → 75 files / **1127 tests** all pass; `npx tsc --noEmit` 0 errors; `npx oxlint src` 0 errors; `npm run build` ok. E2E `verify-whatif-e2e.cjs` against DEV → **PASS**; `verify-watchlist-e2e.cjs` → **10/10 PASS** (no regression).
- **Durable finding**: CSV import is **append, not replace**, with **no duplicate detection** (`sources/src/services/dataProvider.ts:116` / `:204`). Re-importing the same export file to the same workspace creates new transaction entries for every row. This is not a bug — it is correct behaviour for an append operation — but users may misinterpret duplicate line items as account discrepancies. Present user's concern has been resolved; no code changes made to this behaviour.
- **Records finalized**: CHANGELOG.md retitled 0.9.5-dev.1 → 0.9.5, updated test counts (75/1127), added two new test artefact bullets. TASK.md moved Task 124 to TASK_ARCHIVE.md (marked ✅). PROGRESS.md header updated; this entry added; oldest entry (2026-08-20 14:41:35) rolled to archive. All files match (grep verified).
- **Unfinished**: None — 0.9.5 complete and live.

---

## 📅 Log: 2026-08-20 14:59:05 CST (Task 124 損益試算 verification outcome — no defect, E2E coverage added)

- **Task**: Task 124 (spec: `docs/agent/specs/124-whatif-real-cost-basis.md`)
- **Investigation**: User reported 損益試算 損益 showed ~1,582 instead of matching 庫存總覽 after 0.9.5-dev.1 release. Code review found **no defect** — the discrepancy came from DEV app's default workspace after login being `測試區1`, which does not hold ticker 0050. With no holding, the tab correctly falls back to watched-stock behaviour (buy price seeded from quote), so P&L is three fees only — the ~1,582 signature.
- **Root cause**: User reported from workspace `測試區1` (no holding); correct workspace is `SNAP正式區` (holds 9 transactions for 0050, reducing to 4,000 shares, rawCost 416,900 → rawAvgCost 104.2250, cost 417,492 → avgCost 104.3730).
- **Verification on running DEV app** (`http://10.8.22.99:5173`, version badge `0.9.5-dev.1`): workspace `SNAP正式區`, ticker 0050 — 買進價格 104.23 (matches seed), 股數 4 張, 賣出價格 103.8 (current quote), 投入成本 NT$417,492 (matches 庫存總覽), 損益 -NT$3,298 (matches 庫存總覽's 未實現淨損益 for same holding). 賣出階梯 11 列、摘要列 3 項 both render correctly.
- **E2E coverage gap closed**: `AnalysisPage.test.tsx` mocked `StockDetailPage` away, so the holding → `StockDetailPage` → `WhatIfTab` prop chain had no test at all. Two additions: (1) `sources/src/components/StockDetail/AnalysisPage.whatif.test.tsx` (new, jsdom) — renders the real chain against the reference position (4,000 shares @ 104.3730 avgCost, quote 103.80) and asserts 買進價格 `104.23`, 投入成本 `417,492`, 損益 `-3,298`; (2) `sources/scripts/verify-whatif-e2e.cjs` (new, Playwright) — cross-checks 賣出價 = 現價 case: tab's 投入成本 / 損益 must equal 庫存總覽's 投入成本 / 未實現淨損益, ladder and marks strip render. Credentials read from `APP_USER` / `APP_PASS` environment variables at run time, never stored in file. Usage: `BASE_URL=… WORKSPACE=… TICKER=… node scripts/verify-whatif-e2e.cjs`.
- **Full verification run**: `npx vitest run` → 75 files / **1127 tests** all pass; `npx tsc --noEmit` 0 errors; `npx oxlint src` 0 errors; `npm run build` ok. E2E `node scripts/verify-whatif-e2e.cjs` against DEV → **PASS** (庫存總覽 417,492 / -3,298 ＝ 損益試算 417,492 / -3,298, 階梯 11 列、摘要 3 項). `node scripts/verify-watchlist-e2e.cjs` against DEV → **10/10 passed** (no regression in existing watchlist E2E). No production code changed by verification step; no Supabase, no Edge, no schema.
- **Records finalized**: PROGRESS.md updated (this entry added, header updated, oldest entry rolled to archive); TASK.md updated (Task 124 marked 📋 verified on DEV with E2E coverage); `docs/UnitTests/E2E.md` updated (new `verify-whatif-e2e.cjs` script added to E2E list).
- **Conclusion**: 0.9.5-dev.1 is correct; no code fix needed. DEV workspace confusion resolved; user can now verify on their own PROD holding by switching workspace and confirming 損益試算 values match 庫存總覽.

