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

---

## Revision 2026-09-01 (2) — §C is IN scope after all

The previous revision put §C out of scope, reasoning that a persisted trading-nature field
needs a Supabase migration and PROD schema changes are blocked by BUG-041. **That was the
wrong call**: the project already has a precedent for shipping a new column ahead of the PROD
migration — `workspaces.fee_rate` (Task 135) — and the read path there degrades instead of
breaking. §C follows that precedent.

Only the PROD migration itself stays with the user, exactly as BUG-041 already does.

### C.1 Field name and values

The spec body names the field `type_nature`. **Use `tx_nature`** instead: this table's columns
are `tx_date`, `tx_type`, `tx_nature` reads as one of that family, and `type_nature` sitting
next to `tx_type` invites confusion.

```ts
export type TxNature = 'SPOT' | 'DAY_TRADE' | 'MARGIN'
tx_nature?: TxNature | null      // on Transaction, optional like Workspace.fee_rate
```

`null` / absent means **unknown**, not 現股. Rows written before the column existed, and every
row on PROD until the migration runs, are unknown. The ledger must keep inferring for those.

### C.2 Migration (mirrors the fee_rate precedent in schema.sql:19-22)

```sql
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_nature TEXT;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_tx_nature_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_tx_nature_check
    CHECK (tx_nature IS NULL OR tx_nature IN ('SPOT', 'DAY_TRADE', 'MARGIN'));
```

Applied to DEV in this task. **PROD is the user's to run**, like BUG-041.

### C.3 Provider must degrade, not break

PostgREST rejects the whole query for an unknown column, so all three transaction paths need
the `listWorkspaces` treatment:

| Path | Failure without a fallback | Required behaviour |
| --- | --- | --- |
| `listTransactions` | every transaction list breaks on PROD | retry once with the legacy column list |
| `addTransactions` | `insert` spreads `tx_nature` into the row → write fails | retry once with `tx_nature` stripped |
| `updateTransaction` | `update(patch)` carries `tx_nature` → edit fails | retry once with `tx_nature` stripped |

### C.4 Explicit label beats inference — but only in the safe direction

`computeLedger` and `proposeFeeCorrections` currently infer 當沖 from the recorded `fee_tax`
(see the previous revision). With a label present:

- `tx_nature === 'DAY_TRADE'` on a TPE SELL → use the halved tax directly, no inference.
- **Anything else — `SPOT`, `MARGIN`, `null`, absent — keeps the existing inference ladder.**

An explicit `SPOT` must NOT force the standard rate. Doing so would re-open BUG-036: a
mislabelled row whose `fee_tax` cannot cover the standard tax would have its brokerage fee
crushed to 0 again. A label may only add information, never re-introduce that failure.

`MARGIN` changes no calculation; the app does not model margin interest. It is carried so a
CSV round-trip does not lose it.

### C.5 CSV columns

Export emits the Chinese label, matching how `交易類型` already exports 買入/賣出 through
`TX_TYPE_LABEL`. Import accepts the Chinese label **and** the code, case-insensitively.

New header, with the legacy combined column kept for compatibility:

```
交易日期,市場,股票代號,股票名稱,交易類型,交易性質,交易單價,交易股數,手續費,證交稅,手續費 / 稅金
```

Import rules:

1. **Column matching order matters.** The existing map uses
   `header.findIndex((h) => h.includes('手續費'))`, and `'手續費'.includes('手續費')` is true,
   so a split `手續費` column collides with the legacy combined one. Resolve `手續費` and
   `證交稅` by **exact** `indexOf` first; use the split pair only when BOTH are present;
   otherwise fall back to the existing `includes` match for the combined column.
2. Split mode writes `fee_tax = 手續費 + 證交稅`. There is no separate persisted fee and tax —
   this task does not split the stored field.
3. An unrecognised `交易性質` value is a row error with the existing per-row reporting, not a
   silent drop.
4. A file with no `交易性質` column imports exactly as it does today.

Round-trip requirement: `parseTransactionsCsv(transactionsToCsv(txs))` must preserve
`tx_nature`, including `undefined`/`null` staying absent.

### C.6 Form

The transaction form gets a `交易性質` selector, shown for TPE only. A stored field with no way
to set it is not a finished feature. Selecting 當沖 also sets the securities tax rate preset to
`0.0015`, which is what a user does by hand today — the preset list already carries that value.

### Test charter (additions)

| Case | Expected outcome | Layer / file |
| :--- | :--- | :--- |
| Import split `手續費` + `證交稅` | `fee_tax` is their sum | `csv.test.ts` |
| Import legacy combined column only | unchanged from today | `csv.test.ts` |
| Import `交易性質` as 當沖 and as `DAY_TRADE` | both give `tx_nature: 'DAY_TRADE'` | `csv.test.ts` |
| Import an unknown 交易性質 | row error naming 交易性質, other rows still import | `csv.test.ts` |
| Export then import | `tx_nature` survives; absent stays absent | `csv.test.ts` |
| `tx_nature: 'DAY_TRADE'` sell whose `fee_tax` covers the standard tax | halved tax used anyway | `pnlEngine.test.ts` |
| `tx_nature: 'SPOT'` sell whose numbers look like a day trade | inference ladder still applies | `pnlEngine.test.ts` |
| `tx_nature: 'DAY_TRADE'` in batch recalculation | no proposal | `fees.test.ts` |
| `listTransactions` when the column is missing | retries with the legacy list | `dataProvider.transactions.test.ts` |
| `addTransactions` / `updateTransaction` when the column is missing | retries with `tx_nature` stripped | `dataProvider.transactions.test.ts` |
