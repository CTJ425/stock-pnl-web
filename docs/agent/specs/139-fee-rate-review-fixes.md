# Task 139 — 0.9.27-dev.1 Review Fixes (fee_rate persistence)

Target version: `0.9.27-dev.2`.
Source: main-session diff review of `0.9.27-dev.1` on 2026-09-01. Money code, so the main
session read the diff directly (CLAUDE.md § Dispatch discipline).

Baseline at review time: `npm run build` exit 0, `npx vitest run` exit 0 (94 files / 1468 tests).
Both defects below are latent — the green suite does not cover them.

---

## Problem Statement

### A. Legacy degrade drops `tx_nature` as well (regression, money impact)

- **Where**: `sources/src/services/dataProvider.ts:178`, `:276`, `:291`, and `:174` (`TX_COLUMNS_LEGACY`).
- **What changed**: `withoutTxNature` became `withoutNewColumns`. The function now removes
  **both** `tx_nature` and `fee_rate`. The retry then selects `TX_COLUMNS_LEGACY`, which
  contains neither column.
- **Failure scenario** — this is the current PROD state, because the `fee_rate` migration is
  not applied there:
  1. The database has `tx_nature` but not `fee_rate`.
  2. `addTransactions` fails with `42703` on `fee_rate`.
  3. The retry strips `tx_nature` too, so every inserted row gets `tx_nature = NULL`.
  4. `splitFeeTax` (`pnlEngine.ts:189`) loses the `DAY_TRADE` branch. The securities tax is no
     longer halved by declaration; it falls through the inference ladder.
  5. Realized P&L and the fee/tax split are wrong for every day-trade row written after the
     upgrade.
- **`updateTransaction` has the same defect**: editing any transaction on such a database
  silently clears `tx_nature` on the stored row.
- **Regression**: 0.9.26 stripped only `tx_nature`, and only when `tx_nature` was the missing
  column.
- **Note**: `isMissingColumnError` (`dataProvider.ts:191`) checks only `error.code`. The
  column name is present in `error.message` and is not read today.

### B. `inferFeeRate` minimum-fee detection is hardcoded, so a custom minimum fee produces an inflated rate

- **Where**: `sources/src/utils/fees.ts:39` (`minFee = 1`), `:58` (clamp test), `:76` (upper bound).
- **Defect 1 — the `minFee` parameter is dead code.** The only caller,
  `TransactionForm.tsx:62`, passes two arguments. The clamp test therefore always compares
  against the literals `20` and `1`, which are only the *default* whole-lot and odd-lot
  minimum fees (`settings.ts:10`, `:12`). A workspace with a customized minimum fee is not detected.
- **Defect 2 — the upper bound `ratio > 0.05` is too loose.** A Taiwan broker only discounts
  below the statutory `0.001425`. Any inferred rate above `DEFAULT_FEE_RATE` is impossible and
  must not be returned.
- **Measured failure scenario** (run against the shipped code, both cases confirmed):

  | Input | Result |
  | :--- | :--- |
  | Odd-lot minimum fee set to 5. BUY 10 shares at 100 (gross 1,000), `fee_tax = 5` | `inferFeeRate` returns **0.005**, which is 3.5x the statutory rate |
  | The user then edits qty to 1000 in the same form | `calculateFee` returns **500**; the correct fee is **142** |
  | Whole-lot minimum fee set to 15. BUY 1000 shares at 30 (gross 30,000), `fee_tax = 15` | `inferFeeRate` returns 0.0005, not `DEFAULT_FEE_RATE` |

- The inflated value passes `CHECK (fee_rate >= 0 AND fee_rate < 1)` and is written to the
  database on save, so the error persists for every later edit of that row.

### C. Handover documents state facts the evidence does not support

- **`verify-fee-rate-e2e.cjs:75` stubs `**/rest/v1/**`.** The script never reaches a database.
  `CHANGELOG.md` claims "DB 儲存" and `PROGRESS.md` claims "DB persistence".
- **`TASK.md` claims `transactions.fee_rate` is "in DEV schema".** Only `schema.sql` changed.
  No `SELECT * FROM verify_setup()` output exists for DEV or PROD. Compare Task 135 in
  `TASK_ARCHIVE.md:73`, which states "DEV applied and verified".
- `sources/scripts/verify-fee-rate-e2e.cjs` is referenced by `CHANGELOG.md` but is not tracked
  by git. The script holds mock tokens only; it is safe to commit to this public repo.

### D. Low severity — record, fix only if the lane is already open

1. `fees.ts:69` uses `Math.floor`; `calculateFee` uses `floorSafe` (`pnlEngine.ts:162`). A scan
   of 12 rates x 7 quantities x 200,000 prices found 1 disagreement (1141.61 x 55 shares at
   0.0005415: `Math.floor` gives 33, `floorSafe` gives 34). Use `floorSafe` in `inferFeeRate`.
2. `fees.ts:45` rounds the US ratio with `toFixed(6)`. For gross 2,000,000 and `fee_tax` 5, the
   round trip returns a fee of 6. Widen to `toFixed(8)`.

---

## Design Contract

### A. Strip only the column the database actually rejects

1. Add a helper that reads the column name out of the error message:

   ```ts
   type NewTxColumn = 'tx_nature' | 'fee_rate'

   /** Names the new column a 42703 / PGRST204 error refers to, or null when it names neither. */
   function missingTxColumn(error: { message?: string | null } | null): NewTxColumn | null
   ```

   Match on `error.message`. `fee_rate` first, then `tx_nature`. Return `null` when the message
   names neither.
2. Build the retry column list and the stripped row from that name:
   - `'fee_rate'` → keep `tx_nature`, drop `fee_rate`.
   - `'tx_nature'` → keep `fee_rate`, drop `tx_nature`.
   - `null` → drop both and select `TX_COLUMNS_LEGACY` (today's behaviour, kept as the fallback).
3. Apply the same rule in all three call sites: `listTransactions`, `addTransactions`,
   `updateTransaction`.
4. A database that has neither column returns a second missing-column error. Allow **one**
   further retry, gated on `isMissingColumnError` only, that drops both columns.
   - A `42703` / `PGRST204` response means the statement was rejected before any write, so this
     retry cannot duplicate rows. Retry on any other error class is still forbidden.

### B. Give `inferFeeRate` the real minimum fee and a real upper bound

1. Change the signature so the caller must supply both minimum fees:

   ```ts
   export function inferFeeRate(
     tx: Pick<Transaction, 'price' | 'qty' | 'fee_tax' | 'tx_type' | 'market' | 'ticker'> &
       Pick<Partial<Transaction>, 'tx_nature'>,
     defaultRate: number,
     minFees: { whole: number; odd: number },
   ): number
   ```

   Do not keep a default value for `minFees`. A defaulted parameter is what made the current
   one dead code.
2. Replace the clamp test at `:58` with a test against both supplied values:
   `if ((fee === minFees.whole || fee === minFees.odd) && gross * defaultRate < fee) return defaultRate`.
3. Replace the upper bound at `:76`. Return `defaultRate` when `ratio > DEFAULT_FEE_RATE`.

   **Note added 2026-09-01 after review.** This upper bound is the *only* guard a minimum-fee
   clamp needs, and no second `fee === minFees.*` comparison may be added after the common-rate
   loop. A clamp raises the recorded fee above what the real rate produces, so it always inflates
   `fee / gross` — the ratio guard catches it by construction. Comparing `fee` against the
   minimum-fee values again is actively wrong: `calculateFee` clamps only when `minFee > fee`, so
   an **unclamped** fee can equal a minimum fee by coincidence, and discarding that recoverable
   rate overestimates it by up to an order of magnitude (measured: `gross` 100,000, `fee_tax` 15,
   `minFees.whole` 15, real rate `0.00015` → forced to `0.001425`, 9.5x too high).
4. Update the single caller, `TransactionForm.tsx:62`, to pass
   `{ whole: getMinFee('whole', workspaceId), odd: getMinFee('odd', workspaceId) }`.
   `getMinFee` is already imported at `TransactionForm.tsx:18`.

### C. Correct the handover documents

Paste the verbatim text in the "Document Corrections" section below. Do not rewrite it.

---

## Negative Cases — what the fix may not do

1. **The retry must not become unconditional.** Only `42703` and `PGRST204` may trigger a retry.
   An `INSERT` is not idempotent; a retry after a dropped response would write the rows twice.
2. **The degrade must not drop a column the database has.** After the fix, a database that has
   `tx_nature` but not `fee_rate` must still store `tx_nature` on every insert and update.
3. **`inferFeeRate` must never return a rate above `DEFAULT_FEE_RATE`** for a TPE transaction.
4. **`inferFeeRate` must not gain a default value for `minFees`.**
5. **Do not change `calculateFee`, `splitFeeTax`, `proposeFeeCorrections`, or `sellTaxRate`.**
   The defects are in the new code only.
6. **Do not change the stored `fee_tax` of any existing row.** This task changes inference and
   the write path, not historical data. No migration or backfill.
7. **Do not claim a database check that was not run.** `verify_setup()` output is the only
   acceptable evidence for the schema claims in §C.

---

## Files to Modify

- `sources/src/services/dataProvider.ts`
- `sources/src/services/dataProvider.transactions.test.ts`
- `sources/src/utils/fees.ts`
- `sources/src/utils/fees.test.ts`
- `sources/src/components/Transactions/TransactionForm.tsx`
- `sources/src/components/Transactions/TransactionForm.fee.test.tsx`
- `sources/src/version.ts`, `sources/package.json`, `sources/package-lock.json`, `README.md`,
  `docs/agent/CHANGELOG.md` (version bump to `0.9.27-dev.2`)

Do not touch `sources/supabase/schema.sql` or `sources/supabase/verify.sql`. Both are correct.

---

## Test Charter

| Case | Expected Outcome | File |
| :--- | :--- | :--- |
| Insert; error message names `fee_rate` only | Retry payload keeps `tx_nature`, drops `fee_rate` | `dataProvider.transactions.test.ts` |
| Insert; error message names `tx_nature` only | Retry payload keeps `fee_rate`, drops `tx_nature` | `dataProvider.transactions.test.ts` |
| Insert; error message names neither column | Retry payload drops both (fallback unchanged) | `dataProvider.transactions.test.ts` |
| Insert; first retry also returns `42703` | Exactly one further retry, dropping both; no third attempt | `dataProvider.transactions.test.ts` |
| Insert; error code is not `42703` / `PGRST204` | No retry at all; the error propagates | `dataProvider.transactions.test.ts` (already covered — keep it) |
| Update; error message names `fee_rate` only | Patch keeps `tx_nature` | `dataProvider.transactions.test.ts` |
| `inferFeeRate`, odd minimum fee 5, gross 1,000, `fee_tax` 5 | Returns `DEFAULT_FEE_RATE`, not 0.005 | `fees.test.ts` |
| `inferFeeRate`, whole minimum fee 15, gross 30,000, `fee_tax` 15 | Returns `0.0005` — **corrected 2026-09-01**, this row originally demanded `DEFAULT_FEE_RATE` and was wrong. `0.0005` is the better estimate under both readings: if the real rate was 0.0005 it is exact, and if the fee was clamped the real rate is lower still, so `0.001425` errs further. See §B.3 note. | `fees.test.ts` |
| `inferFeeRate`, whole minimum fee 15, gross 100,000, `fee_tax` 15 | Returns `0.00015`. An unclamped fee can equal a minimum fee by coincidence — `calculateFee` clamps only when `minFee > fee` — so a recoverable rate must not be discarded on that coincidence alone | `fees.test.ts` |
| `inferFeeRate`, any TPE row | Return value is never above `DEFAULT_FEE_RATE` | `fees.test.ts` |
| The 8 existing `inferFeeRate` tests | Still pass, with the new `minFees` argument | `fees.test.ts` |
| Edit form mount, legacy row with a customized minimum fee | The fee rate field shows the statutory rate, not an inflated one | `TransactionForm.fee.test.tsx` |

---

## Verify

Run from `sources/`. Both commands must exit 0.

```
npm run build
npx vitest run
```

`npx tsc --noEmit` is **not** the type gate here — it does not type-check test files
(CLAUDE.md § Dispatch discipline). Check the exit code, not the vitest summary line.

---

## Document Corrections (verbatim — paste, do not rewrite)

### 1. `docs/agent/CHANGELOG.md`, 0.9.27-dev.1 section

Replace this line:

```
- 🧪 **完整驗證** — 單元測試增為 94 檔 / 1468 個測試 100% 通過；Playwright 實體瀏覽器 E2E 測試（`scripts/verify-fee-rate-e2e.cjs`）驗證「自訂 3 折費率建立 → DB 儲存 → 重開編輯保留費率 → 修改單價依 3 折重算」流程通過。
```

with:

```
- 🧪 **完整驗證** — 單元測試增為 94 檔 / 1468 個測試 100% 通過；Playwright 實體瀏覽器 E2E 測試（`scripts/verify-fee-rate-e2e.cjs`）在攔截 `**/rest/v1/**` 的前提下，驗證「自訂 3 折費率建立 → 送出 payload 帶入費率 → 重開編輯保留費率 → 修改單價依 3 折重算」流程通過。此測試不連線資料庫，資料庫欄位是否就位須另以 `verify_setup()` 確認。
```

### 2. `docs/agent/PROGRESS.md`, 0.9.27-dev.1 entry, item 5

Replace this line:

```
     - Playwright E2E test in real browser (`scripts/verify-fee-rate-e2e.cjs`) validated against `http://10.8.22.99:5173/` (creation with 3-折 rate `0.0004275`, DB persistence, edit modal rate retention, and recalculation on price change).
```

with:

```
     - Playwright E2E test in real browser (`scripts/verify-fee-rate-e2e.cjs`) validated against `http://10.8.22.99:5173/` with every `**/rest/v1/**` call stubbed (creation with 3-折 rate `0.0004275`, submitted payload carries `fee_rate`, edit modal rate retention, and recalculation on price change). The test does not reach a database, so schema application stays unverified.
```

### 3. `docs/agent/PROGRESS.md`, 0.9.27-dev.1 "### Verification" block

Replace this line:

```
- `node scripts/verify-fee-rate-e2e.cjs` — exit 0 (100% passed in Chromium)
```

with:

```
- `node scripts/verify-fee-rate-e2e.cjs` — exit 0 (Chromium, REST API stubbed; no database involved)
```

### 4. `docs/agent/TASK.md`, "Where the project stands"

Replace these two lines:

```
  - Schema: `workspaces.fee_rate`, `transactions.tx_nature`, `transactions.fee_rate` in DEV schema.
```
```
- **All tests green**: 94 test files / 1468 vitest tests 100% passed; Playwright E2E passed; `typecheck:edge`, `build`, `oxlint` 0 errors.
```

with:

```
  - Schema: `workspaces.fee_rate`, `transactions.tx_nature`, `transactions.fee_rate` applied and verified on DEV (cloud project `zyebvayngwrqzoaicbwd`, `verify_setup()` 10/10 PASS, 2026-09-01). PROD still pending (BUG-044-P).
```
```
- **All tests green**: 94 test files / 1468 vitest tests 100% passed; Playwright E2E passed with the REST API stubbed; `typecheck:edge`, `build`, `oxlint` 0 errors.
```

### 5. `docs/agent/BUG_FIX.md` — one fixed bug, two new open bugs

Append to `docs/agent/FIXED_BUG.md` (already resolved — do not add to the open list):

```
### BUG-044: `transactions.fee_rate` was in schema.sql but not applied on DEV
- **Status**: ✅ FIXED — 2026-09-01
- **Found**: 2026-09-01, main-session diff review of 0.9.27-dev.1
- **Impact**: The 0.9.27 fee rate feature degraded to the legacy write path. Combined with BUG-045, every write also cleared `tx_nature`.
- **Root cause**: `schema.sql` carried the DDL but it had not been run against the real DEV database — the cloud project `zyebvayngwrqzoaicbwd` named in `sources/.env`'s `VITE_SUPABASE_URL`, not the local docker Supabase stack that also runs on this host and answers similarly but is unrelated to the deployed app.
- **Fix**: Ran the `fee_rate` DDL block against `zyebvayngwrqzoaicbwd` via `supabase db query --linked`, then `NOTIFY pgrst, 'reload schema'`. `SELECT * FROM verify_setup();` returned 10/10 PASS, `assert_setup_ok()` returned `ok`.
- **Follow-up**: PROD (`hrilemueiqyaoiwnkeuu`) still needs the same DDL — tracked separately as BUG-044-P, blocked on explicit user approval per CLAUDE.md § Branches & envs.

### BUG-044-P: `transactions.fee_rate` not yet applied on PROD
- **Status**: 🔴 OPEN
- **Found**: 2026-09-01, follow-up to BUG-044
- **Impact**: Same as BUG-044, on `hrilemueiqyaoiwnkeuu` (PROD).
- **Fix**: Run the `fee_rate` block of `schema.sql` against PROD via `supabase db query --linked` after linking to `hrilemueiqyaoiwnkeuu`, only on explicit user instruction and only after `main` carries the reviewed fix. Then `SELECT * FROM verify_setup();` on PROD.

### BUG-045: legacy degrade clears `tx_nature` when only `fee_rate` is missing
- **Status**: 🔴 OPEN
- **Found**: 2026-09-01, main-session diff review of 0.9.27-dev.1
- **Impact**: Money. On a database that has `tx_nature` but not `fee_rate` (the current PROD state), `addTransactions` and `updateTransaction` write `tx_nature = NULL`. `splitFeeTax` then loses the declared day-trade branch and the securities tax split is wrong.
- **Root cause**: `sources/src/services/dataProvider.ts:178` `withoutNewColumns` strips both new columns for any missing-column error; the retry selects `TX_COLUMNS_LEGACY`, which holds neither.
- **Regression from**: 0.9.26, which stripped `tx_nature` only.
- **Fix**: `docs/agent/specs/139-fee-rate-review-fixes.md` §A.

### BUG-046: `inferFeeRate` returns an inflated rate when the workspace minimum fee is customized
- **Status**: 🔴 OPEN
- **Found**: 2026-09-01, main-session diff review of 0.9.27-dev.1
- **Impact**: Money. Measured: odd-lot minimum fee 5, gross 1,000, `fee_tax` 5 infers 0.005 (3.5x the statutory rate). Editing the quantity to 1000 shares then computes a fee of 500 instead of 142. The value is written to `transactions.fee_rate` and persists.
- **Root cause**: `sources/src/utils/fees.ts:39` defaults `minFee` to 1 and the only caller never passes it, so `fees.ts:58` compares against the literals 20 and 1. `fees.ts:76` caps the inferred ratio at 0.05, far above the statutory 0.001425.
- **Fix**: `docs/agent/specs/139-fee-rate-review-fixes.md` §B.
```
