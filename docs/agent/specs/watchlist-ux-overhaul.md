# Spec — 觀察清單 UX overhaul

Supersedes the UI shipped in 0.8.0 / 0.8.1. The data layer (`watchlistService`, `tw_watchlist`,
the Edge whitelist union) is correct and **does not change**.

## Why

0.8.0 put the watchlist behind a 管理觀察 button on 個股分析 — a page that, until 0.8.0, required
a TW holding to enter. The user's verdict: the panel looks half-finished, the what-if tab is
unreadable, the entry point is undiscoverable, and none of it looks like the rest of the app.

The decision that fixes all four at once: **a watched stock is a first-class citizen, equal to a
holding.** It therefore lives where holdings live — 庫存總覽 — not behind a button on another page.

The original placement came from a bad trade: the 7th nav cell would squeeze the 320px mobile
bottom bar, so the entry was buried. That let a layout detail overrule information architecture.
Putting the section on 庫存總覽 costs no nav cell and still makes it first-class.

## Decisions (from the user)

| Item | Decision |
| ---- | ---- |
| Watchlist home | **個股分析**, a 4th inner tab named `觀察股票` beside 分析內容 / 損益試算 / AI 分析 |
| Stock picker | **holdings only.** The 觀察 group is removed from the dropdown; watched stocks are reached only from the 觀察股票 tab |
| 管理觀察 as a concept | **Removed.** Add = a search-only modal; remove = `×` on the row |
| Watched rows | Show 現價 and 漲跌, like holdings |
| What-if layout | One sentence with three inline inputs + one pair of headline numbers |
| Sell price | A visible input, defaulting to the current quote |

## Contract

### 1. `觀察股票` tab inside 個股分析

**Revision (user, after seeing 0.9.0 on dev).** The 庫存總覽 placement was never the user's choice —
they asked twice for 個股分析, and the main session turned their answer about *status* ("跟持股平起
平坐") into a decision about *location*. Corrected: the watchlist is the 4th tab of the stock detail
tab strip, and 庫存總覽 goes back to exactly what it was before 0.9.0.

- `StockDetailPage`'s `TABS` becomes 分析內容 / 損益試算 / AI 分析 / **觀察股票**.
- The tab renders the list, the count and the add entry — same table content as before.
- Title: `觀察中` plus the count as `N/30` (`WATCHLIST_MAX`), and a `＋ 加入觀察` button.
- Columns: 代號, 名稱, 現價, 漲跌, and a `×` remove control per row.
- Quotes: ONE batched `fetchPrices` call for all watched tickers (`{ market: 'TPE', ticker }`).
  A ticker with no quote shows `—`, never a spinner that never ends and never `NaN`.
- Row click selects that ticker as the page's current stock. Wiring: `StockDetailPage` takes an
  `onSelectTicker(ticker, name)` prop and `AnalysisPage` handles it. `AnalysisPage` keys
  `StockDetailPage` by the selection, so picking a watched stock remounts it and lands on
  分析內容 — which is the point of the click.
- Because the picker no longer lists watched stocks, `AnalysisPage` still needs the watchlist to
  RESOLVE a selection (name, and whether the key is valid) — it just does not render it in the menu.
- **Selection resolution order** (both halves of it were review BLOCKERs before they were pinned
  here): matching holding **by ticker** → matching entry in the loaded watchlist → the
  `{ticker, name}` handed over by the tab → first holding → first watched → null.
  - Holdings win regardless of the key's prefix: a stock you hold is a holding, and the watchlist
    is only how you found it. Resolving a `watch:` key without checking holdings stripped qty and
    cost from a stock the user had bought after watching it.
  - `WatchTab` reports every successful add and remove upward (`onChanged`), `AnalysisPage`
    re-reads the list and clears the handed-over entry. Two unsynchronised copies let a removed
    stock stay on screen indefinitely.
- `×` calls `removeWatch(ticker)` and refreshes the section in place. No confirm dialog — it is
  reversible in two clicks and a confirm on every row is worse.
- Empty state: `還沒有觀察標的` + the same `＋ 加入觀察` button. The section always renders, so the
  feature is discoverable before it holds anything.
- At `WATCHLIST_MAX`, `＋ 加入觀察` is disabled and says why.

### 2. `AddWatchModal` — replaces `WatchlistPanel`

`WatchlistPanel.tsx` and its test are DELETED. The new modal does one thing: add.

- Uses the shared `Modal` (`components/Common/Modal.tsx`). Title `加入觀察`, and the count `N/30`
  in the modal head.
- The search input is FIRST, uses the app's normal input styling (the 0.8.0 one was a bare
  unstyled `<input>`, the single most obvious "half-finished" tell). Autofocus on open.
- Results below the input: `symbol` prefix (case-insensitive) or `name` substring, source order,
  already-watched excluded. Empty query shows nothing.
- Clicking a result adds it, closes the modal, and the new row appears in 庫存總覽.
- Errors render inside the modal and never close it.

### 3. `WhatIfTab` — one sentence, one answer

Layout, in this order:

```
若我在 [ 買進價 ] 買進 [ 股數 ] 股，並在 [ 賣出價 ] 賣出
                                       預設：現價 24.20

    損益  +NT$1,660          報酬率  +6.85%

    成本 NT$24,234 · 賣出可得 NT$25,894
    手續費 34+36 · 證交稅 78 · 回本價 24.35
```

- **賣出價 becomes a real input**, defaulting to the current quote. In 0.8.0 the exit price was an
  invisible assumption, so 「買 24.2 / 賣 24.2 / 虧 140」 read as a broken number.
- 損益 and 報酬率 are the only large numbers. Cost, proceeds, fees, tax and break-even collapse to
  two small lines.
- Gain/loss colouring keeps `pnlClass` (project convention: red = gain, green = loss).
- `whatIf()` in `whatIf.ts` gains nothing but a caller-supplied sell price — it already takes
  `price`; the tab simply stops hardcoding it from the quote. **No fee maths changes.**
- Still persists nothing.

### 4. `AnalysisPage`

- The `管理觀察` button stays removed.
- **The picker lists holdings only** — no 持股 / 觀察 group headers, back to a flat list. A watched
  stock can still be the current selection (its name shows on the trigger); it is simply not
  reachable from the menu.
- With no TW holding at all, the page must still render so the 觀察股票 tab is reachable — the
  empty state may no longer be a dead end.

## Files

| File | Action |
| ---- | ---- |
| `sources/src/components/StockDetail/WatchTab.tsx` | new (was `Dashboard/WatchSection.tsx`) |
| `sources/src/components/StockDetail/StockDetailPage.tsx` | 4th tab + `onSelectTicker` |
| `sources/src/components/Dashboard/WatchSection.tsx` | delete |
| `sources/src/components/Dashboard/DashboardPage.tsx` | revert to pre-0.9.0 |
| `sources/src/components/AppShell.tsx` | revert to pre-0.9.0 |
| `sources/src/components/StockDetail/AddWatchModal.tsx` | new (replaces WatchlistPanel) |
| `sources/src/components/StockDetail/WatchlistPanel.tsx` | delete (with its test) |
| `sources/src/components/StockDetail/WhatIfTab.tsx` | rewrite the layout |
| `sources/src/components/StockDetail/AnalysisPage.tsx` | drop the 管理觀察 button |

Unchanged: `watchlistService.ts`, `whatIf.ts`, `schema.sql`, everything under
`sources/supabase/functions/`.

## Test charter

| Case | Expected outcome | Layer / file |
| ---- | ---- | ---- |
| 觀察中區塊恆常渲染 | 空清單時仍出現，含加入鈕 | `WatchSection.test.tsx` |
| 數量顯示 | 標題出現 `N/30` | `WatchSection.test.tsx` |
| 現價批次取得 | 一次 `fetchPrices`，涵蓋所有觀察代號 | `WatchSection.test.tsx` |
| 取不到報價 | 顯示 `—`，不出現 NaN | `WatchSection.test.tsx` |
| 移除 | 呼叫 `removeWatch` 並就地更新 | `WatchSection.test.tsx` |
| 已滿 30 檔 | 加入鈕停用並說明 | `WatchSection.test.tsx` |
| 加入對話框 | 搜尋在最上、有樣式、標題帶 `N/30` | `AddWatchModal.test.tsx` |
| 加入後關閉 | 呼叫 `addWatch` 並關閉 | `AddWatchModal.test.tsx` |
| 加入失敗 | 訊息留在對話框內，不關閉 | `AddWatchModal.test.tsx` |
| 賣出價可輸入 | 預設帶現價，改動後數字跟著變 | `WhatIfTab.test.tsx` |
| 沒有現價 | 賣出價空白，提示輸入，不算出 NaN | `WhatIfTab.test.tsx` |
| 主數字 | 損益與報酬率存在且與 `whatIf()` 同值 | `WhatIfTab.test.tsx` |
| 分析頁不再有管理觀察 | 該按鈕不存在 | `AnalysisPage.test.tsx` |
| 版面（瀏覽器） | 對話框 bounding box 在 viewport 內 | `scripts/verify-watchlist-e2e.cjs` |

## Verify

```bash
# from sources/
npx vitest run
npx tsc --noEmit
npm run build            # broader type check than tsc --noEmit; covers test files
npx oxlint src
node scripts/verify-watchlist-e2e.cjs    # with npm run dev running, DEV only
```

The browser step is not optional. jsdom has no layout, which is exactly how 0.8.0 shipped a
feature that passed 1058 tests and did not work — see `docs/UnitTests/E2E.md`.

## Non-goals

- No schema change, no Edge deploy.
- No reorder / drag-and-drop.
- No change to the fee, tax or break-even maths.
- No new nav tab.
