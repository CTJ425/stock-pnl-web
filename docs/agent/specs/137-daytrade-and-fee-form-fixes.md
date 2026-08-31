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
