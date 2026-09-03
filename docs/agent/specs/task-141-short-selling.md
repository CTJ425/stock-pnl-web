# Task 141 — Short selling (融券) support, Stage A: engine, types, fees

- Status: SPEC
- Timestamp: 2026-09-02 Asia/Taipei
- Lane: 2 (P&L maths, money code)
- Stage A files only. Stage B (UI/IO) and Stage C (schema DDL) are separate dispatches.

## Assumptions (user-confirmed 2026-09-02)

1. Borrow fee (借券費) rate is **0.0008 (0.08%)**, charged on the SELL leg only.
2. Margin deposit (保證金, ~90%) is **capital tied up, not a cost**. It never enters P&L.
   Stage A stores nothing for it.
3. 資券當沖 (same-day short open + cover) does **not** get the halved day-trade tax.
   A `SHORT` sell always pays the full `sellTaxRate(ticker)`.

## Contract

### C1 — `src/types/models.ts`

Add `'SHORT'` to `TxNature`. Add `SHORT: '融券'` to `TX_NATURE_LABEL`.
Update the `TxNature` doc comment: `SHORT` changes the ledger path, it is not a label-only value.

### C2 — `src/utils/pnlEngine.ts` — new constant

```ts
/** 借券費（融券手續費）率, charged on a SHORT sell only. */
export const BORROW_FEE_RATE = 0.0008
```

**It must live in `pnlEngine.ts`, not `fees.ts`.** `fees.ts` already imports from `pnlEngine.ts`
(`fees.ts:9`); defining it in `fees.ts` and importing it back creates a circular import.

### C3 — `src/utils/pnlEngine.ts` — `splitFeeTax` returns a third component

Change the return type to `{ fee: number; tax: number; borrow: number }`.
Every existing caller destructures `{ fee }` or `{ tax }`, so adding a field is source-compatible.

For `tx_type === 'SELL' && market === 'TPE' && tx_nature === 'SHORT'`:

```
gross     = price * qty
stdTax    = floorSafe(gross * sellTaxRate(ticker))     // full rate, never halved
stdBorrow = floorSafe(gross * BORROW_FEE_RATE)

if      (fee_tax >= stdTax + stdBorrow) { tax = stdTax;  borrow = stdBorrow }
else if (fee_tax >= stdTax)             { tax = stdTax;  borrow = fee_tax - stdTax }
else                                    { tax = fee_tax; borrow = 0 }
fee = fee_tax - tax - borrow
```

`borrow` is `0` on every other path, including `DAY_TRADE` and the BUG-036 inference ladder.
`fee` must never go negative.

### C4 — `src/utils/pnlEngine.ts` — short position state

```ts
export interface ShortLot {
  txId: string
  date: string
  qty: number
  price: number
  /** price*qty − sell fee − tax − borrow fee; reduced proportionally on a partial cover */
  proceeds: number
  /** price*qty; reduced proportionally on a partial cover */
  rawProceeds: number
}
```

`Position` gains four fields, all initialised at position creation (`pnlEngine.ts:320-331`):

```ts
shortQty: number            // 0
shortProceeds: number       // 0
shortRawProceeds: number    // 0
shortLots: ShortLot[]       // []
```

`LedgerSummary` gains `feesBorrow: number` (initialised 0), so the identity
`fees = feesBrokerage + feesTax + feesBorrow` holds.

### C5 — `src/utils/pnlEngine.ts` — `computeLedger` dispatch

Insert the branch inside the existing residual loop (`pnlEngine.ts:478`), **after** the common
`countTx` / `y.fees` / `yt.fees` / `estTax` bookkeeping and **before** the existing
`if (tx.tx_type === 'BUY')` branch. Do not touch the day-trade block (`pnlEngine.ts:369-479`).

Change the shared fee bookkeeping to also split out the borrow fee:

```
const { tax: estTax, borrow: estBorrow } = splitFeeTax({ ...tx, qty: effQty, fee_tax: effFeeTax })
ledger.summary.feesTax       += estTax
ledger.summary.feesBorrow    += estBorrow
ledger.summary.feesBrokerage += effFeeTax - estTax - estBorrow
```

**`SHORT` + `SELL` — open a short position**

```
gross    = tx.price * effQty
proceeds = gross - effFeeTax
pos.shortQty        += effQty
pos.shortProceeds   += proceeds
pos.shortRawProceeds += gross
pos.shortLots.push({ txId, date, qty: effQty, price, proceeds, rawProceeds: gross })
```

**`SHORT` + `BUY` — cover**

```
gross      = tx.price * effQty
coverTotal = gross + effFeeTax
matchedQty = Math.min(effQty, pos.shortQty)
ratio      = matchedQty / effQty
coverCost  = coverTotal * ratio

// FIFO-consume shortLots for matchedQty, accumulating proceedsBasis and rawProceedsBasis
realized   = proceedsBasis - coverCost

pos.shortQty        -= matchedQty
pos.shortProceeds   -= proceedsBasis
pos.shortRawProceeds -= rawProceedsBasis
pos.realized        += realized

y.sellAmt    += proceedsBasis     yt.sellAmt    += proceedsBasis
y.sellGross  += rawProceedsBasis  yt.sellGross  += rawProceedsBasis
y.costBasis  += coverCost         yt.costBasis  += coverCost
y.rawCostBasis += gross * ratio   yt.rawCostBasis += gross * ratio
yt.realized  += realized
y.realizedTw / y.realizedUs += realized   (by currency, same as the existing paths)

yt.sells.push({ txId, date, qty: matchedQty, price: tx.price,
                sellAmt: proceedsBasis, sellGross: rawProceedsBasis,
                costBasis: coverCost, rawCostBasis: gross * ratio,
                realized, fees: effFeeTax * ratio, feesTax: 0,
                avgCost: coverCost / matchedQty, oversold: false })

if (pos.shortQty === 0) { pos.shortProceeds = 0; pos.shortRawProceeds = 0; pos.shortLots = [] }
```

The explicit zeroing is the BUG-039 rule: proportional subtraction leaves float residue that
would pollute the next short open.

**Over-cover residual** — when `effQty > pos.shortQty`, the excess shares open a **long** lot,
using the same code path a `BUY` already takes, with `effQty` and `effFeeTax` scaled by
`(effQty - matchedQty) / effQty`. Push one warning:

```
`${tx.tx_date} ${tx.ticker} 回補 ${effQty} 股，但當時空單僅 ${matchedQty} 股（超出部分視為現股買進）`
```

### C6 — `src/utils/pnlEngine.ts` — holdings and unrealized

`ledger.holdings` (`pnlEngine.ts:615`) filter becomes `pos.qty > 0 || pos.shortQty > 0`.
`avgCost` and `rawAvgCost` (`pnlEngine.ts:621-622`) must guard division by zero:

```ts
avgCost:    pos.qty > 0 ? pos.cost / pos.qty : 0,
rawAvgCost: pos.qty > 0 ? pos.rawCost / pos.qty : 0,
```

Copy `shortLots` the same way `openLots` is copied, so a `Holding` cannot mutate the ledger.

New export:

```ts
/**
 * Unrealized P&L of an open short leg at `price`. A cover pays a brokerage fee and no tax,
 * so this is proceeds − (price*shortQty + coverFee). Falling price raises the result.
 */
export function estimateUnrealizedShort(
  holding: Holding, price: number, feeRate: number, minFee?: number,
): number
```

```
if (!(holding.shortQty > 0)) return 0
coverVal = price * holding.shortQty
fee      = floorSafe(coverVal * feeRate)
if (feeRate > 0 && minFee !== undefined && minFee > fee) fee = minFee
return Math.round(holding.shortProceeds - coverVal - fee)     // TWD
// US market: holding.shortProceeds - coverVal, no rounding
```

### C7 — `src/utils/fees.ts` — borrow fee in `calculateFee`

`FeeInput` gains `nature?: TxNature | null`. In the `market === 'TPE'` branch, after the tax is
added on a SELL:

```ts
if (input.nature === 'SHORT') fee += floorSafe(amount * BORROW_FEE_RATE)
```

Order matters: the minimum-fee floor applies to the **brokerage part only**, before tax and
borrow are added — the existing code already floors before the tax line, so add the borrow line
after the tax line and change nothing else.

New export:

```ts
/**
 * Cover price at which an open short breaks even. Below it the short is profitable.
 */
export function breakEvenPriceShort(
  holding: Holding, feeRate: number, minFee?: number,
): number
```

Mirror `breakEvenPrice`'s structure: closed-form seed, then step up/down by 0.01 until the
predicate flips, returning `0` on non-convergence. Predicate:
`holding.shortProceeds - (p * shortQty + calculateFee({ market, txType:'BUY', price:p, qty:shortQty, feeRate, minFee })) >= 0`.
Guard `!(holding.shortQty > 0)` → return 0. A cover is a BUY, so **no tax term**.

## Negative conditions — the code may NOT do these

- **Never infer `SHORT` from data.** Not from "same-day buy and sell", not from "sell with no
  holding", not from the fee ladder. Only an explicit `tx_nature === 'SHORT'` takes a short path.
  Reason: "same-day buy and sell means 當沖" scored 12 false positives out of 14 on the two real
  broker exports in `docs/`.
- **A short open must not touch `y.buyAmt` / `y.buyGross` / `y.sellAmt` / `y.sellGross` /
  `y.costBasis`.** Booking the open into `sellAmt` inflates the year's 總賣出金額 by a trade that
  realized nothing. Amounts are booked on the cover only.
- **A cover must not touch `y.buyAmt` / `y.buyGross`.** It is the `costBasis` of the realization,
  not an acquisition; booking both double-counts.
- **A short leg must not consume, average into, or zero `pos.qty`, `pos.cost`, `pos.rawCost` or
  `pos.openLots`.** Long holdings stay bit-identical.
- **A `SHORT` sell must never raise the oversold warning**, whatever `pos.qty` is.
- **A `SHORT` sell tax is never halved**, even when the cover is on the same date.
- Do not change the day-trade block (`pnlEngine.ts:369-479`). Its candidate filter already tests
  `tx_nature === 'DAY_TRADE'` explicitly, so `SHORT` rows fall through to the residual loop.

## Test charter

All money figures below use `ticker '2603'` (0.3% tax) unless stated, `feeRate 0.001425`.
Open leg 1000 @ 100: fee 142 + tax 300 + borrow 80 = `fee_tax` **522**, proceeds **99,478**.
Cover leg 1000 @ 95: fee 135 = `fee_tax` **135**, cover cost **95,135**. Realized **4,343**.

| Case | Expected outcome | Layer / file |
| ---- | ---- | ---- |
| `splitFeeTax` SHORT sell | `{ fee: 142, tax: 300, borrow: 80 }` | `pnlEngine.test.ts` |
| `splitFeeTax` SPOT sell (fee_tax 442) | `{ fee: 142, tax: 300, borrow: 0 }` | `pnlEngine.test.ts` |
| `splitFeeTax` SHORT ETF `0050` 1000@200, fee_tax 645 | `{ fee: 285, tax: 200, borrow: 160 }` | `pnlEngine.test.ts` |
| Open only | `shortQty 1000`, `qty 0`, `shortProceeds 99478`, holdings length 1, `avgCost` is `0` not `NaN`, `yearly.sellAmt 0`, `realizedTw 0` | `pnlEngine.test.ts` |
| Open then cover next day | `shortQty 0`, `realized 4343`, `warnings` empty, `yearly.sellAmt 99478`, `yearly.costBasis 95135`, `yearly.buyAmt 0`, holdings empty | `pnlEngine.test.ts` |
| Same-day open + cover | identical to the cross-day case (`realized 4343`) — full tax, no day-trade path | `pnlEngine.test.ts` |
| Partial cover (open 2000, cover 1000) | `realized ≈ 4342.5`, `shortQty 1000`, `shortProceeds ≈ 99477.5` | `pnlEngine.test.ts` |
| Over-cover (open 1000, cover 1500 @95) | 1 warning containing `超出部分視為現股買進`, `shortQty 0`, `qty 500`, `cost ≈ 47567.67` | `pnlEngine.test.ts` |
| Long holding protected | prior `BUY 1000 @90 SPOT` then `SELL 1000 @100 SHORT`: `qty 1000`, `cost 90128` unchanged, `shortQty 1000`, `warnings` empty | `pnlEngine.test.ts` |
| `estimateUnrealizedShort` | proceeds 99478, price 95, feeRate 0.001425, minFee 20 → `4343` | `pnlEngine.test.ts` |
| `calculateFee` with `nature: 'SHORT'` | 1000 @ 100 → `522`; same input without `nature` → `442` | `fees.test.ts` |
| `breakEvenPriceShort` | proceeds 99478, qty 1000, feeRate 0.001425, minFee 20 → a price `p` where realized ≥ 0 and `p + 0.01` gives realized < 0 | `fees.test.ts` |

## Files — you may touch nothing else

- `sources/src/types/models.ts`
- `sources/src/utils/pnlEngine.ts`
- `sources/src/utils/fees.ts`

## Verify

From `sources/`:

```
npx vitest run src/utils/pnlEngine.test.ts src/utils/fees.test.ts
npm run build
```

`npm run build` is the type gate — `npx tsc --noEmit` does not type-check test files here.
Not done until both exit 0 and the whole suite (`npx vitest run`) stays green.

## Non-goals for Stage A

- No UI. `holdingRows.ts`, `DashboardPage.tsx`, `TransactionForm.tsx`, `csv.ts` are Stage B.
- No schema DDL. `schema.sql` / `verify.sql` CHECK constraint is Stage C, and no Supabase
  deploy happens without the user asking.
- No workspace-configurable borrow rate. `BORROW_FEE_RATE` is a module constant this stage.
- No 資券當沖 cross-nature matching (融券賣出 + 融資買進).
