# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Task 197 on `dev`** — 損益試算 gains 攤平試算 (補進 column, before/after table, target-average solver).
- Status: ✅ `dev` = 0.10.35-dev.1; `main` still 0.10.34. Left: release when the user OKs it; check on a real held stock.
- Timestamp: 2026-10-07 09:47:34 Asia/Taipei

---

## 📅 Log: 2026-10-07 09:47:34 Asia/Taipei (Task 197 — 攤平試算 in 損益試算, 0.10.35-dev.1)
- **Ask**: 「在個股分析中心增一個功能…補幾張、什麼價格，平均成本會變多少，想要和損益試算整合」 → shape round (ledger 補進 column, both forward and target solve, single tranche) → 「依照你的建議直接進行開發，然後先合併上dev」.
- **Done**: `whatIf.ts` `averageDown` (moving-average, add-on fee at today's workspace rate and the add-on's own whole/odd minimum) and `sharesForTargetAvg` (closed-form seed, then every candidate re-checked through `averageDown`; `already` / `unreachable` when price × (1 + feeRate) is on the wrong side of the target). `WhatIfTab.tsx`: held stocks get 現有持股 / 補進 · 假設 / 合計 / 賣出 · 試算; with an add-on the base column locks to the real holding, and the sell side, ladder, marks and break-even price the merged position; 補進前後 table (均價含費, 回本價, 現價試算損益, 股數, 投入成本); 目標均價 row with a 帶入補進股數 button (never overwrites the add-on by itself). Watched stocks unchanged. `tables.css`: ledger cells styled by `is-key` / `col-sell` / `is-last` classes instead of nth-child; ≤ 560 px hides 合計 and stacks 股數 over 單位.
- **Verified**: vitest full 3,138 pass / 7 skipped (+13 new in `whatIf.test.ts` / `WhatIfTab.test.tsx`), `npm run build`, `typecheck:edge`. Temporary harness (deleted): 1280 px light/dark and 375 px with 2,000 sh @ 512.30 + 1 張 @ 480 → 合計 1,506,744, 均價 502.25, target 495 → 3 張. The 375 px page scrolls 61 px sideways in the harness both before and after the change (the ladder table; the harness has no app shell), so not attributed to this change.
- **Not verified**: a real held stock in the running app; a holding with fee-rounding `position` mode (the add-on fee floors per trade as `calculateFee` does).

## 📅 Log: 2026-10-06 20:50:02 Asia/Taipei (Task 196 — Discord headline split by workspace, 0.10.34)
- **Ask**: 「在DC推播的部分，未實現損益我想要拆開，不要合併在一起」 → demo string first → 「好，請幫我直接改，然後給我看demo 樣子」 → 「直接幫我合併到main」.
- **Done** `dd6414e` (0.10.34-dev.1) + `acd3fde` (release): `holdingsCard.ts` `grandTotalLine` → `workspaceTotalLine` + `headlineContent` (one `・<name>：台股 **±n**（pct）｜美股 …` line per workspace; single workspace unchanged; whole lines dropped from the end to stay ≤ 2,000 chars, `…另 N 個工作區`). `card.total` is no longer read by the payload but kept (still computed and tested in `aggregateCard`).
- **Verified**: real `buildHoldingsPayload` on the screenshot's figures printed the intended 4-line content; `stock-report` vitest 998 pass; full `npm test` 3,124 pass / 7 skipped (the first full run had one SectorFlowPage failure — passed alone with and without the change, and on the rerun), build, `typecheck:edge`. DEV `stock-report` v55 `f1c09b7bc978` → v56 `2313613a94c8`, verify_jwt false kept. Release body read back from GitHub.
- **PROD deploy** (2026-10-06 21:12:50 Asia/Taipei, user ran it with `!` after the auto-mode classifier denied the agent's own PROD deploy): `stock-report` v31 `f1c09b7bc978` → v32 `2313613a94c8` (= DEV v56), `--no-verify-jwt`, verify_jwt false confirmed by `functions list`.
- **Not verified**: a real Discord post with the new headline (a send needs `CRON_SECRET` or the admin preview).
