# Task 119 — Anchor the sell ladder on the holding average cost

Target version: `0.9.3-dev.1` (dev only — the user wants to look at it on DEV before any merge).

## Problem

The 賣出階梯 always anchors on the live quote, so a held stock's ladder shows nine steps
around 現價 and, if it happens to fall inside the window, the break-even row. The number a
holder actually reasons from — the 持有均價 — is not on the table at all. The user asked for
the ladder to be read against the holding cost: **steps run ±10% of the average cost**, and
現價 / 回本 become marked rows inside that window.

## Contract

`sellLadder(input: WhatIfInput, marks?: LadderMarks): LadderRow[]`

- The anchor stays `input.price`. The caller decides what the anchor is; `sellLadder` does
  not read `avgCost` on its own.
- `LadderMarks = { currentPrice?: number | null; avgCost?: number | null }`.
- Nine steps at ±10% / ±7.5% / ±5% / ±2.5% / 0% of the anchor, every step `kind: 'step'`
  (the 0% step is no longer hard-coded to `'current'`).
- Each mark — `breakEven` (from `whatIf(input)`), `currentPrice`, `avgCost` — is inserted as
  its own row when it is a finite number `> 0` **and** falls inside
  `[minStepPrice, maxStepPrice]`. Outside the window it is dropped; the ladder is never
  stretched to reach it. A `null`/`undefined`/`0` mark is simply absent.
- Sort stays descending by price (highest first).
- Dedupe stays price-keyed and keeps the most specific kind. New rank:
  `current: 3 > avgCost: 2 > breakEven: 1 > step: 0`.
- `LadderKind` gains `'avgCost'`. `LadderRow` shape is otherwise unchanged, and
  `relative` stays `price / anchor - 1`.
- Every row's `pnl` / `roi` / `proceeds` / `sellFeeTax` stays a fresh `whatIf()` call at that
  row's price. No interpolation, no change to `whatIf()` itself, `fees.ts`, or `pnlEngine.ts`.
- Called with no `marks`, the function must behave exactly as today apart from the 0% row's
  kind: 9 steps + break-even when it is inside the window.

### `WhatIfTab`

- Anchor: `avgCost` when it is set and `> 0`, else the live quote, else the entered buy price
  (today's `currentPrice ?? buyPriceNum` fallback stays the tail of that chain).
- Passes `{ currentPrice, avgCost }` as marks.
- Heading: `賣出階梯 · 持有均價 ±10%` when anchored on the average cost, otherwise the current
  `賣出階梯 · 現價 ±10%`.
- Relative column header follows the anchor: `相對均價` / `相對現價`.
- The dash in the relative column is driven by the value, not the kind: show `—` when
  `row.relative === 0`, else the signed percent.
- `LADDER_TAG` gains `avgCost: '均價'`; a `.whatif-ladder-row--avgCost` rule styles that row in
  the same family as `--current` / `--breakEven`, reusing existing custom properties. No new
  colour literals.
- Clicking any row still writes that row's price into 賣出價格, and the ladder does not move
  when the user types a sell price.

## Files

- `sources/src/components/StockDetail/whatIf.ts`
- `sources/src/components/StockDetail/WhatIfTab.tsx`
- `sources/src/index.css` (the `.whatif-ladder-row--*` block only)

## Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| Held stock, avg cost anchor | 9 steps around avgCost, one `avgCost` row at the anchor | `whatIf.test.ts` |
| Live quote inside the window | one `current` row at exactly `currentPrice` | `whatIf.test.ts` |
| Live quote outside ±10% | no `current` row; ladder not stretched | `whatIf.test.ts` |
| Quote == avg cost | one row only, kind `current` (rank 3 beats 2) | `whatIf.test.ts` |
| No marks passed | 9 steps + break-even, as before | `whatIf.test.ts` |
| Marks null | no `current` / `avgCost` rows | `whatIf.test.ts` |
| Held stock renders | heading says 持有均價, table shows 均價 / 現價 / 回本 tags | `WhatIfTab.test.tsx` |
| Watched stock renders | heading still says 現價 ±10%, no 均價 tag | `WhatIfTab.test.tsx` |

## Non-goals

- Do not touch `whatIf()`, `fees.ts`, `pnlEngine.ts`, or any fee/tax maths.
- Do not fix the known double-counted buy fee (`avgCost` is fee-inclusive and `whatIf()` adds
  the buy fee again). It is an open bug with its own decision to make; this task only moves
  the anchor.
- No persistence, no Supabase, no Edge, no schema.
- Do not merge to `main`.
