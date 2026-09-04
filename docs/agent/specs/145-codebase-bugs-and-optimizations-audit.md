# Task 145 — Codebase Deep Audit: Defects, Truncation Risks & Optimization Plan

Target version: `0.9.34-dev.1` (or subsequent release).

## Overview

Following a comprehensive audit of the entire codebase (`sources/src/` and `sources/supabase/`), including peer challenge and independent verification, 10 defects (3 P0, 4 P1, 2 P2, 1 design clarification) and 5 performance/UI/architecture optimizations were documented with verified code references and actionable remediation steps.

---

## Part 1: Defects & Bugs (Ranked by Severity)

### 1. CSV Export/Import Borrow Fee Loss on Short Positions (BUG-063 / P0)
- **Location**: `sources/src/utils/csv.ts:262, 325` & `sources/src/utils/pnlEngine.ts:268`
- **Root Cause**: During CSV export, `splitFeeTax(tx)` calculates `{ fee: tx.fee_tax - tax - borrow, tax, borrow }`. CSV columns only contain `手續費` (broker fee) and `交易稅` (tax). When importing via `csv.ts:262` (`splitMode`), `feeTax = fee + tax` is assigned, permanently discarding the 0.08% borrow fee.
- **Failure Scenario**: A user exports their transactions to CSV and re-imports them into another workspace or account. Any short-selling transaction loses its borrow fee permanently, understating the transaction cost and distorting subsequent P&L calculations.
- **Remediation**:
  - Add optional `借券費` column to CSV format, or
  - In `splitMode` import, if `tx_nature === 'SHORT'` and borrow fee is not explicitly given, infer borrow fee using `gross * BORROW_FEE_RATE` or preserve the difference.

### 2. Recalculate Fees Drops Borrow Fee and Desynchronizes fee_rate (BUG-064 / P0)
- **Location**: `sources/src/utils/fees.ts:163-171` & `sources/src/components/Transactions/RecalcFeesModal.tsx:55-64`
- **Root Cause**: `proposeFeeCorrections` calls `calculateFee` without passing `nature: tx.tx_nature`. Short sales (`tx_nature === 'SHORT'`) are treated as normal spot sells, calculating a fee without the 0.08% borrow fee. The modal flags this as a mismatch and prompts the user to overwrite `fee_tax`. Furthermore, when applying updates, `updateTransaction` fails to include `fee_rate: opts.feeRate`, leaving the stored `fee_rate` column outdated.
- **Remediation**:
  - Pass `nature: tx.tx_nature` in `proposeFeeCorrections`.
  - Include `fee_rate: opts.feeRate` in the patch passed to `updateTransaction`.

### 3. Stock Split Wizard Corrupts Short Covering and Ignores Short Sells (BUG-065 / P0)
- **Location**: `sources/src/components/Transactions/StockSplitModal.tsx:49-65, 178-184`
- **Root Cause**: `StockSplitModal` selects eligible transactions with `tx.tx_type === 'BUY'` without excluding `tx.tx_nature === 'SHORT'`. Short-cover buys are erroneously transformed as if they were spot purchases. Meanwhile, unhedged short sells (`tx_type === 'SELL'`, `tx_nature === 'SHORT'`) are completely ignored, creating an irreconcilable position mismatch between long and short shares.
- **Remediation**:
  - Exclude `tx.tx_nature === 'SHORT'` when scanning `buyTickers` and building `previewItems`, OR
  - Explicitly support short positions by applying split ratios to both short-sell and short-cover transactions.

### 4. PostgREST 1000-Row Default Limit Silently Truncates Data (BUG-066 / P1)
- **Locations**:
  1. `sources/src/services/dataProvider.ts:312` (`listTransactions` without pagination).
  2. `sources/supabase/functions/backup-transactions/index.ts:72` (`backupAccount` table dump).
  3. `sources/supabase/functions/stock-report/index.ts:1003` (`heldTwTickers` across all users).
  4. `sources/supabase/functions/stock-report/index.ts:1011` (`watchedTwTickers` whitelist).
  5. `sources/supabase/functions/backup-transactions/index.ts:172` & `stock-report/index.ts:3809` (`listUsers({ page: 1, perPage: 1000 })`).
  6. `sources/supabase/functions/stock-report/index.ts:3538` (`source_probe_tick` `.limit(2000)` truncated by server max_rows).
  7. `sources/supabase/functions/stock-report/index.ts:3947` (restore return count).
- **Root Cause**: Supabase PostgREST imposes a strict default `max_rows = 1000`. Queries without `.range()` pagination loops silently stop at 1000 rows.
- **Remediation**: Implement pagination chunking loops (e.g. `fetchAllPages` helper) for multi-record dumps, exports, and bulk ticker listings.

### 5. Dual Long/Short Position Masking in Stock Detail Analysis (BUG-067 / P1)
- **Location**: `sources/src/components/StockDetail/AnalysisPage.tsx:84, 115, 204`
- **Root Cause**: `holdingEntries` maps rows using `r.holding.key` (`'TPE:2330'`) instead of `r.rowKey` (`'TPE:2330:LONG'` vs `'TPE:2330:SHORT'`).
- **Failure Scenario**: When an account simultaneously holds a spot long and a short position in the same stock:
  - React issues a Duplicate Key warning on dropdown render.
  - `holdingEntries.find((e) => e.key === selectedKey)` always matches the first entry (long position).
  - The short position cannot be selected or viewed in `AnalysisPage`.
- **Remediation**: Use `r.rowKey` for `holdingEntries.key` and update `selectedKey` comparison logic.

### 6. Pure Short Position Passes Zero Qty/Cost to What-If Tab (BUG-068 / P1)
- **Location**: `sources/src/components/StockDetail/AnalysisPage.tsx:258`
- **Root Cause**: A pure short position has `holding.qty === 0` and `holding.avgCost === 0` (the short quantity is stored in `shortQty`). Passing `holding` directly causes `WhatIfTab` and related cost calculators to be initialized with 0 shares and 0 cost basis.
- **Remediation**: Construct `ReportHolding` passing `qty: holding.shortQty` and `avgCost: holding.shortAvgCost` when analyzing a short position row.

### 7. Full Batch Failure Unconditionally Publishes manifest.json (BUG-069 / P1)
- **Location**: `sources/supabase/functions/stock-report/index.ts:3111`
- **Root Cause**: In `handleGenerateAll`, `uploadJson('reports/manifest.json', ...)` is executed unconditionally at the end of the batch, even if `generated === 0` and all tickers failed.
- **Remediation**: Guard the manifest update with `if (generated > 0)`.

### 8. Timing-Unsafe Secret Comparison in `backup-transactions` (BUG-070 / P2)
- **Location**: `sources/supabase/functions/backup-transactions/index.ts:51`
- **Root Cause**: `got !== expected` is used instead of constant-time comparison `secretsMatch` from `_shared/cronSecret.ts`.
- **Remediation**: Import and use `secretsMatch(got, expected)`.

### 9. Duplicate React Key and Mislabeling in Yearly Report (BUG-071 / P2)
- **Location**: `sources/src/components/YearlyReport/YearlyPage.tsx:373, 377` & `sources/src/utils/pnlEngine.ts:534, 772`
- **Root Cause**: Day-trade split sells push the same `txId` multiple times into `yt.sells`, triggering `<tr key={sell.txId}>` React warnings. Line 377 also hardcodes the label `"賣出"`, which displays "賣出" even for buy-to-cover (`BUY` + `SHORT`) transactions.
- **Remediation**: Use composite key `${sell.txId}:${idx}` and render label dynamically based on whether it is a cover buy or sell.

### 10. `StockSplitModal.tsx` `useMemo` Dependency & Identity Instability (Clarification)
- **Location**: `sources/src/components/Transactions/StockSplitModal.tsx:43-46, 149`
- **Analysis**: Notice that adding `minFees` object literal directly to `useMemo` dependencies causes complete memo invalidation on every render.
- **Remediation**: Wrap `minFees` in its own `useMemo` or pass primitive values `[minFees.whole, minFees.odd]`.

---

## Part 2: Optimizations

### OPT-1: Route-Level Code Splitting (`AppShell.tsx:36-46`)
- **Problem**: 795 KB main JavaScript bundle. Heavy pages (`AdminConsolePage`, `MacroPage`, `FxPage`) and extensive SVG icon collections are statically imported.
- **Remediation**: Convert `AdminConsolePage`, `MacroPage`, and `FxPage` to `React.lazy()` with `<Suspense fallback={<PageSkeleton />}>`.

### OPT-2: Stable Reference for `IntradayChart.tsx:133`
- **Problem**: `const points = data?.points ?? []` allocates a new array on every render when data is missing, retriggering 5 cascading `useMemo` hooks.
- **Remediation**: Declare a module-level `const EMPTY_POINTS: PricePoint[] = []`.

### OPT-3: Light Theme Hardcoded White Contrast Fix (`index.css:4019, 4376`)
- **Problem**: Hardcoded `rgba(255, 255, 255, 0.9)` on elements like `.pwr-dot` washes out or becomes completely invisible in light mode.
- **Remediation**: Replace with CSS custom properties (`--text-muted`, `--border-subtle`).

### OPT-4: Eliminate Cached Price Industry Flickering (`stock-price/index.ts:246`)
- **Problem**: `price_cache` hit returns `industry: null`, resulting in the industry badge flickering between blank and the real name upon cache expiration.
- **Remediation**: Retain and return cached `industry` string on cache hit.

### OPT-5: Sentinel 0 Elimination in `breakEvenPrice` (`fees.ts:187, 203`)
- **Problem**: Returns `0` for both zero-cost cases and indeterminate calculations.
- **Remediation**: Refactor return type to `number | null`.

---

## Implementation Roadmap

1. **Phase 1 (Data Integrity & Calculation Accuracy)**: BUG-063 (CSV Borrow Fee), BUG-064 (Recalc Fees), BUG-065 (Stock Split Short Isolation).
2. **Phase 2 (Capacity & Availability)**: BUG-066 (PostgREST Pagination Loop), BUG-067 (Dual Long/Short RowKey), BUG-068 & BUG-069 (What-If & Manifest Guard).
3. **Phase 3 (Security, UI & Performance)**: BUG-070 (Timing Safe Comparison), BUG-071 (Yearly Report Keys), OPT-1 (Code Splitting), OPT-2 (Memo Stabilization).
