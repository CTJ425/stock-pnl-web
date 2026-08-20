# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Task 124 verification outcome recorded; investigation found no code defect, E2E coverage added
- Status: **✅ VERIFIED**
- Timestamp: 2026-08-20 14:59:05 CST

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

---

## 📅 Log: 2026-08-20 14:41:35 CST (Task 124 0.9.5-dev.1 損益試算成本基數精確度修正 recorded)

- **Task**: Task 124 (spec: `docs/agent/specs/124-whatif-real-cost-basis.md`)
- **Scope**: Three genuine defects on real PROD position (0050, 玉山証券 workspace: 4,000 shares, `rawCost` 416,900 → `rawAvgCost` 104.2250, `cost` 417,492 → `avgCost` 104.3730, quote 103.80).
- **What was fixed**: (1) 買進價 rounding: 104.225's binary trap → new `roundPrice()` helper (`Math.round((value + Number.EPSILON) * 100) / 100`), used by both seed and ladder; (2) buy fee recalculation: `whatIf()` gains optional `buyFee` override, WhatIfTab supplies real fee, so 投入成本 exact match 庫存總覽 (−3,298 exact parity on reference position); (3) ledger labels: buy side shows 成交均價（未含費）& 實付手續費, source in hint, sell side shows 現價.
- **Files changed**: `sources/src/utils/formatters.ts` (new `roundPrice`), `sources/src/components/StockDetail/whatIf.ts` (buyFee override, snap fix), `WhatIfTab.tsx` (seed re-keyed, labels), `StockDetailPage.tsx`, `AnalysisPage.tsx`, `sources/src/index.css`.
- **Tests added**: `sources/src/utils/formatters.test.ts` (rounding trap values); `whatIf.test.ts` & `WhatIfTab.test.tsx` gained 104.23 seed, 417,492 cost parity, −3,298 P&L match, edited-price fee rate, and label test cases.
- **Verification**: `npx vitest run` 74 files / **1125 tests** all pass; `npx tsc --noEmit` 0 errors; `npx oxlint src` 0 errors (5 pre-existing); `npm run build` ok. Frontend only — no Supabase, no Edge, no schema, no migration.
- **Reviewer verdict**: `route:reviewer` **PASS** with three RISKS fixed pre-delivery: (1) `sellLadder` snap now uses `roundPrice`, not local `Math.round`; (2) WhatIfTab re-seeds on `[ticker, rawAvgCost, avgCost, heldQty]` to sync on workspace switch; (3) `buyFee` clamped to 0 when not finite or not > 0. Spec formula (`roundPrice`) also corrected — old formula returned 0.14 for 0.145, verified fix across 0.145 / 1.005 / 104.225 / 8888.885 / 12345.675.
- **Records finalized**: CHANGELOG.md gained 0.9.5-dev.1 section (7 bullets, house style); Task 124 added to TASK.md as 🔄 (awaiting user's real-position check); this PROGRESS entry added.
- **Unfinished**: User verification on real PROD position (0050, 玉山) — compare 損益試算 against 庫存總覽 for precision match (投入成本、損益、手續費).

