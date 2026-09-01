# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Session 2026-09-01 recorded (Lot-based unrealized P&L, day-trading tax split, transaction form edit fix)
- Status: **✅ RECORDED**
- Timestamp: 2026-09-01 09:39:42 Asia/Taipei

---

## 📅 Log: 2026-09-01 09:39:42 Asia/Taipei (Lot-based unrealized P&L, day-trading tax, codebase audit fixes)

- **Status**: ✅ **COMPLETED (not deployed)**
- **Tasks Completed**: Task 136 (Lot-Based Unrealized P&L), Task 137 (Day-Trading Tax & Form Edit Parity, except §C), Task 138 (Codebase Deep Audit Remediation, items 1–6, item 7 withdrawn)
- **Routing**: 2 scouts → 3 parallel builders → 3 reviewers → main-session adjudication
- **Bugs Fixed**: BUG-033 (form mount recalculation), BUG-034 (fmtPercent rounding), BUG-035 (TDR/REIT tax rates), BUG-036 (day-trade brokerage fee), BUG-037 (parseNumber accounting format), BUG-038 (breakEvenPrice zero-cost), BUG-039 (full liquidation residue). BUG-040 recorded as invalid (false premise). BUG-041 operational note (PROD schema pending). New RISK: breakEvenPrice sentinel ambiguity (pre-existing).
- **Work Summary**:
  - Task 136: `Position`/`Holding` carry `openLots: OpenLot[]`; `computeLedger` appends per BUY, consumes per SELL (FIFO); `estimateUnrealized` floors per-lot min fee and tax. Reference case (0050, 4 lots 2000/1000/1000/2000, cost 625,188, price 106.25): 10,770 vs 10,767 (3 TWD gap to broker app).
  - Task 137: Day-trade detection (fee_tax < floorSafe(gross × sellTaxRate) AND fee_tax - halfTax = max(minFee, floorSafe(gross × feeRate))). Tax ladder in ledger: standard when covered, half-tax if not, recorded amount as fallback. Batch recalculation excludes day-trades (risk of data corruption). TransactionForm edit fix: compare initial vs current values instead of skipping first effect (StrictMode survives). §C deferred (CSV columns need Supabase migration, blocked by BUG-041).
  - Task 138: TDR/REIT tax rates 0.1%, fmtPercent uses Decimal half-up rounding, breakEvenPrice admits cost=0 but still rejects NaN/negative, computeLedger zeroes cost/rawCost/openLots at qty=0.
- **Tests**: Baseline 91 files / 1377 tests → final **92 files / 1416 tests**, all passing. New file `realExports.test.ts` runs 106 broker CSV rows through parse/ledger/fee-corrections. `npx tsc --noEmit` exit 0. `npm run build` exit 0.
- **Reviewer verdicts**: Formatters/CSV PASS (2 RISKs both fixed); pnlEngine FAIL→fixed (Holding literal missing openLots field); fees/form PASS (StrictMode RISK fixed, breakEvenPrice sentinel RISK recorded).
- **Verification gap**: `npx tsc --noEmit` passed while `npm run build` failed (build config type-checks test files, --noEmit does not). `npm run build` is the real type gate.
- **Files Changed**: `pnlEngine.ts`, `fees.ts`, `formatters.ts`, `csv.ts`, `TransactionForm.tsx`, `RecalcFeesModal.tsx`, `whatIf.ts`, plus version files and 7 test files.
- **Edge Deployment**: Not needed.

## 📅 Log: 2026-08-31 18:35:00 Asia/Taipei (Workspace fee rate persistence to Supabase)

- **Status**: ✅ **COMPLETED (DEV verified, PROD pending schema)**
- **Task**: Task 135 — `Workspace fee rate persistence (Supabase)`
- **Routing**: Lane 2 (schema + Edge) — scout mapped spec + failing tests → builder (2 rounds) → reviewer (2× PASS) → adjudicate
- **Work Summary**: Moved persistent fee rate storage from `localStorage` to `workspaces.fee_rate` column, implementing sync logic for cache/remote reconciliation.
- **Key Changes**:
  - New `utils/feeSync.ts`: pure function `planFeeSync()` with three-way reconciliation (adopt-remote, push-local, default fallback).
  - `WorkspaceContext.tsx`: calls `syncWorkspaceFees()` before `setWorkspaces()` renders, ensuring first view has synced values.
  - `SupabaseProvider.listWorkspaces()`: queries with `fee_rate` column, retries with legacy column list if schema not deployed yet (fail-safe for staggered rollout).
  - No signature changes; six callsites of `getFeeRate()` require zero edits.
- **Schema (DEV)**: Applied and verified — `workspaces.fee_rate NUMERIC` + range check, PostgREST confirms HTTP 200 with `fee_rate` in response.
- **Schema (PROD)**: Pending — blocked by no access token. Recorded as BUG-041, requires manual execution (three ALTER statements + schema reload).
- **Tests**: 19 new across 3 files (`utils/feeSync.test.ts`, `services/feeSettings.test.ts`, `services/dataProvider.workspaces.test.ts`). Full suite: 91 files / 1377 tests, exit 0; `tsc --noEmit` and `npm run build` both exit 0.
- **Risks Accepted** (BUG-042, BUG-043): Silent fallback error swallowing, pattern-matching existing `LocalProvider` style.
- **Edge Deployment**: Not needed — no Edge Function changes.
- **Files Changed**: 5 source + 3 test, plus CHANGELOG.md, TASK.md, BUG_FIX.md recorded.

---
