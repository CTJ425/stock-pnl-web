# Task 141 — Short selling (融券), Stage B: UI and CSV

- Status: SPEC
- Timestamp: 2026-09-02 Asia/Taipei
- Lane: 2 (user-visible money figures)
- Depends on Stage A (`task-141-short-selling.md`), already merged into the working tree.

## Stage A surface this stage consumes

```ts
// src/types/models.ts
type TxNature = 'SPOT' | 'DAY_TRADE' | 'MARGIN' | 'SHORT'
TX_NATURE_LABEL.SHORT === '融券'

// src/utils/pnlEngine.ts — Position/Holding, all four required
shortQty: number; shortProceeds: number; shortRawProceeds: number; shortLots: ShortLot[]
export function estimateUnrealizedShort(h: Holding, price: number, feeRate: number, minFee?: number): number

// src/utils/fees.ts
export function breakEvenPriceShort(h: Holding, feeRate: number, minFee?: number): number
calculateFee(input) — FeeInput now has `nature?: TxNature | null`; a SHORT SELL adds the borrow fee
```

`ledger.holdings` now contains a position when `qty > 0` **or** `shortQty > 0`. A position can
carry both legs at once (long 波段持股 plus an open 融券), and `avgCost` is `0`, not `NaN`, when
`qty === 0`.

---

## B1 — `src/utils/csv.ts`

`parseTxNature` accepts the 融券 label and code:

```ts
if (trimmed === '融券') return 'SHORT'
...
if (v === 'SPOT' || v === 'DAY_TRADE' || v === 'MARGIN' || v === 'SHORT') return v
```

Export needs no change — it already writes `TX_NATURE_LABEL[tx.tx_nature]`, which now resolves
`SHORT` to `融券`. Do not touch the header array or any other column.

---

## B2 — `src/utils/holdingRows.ts`

`HoldingRow` gains three fields, placed first so the shape reads direction-first:

```ts
export interface HoldingRow {
  /** Unique per row: a position with both legs emits two rows. `${holding.key}:${direction}` */
  rowKey: string
  direction: 'LONG' | 'SHORT'
  /** Shares for this row. Negative on a SHORT row, so the UI reads one field. */
  rowQty: number
  holding: Holding
  ...existing fields unchanged
}
```

`buildHoldingRows` changes from `.map` to `.flatMap`. Its signature does not change.

For each holding, emit **in this order**:

1. a `LONG` row when `h.qty > 0` — every existing field keeps its current formula verbatim,
   plus `rowKey: `${h.key}:LONG``, `direction: 'LONG'`, `rowQty: h.qty`;
2. a `SHORT` row when `h.shortQty > 0`:

| Field | Value |
| ---- | ---- |
| `rowKey` | `` `${h.key}:SHORT` `` |
| `direction` | `'SHORT'` |
| `rowQty` | `-h.shortQty` |
| `minFee` (local) | `h.currency === 'TWD' ? getMinFee(h.shortQty >= 1000 ? 'whole' : 'odd', workspaceId) : undefined` |
| `mktVal` | `price !== null ? price * h.shortQty : null` — the cost to buy the shares back, always positive |
| `netMktVal` | `null` — 淨收 has no meaning on a short leg |
| `unrealized` | `price !== null ? estimateUnrealizedShort(h, price, feeRate, minFee) : null` |
| `rawUnrealized` | `price !== null ? h.shortRawProceeds - price * h.shortQty : null` |
| `roi` | `unrealized !== null && h.shortProceeds !== 0 ? unrealized / h.shortProceeds : null` |
| `breakEven` | `breakEvenPriceShort(h, feeRate, minFee)` |
| `price`, `priceStale`, `dayChange`, `tradeDay`, `closed`, `trial` | identical to the LONG row |

A holding with `qty === 0 && shortQty === 0` emits nothing.

---

## B3 — `src/components/Dashboard/DashboardPage.tsx`

### B3.1 Direction column

Add a first column to the `<thead>` (`DashboardPage.tsx:86-98`) and to the row template
(`:100-210`). Header label `方向`, not numeric. Cell renders a pill:
`<span className={row.direction === 'SHORT' ? 'dir-short' : 'dir-long'}>{row.direction === 'SHORT' ? '空' : '多'}</span>`.

Add the two class names to the existing dashboard stylesheet. 台股慣例 red = up = long,
green = down = short — a short row's share count is green, not red.

### B3.2 Row source fields

- `key={row.rowKey}` replaces `key={h.key}`. **`data-testid` keeps its current value
  `` `holding-row-${h.ticker}` `` on a LONG row** — two existing tests select by it — and a
  SHORT row uses `` `holding-row-${h.ticker}-SHORT` ``.
- The 持有股數 cell renders `fmtQty(row.rowQty)`; a negative value takes the same class the
  other 跌/綠 figures use.
- 投入成本 and 平均買入成本 render `—` on a SHORT row (a short leg has proceeds, not cost).
- 保本賣出價 header keeps its label; on a SHORT row its help text must say the short meaning:
  **低於**此價才獲利.

### B3.3 Totals `<tfoot>`

The holdings table currently has no `<tfoot>`. Add one with three rows, spanning the leading
columns and putting the figure in the 目前市值 column:

**The sums cover TWD rows only** (`row.holding.currency === 'TWD'`). Adding a USD market value
to a TWD one produces a number that means nothing, and 融券 is a Taiwan-market product anyway.
Label the rows `多頭市值（台股）`, `空頭市值（台股）`, `淨曝險（台股）`.

| Row | Value |
| ---- | ---- |
| 多頭市值（台股） | sum of `mktVal` over TWD rows where `direction === 'LONG'` |
| 空頭市值（台股） | sum of `mktVal` over TWD rows where `direction === 'SHORT'` |
| 淨曝險（台股） | 多頭市值 − 空頭市值 |

Put the matching 未實現損益 sum in that column on each row. Rows with `mktVal === null`
(no price) are skipped in the sums. Render the whole `<tfoot>` only when at least one row
has a non-null `mktVal`.

Each row carries a `data-testid` so tests can select it, and so does the 目前市值 cell inside it:

| Row `data-testid` | 目前市值 cell `data-testid` |
| ---- | ---- |
| `totals-long` | `totals-long-mktval` |
| `totals-short` | `totals-short-mktval` |
| `totals-net` | `totals-net-mktval` |

Each 目前市值 cell's text is the formatted figure only, produced by the same money formatter
the table body already uses.

### B3.4 Warning copy

`DashboardPage.tsx:256` currently reads:

```
發現 {n} 筆資料異常（如超賣），已以持有股數為上限計算：
```

Stage A added an over-cover warning that is **not** capped at held shares, so the second
clause is now false. Replace the whole line with:

```
發現 {n} 筆資料異常（如超賣、超額回補）：
```

---

## B4 — `src/components/Transactions/TransactionForm.tsx`

### B4.1 Nature option

Add `<option value="SHORT">{TX_NATURE_LABEL.SHORT}</option>` after `MARGIN`
(`TransactionForm.tsx:383-402`).

In the same `onChange`, extend the existing `DAY_TRADE` branch:

```ts
if (next === 'DAY_TRADE') {
  taxRateManual.current = true
  setTaxRate('0.0015')
} else if (next === 'SHORT') {
  // 融券賣出付全額證交稅，資券當沖不適用減半
  taxRateManual.current = false
  updateTaxRateAuto(ticker)
}
```

Do not change what happens when `next` is `SPOT` or `MARGIN`.

### B4.2 Borrow fee in the auto-calculated fee

The fee `useEffect` (`TransactionForm.tsx:170-192`) must pass the nature so a 融券 sell picks up
the borrow fee:

```ts
nature: market === 'TPE' ? nature : undefined,
```

Add `nature` to the effect's `sig` string **and** to its dependency array. Missing either one
leaves the fee stale when only the nature changes.

### B4.3 Short-cover quick pick

A 融券回補 is a BUY, so the existing holdings dropdown (gated on `isSpotSell`) never fires.
Add a mirror of it:

```ts
const isShortCover = txType === 'BUY' && market === 'TPE' && nature === 'SHORT'
const activeShorts = useMemo(
  () => ledger.holdings.filter((h) => h.shortQty > 0 && h.market === market),
  [ledger.holdings, market],
)
```

Filter it by the typed ticker/name exactly as `filteredTickerHoldings` does, and render it with
the same JSX shape as the block at `TransactionForm.tsx:430-456`, with:

- `data-testid="ticker-shorts-dropdown"`,
- the tag text `` `空單 ${item.shortQty.toLocaleString()} 股` `` in place of `庫存 … 股`,
- the empty state `目前帳戶無空單` / `空單中無匹配代號`.

Reuse `pickHolding` for the click handler. Both dropdowns are mutually exclusive by
construction (`isSpotSell` needs SELL, `isShortCover` needs BUY); do not add a guard for it.

---

## Negative conditions

- **Do not change any existing LONG row formula.** `mktVal`, `netMktVal`, `unrealized`,
  `rawUnrealized`, `roi` and `breakEven` on a LONG row must stay byte-identical.
- **Do not add a total that mixes the two directions into one 總市值 number.** The three-row
  split is the point: adding a short leg's market value to a long leg's is meaningless.
- **Do not infer `SHORT`** anywhere in the form or the CSV importer. Only the explicit label
  or code selects it.
- **Do not change the CSV header array or column order** — `csv.test.ts` locks the round trip.
- Do not touch `pnlEngine.ts`, `fees.ts` or `models.ts`; Stage A is closed.

## Files — you may touch nothing else

- `sources/src/utils/csv.ts`
- `sources/src/utils/holdingRows.ts`
- `sources/src/components/Dashboard/DashboardPage.tsx`
- `sources/src/components/Transactions/TransactionForm.tsx`
- `sources/src/index.css` (only to add `.dir-long` / `.dir-short`; if the dashboard styles live
  in another stylesheet, use that one instead and say so in your report)

## Verify

From `sources/`:

```
npx vitest run
npm run build
```

Both must exit 0. Check the exit code, not the summary line.
