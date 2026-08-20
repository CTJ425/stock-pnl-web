# Task 117 — 損益試算: sell ladder (現價 ±10%) + editable-price ledger

Design artifact: `賣出階梯與對帳單` (ladder on top, ledger below, no in-cell bars).

## Contract

### 1. New pure function `sellLadder` in `sources/src/components/StockDetail/whatIf.ts`

```ts
export type LadderKind = 'step' | 'current' | 'breakEven'

export interface LadderRow {
  /** Sell price, rounded to 2 decimals. */
  price: number
  /** price / anchor - 1. The anchor is `input.price`. */
  relative: number
  kind: LadderKind
  pnl: number
  roi: number
  proceeds: number
  sellFeeTax: number
}

export function sellLadder(input: WhatIfInput): LadderRow[]
```

Rules:

- The anchor is `input.price` as passed to `sellLadder`. **The component passes the
  quote, not the sell-price input** — see §2 — so the ladder never moves when the user
  types a sell price. Steps are
  `anchor * (1 + p)` for `p` in `-0.10, -0.075, -0.05, -0.025, 0, +0.025, +0.05, +0.075, +0.10`,
  each rounded to 2 decimals with `Math.round(x * 100) / 100`.
- The `p === 0` row has `kind: 'current'`; every other step has `kind: 'step'`.
- Each row's `pnl` / `roi` / `proceeds` / `sellFeeTax` come from `whatIf({ ...input, price: row.price })`.
  No new fee maths — fees are recomputed per row, never interpolated.
- The break-even price (`whatIf(input).breakEven`) is inserted as one extra row with
  `kind: 'breakEven'`, at its sorted position, **only when**:
  - it lies inside the window `[minStepPrice, maxStepPrice]`, and
  - no step row already has that exact price. When a step row has that price, that row keeps
    its own `kind` and no extra row is inserted.
- Rows are returned sorted by `price` ascending, and **every returned price is unique**.
  Two steps can round onto the same 2-decimal price once the anchor is small enough that
  `anchor * 0.025` falls under the 0.01 grid (anchor 0.35 rounds both −10% and −7.5% to 0.32).
  Collapse them to one row; when the collapsed rows have different kinds, keep the most
  specific one: `current` > `breakEven` > `step`.
- Returns `[]` when `whatIf(input)` returns `null` (invalid buyPrice / qty / price).

### 2. `WhatIfTab.tsx` layout

Replaces the sentence-style form. Order inside `rpt-section`:

0. The ladder is built with `sellLadder({ ...whatIfInput, price: anchor })` where
   `anchor = currentPrice ?? buyPriceNum`. The 賣出價 input is NOT the anchor.
1. **賣出階梯 · 現價 ±10%** — a scrollable table. Columns: 賣出價 / 相對現價 / 損益 / 報酬率 / 實收.
   - The `current` row is highlighted and its 賣出價 cell carries the tag `現價`;
     the `breakEven` row is highlighted differently and carries the tag `回本`.
   - 相對現價 renders `—` on the `current` row, otherwise a signed percent.
   - Clicking a row writes that row's price into the 賣出價 input (`String(row.price)`).
     The ladder itself does not move.
   - Test hooks: the `<table>` gets `data-testid="whatif-ladder"`; every `<tbody>` row gets
     `data-testid="whatif-ladder-row"` and `data-kind="step" | "current" | "breakEven"`.
   - The whole table is hidden when `sellLadder` returns `[]`.
   - Gains/losses use `pnlClass`; no bars, no colour blocks.
2. **對帳單 · 自訂賣出價** — two columns.
   - 買進 · 假設: 買進價 (input), 股數 (input + 張/股 select), 價金 `buyPrice * shares`,
     手續費 `buyFee`, 投入成本 `cost`.
   - 賣出 · 試算: 賣出價 (input), 股數, 價金 `sellPrice * shares`,
     手續費 + 證交稅 `sellFeeTax`, 實收 `proceeds`.
   - 結算 row: `pnl`, `roi`, and 回本價 `breakEven`.
   - Test hooks: `data-testid` `whatif-cost` (投入成本), `whatif-proceeds` (實收),
     `whatif-breakeven` (回本價).
3. The existing hints stay: 買進價預設說明 + 「此為試算工具，不會影響持股或任何損益報表」.

Existing `data-testid` values `whatif-pnl`, `whatif-roi`, `whatif-fees` must keep working —
`whatif-pnl` / `whatif-roi` move onto the 結算 row, `whatif-fees` stays as the combined
`buyFee + sellFeeTax` hint.

### 3. Styling

- The ladder reuses the existing table system: `<div class="table-scroll"><table class="data-table whatif-ladder">`.
  Do not invent a second table style.
- New CSS goes in `sources/src/index.css`, next to the other `.whatif-*` / `.data-table` rules,
  using existing custom properties only (`var(--panel)`, `var(--ink-muted)`, …). Do not add
  new colour literals and do not add a bar/heat-map column — the ladder is a number table.
- The clickable row needs a real interactive affordance: `cursor: pointer`, a hover state,
  and keyboard access (`<tr tabIndex={0}>` + `onKeyDown` for Enter/Space, or a button inside
  the first cell — pick one and keep it consistent).
- The ledger is a two-column grid that collapses to one column under 720px.
- Both themes must work; the project already switches on `[data-theme]` — follow the file.

### What must NOT change

- `whatIf()` itself: signature, maths, and the existing buy-fee behaviour.
- The tab stays a sandbox: no localStorage, no Supabase, no store writes.
- Fee rate / min fee resolution stays workspace-scoped (`getFeeRate(current?.id)`).

## Superseded

`WhatIfTab.test.tsx` describe 「畫面只留四個數字」 asserted 成本／賣出可得／回本價 were removed
(0.9.1-dev.1). The user has since asked for the ledger, so that block is rewritten in this task.

## Non-goals

- Do not fix the double-counted buy fee (held stocks default `buyPrice` to the
  fee-inclusive avgCost and `whatIf()` adds `buyFee` again). It is pre-existing and
  is a separate decision; the ledger only makes it visible.
- Do not regenerate the ladder from a user-typed sell price. The heading promises
  「現價 ±10%」 and the ladder must keep that promise.
- No US-stock support.
