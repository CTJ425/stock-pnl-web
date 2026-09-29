# Active Bug Fixes & Accepted Risks (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-09-21 15:52:00 Asia/Taipei

---

## 🐛 Open / Active Issues & Accepted Risks

### BUG-088 — 元大 rounds sell fee/tax on the whole position, 玉山 per lot; the dashboard only does per lot
- **Found**: 2026-09-29. PROD workspace Ron的投資組合 (元大 account): 2303 two lots (1,000 @163.5 + 1,000 @160, cost 323,637), price 153.5, 牌告 basis. 元大 −17,995 = 307,000 − floor(307,000 × 0.1425%) 437 − 921 − 323,637; dashboard −17,993 = per-lot fee 218 + 218, tax 460 + 460.
- **History**: 0.9.0–0.9.24 floored on the aggregate (would match 元大). e120041 (0.9.25, Task 136, 2026-09-01) switched to per-lot flooring to match 玉山 (0050 four lots: 10,770 per lot vs 10,767 aggregate). 玉山 still matches per lot (2026-09-29: 0050 five lots sum 49,555 = dashboard). One rule cannot match both brokers; the gap is ≤ 1 TWD per open lot per term.
- **Fix (0.10.5-dev.1, 8b56632, DEV only)**: `workspaces.fee_rounding` ('lot' | 'position', NULL = 'lot') set in 手續費設定 「分批買進時，預扣的費用怎麼算」; optional `rounding` param on `estimateUnrealized` / `breakEvenPrice` / `buildHoldingRows`, default 'lot' is the old arithmetic unchanged. Not applied: what-if (single synthetic lot), Edge holdings card (engine copy synced, callers still per lot).
- **Verified**: PROD data recompute — Ron 2303 list basis −17,995 with 'position' (= 元大); 玉山 stays 'lot', 0050 49,555 (= 玉山; 'position' would give 49,552). DEV browser (session via admin magic link): row detail 牌告 0.1425% −17,995 / −5.56%; panel checked 1440 / 390 (no overflow), light / dark. DDL applied on DEV only; `stock-report` redeployed on DEV (v32, sha `58e94285…`, verify_jwt false) because the engine copy changed.
- **0.10.5-dev.2 (58dee12)**: fee settings preview on the dashboard (`onPreview` → unsaved rate / rebate / rounding recompute every figure, tag 預覽・尚未儲存, 取消 restores); E2E `scripts/verify-pnl-rounding-e2e.cjs` (new buy / sell through the form, oracle written independently of the engine, preview / 取消 / 儲存) — 7/7 pass on 2026-09-29.
- **Before PROD**: apply the `fee_rounding` DDL on PROD, merge to `main`, deploy `stock-report` on PROD, then set Ron的投資組合 to 整筆 in the UI (user's choice).
- **Status**: Front end released in 0.10.5 (`main` 4dd8fe1). PROD `stock-report` deployed 2026-09-29 16:33:02 from clean `main` 9167a40: v19 → v20, ezbr `27ef30af…` → `58e94285…` (= DEV v32), verify_jwt false, POST `{}` → 400 Unknown action. PROD `fee_rounding` DDL applied 2026-09-29 16:36:13 after the user re-authorized (Management API, identity guard in the DO block; first attempt had been denied by the permission classifier): check → is_prod true, is_dev false, text, CHECK lot|position, 0 rows set; PROD REST `select=fee_rounding` → 200 (control column → 400); `verify.sql` reinstalled, `verify_setup()` 10/10 PASS. Remaining: user sets Ron的投資組合 to 整筆 in the UI (their choice).

---

### BUG-087 — Same-day buy: broker (玉山) unrealized P&L / break-even differ from the dashboard
- **Found**: 2026-09-29, reported by the user on PROD. 6560 欣普羅 bought 2026-09-29, 32.6 × 1000, fee_tax 46, fee_rate 0.001425 (standard); close 32.40.
- **Numbers**: dashboard −389 / −1.19% / break-even 32.79; broker −340 / −1.04% / break-even 32.75. 0050 and 2303 (held overnight) match the broker; broker total 49,423 (dashboard total not yet confirmed; 49,374 expected if this is the only gap).
- **Analysis**: dashboard = 32,400 − 32,646 − fee 46 − tax 97 (0.3%). Only a 0.15% tax (48) reproduces both broker numbers exactly: −340, and break-even 32.75 (lowest cent price covering cost with floored fee/tax: 32.74 nets 32,645, 32.75 nets 32,655; at 0.3% the same search gives 32.79). With 0.3% the best case is −343 even at zero sell fee. Hypothesis: the broker estimates a same-day buy at the 現股當沖 rate. `estimateUnrealized` (`pnlEngine.ts:917`) and `breakEvenPrice` have always used `sellTaxRate` (0.3%) since 58a1a42; no commit since changed it. E.SUN publishes no rule for this; not confirmed.
- **Confirmed by broker screenshots (2026-09-29 14:46)**: E.SUN 庫存損益 明細 shows 6560 預估收入 32,306 = 32,400 − 46 − **48** (0.15% tax) while 2303 shows 305,642 = 307,000 − 437 − **921** (0.3%) on the same screen. Everything else equals PROD: total cost 1,176,770, total market value 1,229,800, 0050 five lots net 49,555, 2303 208 / break-even 153.4. So the broker applies the 現股當沖 rate to a lot bought today only.
- **6560 has no special status (checked 2026-09-29)**: absent from TPEx OpenAPI `tpex_trading_warning_information`, `tpex_trading_warning_note`, `tpex_disposal_information`, `tpex_intraday_trading_pre`, `tpex_intraday_trading_his` (data dated 1150924; 9/25 and 9/28 were holidays). Ordinary TPEx common stock; no per-stock or small-cap tax relief exists — the only 0.15% is 現股當沖 (listed and OTC, to 2027-12-31).
- **User position**: before, same-day buys always matched the broker 100%; asked for a full review of the P&L core.
- **Historical recompute (2026-09-29)**: every release tag 0.9.0 (2026-08-19) → 0.10.4 (78 tags), each with its own `computeLedger` / `estimateUnrealized` / `breakEvenPrice` in a detached worktree, gives the identical result for this trade: cost 32,646, unrealized −389, break-even 32.79. No version ever produced −340 / 32.75, so the gap is not a regression in this repo. Script: session scratchpad `hist.sh` (worktree per tag, symlinked `node_modules`, result written to a file because vitest swallows `console.log`).
- **Next**: check the broker's 6560 break-even on 2026-09-30 (price-independent: 32.79, equal to the dashboard, confirms the hypothesis). Then decide whether same-day lots use 0.15%. Break-even is cent-level at the broker too (user: 0050 105.1 and 2303 153.4 match) — no tick rounding needed.
- **Status**: OPEN (awaiting user check)

---

### RISK-021 — Daily and intraday series caches survive an account switch
- **Where**: `sources/src/services/dailyProxy.ts`, `sources/src/services/intradayProxy.ts`
- **Risk**: both in-memory caches carry an LRU cap (PR-03) but, unlike `warmStock.ts`, have no `onAuthStateChange` reset. After a sign-out and sign-in as another user on the same tab, cached series can be shown until their TTL expires (dailyProxy 300 s).
- **Why accepted**: the cached data is public market data from the reports bucket and the stock-price Edge Function, not user-scoped rows, so nothing private leaks; the only effect is a few minutes of possibly stale display. Found by the Task 166 batch 4 review, 2026-09-23.
- **Status**: ACCEPTED (Task 166 batch 4, 0.9.66)

---

### RISK-020 — Nothing in the admin console reports a missing Discord cron schedule
- **Where**: `sources/src/components/Admin/DiscordSection.tsx` (the deleted `ScheduleSection`), `sources/src/components/Settings/DiscordMySettings.tsx:69`
- **Risk**: when `discord-summary-brief` / `discord-summary-full` are absent from `cron.job`, `scheduleFromJobs` yields `{brief: null, full: null}` and every inheriting account silently stops receiving (`dueAt` treats a null global time as not-due, by design). The deleted `ScheduleSection` was the only surface that said so, with 「找不到 Discord 排程工作，無法調整。」. What remains is `預設（尚未設定）` on each account's own drop-down — per-account, per-slot, and visible only to a signed-in user looking at their own settings. No admin-facing surface reports it.
- **Why accepted**: the schedule editor was removed on purpose (spec `discord-admin-slim.md` D1, user decision 2026-09-21); re-adding an alert would re-add a schedule surface to the console. The failure mode requires the cron jobs to be deleted, which now only happens by hand at the database. Found by the step-2g review, 2026-09-21.
- **Status**: ACCEPTED (Task 165 step 2g)

---

### RISK-019 — `DiscordAccountsSnapshot.schedule` is computed and sent but never read
- **Where**: `sources/src/services/discordAccounts.ts:38`, produced at `sources/supabase/functions/stock-report/discordAccounts.ts:72-78` (`snapshot()`), returned on every `discord-accounts` op
- **Risk**: a field written but never read. `DiscordAccountsSection.tsx` is the only remaining caller of `getDiscordAccounts()` and destructures `data.accounts` only. A future change to the schedule shape would compile clean while silently breaking nothing — and would equally hide a real break.
- **Why accepted**: spec `discord-admin-slim.md` D2 deliberately keeps the whole `set-schedule` path (Edge op, `discord_schedule_set`, `saveDiscordSchedule()`) so the global times stay changeable from the database side; `snapshot()` is shared by every op of that path and pruning the field means editing the ops and their tests for no user-visible gain. Found by the step-2g review, 2026-09-21.
- **Status**: ACCEPTED (Task 165 step 2g)

---

### RISK-018 — `DEFAULT_DISCORD_SCHEDULE` has no runtime caller
- **Where**: `sources/supabase/functions/stock-report/discordSchedule.ts:16`
- **Risk**: its only production reader was `DiscordSection.tsx`'s deleted `GlobalScheduleBlock`. Only `discordSchedule.test.ts` references it now, so the constant can drift away from the times the cron jobs actually carry without anything failing.
- **Why accepted**: it is the written definition of the two global defaults, and the tests assert it stays inside `SCHEDULE_OPTIONS`, which is the invariant worth keeping. Annotated as such in the source (commit `0418d70`). Found by the step-2g review, 2026-09-21.
- **Status**: ACCEPTED (Task 165 step 2g)

---

### RISK-017 — Discord holdings settings ops are check-then-act, not atomic
- **Where**: `sources/supabase/functions/stock-report/holdingsRun.ts` (`runHoldingsSettingsOp`: quota check before `finish`; `enable` reads the webhook before `setEnabled`)
- **Risk**: two concurrent `test`/`preview` calls from one user (two tabs) can both pass the 10-per-day check; an `enable` racing a `clear` can leave `enabled = true` with `webhook_url = null`, so the panel shows 已開啟 while 未設定.
- **Why accepted**: the quota overrun is a few extra messages to the user's own webhook; the daily run filters `webhook_url is not null`, so the inconsistent row never sends. Found by the step-2c review, 2026-09-17.
- **Status**: ACCEPTED (Task 165 Phase 2)

---

### RISK-016 — Discord holdings run fetches every held ticker at once
- **Where**: `sources/supabase/functions/stock-report/holdingsRun.ts` (`Promise.all` over a user's keys), `holdingQuotes.ts` (`createQuoteCache`, `makeChartFetch`)
- **Risk**: a user with many distinct tickers sends a burst of simultaneous Yahoo chart requests (TW tickers up to two symbols each); Yahoo may rate-limit the burst.
- **Mitigation in place**: 429 and 5xx get one retry after 500 ms; a failed ticker shows `--` and is left out of the totals, and the footer counts it.
- **Why accepted**: holdings per user are small today. Revisit with a concurrency cap if the send log shows rows with many missing quotes. Found by the step-2c review, 2026-09-17.
- **Status**: ACCEPTED (Task 165 Phase 2)

---

### RISK-015 — A Discord holdings run killed mid-user leaves that user `claimed` for the day
- **Where**: `sources/supabase/functions/stock-report/holdingsRun.ts` (`runHoldingsDaily`), `sources/supabase/schema.sql` §14 (`user_discord_send_log_once`)
- **Risk**: the budget is checked only before a user starts. If the Edge invocation is killed while a user is in flight, their `daily` row stays `claimed`, the partial unique index blocks any rerun that day, and they miss the card. Users not started before the budget ran out (`leftOver`) are not retried either.
- **Mitigation in place**: `HOLDINGS_RUN_BUDGET_MS` lowered from 110 s to 80 s, so one worst-case user (≈33 s quotes + ≈30 s `postDiscordWebhook`) still ends before the 150 s limit.
- **Why accepted**: few enabled users today; a stale-claim reclaim or a second cron pass is future work if `leftOver` or stuck `claimed` rows appear. Found by the step-2c review, 2026-09-17.
- **Status**: ACCEPTED (Task 165 Phase 2)

---

### RISK-014 — Discord summary: a delivered message can leave its log row stuck in `claimed`
- **Where**: `sources/supabase/functions/stock-report/discordRun.ts` (`runDiscordSummary`: post → `finishSend`), `sources/supabase/functions/stock-report/index.ts` (`finishDiscordSend`), `sources/supabase/schema.sql` (index `discord_send_log_once`)
- **Failure scenario**: if the Discord post succeeds and the following `finishSend` update fails (transient DB error), the row stays `claimed`. The partial unique index then blocks any retry for that day and edition, and the admin console shows 處理中 for a message that was actually delivered. Separately, `runDiscordSummary` awaits `deps.log` without a catch; the real `logEvent` never rejects (`_shared/log.ts`), so this only matters if that contract changes.
- **Found**: 2026-09-17, Task 165 review.
- **Decision**: accepted — a stuck claim prevents a duplicate post, which is the worse failure in a shared channel. If it ever happens, fix the one row by hand (set `status` to `sent`).
- **Status**: OPEN (accepted)

---

### RISK-012 — `scripts/backup-download.cjs` 的 `--dest` 不設路徑邊界
- **Where**: `sources/scripts/backup-download.cjs`
- **Failure scenario**: `--dest=../../..` 之類的值會把備份檔寫到預期以外的目錄。
- **Found**: 2026-09-14, Task 144-4 reviewer 第二輪。
- **Decision**: 不加沙箱。執行這支腳本的人本來就持有 service role key，對他設權限邊界是假安全。改為以 `path.resolve()` 正規化，並在寫入任何檔案前印出絕對路徑，以可見性取代邊界。
- **Status**: OPEN（已接受，設計如此）

---

### BUG-084 — Stale per-workspace 最低手續費 in localStorage still drives estimates, with no UI to see or change it
- **Where**: `sources/src/utils/settings.ts` (`getMinFee`), `sources/src/utils/holdingRows.ts:80-81,119-121`
- **Root Cause Analysis**:
  1. From `046abd9` (2026-07-18) until `39a20e2` (0.9.24-dev.1, 2026-08-31) the transaction form persisted the typed 最低手續費 into `localStorage` (`stock-pnl-web/min-fee-whole|odd/<workspaceId>`) on every change.
  2. `39a20e2` removed that write-back, but nothing clears the old keys and `getMinFee` still reads them first. No UI shows or edits a workspace minimum fee (the AppShell fee dialog only handles the rate).
  3. A browser that typed a minimum fee in that window keeps using it for unrealized P&L and break-even on small positions and odd lots; another device, and the server-side Discord holdings card (Task 165 Phase 2), use the defaults 20 / 1.
- **Impact**: at most the gap between the stale and the default minimum fee per row, only where the estimated sell fee equals the minimum.
- **Status**: OPEN — found 2026-09-17 while checking docs/agent/specs/discord-holdings.md; accepted for Task 165 Phase 2 pending a user decision (clear the legacy keys, or persist minimum fees to `workspaces`).

---

### BUG-079 — 保本賣出價 and 淨收 read the same fee rate differently
- **Where**: `sources/src/utils/holdingRows.ts`, `sources/src/utils/fees.ts`, `sources/src/utils/pnlEngine.ts`
- **Root Cause Analysis**:
  1. `estimateUnrealized` (`pnlEngine.ts:861-865`) calculates unrealized P&L (and therefore `netMktVal = cost + unrealized`) using the fee rate recorded on individual lots (`lot.feeRate` from `holding.openLots`, which defaults to historical statutory rate ~0.001425 or inferred discount).
  2. In contrast, `breakEvenPrice` (`fees.ts:184-194`) receives the current workspace-level `feeRate` and does not consult `openLots`. It computes candidate breakeven via `cost / (qty * (1 - feeRate - taxRate))` and checks `isBreakEven(p)` using `feeRate`.
  3. When a user mistakenly enters `0.6` as a workspace fee rate (intended as 6 折 / 60% of statutory fee, see Task 159 D2), `breakEvenPrice` interprets it as a literal 60% fee rate (denominator `1 - 0.6 - 0.003 = 0.397`), making breakeven price ~2.52× cost basis. Meanwhile, `estimateUnrealized` for existing positions continues evaluating against `lot.feeRate` (~0.000855 or 0.001425), deducting only ~0.39% for fees+tax.
- **Status**: OPEN (Root cause identified; UI input formatting addressed in Task 159 D2, calculation alignment tracked for future remediation)

---

### RISK-010 — 台股清單來源被上游截斷但仍非空時，兩端都會視為完整
- **Where**: `sources/supabase/functions/stock-price/twList.ts`、`sources/src/services/twMarketData.ts`
- **Failure scenario**: BUG-075 與 BUG-076 的完整性檢查判斷的是「此來源有沒有給出結構有效的列」，不是「給的列數對不對」。若 TWSE 或 TPEx 上游改動導致回傳 20 筆而非約 2000 筆，兩端都會判定完整並快取 30 分鐘。
- **Decision**: 不修。目前兩個 OpenAPI 端點都不分頁，沒有證據顯示會發生截斷；要防這種情況必須設一個筆數下限門檻，而該門檻會在上市櫃家數變動時誤判，代價高於效益。
- **Status**: OPEN（已知風險，理論性）

---

### RISK-009 — 加入觀察的「還有 N 筆」計數包含已加入、不可點的項目
- **Where**: `sources/src/components/StockDetail/AddWatchModal.tsx`
- **Failure scenario**: BUG-074 之後已加入的項目不再被濾掉，因此 `matches.length` 會把它們算進去。查詢範圍很廣且總筆數超過 `RESULT_CAP`（50）時，「還有 N 筆，請輸入更完整的關鍵字」的 N 會包含使用者本來就不能加入的列。
- **Decision**: 不修。那些確實是符合條件的列，計數本身沒有錯，只是其中部分不可點；影響輕微，不值得為此增加程式碼。
- **Status**: OPEN（已接受，不修）

---

### AUDIT-10 — CSV 匯入把「以點為千分位」的數字少算 1000 倍且不報錯
- **Where**: `sources/src/utils/csv.ts` (`parseNumber`)
- **Failure scenario**: 交易單價為 `"2.500"`（特定來源可能代表 2500）解析為 `2.5`，通過 `price > 0` 驗證，少算 1000 倍。
- **Decision**: 使用者於 2026-09-04 決定**不改程式**，記為可接受風險。「2.500」在台股與美股都可能是合法的 2.5 元，加規則拒絕它會擋掉正常匯入；多組點號（如「1.234.567」）已是 `NaN` 會報錯。
- **Status**: OPEN（已接受，不修）

---

### RISK-006 — 7 個 `action` 名稱指向模組私有函式，而非公開進入點
- **Where**: `sources/src/services/aiChatStore.ts:48`、`priceProxy.ts:121,188,206`、`twMarketData.ts:49,58,135`
- **What**: Spec 146 要求 `logClient` 的 `action` 使用「所在的 exported 函式名稱」。實際落在 `safeSession`、`writePriceCache`、`fetchFromEdge`、`fetchTwFallback`、`readCache`、`writeCache`、`fetchViaEdge` 這 7 個模組私有函式。
- **Decision**: 本次不改。這些名稱在專案內唯一且可 grep，直接指出快取讀取/寫入或 Edge 失敗點。日後若需按公開操作統計，再引入獨立 `operation` 欄位。
- **Status**: OPEN（低嚴重度，已確認）

---

### RISK-007 — `syncWorkspaceFees` 的 catch 位於迴圈內
- **Where**: `sources/src/services/feeSettings.ts:19-24`，呼叫端 `sources/src/context/WorkspaceContext.tsx:97`
- **What**: catch 在 workspace 清單的 `for` 迴圈內。若多個 workspace 同時失敗，每次登入各寫一列 `app_log`。受 workspace 數量限制，且每次登入才觸發一輪，5 分鐘去重機制會吸收同次登入內的重複訊息。
- **Decision**: 本次不改。改動迴圈結構代價高於筆數影響。
- **Status**: OPEN（低嚴重度，已確認）

---


### RISK-004 — `addTransactions` silently drops `tx_nature` on pre-migration database
- **Where**: `sources/src/services/dataProvider.ts`
- **What**: 當資料庫缺少 `tx_nature` 欄位時，重試會省略該欄並回傳成功。目前兩環境皆已於 0.9.28 補齊欄位（無現行衝擊）。
- **Decision**: Accepted risk。若日後重新建立專案，需留心檢查 DDL 是否含此欄位。
- **Status**: OPEN (low severity, accepted)

---

### RISK-003 — Historical chip report files keep permanent "回補中" note
- **Where**: `sources/supabase/functions/stock-report/index.ts`
- **What**: 過去 6 天的回補檔案內嵌「歷史資料回補中…」備註且不再重寫。目前前端僅讀取最新 manifest.ymd，無現行衝擊。
- **Status**: OPEN (low severity, accepted)

---

### RISK-002 — Night batch cost scaling with watched stock count
- **Condition**: 觀察名單擴增時 batch 執行時間可能上升。目前監控 baseline 為 ~10.1 秒/次。
- **Trigger**: 使用者數或觀察名單顯著成長時再行評估。
- **Status**: OPEN (monitored)

---

### RISK — `breakEvenPrice` returns 0 for zero-cost holdings when `minFee` is undefined
- **Where**: `sources/src/utils/fees.ts:89-92`
- **Condition**: `cost === 0` AND `minFee === undefined`（非 TWD 持股可能觸發）。回傳 0 作為 sentinel。
- **Severity**: Low. Row 依然正常渲染。
- **Status**: OPEN (low severity)

---

### BUG-042 & BUG-043 — `dataProvider.ts` 重試與未知 id 處理
- **BUG-042**: `listWorkspaces` 退回重試吞掉第一次錯誤訊息（Accepted risk：專案生產代碼不留 console.error）。
- **BUG-043**: `LocalProvider.setWorkspaceFeeRate` 對未知 id 靜默成功（Accepted risk：與現有 renameWorkspace 一致）。
- **Status**: ACCEPTED RISK

---

## 🔒 Operational Security Notes

### Supabase Tokens & Secrets Rotation Checklist
- **Notice**: 歷史對話中曾數次出現貼入之 Personal Access Token 或 DEV `CRON_SECRET`（詳細歷程見 `FIXED_BUG.md`）。
- **Action for User**: 建議定期於 Supabase 控制台（Settings → Access Tokens）撤銷過期或已使用之 Token。
- **Standard Working Method**: 終端機登入請使用 `! supabase login` 互動提示字元輸入，避免 Token 進入對話紀錄。
