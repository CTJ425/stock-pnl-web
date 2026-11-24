# Spec: Limit-Up / Limit-Down Quote Parsing & Display Fixes (`0.10.43-dev.1`)

- **Date**: 2026-11-24
- **Status**: Approved for implementation (`0.10.43-dev.1`)
- **Reviewers (EGM)**: `egm-codebase-details`, `egm-design`, `egm-zoom-out`

---

## 1. Live Evidence & Root Causes

Captured live TWSE MIS response for `2330` locked at limit-up (`2026-11-24 09:26:02 Asia/Taipei`):

```json
{
  "c": "2330", "n": "台積電", "y": "2030.0000", "u": "2230.0000", "w": "1830.0000",
  "o": "2230.0000", "h": "2230.0000", "l": "2230.0000",
  "z": "-", "a": "-",
  "b": "0.0000_2230.0000_2225.0000_2220.0000_2215.0000_",
  "g": "6719_8517_74_141_84_",
  "t": "09:26:00", "d": "20261124", "v": "5216",
  "trade": { "t": "09:25:50", "v": 1, "z": "2230.0000", "ft": 20 }
}
```

### Root Causes Identified
1. **MIS `pickPrice` drops limit-up/limit-down prices (`sources/supabase/functions/stock-price/misParse.ts`)**:
   - When a stock locks at limit-up, MIS often emits `z: "-"` and places market buy orders (`"0.0000"`) at `b[0]` ahead of the limit-up bids (`b[1] = "2230.0000"`).
   - `pickPrice` only checked `String(row.b ?? '').split('_')[0]`. Because `toPrice("0.0000")` rejects `<= 0`, it fell directly through to `toPrice(row.y)` (yesterday's close `2030.00`), causing `price === prevClose`, `0.00%` day change, wrong current price, and wrong unrealized P&L.
   - Symmetrically, when a stock locks at limit-down, `b` is `"-"` (no buyers) and `a` carries `"0.0000_..."` or the limit-down ask (`w`), so `pickPrice` also fell back to `row.y`.
2. **`.quote-limit-badge` CSS box model (`sources/src/styles/stock-detail.css`)**:
   - `padding: 1px 6px 8px` placed `8px` of vertical-alignment padding *inside* `border: 1px solid currentColor`, distorting the `漲停` / `跌停` pill and omitting `line-height` and `white-space: nowrap`.
3. **Non-`1d` limit lines in `IntradayChart.tsx`**:
   - `limits` was computed whenever `market === 'TPE'`, drawing daily `±10%` dashed lines across `5d` and daily (`1m`–`all`) ranges where `prevClose` is the range-start close rather than yesterday's close.
4. **ETF tick sizes & trial badge (`whatIf.ts`, `QuoteTab.tsx`)**:
   - `priceLimits(prevClose)` ignored `00*` ETF tick rules (`0.01` < 50, `0.05` >= 50) already handled by `snapToTick`.
   - `QuoteTab` emitted the `漲停`/`跌停` badge during `quote.trial === true` simulated matching.

---

## 2. Explicit Non-Goals (YAGNI)

- **No `price_cache` DDL migration for MIS `u`/`w` columns**: Changing `price_cache` schema across DEV and PROD introduces rollout ordering risks and still cannot cover Yahoo fallback or intraday series. Keep `MisQuote`, `Quote`, and `price_cache` schemas unchanged.

---

## 3. Design & Precedence

### `misParse.ts` (`parseBook` + `pickPrice`)
- `parseBook(value: unknown)`: splits on `'_'`, trims each token, skips empty strings `""` and `"-"` (so trailing underscores never trigger `Number("") === 0`), tracks `hasMarketOrder` (`n === 0`) and `firstPositive` (first `n > 0`).
- `pickPrice(row)` precedence:
  1. `toPrice(row.z)` (current trade or trial price).
  2. **BUG-045 / Task 166 EP-01 time guards (unchanged)**:
     - If `tradeTime >= '13:30:00'` → `return null` (Yahoo fallback).
     - Else if `tradeTime === null && (row.t !== undefined || row.ot !== undefined)` → `return toPrice(row.y)`.
  3. `!trial && volume !== 0 && row.trade?.z` → `toPrice(row.trade.z)` (guards against stale prior-session or pre-open trial objects).
  4. `parseBook(row.b).firstPositive` (skips `"0.0000"` market buy orders).
  5. `!trial` limit-lock inference:
     - 100% market-order limit-up: `bid.hasMarketOrder && ask.firstPositive === null && !ask.hasMarketOrder` → `toPrice(row.u)`.
     - Limit-down lock: `!bid.hasMarketOrder && limitDown !== null && (ask.hasMarketOrder || ask.firstPositive === limitDown)` → `limitDown` (`toPrice(row.w)`). Never blindly accept a non-limit-down ask on illiquid stocks.
  6. `toPrice(row.y)` (yesterday's close fallback).

### Frontend Fixes
- `stock-detail.css` `.quote-limit-badge`: symmetric `padding: 3px 6px`, `margin-bottom: 4px`, `line-height: 1.2`, `white-space: nowrap`, `text-box: trim-both cap alphabetic`.
- `whatIf.ts`: unify `tickSizeFor(price, ticker?)` between `snapToTick` and `priceLimits(prevClose, ticker?)`.
- `QuoteTab.tsx`: pass `ticker` to `priceLimits` and suppress limit badge when `quote.trial` is `true`.
- `IntradayChart.tsx`: gate `limits` on `market === 'TPE' && range === '1d'` and pass `ticker`.

---

## 4. Verification Criteria

- Unit tests in `misParse.test.ts`, `whatIf.test.ts`, `QuoteTab.test.tsx`, `IntradayChart.test.tsx`.
- `npm test`, `npm run build`, `npm run typecheck:edge` all pass from `sources/`.
- Deploy `stock-price` (with default `verify_jwt=true`) to DEV Supabase `accmczhrqsilzrtyhyxa` and confirm bundle update via `supabase functions list`.
