# Task 124 — Align the simulator's cost basis with 庫存總覽

Target version: `0.9.5-dev.1`.

## Problem

Three complaints, all real, all in 損益試算 for a **held** stock:

1. The 買進價 shows `104.22` while 庫存總覽 and the user's broker app show `104.23` for the same
   holding. Same number, two roundings: the average is `416,900 / 4,000 = 104.225`, whose binary
   value is `104.224999999999994`. 庫存總覽 formats with `fmtPrice` (Intl, decimal half-up) →
   `104.23`; `WhatIfTab` seeds the input with `.toFixed(2)` → `104.22`.
2. The tab recomputes the buy fee at the workspace's configured rate instead of using the fee the
   user actually paid, so the P&L never matches 庫存總覽's unrealized figure (an 18-dollar gap on
   the reference position: real embedded fee 592 vs recomputed 594).
3. Nothing on screen says whether the seeded price includes fees, or where it came from.

Reference position (PROD 0050, verified against the database): 4,000 shares,
`rawCost` 416,900 → `rawAvgCost` 104.2250, `cost` 417,492 → `avgCost` 104.3730, quote 103.80.
庫存總覽 shows 未含費 −1,700 and 含費 −3,298; the tab currently computes −3,280.

## Contract

### A. Rounding — a shared helper

Add `roundPrice(value: number): number` to `sources/src/utils/formatters.ts` (next to `fmtPrice`):
decimal half-up to 2 decimals, immune to the binary-representation trap:
`Math.round((value + Number.EPSILON) * 100) / 100`.

(An earlier draft of this spec said `Math.round(Number(value.toFixed(10)) * 100) / 100`. That is
wrong and the builder correctly followed the tests instead: it returns `0.14` for `0.145` and `1`
for `1.005`, because `toFixed(10)` reproduces the same sub-`.5` double. The `EPSILON` form nudges
small values above the boundary, while for larger ones the `* 100` multiplication already rounds
to the boundary. Verified across `0.145`, `1.005`, `104.225`, `8888.885`, `12345.675`.)

`WhatIfTab` seeds 買進價格 with `roundPrice(rawAvgCost).toFixed(2)`, so the field reads `104.23`,
the same as 庫存總覽 and the broker app. The ladder anchor uses the same rounded value.

### B. Cost basis — use what was actually paid

`WhatIfTab` gains an `avgCost: number | null` prop **alongside** the existing `rawAvgCost`
(fee-inclusive and fee-exclusive average). `StockDetailPage` already receives `holding.avgCost`;
pass it through. Both are `null` for a watched stock.

`whatIf()` gains an optional `buyFee?: number` on `WhatIfInput`. When supplied, it is used verbatim
instead of `calculateFee({ txType: 'BUY', … })`; everything downstream (`cost`, `pnl`, `roi`,
`breakEven`) is unchanged in formula.

`WhatIfTab` supplies it only for a held stock:

- **Buy price untouched** (the user has not edited the field): use the exact unrounded
  `rawAvgCost` as `buyPrice` and `(avgCost - rawAvgCost) * shares` as `buyFee`. At the held
  quantity this makes 投入成本 exactly `shares * avgCost` — the same cost basis 庫存總覽 uses —
  so with 賣出價 = 現價 the tab's 損益 equals 庫存總覽's unrealized to the dollar, and 報酬率
  shares its denominator.
- **Buy price edited**: keep the holding's actual average fee *rate*,
  `(avgCost - rawAvgCost) / rawAvgCost`, and charge `round(buyPrice * shares * rate)`. The
  simulation stays on the user's real cost structure instead of jumping to the configured rate.
- **Watched stock**: unchanged — no `buyFee` override, the configured rate applies.

### C. Say what the numbers are

- The 買進 column's 價格 row label reads `成交均價（未含費）` for a held stock, `買進價` otherwise.
- The 費用 row shows `實付手續費` for a held stock, `手續費` otherwise.
- The hint under the ledger becomes, for a held stock:
  `買進價＝持股買進金額 ÷ 股數（未含手續費）；手續費採實際持股平均費用。持股歸零後重新起算。`
- Under 賣出價格, show the live quote as a labelled value: `現價 <quote>`, so the sell side always
  states which price the estimate is against. Omit it when there is no quote.

## Files

- `sources/src/utils/formatters.ts`
- `sources/src/components/StockDetail/whatIf.ts`
- `sources/src/components/StockDetail/WhatIfTab.tsx`
- `sources/src/components/StockDetail/StockDetailPage.tsx`
- `sources/src/components/StockDetail/AnalysisPage.tsx`
- `sources/src/index.css` (only if the new labels need a rule)

## Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| `roundPrice(104.225)` | `104.23`, and `roundPrice(0.145) === 0.15` | `formatters.test.ts` |
| Seeded price | 買進價格 reads `104.23` for `rawAvgCost` 104.225 | `WhatIfTab.test.tsx` |
| Cost basis parity | 投入成本 === `shares * avgCost` (417,492 on the reference position) | `WhatIfTab.test.tsx` |
| P&L parity | 損益 at 賣出價 = 現價 equals 庫存總覽's `estimateUnrealized` | `WhatIfTab.test.tsx` |
| Edited buy price | fee follows the holding's actual rate, not the configured one | `WhatIfTab.test.tsx` |
| Watched stock | unchanged: fee from the configured rate | `WhatIfTab.test.tsx` |
| `whatIf` override | `buyFee` supplied is used verbatim; absent, behaviour is as today | `whatIf.test.ts` |
| Labels | 成交均價（未含費） / 實付手續費 / 現價 shown | `WhatIfTab.test.tsx` |

## Non-goals

- Do not change `pnlEngine`, `fees.ts`, 庫存總覽, YearlyPage, or the report payload.
- Do not change the ladder's window rules, the quote cluster, or the marks strip.
- No Supabase, no Edge, no schema.
