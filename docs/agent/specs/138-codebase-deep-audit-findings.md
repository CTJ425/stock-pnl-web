# Task 138 — Codebase Deep Audit Findings & Remediation Plan

Target version: `0.9.25-dev.1` (or subsequent release).

## Overview

Following the investigation into unrealized P&L lot-based rounding and day-trading fee handling, a comprehensive audit across all calculation engines, data parsers, UI forms, and admin modules identified 11 potential defects and boundary logic issues.

---

## Findings & Specifications

### 1. `fmtPercent` Floating-Point Rounding Epsilon Defect (BUG-034)
- **Location**: `sources/src/utils/formatters.ts:43-46`
- **Root Cause**: `(value * 100).toFixed(2)` suffers from IEEE-754 binary floating point representation issues (e.g. `0.01005 * 100` or `0.07005 * 100` evaluates to `7.0049999999999998...`). JavaScript `.toFixed(2)` rounds down to `7.00%` instead of `7.01%`.
- **Fix**: Apply decimal half-up rounding using `Number.EPSILON`:
  ```ts
  export function fmtPercent(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—'
    const pct = Math.round((value * 100 + Number.EPSILON) * 100) / 100
    return `${pct.toFixed(2)}%`
  }
  ```

### 2. TDR and REITs Securities Transaction Tax Rate Overcharge (BUG-035)
- **Location**: `sources/src/utils/pnlEngine.ts:141-144` (`sellTaxRate`)
- **Root Cause**: `sellTaxRate` only checks `ticker.startsWith('00')` for 0.1% ETF tax rate, defaulting all other tickers to 0.3%.
  - **TDRs (Taiwan Depository Receipts, `91xx` e.g. `9105`)**: Statutory tax rate is **0.1% (0.001)**.
  - **REITs (Real Estate Investment Trusts, `01xx` e.g. `01001T`)**: Statutory tax rate is **0.1% (0.001)**.
- **Fix**: Update `sellTaxRate`:
  ```ts
  export function sellTaxRate(ticker: string): number {
    if (/^00\d+B$/i.test(ticker)) return 0 // Bond ETF exempt
    if (ticker.startsWith('00') || ticker.startsWith('91') || /^01\d{3}[A-Z]?$/i.test(ticker)) return 0.001
    return 0.003
  }
  ```

### 3. Day-Trading Transactions Zero Out Brokerage Fees in Ledger Summary (BUG-036)
- **Location**: `sources/src/utils/pnlEngine.ts:246-253`
- **Root Cause**: `computeLedger` calculates `estTax = Math.min(floorSafe(tx.price * tx.qty * sellTaxRate(tx.ticker)), tx.fee_tax)`. When a day-trade sell occurs with 0.15% tax rate, `sellTaxRate` computes 0.3% tax which exceeds total `fee_tax`. `Math.min` caps `estTax` at `tx.fee_tax`, setting `feesBrokerage` to `0`.
- **Fix**: Detect day-trade tax fitting or accept explicit tax breakdown so `estTax` accurately reflects 0.15% for day trades.

### 4. Floating-Point Residue on Full Position Liquidation (BUG-039)
- **Location**: `sources/src/utils/pnlEngine.ts:284-293`
- **Root Cause**: When `matchedQty === pos.qty`, `pos.cost -= costBasis` can leave a `1e-14` residue. If the user later re-purchases the stock, this residue permanently pollutes the moving average cost.
- **Fix**: When `pos.qty === matchedQty` (or `pos.qty - matchedQty === 0`), explicitly set `pos.cost = 0` and `pos.rawCost = 0`.

### 5. CSV Parsing Fails on Accounting Negative Parentheses Format (BUG-037)
- **Location**: `sources/src/utils/csv.ts:89-94` (`parseNumber`)
- **Root Cause**: Accounting formats representing negative numbers as `(1,000)` become `(1000)` after stripping `$`, resulting in `Number('(1000)') === NaN`.
- **Fix**: Strip parentheses and negate the number if surrounded by `(...)`:
  ```ts
  function parseNumber(value: string): number {
    let s = value.trim()
    const isParenNeg = /^\(.*\)$/.test(s)
    s = s.replace(/(NT\$|US\$|\$|,|\s|\(|\))/g, '')
    if (s === '') return NaN
    const num = Number(s)
    return isParenNeg ? -num : num
  }
  ```

### 6. Zero-Cost Stock Dividend Break-Even Price Inaccuracy (BUG-038)
- **Location**: `sources/src/utils/fees.ts:89-92` (`breakEvenPrice`)
- **Root Cause**: If a position consists purely of zero-cost stock dividends (`cost === 0`), `breakEvenPrice` returns `0`. Selling at 0 TWD would still incur minimum transaction fees (20 TWD) and tax.
- **Fix**: Allow `breakEvenPrice` to compute the minimum price required to cover the selling fee and tax when `cost === 0` and `qty > 0`.

### 7. Self-Revocation of Admin Rights in AccountsSection (BUG-040)
- **Location**: `sources/src/components/Admin/AccountsSection.tsx:33-43`
- **Root Cause**: An admin clicking their own toggle switch immediately revokes their admin status without a confirmation prompt.
- **Fix**: Add a confirmation modal when the target user ID matches the current authenticated user's ID.

---

## Test Charter

| Case | Expected Outcome | Layer / File |
| :--- | :--- | :--- |
| `fmtPercent(0.01005)` | Returns `+1.01%` (not `1.00%`) | `formatters.test.ts` |
| `sellTaxRate('9105')` | Returns `0.001` (TDR 0.1%) | `pnlEngine.test.ts` |
| `sellTaxRate('01001T')` | Returns `0.001` (REITs 0.1%) | `pnlEngine.test.ts` |
| Full liquidation then re-buy | Position cost has 0 residue before re-buy | `pnlEngine.test.ts` |
| CSV `(1,500)` amount | Parsed as `-1500` | `csv.test.ts` |
| Admin self-toggle | Prompts confirmation before execution | `AccountsSection.test.tsx` |
