# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 step 2g — admin schedule removed, send times fully per-account; one spacing rhythm
- Status: ✅ **0.9.60-dev.4 on `dev` (not yet committed/pushed); DEV Supabase unchanged — no schema, Edge or cron change in this step**
- Timestamp: 2026-09-21 15:24:09 Asia/Taipei

---

## 📅 Log: 2026-09-21 15:24:09 Asia/Taipei (Task 165 step 2g, 0.9.60-dev.4)

**發送時間全部下放各帳號，並把設定頁的三套間距收成一套。** 使用者回報兩件事：自助頁改的發送時間「和後台不同步」，以及框框之間太黏。Spec: `docs/agent/specs/discord-admin-slim.md`。

- **「不同步」查證結果不是同步失敗，是後台沒有那一欄。** 兩個頁面本來就寫不同儲存體：後台排程寫 `cron.job`，自助頁三個下拉寫 `user_discord_settings.*_time`；讀取端 `accountTick.ts` 的 `dueAt` 用 `row.time ?? global.time` 合流，繼承是對的。DEV 實測帳號 `9b0b5368` 的 `holdings_time = '18:00'` 已正確寫入，但後台「各帳號狀態」只有四欄（帳號／經濟快報／個人持股／最近發送），那個值在後台是隱形的。
- **決策（user, 2026-09-21）**：後台只保留全域經濟快報 Webhook 與各帳號唯讀狀態清單，時間與個人設定全部下放。`ScheduleSection` 與 `GlobalScheduleBlock` 自 `DiscordSection.tsx` 刪除。
- **Edge op 與 client 保留**（D2，沿用 §R7 前例）：`discord_schedule_set`、`discord-accounts` 的 `set-schedule`、`saveDiscordSchedule()` 都不動，只移除 UI。刪掉要連帶刪一批通過的測試，換不到使用者看得到的好處。代價是全域 17:30／21:30 之後只能由資料庫端調整。
- **「跟隨全域」改為「預設（HH:MM）」**（D4）：後台已無「全域」設定畫面，舊名稱指向一個使用者到不了的地方。解析出來的時間照舊顯示。
- **間距：Playwright 實測而非目測。** 載入跑在 5173 的真實 `index.css`、注入該頁真實 DOM 量 1440px 下的相鄰元素距離。修前：`ai-form-group → ai-actions` 是 **0px**（網址框與按鈕列貼死），其餘 12px／14px／16px 三種混用。原因是 `.ai-form-group` 與 `.ai-actions` 兩者都沒有 margin，平常靠 `.ai-form` 的 gap 撐開，而這個面板不是 `.ai-form`。修後：區塊內一律 12px、區塊之間 24px。
- **`.hint` 的修正刻意只作用在 `.dsc-block` 內**（D6）：`.hint` 全站用了 109 次、跨 25 個檔案，而 `index.css` 裡**沒有任何 `.hint` 基礎規則**——它一直是瀏覽器預設 `<p>`（14px 正文、14px 合併邊距）。給它全域規則會重新排版整個 app，所以只移除這個面板內的 margin，字級與顏色不動。
- **三個時間下拉改為同一左緣**（D7）：`.dsc-schedule-row > span` 固定 112px；原本三個 label 三種寬度，select 起始位置跟著參差。
- **測試由主 session 先寫成紅的再派工**：`DiscordSection.test.tsx` 刪掉整個「發送排程」describe（5 條）與其 fixture，新增一條反向斷言（無排程標題、無「儲存排程」、無兩個時間 label、`<select>` 數量為 0）；`DiscordMySettings.test.tsx` 新增 2 條（繼承選項須為「預設（17:30）」／「預設（21:30）」，且任何選項文字不得含「全域」；全域時間為 null 時須為「預設（尚未設定）」）。派工前 3 failed / 31 passed。
- **Verify**：`npx vitest run` 2,569 passed / 7 skipped / 0 failed（150 檔通過、1 檔 skipped）；`npm run build`、`npm run lint` 皆 exit 0。
- **未做**：尚未 commit、未推送；DEV 與 PROD 的 Supabase 完全未動（本步驟沒有 schema、Edge 或 cron 變更）。

---

## 📅 Log: 2026-09-21 14:50:47 Asia/Taipei (Task 165 step 2f, 0.9.60-dev.3)

**各帳號可自訂 Discord 發送時間。** 原本三個固定 pg_cron job 代表全站只有兩個時間；改成一個每 30 分鐘的 tick，每次醒來問「這個半點有哪些帳號該發」。Spec: `docs/agent/specs/discord-account-schedule.md`。

- **資料模型**：`user_discord_settings` 新增 `market_brief_time` / `market_full_time` / `holdings_time`，皆可為 NULL＝跟隨全域。三個欄位而非兩個，是為了讓每個下拉選單待在所屬區塊（經濟快報有兩版，持股一版）。個人持股繼承的是**快報**時間，不是完整版。CHECK 只驗 `'HH:MM'` 形狀，允許窗格由 Edge 以 `SCHEDULE_OPTIONS` 再驗一次，維持單一定義來源。
- **cron**：新增 `discord-account-tick`（`0,30 9-15 * * 1-5` UTC＝台北 17:00–23:30），退役 `discord-holdings-daily`；`discord_schedule_set` 改為只調整兩個 job，`holdingsAligned` 概念消失。全域 brief/full job 不再夾帶各帳號副本。
- **exactly-once 是新增的保護，不是改名**：`finishDiscordMarketOverride` 原本直接 INSERT 一筆完成狀態、沒有先 claim，這在一天跑一次的 job 下安全，但 tick 每 30 分鐘會醒來、有機會和自己競爭。改成 `claimMarketCopy` → post → `finishMarketCopy`（UPDATE 已 claim 的那筆），並新增 `market-brief` / `market-full` 兩個 partial unique index。
- **`dueAt` 是純函式**，整條繼承規則集中在這裡。其中一條規則單獨寫了測試：全域時間為 NULL（cron job 不存在）時，繼承的帳號必須是「不發」而非「每個 tick 都發」。
- **行為變化（D6）**：各帳號副本在該帳號選定的時間才建構內容，不再是全域那份的副本。選 22:30 的人拿到 22:30 當下的數據，與全域 21:30 那份會有些微差異。
- **測試修復（28 個失敗全部是我方 fixture）**：`discordRunMarket.test.ts` 整檔刪除（它測的是 D4 已移除的行為），覆蓋範圍改寫進 `accountTick.test.ts`（20 條：16 條 `dueAt`、4 條 tick 行為，含「claim 必須早於 post」的呼叫順序斷言與「payload 物件同一性」）；`discordRun.test.ts` 新增「只發全域」；`discordSchedule.test.ts` / `discordAccounts.test.ts` / `DiscordSection.test.tsx` 移除 `holdingsAligned`；`discordMySettings.test.ts` 補 deps 並新增 7 條 `set-times` 測試。
- **四度出現的同一模式**：builder 再次把新欄位設成 optional（`market.briefTime?`、`holdings.time?`、`globalSchedule?`、`ScheduleView.holdingsAligned?`）以讓舊 fixture 編得過，已全部改回必填。在此 spec 下「欄位缺席」與「值為 null」語意不同（後者＝跟隨全域，前者＝序列化漏掉），執行期卻長得一樣。
- **Verify**：`npx vitest run` 2,571 passed / 7 skipped / 0 failed；`npm run build`、`npm run lint`、`npm run typecheck:edge` 皆 exit 0。
- 同批併入：管理後台各帳號表格改為固定欄寬（原本帳號欄吃掉所有剩餘寬度，其餘三欄擠成一團），列高 40→44px，並刪除 7 個失去使用者的 dead CSS 類別。