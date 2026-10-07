# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Task 197 on `dev`** — 損益試算 split into 賣出試算 / 補進試算 (0.10.35-dev.2).
- Status: ✅ `dev` = 0.10.35-dev.2 after push; `main` still 0.10.34. Left: DEV check with a real login; release on the user's OK.
- Timestamp: 2026-10-07 10:23:07 Asia/Taipei

---

## 📅 Log: 2026-10-07 10:23:07 Asia/Taipei (Task 197 — 損益試算 split into 賣出試算 / 補進試算, 0.10.35-dev.2)
- **Ask**: 「這樣畫面看起來很混亂，幫我拆成賣出試算跟補進試算，且補進試算要多一個漲跌%數」 → %: 「用 % 決定補進價」; layout 「輸入在上、結論卡、再明細」; link 「補進頁加一個按鈕」 → canvas mockup (artifact J7LrPnryNymAcHXD3g4AfQ) → 「先幫我改一版，然後commit到dev」.
- **Done**: `WhatIfTab.tsx` restored from `acd3fde` as `SellWhatIf` (+ `carried` prop: buy side locked, banner, 改回現有持股) under a new `WhatIfTab` that shows `subtabs` 賣出試算 / 補進試算 only for a held stock; both panels stay mounted (`hidden`). New `AddOnWhatIf.tsx`: price ↔ % linked (last-typed wins), base 現價 / 持有均價 (含費), chips -3/-5/-10/-15, `snapToTick` to the nearest order price; result block (補進後均價 hero, 需準備資金, 回本價), 補進前後 table, target solver, 用補進後部位試算賣出. `whatIf.ts` `snapToTick`: ETF bands (<50 0.01, ≥50 0.05; TWSE 營業細則, web-checked 2026-10-07); the 1,000+ band's move to 1 (approved 2026-08-25) is not in force before 2027-07, so not applied. `tables.css` ledger back to 0.10.34; new `.whatif-modes` / `.whatif-carried` / `.addon-*`.
- **Verified**: vitest 3,143 pass / 7 skipped, `npm run build`, `typecheck:edge`, oxlint. Temporary harness (deleted): 1280 light/dark, 390 phone — -5% → 473.50, 1 張 → 500.08 / NT$474,174 / 回本 502.31; target 495 → 2 張; carry → sell view 3,000 股, cost 1,500,234.
- **Noticed, not changed**: `priceLimits` (漲跌停 badge / chart lines) uses the stock tick bands for ETFs too.
- **Not verified**: DEV with a real login (item 3).

## 📅 Log: 2026-10-07 09:47:34 Asia/Taipei (Task 197 — 攤平試算 in 損益試算, 0.10.35-dev.1)
- **Ask**: 「在個股分析中心增一個功能…補幾張、什麼價格，平均成本會變多少，想要和損益試算整合」 → shape round (ledger 補進 column, both forward and target solve, single tranche) → 「依照你的建議直接進行開發，然後先合併上dev」.
- **Done**: `whatIf.ts` `averageDown` (moving-average, add-on fee at today's workspace rate and the add-on's own whole/odd minimum) and `sharesForTargetAvg` (closed-form seed, then every candidate re-checked through `averageDown`; `already` / `unreachable` when price × (1 + feeRate) is on the wrong side of the target). `WhatIfTab.tsx`: held stocks get 現有持股 / 補進 · 假設 / 合計 / 賣出 · 試算; with an add-on the base column locks to the real holding, and the sell side, ladder, marks and break-even price the merged position; 補進前後 table (均價含費, 回本價, 現價試算損益, 股數, 投入成本); 目標均價 row with a 帶入補進股數 button (never overwrites the add-on by itself). Watched stocks unchanged. `tables.css`: ledger cells styled by `is-key` / `col-sell` / `is-last` classes instead of nth-child; ≤ 560 px hides 合計 and stacks 股數 over 單位.
- **Verified**: vitest full 3,138 pass / 7 skipped (+13 new in `whatIf.test.ts` / `WhatIfTab.test.tsx`), `npm run build`, `typecheck:edge`. Temporary harness (deleted): 1280 px light/dark and 375 px with 2,000 sh @ 512.30 + 1 張 @ 480 → 合計 1,506,744, 均價 502.25, target 495 → 3 張. The 375 px page scrolls 61 px sideways in the harness both before and after the change (the ladder table; the harness has no app shell), so not attributed to this change.
- **Not verified**: a real held stock in the running app; a holding with fee-rounding `position` mode (the add-on fee floors per trade as `calculateFee` does).
