# Task 137 — Day-Trading Tax Recognition & Transaction Form Edit Parity

Target version: `0.9.25-dev.1` (or next planned release).

## Problem Statement

### 1. `TransactionForm.tsx` Edit Mode Auto-Overwrite on Mount (Bug)
- **Symptom**: When editing an existing transaction (e.g. 華邦電 sell with saved `fee_tax = 362`), opening the edit modal immediately displays `"已依目前費率重算；原本是 362 還原原紀錄"` and sets the input field to `645`. Even after restoring/saving, subsequent openings of the edit modal re-trigger the overwrite.
- **Root Cause**: `TransactionForm.tsx:109-125` contains a `useEffect` on `[price, qty, unit, feeRate, taxRate, minFee, market, txType, getActualShares]`. On initial mount in edit mode (`initial` is present), this effect runs unconditionally, computes `calculateFee`, and executes `setFee(String(calculated))` — overwriting `initial.fee_tax`.
- **Expected Behavior**: In edit mode, initial mount must retain `initial.fee_tax` as-is. Re-calculation should ONLY trigger when the user actually changes one of the core inputs (`price`, `qty`, `taxRate`, `feeRate`, `unit`, `market`, `txType`).

### 2. Batch Fee Recalculation Blind to Day-Trading (現股當沖 0.15% 減半證交稅)
- **Symptom**: Running `proposeFeeCorrections` (`fees.ts:62-81`) computes sell tax using `sellTaxRate(tx.ticker)`, which blindly applies 0.3% to all general stocks. For day-trading sell transactions (e.g. 華邦電 sell with actual tax 282 TWD + 80 TWD fee = 362 TWD), it proposes 645 TWD (+283 TWD excess tax).
- **Risk**: `RecalcFeesModal.tsx:26-28` defaults to `checked = all proposals`. Clicking "更新勾選的手續費" destructively overwrites day-trading tax records with double taxes.

### 3. Automatic Day-Trading & Fee Fitting Heuristic
- When importing historical or legacy CSVs lacking explicit "當沖" labels:
  - **Rule 1 (Date & Symbol Matching)**: Identify same-date BUY and SELL of the same ticker.
  - **Rule 2 (Tax & Fee Mathematical Fitting)**:
    $$\text{Tax}_{\text{standard}} = \lfloor \text{gross} \times 0.003 \rfloor, \quad \text{Tax}_{\text{daytrade}} = \lfloor \text{gross} \times 0.0015 \rfloor$$
    $$\text{ResidualFee}_{\text{standard}} = T - \text{Tax}_{\text{standard}}, \quad \text{ResidualFee}_{\text{daytrade}} = T - \text{Tax}_{\text{daytrade}}$$
    If $\text{ResidualFee}_{\text{standard}} \le 0$ and $\text{ResidualFee}_{\text{daytrade}} \approx \lfloor \text{gross} \times \text{feeRate} \rfloor$, the transaction is mathematically confirmed as day-trading.

---

## Design Contract

### A. Fix `TransactionForm.tsx` Edit Lifecycle
1. Introduce a ref `isMountedRef` or tracking ref `initialFeeRef` in `TransactionForm.tsx`.
2. Skip automatic `setFee` execution on the initial mount when `initial` is defined.
3. Only update `fee` when dependent values deviate from their initial state via user interaction.
4. When `isEdit` is true, initialize `taxRate` by fitting `initial.fee_tax` against possible tax rates (0.003, 0.0015, 0.001, 0) to avoid showing false tax rate dropdown mismatches.

### B. Harden `proposeFeeCorrections` & `RecalcFeesModal`
1. **Modal Safety**: `RecalcFeesModal.tsx` should default to `checked = new Set()` (opt-in selection) or display a prominent badge `⚠️ 賣出含預估證交稅（若為當沖請勿勾選）`.
2. **Exclude Day-Trades from Standard Recalculation**: If a sell transaction's existing `fee_tax` is less than $\text{gross} \times 0.003$, do not propose standard 0.3% tax overwrite unless explicitly requested.

### C. Future CSV Schema Enhancement
For future exports/imports, support extended columns:
- `交易性質` (`type_nature`: `SPOT` 現股 / `DAY_TRADE` 當沖 / `MARGIN` 融資)
- `手續費` (`fee`) and `證交稅` (`tax`) as separate explicit columns, maintaining backward compatibility with legacy `手續費 / 稅金` column.

---

## Files to Modify

- `sources/src/components/Transactions/TransactionForm.tsx`
- `sources/src/components/Transactions/TransactionForm.fee.test.tsx`
- `sources/src/utils/fees.ts`
- `sources/src/utils/fees.test.ts`
- `sources/src/components/Transactions/RecalcFeesModal.tsx`

---

## Test Charter

| Case | Expected Outcome | Layer / File |
| :--- | :--- | :--- |
| Edit modal mount | `fee` input equals `initial.fee_tax`; NO "已依目前費率重算" banner on mount | `TransactionForm.fee.test.tsx` |
| Edit price/qty | Auto-recalculation triggers dynamically on user edit | `TransactionForm.fee.test.tsx` |
| Day-trade sell in batch recalculate | Not blindly overridden with 0.3% tax; warnings or opt-in selection applied | `fees.test.ts` |

---

## Revision 2026-09-01 — day-trade detection rule, corrected against real data

The original §3 heuristic is **wrong as written**: "Rule 1 (Date & Symbol Matching)" produces
false positives at a rate that makes it unusable alone, and the §B.2 exclusion threshold
(`fee_tax < gross * 0.003`) excludes every ETF sell.

### Evidence

Source: `docs/交易紀錄-Ronlin股票紀錄-2026-08-24.csv` (feeRate 0.0004275, 3折) and
`docs/交易紀錄-玉山證卷-2026-08-25.csv` (feeRate 0.001425, 原價). Both use `minFee = 20`.
40 sell rows total. Each row was refitted as
`T == floor(gross * taxRate) + max(minFee, floor(gross * feeRate))`.

| Outcome | Rows |
| --- | ---: |
| Fits standard rate | 38 |
| Fits day-trade rate (tax halved) | 2 |
| Fits neither | 1 |

- **Day trades (2 rows)**: `2344` 2026-08-18 (`gross 188500`, `T 362`, standard would be `645`)
  and `2303` 2026-08-24 (`gross 123500`, `T 237`, standard would be `422`).
- **Same-day buy+sell pairs: 14 rows, of which only 2 are day trades.** Rows `2330` 2026-05-20,
  `1815`/`4938` 2026-05-29, `2312` 2026-06-01, `2303` 2026-07-13, `2303` 2026-07-27,
  `8150`/`2337`/`00403A`/`00981A` 2026-07-17 and `3037` 2026-04-28 all fit the **standard**
  rate despite same-day round trips. Same-date matching alone gives **12 false positives**.
- **Unexplained (1 row)**: `2891` 2026-06-05, `T 3932` against a standard `722`. The row fits
  no tax rate. It must stay classified as standard and must not be "corrected".

### Corrected rule — use the tax-shortfall test only

A sell is a **suspected day trade** when the recorded total cannot even cover the standard tax:

```
suspected = tx.fee_tax < floorSafe(gross * sellTaxRate(tx.ticker))
```

`sellTaxRate(ticker)` — not a hardcoded `0.003` — is required. `0050` sold at `gross 103500`
records `T 147` against a 0.1% tax of `103`; a hardcoded `0.003` threshold (`310`) would flag
every ETF sell as a day trade.

Verified against all 40 rows: the test fires on exactly the 2 day trades, and on no
same-day standard row, no ETF row, and not on the unexplained `2891` row.

Confirmation (optional strengthening, not required to pass): the residual after the halved tax
equals the expected fee, i.e.
`tx.fee_tax - floorSafe(gross * sellTaxRate(t) / 2) == max(minFee, floorSafe(gross * feeRate))`.

### Impact on the contract

- **§3 Rule 1 is dropped.** Do not use date-and-symbol matching to classify day trades.
- **§B.2 threshold is replaced** by the `sellTaxRate`-based shortfall test above.
- `proposeFeeCorrections` must emit **no proposal** for a suspected day-trade sell.

### Test fixtures to use (real data, exact integers)

| Ticker | Date | Side | Price | Qty | feeRate | Recorded `fee_tax` | Standard total | Class |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 2344 | 2026-08-18 | SELL | 188.5 | 1000 | 0.0004275 | 362 | 645 | day trade |
| 2303 | 2026-08-24 | SELL | 123.5 | 1000 | 0.0004275 | 237 | 422 | day trade |
| 2330 | 2026-05-20 | SELL | 2415 | 50 | 0.0004275 | 413 | 413 | standard, same day |
| 0050 | 2026-07-15 | SELL | 103.5 | 1000 | 0.0004275 | 147 | 147 | standard ETF |
| 2891 | 2026-06-05 | SELL | 70.3 | 3000 | 0.0004275 | 3932 | 722 | unexplained, leave alone |

### Out of scope for this task

**§C (CSV schema enhancement) is not implemented here.** A `交易性質` / `type_nature` column
needs a new persisted transaction field, which needs a Supabase migration. PROD schema changes
are blocked (see BUG-041). §C stays open as a separate task.
