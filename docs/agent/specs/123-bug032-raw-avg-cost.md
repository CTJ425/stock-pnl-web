# Task 123 — BUG-032: seed the simulator from the raw traded price

Target version: `0.9.4-dev.1`.

## Problem

`WhatIfTab` seeds 買進價格 from `Holding.avgCost`, which already includes the buy fee, and
`whatIf()` then adds a buy fee on top. 投入成本 is therefore overstated by roughly one fee
(~0.14%; measured NT$4,276 on a ~NT$3M 2330 position) and the break-even row inherits the
same error. The user's decision: **use the raw traded price as the buy price**, so the fee is
counted exactly once, by `whatIf()`.

`pnlEngine` already carries the fee-exclusive value — `Holding.rawAvgCost = pos.rawCost / pos.qty`
(`sources/src/utils/pnlEngine.ts:333`), where `pos.rawCost` accumulates `tx.price * tx.qty`
only (`pnlEngine.ts:262`). 庫存總覽 already displays it as 未含費. Nothing needs recomputing;
this is a plumbing change.

## Contract

1. `sources/src/utils/pnlEngine.ts` — **unchanged**. `avgCost`, `rawAvgCost`, and
   `estimateUnrealized` all keep their current meaning and callers.
2. `sources/src/services/reportProxy.ts` — **unchanged**. `ReportHolding` is the payload sent
   to the report Edge Function; do not widen it.
3. `sources/src/components/StockDetail/AnalysisPage.tsx` — pass the holding's `rawAvgCost`
   into `StockDetailPage` through a new dedicated prop, not through the `holding` object.
   `null` for a watched stock.
4. `sources/src/components/StockDetail/StockDetailPage.tsx` — `StockDetailPageProps` gains
   `rawAvgCost?: number | null`, defaulting to `null`, forwarded to `WhatIfTab`. The existing
   `holding` prop and everything else on the page keep working untouched.
5. `sources/src/components/StockDetail/WhatIfTab.tsx` — the `avgCost` prop is **renamed** to
   `rawAvgCost: number | null` and now carries the fee-exclusive average traded price. Every
   current use of `avgCost` switches to it with no other change in behaviour: the 買進價格
   default, `isHeld`, the ladder anchor, the `avgCost` mark, and the marks strip.
   - The hint under the ledger becomes `買進價預設為成交均價 <price>（未含手續費）`.
   - The `均價` row tag, the `持有均價 ±10%` heading, and the quote cluster are unchanged.

After the change, for a holding of 1000 shares at a raw 100.00 with a 0.1425% fee, 投入成本 is
`100,000 + one buy fee` (~NT$100,142), not `100,142 + another fee` (~NT$100,285).

## Files

- `sources/src/components/StockDetail/WhatIfTab.tsx`
- `sources/src/components/StockDetail/StockDetailPage.tsx`
- `sources/src/components/StockDetail/AnalysisPage.tsx`

## Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| Held stock seeds the input | 買進價格 defaults to the raw price, not the fee-inclusive one | `WhatIfTab.test.tsx` |
| Fee counted once | 投入成本 − 價金 is one fee (≈142.5 on 100k), never two | `WhatIfTab.test.tsx` |
| Hint wording | says 成交均價 … 未含手續費 | `WhatIfTab.test.tsx` |
| Ladder unchanged | anchor, 均價 tag, cluster and heading behave as in 0.9.3 | `WhatIfTab.test.tsx` (existing, renamed prop) |
| Watched stock | unchanged; no holding, no 均價 | `WhatIfTab.test.tsx` (existing) |

## Non-goals

- Do not change `pnlEngine`, `fees.ts`, `whatIf()`'s maths, 庫存總覽, YearlyPage, or the report
  payload.
- Do not rename `Holding.avgCost` or change what 庫存總覽 shows.
- No Supabase, no Edge, no schema.
