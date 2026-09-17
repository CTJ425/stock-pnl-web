# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 Phase 1 — Discord daily market summary implemented on `dev` (working tree, uncommitted, not deployed)
- Status: 🔄 **IMPLEMENTED, NOT COMMITTED** — DEV DDL / cron / Edge deploy await user approval
- Timestamp: 2026-09-17 13:51:06 Asia/Taipei

---

## 📅 Log: 2026-09-17 13:51:06 Asia/Taipei (Task 165 Phase 1, unversioned — `dev` working tree)

**What**: Market-wide after-hours summary posted to one admin-configured Discord webhook, weekdays 17:05 (brief) and 21:30 (full). Design decided with the user step by step; spec `docs/agent/specs/discord-daily-summary.md`. No per-user data (holdings summary is Phase 2).

**Changed**
- Edge (`stock-report`): new pure modules `discordUrl.ts`, `discordWebhook.ts`, `marketMargin.ts`, `globalIndexClose.ts`, `discordSummary.ts`, `discordRun.ts`; `index.ts` wires `discord-summary` (x-cron-secret) and `discord-webhook` (admin JWT). Neither is in `ADMIN_RUN_JOBS`.
- DDL (`schema.sql` §13): `app_secrets` (RLS on, no policies, revoked from anon/authenticated), `discord_send_log` + partial unique index `discord_send_log_once`, cron `discord-summary-brief` `5 9 * * 1-5` and `discord-summary-full` `30 13 * * 1-5`. `verify.sql` now expects 17 tables and checks RLS on both new ones.
- Snapshots: `SECRET_TABLES = ['public.app_secrets']` is always excluded, also under `--with-cache`; `discord_send_log` joins `CACHE_TABLES`.
- Admin console: new `Discord` panel (`DiscordSection.tsx`, `services/discordWebhook.ts`) — shows only the last 4 token characters; set / clear / test send; recent sends table.

**Data sources** (checked against real responses on 2026-09-17): `market/daily.json` (TAIEX + 三大法人); TWSE `MI_MARGN?selectType=MS` fetched at send time (market 融資融券 totals); Yahoo chart 1d/5d for 8 indices fetched at send time (last completed session only); `macro/us.json`; `fx/twd.json`.

**Review**: Edge modules PASS with 4 RISKs — 2 fixed (a null macro value rendered as 0; unsorted Yahoo bars), 2 accepted as RISK-014. Admin section FAIL, then fixed (rejections shown verbatim, one in-flight flag, 45 s invoke timeout, admin-console markup). Main session read the `index.ts` / `schema.sql` / `verify.sql` diffs and fixed a DB read error being reported as "not configured".

**Verification** (from `sources/`): `npm test` 136 files, 2174 passed / 7 skipped, exit 0; `npm run build` exit 0; `npm run typecheck:edge` exit 0. `node_modules` was missing and was restored with `npm ci`.

**Not done**: commit + version bump; apply §13 on DEV (clone an existing job's command so `CRON_SECRET` is never read); deploy `stock-report` to DEV with `--no-verify-jwt`; set the webhook in the DEV admin console and run 測試發送; PROD only after explicit OK.

---

## 📅 Log: 2026-09-16 10:10:00 Asia/Taipei (0.9.56, 總體經濟國際指數下鑽與走勢區間正式定版)

**Phase A 國際指數卡片強化**：
- `GlobalIndices` 新增台灣加權指數（`^TWII`）群組，置於第一順位。
- 每個市場群組標題顯示開收盤時間文字（`SESSION_HOURS`：台灣、日本、韓國、美國冬夏令時間）。
- 每張指數卡片顯示報價時間戳記（`asOf`，格式 `MM/DD HH:mm`）及盤中狀態標籤，無效或空值時回退為 `null`。
- 卡片支援點擊進入下鑽詳情頁（`IndexDetail`）。

**Phase B 指數下鑽詳情頁與 7 走勢區間**：
- 新增 `IndexDetail` 組件：包含返回按鈕、市場開盤時段條、當日 6 格統計帶與無成交量線的 `IntradayChart`。
- 新增 `indexTrend.ts`：提供 7 個走勢區間（`1d`、`5d`、`6m`、`ytd`、`1y`、`5y`、`all`，排除 `1m`），分流 intraday 與 daily 遠端資料。
- `dailyProxy.ts` 之 `fetchRemoteDaily` 新增 `market` 參數，快取鍵隔離為 `${market}:${ticker}:${range}`。
- 嚴格遵守負向規範：外盤指數不顯示三大法人、收盤統計或成交量。

**總體經濟次分頁重構與加權指數下鑽**：
- 總體經濟次分頁由「國際指數」（預設）與「美國經濟」組成。
- 加權指數點擊下鑽進入完整台股市場分析（`TwMarketSection` / `TwIndexToday`），提供 `onBack` 返回按鈕。

**大盤看板解耦、走勢圖恆常渲染與 Fallback**：
- 移除原本因無盤後歷史檔導致大盤看板被阻擋問題，`<TwIndexToday>` 常態渲染。
- `TwIndexToday` 解除走勢圖條件限制，永遠渲染 `<IntradayChart>`，保持 7 區間按鈕可點選。
- 支援開盤前即時報價 fallback（`TwIndexToday` 與 `IndexDetail` 同步支援傳入 `quote` 或 `fetchIndexQuotes`），避免開盤前大盤看板與詳情頁呈現全橫線或空狀態。
- 修復 `GlobalIndices` 匯出 `INDICES` 觸發的 Fast Refresh 警告，並以 `now` 狀態驅動 60 秒定時刷新確保休市時狀態標籤即時更新。

**驗證**：
- 129 檔測試檔 / 2,033 條測試全數通過（0 失敗）；`npm run build`、`npm test`、`npm run lint` 皆 exit 0。
