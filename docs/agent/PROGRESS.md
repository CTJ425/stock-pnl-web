# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 — 0.9.58 deployed to PROD (§14 + §15, holdings cron, `stock-report` v10)
- Status: ✅ **0.9.58 on `dev` and `main`, deployed to DEV and PROD** — next: watch one real 17:30 / 21:30 round on PROD
- Timestamp: 2026-09-18 15:46:22 Asia/Taipei

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

---

## 📅 Log: 2026-09-20 Asia/Taipei (Task 165 step 2e Revision 1, 0.9.60-dev.2)

**Discord 設定介面統一成一個頁面，並讓「繼承全域」變得看得懂。** 使用者反映兩件事：管理員後台有一套特權版的同樣介面，導致 admin 設定自己的 Discord 時看到的畫面和別人不一樣；以及全域已設定時，個別帳號仍顯示「目前：未設定（使用全域頻道）」，無法判斷自己到底收不收得到。

- **決策（user, 2026-09-20）**：所有帳號（含 admin）一律用同一個自助頁面；後台只保留全站設定——全域經濟快報 webhook 與發送排程；各帳號區塊改為唯讀清單；排程 UI 移到全域區塊；`discord-my-settings` 的 `get` 加回全域 webhook 狀態。Spec: `docs/agent/specs/discord-user-self-service.md` §Revision 1。
- **延後（R6）**：各帳號自訂發送時間。現行排程是三個固定 pg_cron job，要做成各帳號自訂必須改成 30 分鐘 tick 模型，並為 `kind='market'` 補 `(user_id, taipei_ymd)` 唯一索引，否則會重複發送；而且只對有自己 webhook 的帳號有意義。獨立為 step 2f。
- **範圍取捨（R7）**：`discord-accounts` 的各帳號寫入 ops 保留在 Edge，只移除 UI。刪掉要連帶刪一批測試，超出「讓 UI 一致」的需求。
- **經濟快報狀態改為兩行**：`全域頻道：已設定 …{last4} — 你會在共用頻道收到` 或 `全域頻道：管理員尚未設定，目前沒有人收得到`，加上 `我的頻道：未設定（不另外發送）` / `…{last4}（推送中）` / `…{last4}（已暫停）`。
- **測試修復（40 個失敗全部是 fixture）**：`DiscordAccountsSection.test.tsx` 整檔重寫成唯讀表格的測試（含一條「完全沒有任何編輯控制項」的斷言）；六條排程測試隨 UI 搬到 `DiscordSection.test.tsx`；`DiscordMySettings.test.tsx` 與 Edge 的 `discordMySettings.test.ts` 補上 `global` / `readWebhook`。
- **Verify**：`npx vitest run` 2,558 passed / 7 skipped / 0 failed；`npm run build`、`npm run lint`、`npm run typecheck:edge` 皆 exit 0。
- **DEV 部署**：`market_enabled` 欄位與 backfill 以 `DO $$ IF NOT EXISTS` 區塊套用（帶 DEV identity predicate，backfill 影響 0 列）；`stock-report` 部署兩次，v19 → v20 → v21，`ezbr_sha256` 每次都變，`verify_jwt` 維持 false。
- **E2E（Playwright，localhost:5173，DEV Supabase）**：用 magic link 換 admin 與一般帳號兩組 session 注入 localStorage。結果：兩個帳號的自助頁面結構完全相同；一般帳號讀到 `全域頻道：已設定 …27lX — 你會在共用頻道收到` 與 `我的頻道：未設定（不另外發送）`；未設定網址時測試鈕與啟用開關皆 disabled；後台各帳號區塊 `input/select/button` 數量為 0、兩列資料、排程與全域 webhook 都在；寫入往返（持股啟用 off→on→off）經真實 Edge 成功且 DB 狀態還原；無效網址被 Edge 退回並顯示「網址格式不正確」；無 console error。
- **R8 追加（user 回報，2026-09-20）**：繼承全域的帳號，經濟快報的「啟用」與「測試連線」是灰的，但上一行寫著「全域頻道：已設定」，看起來像壞了。先端到端查證不是 bug——存入有效網址會正確解鎖兩個控制項並自動啟用，清除也會還原（Playwright 實測，DB 狀態前後一致）。真正的問題是：**繼承全域不是這個 app 能開關或測試的東西**，訊息發到管理員的共用頻道，看不看得到取決於該帳號的 Discord 成員資格，不是 app 狀態。改為在 `market.configured` 為 false 時**不渲染**這兩個控制項（而非停用），改顯示「要在自己的頻道也收到一份，請在上方設定 Webhook 網址。」。個人持股區塊維持停用樣式，因為它的狀態列「目前：未設定」本身沒有矛盾。Spec: `docs/agent/specs/discord-user-self-service.md` §R8。E2E 覆驗：`marketTestPresent: 0`、`marketTogglePresent: 0`。
- **未做**：尚未 commit、未推送；PROD 完全未動（無 `market_enabled` 欄位、Edge 仍是舊版）。