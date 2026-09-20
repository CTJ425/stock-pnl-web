# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 — 0.9.58 deployed to PROD (§14 + §15, holdings cron, `stock-report` v10)
- Status: ✅ **0.9.58 on `dev` and `main`, deployed to DEV and PROD** — next: watch one real 17:30 / 21:30 round on PROD
- Timestamp: 2026-09-18 15:46:22 Asia/Taipei

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

---

## 📅 Log: 2026-09-19 23:10:08 Asia/Taipei (Task 165 step 2e, 0.9.60-dev.1)

**Discord webhook 下放到各帳號自助設定。** 使用者現在可以自己設定經濟快報與個人持股兩支 webhook、各自開關、各自推播測試，不必經過管理員。管理員保留全域經濟快報 webhook 與代編各帳號的能力。

- **決策（user, 2026-09-19）**：「沿用全域」= 沿用**內容**不是沿用頻道（全域快報的同一份 payload 發到使用者自己的頻道）；兩類推播各一支 webhook；管理員保留全域；快報與完整版**兩版都發**給自訂 webhook（原本只有完整版）；新增 `market_enabled` 讓使用者暫停而不必清掉網址；測試按鈕一律以 DB 已存網址為準。Spec: `docs/agent/specs/discord-user-self-service.md`。
- **Schema §14**：新增 `market_enabled BOOLEAN NOT NULL DEFAULT FALSE`，與 backfill `UPDATE ... SET market_enabled = TRUE WHERE market_webhook_url IS NOT NULL` 一起包在 `DO $$ ... IF NOT EXISTS (information_schema.columns ...) $$` 區塊內，確保只跑一次——否則日後重新套用 `schema.sql` 會把使用者自己關掉的推播重新打開。RLS 維持零 policy、`REVOKE ALL FROM anon, authenticated`。
- **Edge**：新增 `discord-my-settings` action（`assertUser` 為該 branch 第一行，`userId` 只從 JWT 取）與 `discordMySettings.ts`；`discordRun.ts` 拿掉 `if (edition === 'full')` 閘門；`discordTargets.ts` 新增會 throw 的 `toMarketOverride`，`MarketOverride.enabled` 為必填。
- **前端**：新增 `src/components/Settings/DiscordMySettings.tsx` 自助頁，掛在 `AppShell` 的 `UserMenu`（每個登入帳號可見，非管理員限定）；`src/services/discordMySettings.ts` 以 `import type` 取用 Edge 的 `MySettingsStatus`，讓前後端形狀不符變成編譯錯誤。
- **Review 抓到兩個上線前會出事的缺陷**：(1) `loadDiscordMarketOverrides` 漏 select `market_enabled`，`groupMarketTargets` 收到 `undefined` 會丟掉**每一筆** override——部署後所有帳號的經濟快報副本會全停；`db.select()` 型別是 `any`，編譯器看不見，2552 個綠燈測試也沒覆蓋這條路徑。(2) 前端讀的是扁平欄位、Edge 回的是巢狀，每個欄位都是 `undefined`，`undefined !== null` 使得「未設定前必須 disabled」的測試鈕與 toggle 全部是開的。根因是 spec §5.3 與 §5b.2 自相矛盾，兩個 builder 各信一邊。兩者皆已修，並各自補上測試。
- **Verify**：`npx vitest run` 2,564 passed / 7 skipped / 0 failed（150 檔）；`npm run build`、`npm run lint`、`npm run typecheck:edge` 皆 exit 0。
- **未做**：尚未 commit、未推送、DEV 與 PROD 都還沒套用 schema `market_enabled`，也還沒重新部署 `stock-report`。