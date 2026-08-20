# Task 121 — Ladder window that always contains both the average cost and the live quote

Target version: `0.9.3-dev.2` (dev only).

## Problem

Task 119 anchored the ladder on the holding average cost, but the live quote only appears
when it lands inside ±10% of that anchor. A stock that ran up 30% therefore shows no 現價
row at all — exactly when the user most wants to know what selling now is worth. The user
chose: widen the window so it always covers both prices, and add a summary strip above the
table so 現價 / 持有均價 / 回本 are readable without scanning the rows.

## Contract

### A. `sellLadder(input, marks?)` — `sources/src/components/StockDetail/whatIf.ts`

Two window modes. Everything else (marks, snapping, dedupe, descending sort, per-row
`whatIf()` recomputation) is unchanged.

**Mode 1 — no holding (`marks.avgCost` absent, null, or `<= 0`): unchanged.**
Nine steps at ±10% / ±7.5% / ±5% / ±2.5% / 0% of `input.price`, `kind: 'step'`. This is
today's behaviour and must stay byte-for-byte equivalent in output.

**Mode 2 — holding (`marks.avgCost > 0`): union window on a round-price grid.**

1. `lo = min(anchor, avgCost, currentPrice?) * 0.9`, `hi = max(anchor, avgCost, currentPrice?) * 1.1`,
   where `anchor = input.price` and `currentPrice` participates only when it is finite and `> 0`.
2. Step size: `raw = (hi - lo) / 12`; `mag = 10 ** Math.floor(Math.log10(raw))`; `step` is
   the first of `[1, 2, 2.5, 5, 10]` where `m * mag >= raw`, times `mag`; finally
   `step = max(step, 0.01)` — 0.01 is the TWSE tick, no grid may be finer.
3. Step rows are every multiple of `step` inside `[lo, hi]`: from `ceil(lo / step) * step`
   to `floor(hi / step) * step`, each snapped to 2 decimals, each `kind: 'step'`.
4. Guard: if that produces fewer than 2 rows (degenerate input), fall back to Mode 1.

In both modes the marks — `breakEven`, `avgCost`, `currentPrice` — are snapped to the 0.01
grid, dropped unless finite and `> 0`, then merged by the existing dedupe with rank
`current: 3 > avgCost: 2 > breakEven: 1 > step: 0`.

**The window a mark is tested against is the mode's own window, not the grid it produced.**
Mode 1 tests against `[minStepPrice, maxStepPrice]` (they are the same thing there). Mode 2
tests against `[lo, hi]` — the grid rounds inward, so a mark can legitimately sit outside the
outermost grid row and must still render; it simply sorts to the top or bottom of the table.
Testing a Mode 2 mark against the grid extremes drops exactly the marks this task exists to
show (avgCost 91 with a quote of 250 gives step 20, a grid starting at 100, and a vanished
average cost).

Mode 2 makes 現價 and 均價 fall inside the window by construction, so both always render.

`relative` stays `price / anchor - 1`. Round-grid step rows therefore show uneven
percentages — that is intended; the marked rows carry the exact ones.

### B. `WhatIfTab` — `sources/src/components/StockDetail/WhatIfTab.tsx`

**Summary strip**, rendered above the ladder, `data-testid="whatif-marks"`:

- One item per mark that exists, in this order: 現價, 持有均價, 回本. Each item is a
  `<button type="button">` with `data-testid="whatif-mark"` and `data-kind` of
  `current` / `avgCost` / `breakEven`.
- Each item shows the label, the price, the relative percent against the anchor, and the
  P&L of selling the whole entered quantity at that price. 持有均價 shows `—` for the
  percent (it is the anchor). The P&L comes from a `whatIf()` call at that price, same as a
  ladder row — never interpolated.
- Clicking an item writes its price into 賣出價格, exactly like clicking a ladder row.
- Watched stock (no `avgCost`): the strip holds 現價 and 回本 only. No quote and no
  holding: no strip at all.

**Heading**, derived from the rows that actually rendered — never from a re-guess of which
mode `sellLadder` chose, which decouples the text from the table (a held penny stock whose
round grid collapses falls back to Mode 1 while the heading still claims a Mode 2 window):

- anchored on the average cost **and** the ladder holds a `current` row whose `relative` is
  not 0 → `賣出階梯 · 涵蓋均價與現價`
- anchored on the average cost otherwise (quote equals the cost, or there is no quote) →
  `賣出階梯 · 持有均價 ±10%`
- anchored on the quote → `賣出階梯 · 現價 ±10%`

The relative column header keeps the Task 119 rule: `相對均價` when anchored on the average
cost, else `相對現價`.

### C. `sources/src/index.css`

Styles for the summary strip only, in the existing `.whatif-*` family. Reuse existing
custom properties; no new colour literals. The strip must stay readable at 390px wide.

## Files

- `sources/src/components/StockDetail/whatIf.ts`
- `sources/src/components/StockDetail/WhatIfTab.tsx`
- `sources/src/index.css`

## Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| avg 100 / quote 130 | step rows are multiples of 5 from 90 to 140; 現價 / 均價 / 回本 one row each | `whatIf.test.ts` |
| quote below cost (100 / 80) | window reaches down past 80; 現價 row present | `whatIf.test.ts` |
| small price (24.2 / 25) | step is 0.5, every step row a multiple of it | `whatIf.test.ts` |
| sub-NT$1 stock (0.35 / 0.36) | step never below 0.01; no duplicate prices | `whatIf.test.ts` |
| far quote (100 / 300) | both 現價 and 均價 still present exactly once | `whatIf.test.ts` |
| no avgCost | nine 2.5% steps, unchanged | `whatIf.test.ts` |
| held render | strip has 3 items; clicking 現價 fills 賣出價格 | `WhatIfTab.test.tsx` |
| watched render | strip has 現價 + 回本 only, no 均價 | `WhatIfTab.test.tsx` |
| heading | 涵蓋均價與現價 when quote ≠ cost, 持有均價 ±10% when equal | `WhatIfTab.test.tsx` |

## Non-goals

- Do not touch `whatIf()`, `fees.ts`, `pnlEngine.ts`, or any fee/tax maths.
- Do not change the watched-stock (Mode 1) ladder.
- Do not fix the fee-inclusive `avgCost` double-count; it stays an open bug.
- No persistence, no Supabase, no Edge. Do not merge to `main`.
