# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Session 2026-09-01 recorded (Transaction nature schema extension and CSV integration)
- Status: **✅ RECORDED**
- Timestamp: 2026-09-01 10:17:41 Asia/Taipei

---

## 📅 Log: 2026-09-01 10:17:41 Asia/Taipei (Transaction nature field and fee/tax split CSV)

- **Status**: ✅ **COMPLETED (DEV verified, PROD pending)**
- **Task Completed**: Task 137 §C (Transaction Nature CSV Extension, full completion)
- **Routing**: 1 scout → 4 builders (data layer, calculations, form, CSV) → 2 reviewers → main-session adjudication
- **Bugs/Risks**: New RISK-004 (dropped label on pre-migration database, severity low, accepted).
- **Work Summary**:
  - Schema: `transactions.tx_nature TEXT` with CHECK constraint (NULL / SPOT / DAY_TRADE / MARGIN) added to `sources/supabase/schema.sql`.
  - Provider: Retry on missing-column errors only (`42703` or `PGRST204`); other errors throw immediately (INSERT is not idempotent).
  - Calculations: `splitFeeTax` centralizes fee/tax split; explicit label only adds information (no forced SPOT rate per BUG-036).
  - CSV: Export emits `交易性質` and split `手續費`/`證交稅` columns, keeps legacy column. Import accepts labels/codes, sums split columns, reports unrecognized nature per-row.
  - Form: `交易性質` selector for TPE only; selecting 當沖 sets securities tax rate to 0.0015.
- **Tests**: 93 files / 1450 tests, all passing, exit 0. Two main-session catches before review: provider retry originally on ANY error (would duplicate transactions); `splitFeeTax` had optional `ticker` with fallback (would overtax ETF/TDR/REIT 3×). Both fixed.
- **DEV Deployment**: Schema applied and verified. PROD pending (BUG-041).
- **Reviewer Verdicts**: Calculations PASS with no findings; data layer PASS WITH RISK (dropped-label risk accepted; ledger inference still correct).
- **Files Changed**: `services/dataProvider.ts`, `sources/supabase/schema.sql`, `utils/fees.ts`, `csv.ts`, `TransactionForm.tsx`, plus 7 test files.
- **Edge Deployment**: Not needed.

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

---
