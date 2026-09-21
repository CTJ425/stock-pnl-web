# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.9.61 — 經濟快報 per-account preview send, released to `main` and deployed (Task 165 step 2h)
- Status: ✅ **0.9.61 on `dev` and `main`, Edge deployed to DEV (v23) and PROD (v12)** — next: watch one real PROD round (18:00 快報＋tick, 21:00 完整版)
- Timestamp: 2026-09-21 16:37:49 Asia/Taipei

---

## 📅 Log: 2026-09-21 16:37:49 Asia/Taipei (Task 165 step 2h, 0.9.61 → PROD)

**經濟快報補上「送真實內容」的那顆按鈕，並修掉一個讓每日配額失效的既有缺陷。** 個人持股一直有兩段式驗證（測試連線＋完整推送測試），經濟快報只有第一段。Spec: `docs/agent/specs/discord-market-preview.md`。

- **缺陷（spec §2）**：`finishDiscordMyMarket` 寫 `kind: 'market'`，但配額計數 `countHoldingsManualToday` 只算 `kind IN ('test','preview')`。也就是 `test-market` 的配額檢查讀的是一個它自己的寫入永遠不會增加的計數器 —— `MANUAL_SENDS_PER_DAY = 10` 對經濟快報從未生效。在這之上再加一顆送**真實內容**的按鈕不可接受，所以一併修掉：`finishMarket` 改為必填 `kind: 'test' | 'preview'`，四顆手動按鈕（兩個測試連線、兩種預覽）共用同一個上限。沒有任何地方再寫 `kind: 'market'`，`schema.sql` 上那句「nothing writes it any more」在此之後才成立。
- **`buildMarketPreview` 是抽取不是新增**：後台 `runWebhookOp` 的 `preview` 分支原本內嵌整段 gather+build，現在抽成 `discordRun.ts` 的匯出函式，兩個呼叫端共用。後台既有測試未修改、全數通過，證明是搬移而非改寫。`latestMarketDay` 維持模組私有。
- **檢查順序就是契約（§5）**：`bad-request` → `not-configured` → `quota` → `no-market-data`，四條拒絕路徑都在 `deps.post` 之前 return，不會出現「已經送出才說配額用完」。每條路徑的測試都同時斷言 `post` 未被呼叫。
- **D4：不看 `market_enabled`。** 帳號暫停時仍可預覽 —— 那個開關正是使用者要用這顆按鈕驗證的東西。這是 step 2e §R8 踩過的同一個坑。
- **D5：不做二次確認。** 訊息只到該帳號自己的頻道，和 `preview-holdings` 一致；後台的全域預覽保留對話框，因為那份是頻道全員都看得到。
- **測試由主 session 先寫成紅的再派工**：16 條失敗，涵蓋四條拒絕路徑、兩種 edition、`【預覽】` 標記、暫停仍可送、發送失敗的記錄、以及 `test-market` 必須寫 `'test'` 的配額回歸守衛；另加 `discordRun.test.ts` 三條（今日／回退最近交易日／空檔案）與前端四條。
- **Review**：PASS，零 findings。主 session 另行自讀五個 diff（對外送出真實訊息且改動速率限制，依 route 規則不只看測試綠燈）。
- **Verify**：`npx vitest run` 2,586 passed / 7 skipped / 0 failed；`npm run build`、`npm run lint`、`npm run typecheck:edge` 皆 exit 0。
- **版面實測**：經濟快報區塊變成五顆按鈕，390px 下自然折成兩行、無水平溢出；兩個區塊的驗證能力現在對稱。
- **部署**：先部署 Edge 再推前端。`stock-report` 自 `main` 的 `dab1447` 部署，PROD v11 → **v12**、DEV v22 → **v23**，兩者 `ezbr_sha256` 同為 `dfb26089…`（同一份 bundle），`verify_jwt` 維持 false。接著 `git push origin main`，Cloudflare Pages 完成後線上 `APP_VERSION` 實測 = `0.9.61`。GitHub Release `0.9.61` 已自動建立。
- **無 schema / cron 變更**：`'test'` 與 `'preview'` 早就在 `user_discord_send_log_kind_check` 內。

---

## 📅 Log: 2026-09-21 16:10:08 Asia/Taipei (Task 165 steps 2e–2g, 0.9.60 → PROD)

**0.9.60 定版、合併 `main`、PROD 完整部署。** 一次帶上三個步驟（2e 自助 webhook、2f 各帳號發送時間、2g 後台瘦身＋間距），PROD 從 step 2d 的狀態一路補齊。

- **部署順序刻意是「後端先、前端最後」**：schema → Edge → cron → `git push origin main`。原因是合併會讓 Cloudflare Pages 在數分鐘內把新前端推上正式站，而新前端會呼叫 `discord-my-settings`；PROD 當時的 Edge 是 v10（step 2d），沒有這個 action。先補後端，正式站的中斷窗口是零。
- **合併前查出的阻斷**：PROD `stock-report` v10、`user_discord_settings` 缺 `market_enabled` 與三個時間欄、cron 仍是 `discord-holdings-daily` + 兩個固定 job、沒有 `discord-account-tick`。若只合併不部署，正式站每個帳號打開「Discord 通知設定」都會拿到「後端尚未部署這個功能」，而且後台的排程編輯器同時被 2g 移除，等於任何畫面都改不了發送時間。
- **PROD schema**：以單一 `DO $prod$` 區塊套用，第一件事是 identity guard（`EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%hrilemueiqyaoiwnkeuu%')`，不成立就 `RAISE EXCEPTION`）。內容為 `market_enabled`（含 backfill，2 列中 1 列設為 TRUE）、三個時間欄、`user_discord_settings_times_check`、放寬的 `user_discord_send_log_kind_check`、兩個 partial unique index。覆驗：10 個欄位到齊、2 個索引存在。
- **PROD Edge**：`supabase functions deploy stock-report --project-ref hrilemueiqyaoiwnkeuu --no-verify-jwt --use-api`，自 `main` 的 `50721c6` 部署。v10 → **v11**，`ezbr_sha256` 由 `1c93c3fc…` 變為 `057927aa…`（證明新 bundle 真的落地，版本號本身不算證據），`verify_jwt` 維持 false。
- **PROD cron**：新增 `discord-account-tick`（`0,30 9-15 * * 1-5`），**command 以複製 `discord-holdings-daily` 的內容再替換 action 字串的方式產生**，全程在 `DO` 區塊內，CRON_SECRET 沒有被讀出來過；接著 `unschedule('discord-holdings-daily')`。覆驗用結構述詞（`command LIKE '%x-cron-secret%'`、`regexp_match` 取 action），確認 action 為 `discord-account-tick`、指向 PROD url、帶 secret。
- **PROD 的兩個全域時間刻意不動**：brief `0 10`（台北 18:00）、full `0 13`（21:00）。兩者都落在 `SCHEDULE_OPTIONS` 的合法格點上，DEV 是 17:30／21:30 只是各自的設定值，不是不同步。PROD 帳號的「預設」標籤因此會顯示 18:00。
- **`verify_setup()` on PROD：10/10 PASS**，其中 `cron target host` = `hrilemueiqyaoiwnkeuu.supabase.co`、`cron http (recent)` = 200、`cron placeholders` = none。
- **前端**：`git push origin main` 後由 Cloudflare Pages 自動部署；以 `assets/chipFormat-MEp8ar_g.js` 實測線上 `APP_VERSION` = `0.9.60`。`git push origin main:dev` 同步，兩個分支版本字串一致。GitHub Release `0.9.60` 已由 workflow 自動建立。
- **CHANGELOG**：`0.9.60-dev.1` ~ `dev.4` 四個區段收攏為一個正式版區段。
- **未做**：尚未觀察任何一輪真實的 PROD 發送，`discord-account-tick` 在 PROD 也還沒有實跑紀錄。
