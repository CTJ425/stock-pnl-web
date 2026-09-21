# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.9.60 released to `main` and deployed to PROD (Task 165 steps 2e–2g)
- Status: ✅ **0.9.60 on `dev` and `main`, deployed to DEV and PROD** — next: watch one real PROD round (18:00 brief + tick, 21:00 full) and the first real `discord-account-tick` run
- Timestamp: 2026-09-21 16:10:08 Asia/Taipei

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