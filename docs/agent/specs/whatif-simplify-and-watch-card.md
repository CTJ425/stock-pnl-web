# Spec — simplify 損益試算, and give 觀察股票 the same card as its sibling tabs

Two independent changes in the 個股分析 tab strip. Change A is cosmetic; Change B
changes what the tab renders but **not** how it calculates.

Command root is `sources/`. Verify with:

```
cd sources && npm test && npx tsc --noEmit && npx oxlint src
```

---

## Change A — 觀察股票 tab has no card, its siblings do

### Fact

`StockDetailPage.tsx:382-391` mounts four tab bodies. Three are wrapped, one is not:

| Tab | Wrapper at mount site |
| ---- | ---- |
| 分析內容 | `<div className="detail-stack">` → four `<section className="glass detail-card">` |
| 損益試算 | `<div className="glass detail-body">` |
| AI 分析 | `<div className="glass detail-body">` |
| **觀察股票** | **none — `<WatchTab …/>` is mounted bare** |

`WatchTab.tsx:72-76` then opens with `.section` / `.section-title` / `<h2>`, which is the
**DashboardPage** section pattern, not the StockDetail one. This is left over from
f106f43, which moved the component out of `Dashboard/WatchSection` without restyling it.
Result: the tab renders with no glass surface and a heading one level larger than every
other heading in the page.

### Do

1. `StockDetailPage.tsx:391` — wrap the `<WatchTab …/>` element in
   `<div className="glass detail-body">`, byte-identical to the `whatif` and `ai`
   branches immediately above it (lines 383-390).
2. `WatchTab.tsx:72-76` — replace the outer element and heading block:
   - `<div className="section">` → `<div className="rpt-section">`
   - `<div className="section-title">` → `<div className="rpt-section-head">`
   - `<h2>觀察中</h2>` → `<h3>觀察中</h3>`
   - Keep the `.toolbar` and **all** of its children unchanged: the `N/30` hint, the
     at-max hint, and the 加入觀察 button.
3. Read `index.css:1986-2007` first. `.rpt-section-head` is the layout that must hold the
   `<h3>` and the `.toolbar` on one row with the toolbar to the right. If it does not
   already do that, add the minimum rule needed **in the existing `.rpt-section-head`
   block** — do not invent a new class.

### Do NOT

- Do **not** change the 加入觀察 button's `btn btn-sm` classes. That pair is the app's
  standard toolbar button, verified at `DashboardPage.tsx:329`, `MacroPage.tsx:330`,
  `FxPage.tsx:320`, `AdminStatusPage.tsx:249`, `ProbeWarRoom.tsx:134`. It is already
  consistent. The card was the problem, not the button.
- Do **not** touch `AddWatchModal.tsx`. It already uses the shared `Modal` and
  `.search-box`/`.search-input` classes.
- Do **not** change the table, the empty state, or the remove flow.

---

## Change B — 損益試算 shows four numbers too many

### Target surface

The tab must show exactly this, in this order:

```
若我在 [買進價格] 買進 [股數] [張▾]，並在 [賣出價格] 賣出

  損益              報酬率
  +9,100            +9.07%
  含手續費與證交稅 -1,185

  買進價預設為平均成本 100.29        ← one hint line, wording per rule 4 below
  此為試算工具，不會影響持股或任何損益報表。
```

Everything else currently rendered goes away.

### Rules

1. **The calculation does not change.** Keep calling `whatIf()` from `./whatIf` with the
   same input shape. It already returns `buyFee`, `sellFeeTax`, `pnl`, `roi`. Do not edit
   `whatIf.ts`, `utils/fees.ts`, or `utils/pnlEngine.ts`. `cost`, `proceeds` and
   `breakEven` simply stop being rendered — leave them in the returned type.

2. **Delete these output rows** (`WhatIfTab.tsx:114-121`): 成本, 賣出可得,
   手續費＋證交稅 breakdown, 回本價.

3. **Add one fee line** under the two headline numbers:
   `含手續費與證交稅 -{fmtMoney(result.buyFee + result.sellFeeTax, 'TWD')}`
   Use `className="hint"` and `data-testid="whatif-fees"`. Keep the existing
   `data-testid="whatif-pnl"` and `data-testid="whatif-roi"` exactly as they are.

4. **New prop, new defaults.** Extend `WhatIfTabProps`:

   ```ts
   interface WhatIfTabProps {
     ticker: string
     currentPrice: number | null
     /** Set for a held stock, null for a watched one. Fee-inclusive average cost. */
     avgCost: number | null
     /** Set for a held stock, null for a watched one. Shares currently held. */
     heldQty: number | null
   }
   ```

   | Field | Held stock (`avgCost !== null`) | Watched stock |
   | ---- | ---- | ---- |
   | 買進價格 | `avgCost`, to 2 dp | `currentPrice` |
   | 股數 + unit | `heldQty % 1000 === 0` → `張`, value `heldQty / 1000`; otherwise `股`, value `heldQty` | `張`, value `1` |
   | 賣出價格 | `currentPrice` | `currentPrice` |
   | hint line | `買進價預設為平均成本 {avgCost to 2dp}` | `買進價預設為現價 {currentPrice}` |

   When `currentPrice` is null, leave 賣出價格 empty and render no hint line — the
   existing `hasQuote` guard already does this; keep that behaviour.

   `StockDetailPage.tsx:384` passes the two new props: `avgCost={holding?.avgCost ?? null}`
   and `heldQty={holding?.qty ?? null}`. `holding` is already in scope on that component
   (`StockDetailTarget`), so no plumbing above it changes.

5. **股/張 unit selector.** Add a `<select className="narrow">` immediately after the 股數
   input with options `張` and `股`, replacing the static `股，並在` text with
   `，並在`. Follow the markup of `TransactionForm.tsx:367-376`.

   Derive shares; do **not** rewrite the input value when the unit changes:

   ```ts
   const shares = unit === '張' ? qtyNum * 1000 : qtyNum
   ```

   `shares` is what goes into `whatIf({ qty: shares, … })` and what the existing whole-lot
   minimum-fee rule tests (`shares % 1000 === 0`). This differs deliberately from
   `TransactionForm`, which converts the value in place — here the input is a sandbox and
   an in-place rewrite would fight the user mid-typing.

6. **Labels.** `假想買進價` → `買進價格`; `賣出價` → `賣出價格`; `股數` stays. Keep the
   `htmlFor` / `id` pairs (`whatif-buy-price`, `whatif-qty`, `whatif-sell-price`) — tests
   and the a11y wiring both use them. The new select gets `id="whatif-unit"` and a
   `<label htmlFor="whatif-unit">單位</label>`.

7. Keep the sandbox disclaimer line and the module docstring's claim that state is not
   persisted — that stays true.

### Do NOT

- Do not persist any of this to localStorage, Supabase, or a context.
- Do not add a US-stock path. `whatIf.ts` is TPE-only by design; this change does not
  alter that.
- Do not touch `WhatIfTab.test.tsx` or any other `*.test.ts(x)` file. The main session
  owns the tests for this change and is updating them in parallel.

---

## Files

- `sources/src/components/StockDetail/StockDetailPage.tsx` (2 edits: line 384 props, line 391 wrapper)
- `sources/src/components/StockDetail/WatchTab.tsx` (heading block only)
- `sources/src/components/StockDetail/WhatIfTab.tsx` (main rework)
- `sources/src/index.css` (only if rule A3 requires it)

No other file may change.
