# Task 142 — Cold holdings redesign: grouped rail table, net on top, colour-coded natures

- **Status**: ✅ DONE (0.9.28-dev.3, 2026-09-03)
- **Lane**: 2 (elevated risk — holdings display, KPI semantics, a user-visible colour rule)
- **Baseline**: 95 test files, 1518 tests, exit 0 (2026-09-03)
- **Approved design**: artifact `f6d0c748-9302-437b-ab2b-6f148de707bc` (配色版庫存總覽)

## Goal

Replace the three-row holdings `<tfoot>` with direction groups inside the table, move the
net figures into the market panel at the top, and encode direction and transaction nature
with two non-market hues instead of frames.

## Contract

### C1 — Colour roles are disjoint

| Hue | Meaning | May appear in |
| --- | --- | --- |
| `--up` / `--down` | price move, profit, loss | price, unrealized, ROI, realized columns |
| `--steel` (solid) | SHORT position, 融券 | direction and nature cells only |
| `--steel-tint` | 融資 | nature cell only |
| `--ochre-tint` | 當沖 | nature cell only |
| none | LONG position, 現股 | the default; carries no colour |

**Negative case**: `--up` / `--down` must not appear on a direction or nature cell, and
`--steel` / `--ochre` must not appear on a price or a P&L figure. A grep for `pnl-up` or
`pnl-down` inside the nature cell is a failure.

### C2 — Market panel carries the net

- Panel hero label is `淨額市值` when the market has SHORT rows, `持倉市值` when it does not.
- Panel hero value (`data-testid="{tw|us}-mktval"`) is `longMkt - shortMkt` when SHORT rows
  exist, and `longMkt` when they do not.
- The exposure bar renders **only** when SHORT rows exist. It carries
  `data-testid="{tw|us}-exposure"`. Its two segments are sized by `longMkt` and `shortMkt`,
  and its key exposes `{tw|us}-long-mktval` and `{tw|us}-short-mktval`.
- **Negative case**: a market with no SHORT rows renders no exposure bar and no key. A
  one-segment bar is forbidden — it states no proportion.
- `{tw|us}-cost` keeps its existing meaning: LONG rows only, each holding counted once.
  This is the Task 141 guarantee and it does not change.

### C3 — Holdings table groups by direction

- The `方向` column is deleted. The table has 10 columns.
- When SHORT rows exist, the body renders a caption row before each non-empty group:
  `data-testid="holding-group-LONG"` and `holding-group-SHORT`. Each caption row shows the
  count and subtotal market value (in a cell carrying
  `data-testid="holding-group-{LONG|SHORT}-mktval"`), the subtotal unrealized, and an
  **empty ROI cell**.
- **Negative case**: the caption row must not compute a group ROI. A correct group ROI for a
  SHORT group is not a simple sum and is out of scope. Leave the cell empty.
- When no SHORT rows exist, no caption row renders at all.
- SHORT rows carry `className="row-short"`.
- `<tfoot>` and the testids `totals-long`, `totals-short`, `totals-net`,
  `totals-long-mktval`, `totals-short-mktval`, `totals-net-mktval` are deleted.
- `holding-row-{ticker}` and `holding-row-{ticker}-SHORT` testids **must not change**.

### C4 — Transaction 類型 cell is one chip

- The cell renders a single `<span class="tx-chip tx-chip-{spot|day|margin|short}">`.
- Text is `{TX_NATURE_LABEL[nature]}{買|賣}` — for example `現股買`, `融券賣`.
- **Negative case**: `tx_nature` is optional and nullable, and absent means *unknown*, not
  現股 (`models.ts:37-38`). When it is null the chip shows `TX_TYPE_LABEL[tx.tx_type]`
  (`買入` / `賣出`) and uses `tx-chip-spot`. It must not claim 現股.

### C5 — The cash-flow column loses its colour

`cashFlow` (`TransactionsPage.tsx:23-26`) returns `-(gross + fee)` for BUY and
`gross - fee` for SELL. Its sign is a restatement of the side, never a profit. The current
`pnlClass(flow)` therefore paints every purchase green and every sale red, which in the
Taiwan reading says "buying is a loss".

- The cell className becomes `num` only. `pnlClass` is removed from it.
- The column label changes from `損益 / 收支` to `現金收支`. The `sortKey` stays `flow`.

## Files

Builder may touch only these:

- `sources/src/index.css`
- `sources/src/components/Dashboard/DashboardPage.tsx`
- `sources/src/components/Transactions/TransactionsPage.tsx`

## Implementation notes

### index.css

Add five tokens to `:root` (the dark default, line 6) **and** to `:root[data-theme='light']`
(line 54):

| Token | dark | light |
| --- | --- | --- |
| `--steel` | `#74a6c0` | `#2f6484` |
| `--steel-tint` | `rgba(116,166,192,0.20)` | `rgba(47,100,132,0.14)` |
| `--steel-on` | `#0b0e13` | `#fafbfc` |
| `--ochre` | `#d6a742` | `#8a5e12` |
| `--ochre-tint` | `rgba(214,167,66,0.20)` | `rgba(138,94,18,0.15)` |

New rules (place near `.market-panel` at line 383 and `.data-table` at line 503):

- `.exposure-bar` — flex, height 8px, gap 2px, margin-top 12px
- `.exposure-seg-long` — `background: var(--ink)`
- `.exposure-seg-short` — `background: var(--steel)`
- `.exposure-key` — flex, gap 16px, margin-top 8px, font-size 11.5px
- `.exposure-sw` — 12×8px block; `.exposure-sw-long` / `.exposure-sw-short` match the segments
- `.market-note` — margin-top 13px, font-size 11.5px, `color: var(--ink-secondary)`
- `.market-panel` — add `display: flex; flex-direction: column;`
- `.market-foot` — `margin-top: auto` so both panels align on their bottom row
- `.holding-group td` — background `var(--thead-bg)`, small tracked uppercase label
- `.holding-group-short .holding-group-label` — `color: var(--steel)`
- `.row-short td` — `background: var(--steel-tint)`
- `.row-short td:first-child` — `box-shadow: inset 3px 0 0 var(--steel)`
- `.tx-chip` — inline-block, font-size 11px, padding 2px 8px, no border
- `.tx-chip-spot` — `color: var(--ink-secondary); background: var(--surface-strong)`
- `.tx-chip-day` — `color: var(--ochre); background: var(--ochre-tint)`
- `.tx-chip-margin` — `color: var(--steel); background: var(--steel-tint)`
- `.tx-chip-short` — `color: var(--steel-on); background: var(--steel)`

**Do not** change `--radius`, `--shadow-card`, `backdrop-filter`, `--accent`, `--up` or
`--down`. Stripping the glass system is a separate task.

### DashboardPage.tsx

1. Extract the two `market-panel` blocks (lines 331-378 and 380-427) into one local
   `MarketPanel` component. Do not copy the markup twice.
2. Compute `twShortRows` / `usShortRows` beside the existing `twLongRows` / `usLongRows`
   (lines 302-315). Pass `shortMkt = shortRows.length === 0 ? null : sumOrNull(...)`.
3. The US panel passes a note of the form `{n} 檔 · 全部多單`. Do not add an FX conversion —
   the panel has no exchange-rate source.
4. In `HoldingsTable` (line 74): delete the `方向` header and cell, delete the `<tfoot>`,
   and group the body rows.

### TransactionsPage.tsx

1. Add two helpers next to `cashFlow` (line 23) and **export both by name** — the tests
   import them directly:
   `export function txChipClass(nature?: TxNature | null): string` returns
   `tx-chip-day` | `tx-chip-margin` | `tx-chip-short` | `tx-chip-spot` (the default, which
   also covers `null`/`undefined`).
   `export function txChipLabel(tx: Transaction): string` returns
   `` `${TX_NATURE_LABEL[tx.tx_nature]}${tx.tx_type === 'BUY' ? '買' : '賣'}` `` when
   `tx_nature` is set, and `TX_TYPE_LABEL[tx.tx_type]` when it is not.
2. Replace the 類型 cell (line 350) with the chip.
3. Drop `pnlClass` from the flow cell (line 356) and rename the header (line 323).

## Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| T1 | TW hero shows the net: `tw-mktval` = 905,000 (1,000,000 − 95,000) | `DashboardPage.test.tsx` |
| T2 | Exposure key exposes both legs: `tw-long-mktval` = 1,000,000, `tw-short-mktval` = 95,000 | `DashboardPage.test.tsx` |
| T3 | No SHORT rows → no exposure bar, hero label is `持倉市值`, `tw-mktval` = long only | `DashboardPage.test.tsx` |
| T4 | US panel never renders an exposure bar | `DashboardPage.test.tsx` |
| T5 | `<tfoot>` is gone: `totals-long` / `totals-short` / `totals-net` are absent | `DashboardPage.test.tsx` |
| T6 | The `方向` column header is absent | `DashboardPage.test.tsx` |
| T7 | Caption rows carry count, subtotal market value and subtotal unrealized | `DashboardPage.test.tsx` |
| T8 | SHORT row carries `row-short`; LONG row does not | `DashboardPage.test.tsx` |
| T9 | No SHORT rows → no caption row of either direction | `DashboardPage.test.tsx` |
| T10 | `tw-cost` still counts each holding once, LONG only (Task 141 guarantee) | `DashboardPage.test.tsx` |
| T11 | `txChipLabel` / `txChipClass` map all four natures: `現股買`, `當沖賣`, `融資買`, `融券賣` | unit, `TransactionsPage.test.tsx` |
| T12 | `tx_nature` null gives `買入` / `賣出` and `tx-chip-spot`, never `現股` | unit, `TransactionsPage.test.tsx` |
| T13 | The rendered table carries no `pnl-up` / `pnl-down`, and the header reads `現金收支` | integration, `TransactionsPage.test.tsx` |

## Verify

From `sources/`:

```
npm run build
npx vitest run src/components/Dashboard/DashboardPage.test.tsx src/components/Transactions/TransactionsPage.test.tsx
npx vitest run
```

`npm run build` is the type gate — `npx tsc --noEmit` does not type-check test files here.

## Non-goals

- Do not strip the glass design system (`--radius`, `--shadow-card`, `backdrop-filter`,
  `--accent`). That is a whole-app change and belongs to its own task.
- Do not change `YearlyPage.tsx`. The 分佈 column and the currency split shown in an earlier
  draft are not part of this task.
- Do not change any P&L formula. `netMkt`, `netUnreal`, `buildHoldingRows`, `computeLedger`
  and `cashFlow` keep their current arithmetic.
- Do not change the `sortKey` values in `TransactionsPage`.
- Do not add a group ROI to the caption rows.
