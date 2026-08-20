# Task 122 — Replace the union window with an average-cost ladder plus a quote cluster

Target version: `0.9.3-dev.3` (dev only).

## Problem

Task 121 stretched one window over both the average cost and the live quote. When the two
are far apart the round-price grid gets coarse and the table's proportions break down — the
user's words: 「均價和現價差太多反而格式會跑掉」. The fix: keep the ladder anchored on the
average cost with its regular ±10% / 2.5% steps, and when the quote falls outside that
window give it its own small cluster instead of deforming the main one.

## Contract

### A. `sellLadder(input, marks?)` — `sources/src/components/StockDetail/whatIf.ts`

**Delete the Task 121 round-price grid entirely** — `stepSize`, `STEP_MULTIPLIERS`, the union
window, and the `< 2 rows` fallback. No dead code left behind.

1. **Main group.** Always the nine fixed steps at ±10% / ±7.5% / ±5% / ±2.5% / 0% of
   `anchor = input.price`, each `kind: 'step'`, `group: 'anchor'`. This is the pre-121
   behaviour and is the same for a held and a watched stock.
2. **Marks** — `breakEven`, `avgCost`, `currentPrice` — unchanged: snapped to 0.01, dropped
   unless finite and `> 0`, dropped unless inside `[minStepPrice, maxStepPrice]` of the main
   group, merged by the existing dedupe (`current: 3 > avgCost: 2 > breakEven: 1 > step: 0`).
   Marks are always `group: 'anchor'`.
3. **Quote cluster.** Built only when `marks.avgCost > 0` (a real holding), `marks.currentPrice`
   is finite and `> 0`, and the snapped quote falls **outside** the main window. It is the
   seven prices `quote * (1 + p)` for `p` in `[-0.075, -0.05, -0.025, 0, 0.025, 0.05, 0.075]`,
   each snapped to 0.01, each `group: 'quote'`; the `p === 0` row is `kind: 'current'`, the
   rest are `kind: 'step'`. Any cluster price that lands inside the main window is dropped —
   the main group already covers it.
4. Everything is then sorted descending by price and deduped exactly as today. Each row's
   `pnl` / `roi` / `proceeds` / `sellFeeTax` stays a fresh `whatIf()` call at that price.
   `relative` stays `price / anchor - 1` for every row, cluster rows included, so a cluster
   row reads as its distance from the average cost.

`LadderRow` gains `group: 'anchor' | 'quote'`. Nothing else about the shape changes.

Row count is bounded: 9 steps + at most 2 extra marks + at most 7 cluster rows.

### B. `WhatIfTab` — `sources/src/components/StockDetail/WhatIfTab.tsx`

- A separator row is rendered between the two groups, exactly once, where `group` changes.
  It carries `data-testid="whatif-ladder-gap"` and must **not** carry
  `data-testid="whatif-ladder-row"`; it is a single full-width cell reading `現價附近`, is not
  clickable, and is not focusable.
- Heading: `賣出階梯 · 持有均價 ±10%` when anchored on the average cost, `賣出階梯 · 現價 ±10%`
  otherwise. The Task 121 `涵蓋均價與現價` wording is removed.
- The relative column header, the marks summary strip above the table, and the click-to-fill
  behaviour of ladder rows all stay exactly as they are in 0.9.3-dev.2.

### C. `sources/src/index.css`

A rule for the separator row in the existing `.whatif-ladder*` family — muted, clearly not a
price row. Existing custom properties only, no new colour literals.

## Files

- `sources/src/components/StockDetail/whatIf.ts`
- `sources/src/components/StockDetail/WhatIfTab.tsx`
- `sources/src/index.css`

## Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| avg 100 / quote 130 | main group is the nine 2.5% steps 90…110; cluster is 7 rows around 130 | `whatIf.test.ts` |
| quote inside ±10% | no cluster at all; every row `group: 'anchor'` | `whatIf.test.ts` |
| quote just outside (112) | cluster rows that fall inside the main window are dropped | `whatIf.test.ts` |
| quote far below (60) | cluster sits below the main group, order stays descending | `whatIf.test.ts` |
| watched stock | unchanged nine steps, never a `quote` group | `whatIf.test.ts` |
| held render, quote outside | exactly one `whatif-ladder-gap`, and it is not a ladder row | `WhatIfTab.test.tsx` |
| held render, quote inside | no gap row | `WhatIfTab.test.tsx` |
| heading | 持有均價 ±10% for a holding, 現價 ±10% otherwise | `WhatIfTab.test.tsx` |

## Non-goals

- Do not touch `whatIf()`, `fees.ts`, `pnlEngine.ts`, or any fee/tax maths.
- Do not change the marks summary strip.
- Do not fix the fee-inclusive `avgCost` double-count; it stays an open bug.
- No Supabase, no Edge, no schema. Do not merge to `main`.
