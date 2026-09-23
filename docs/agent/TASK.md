# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-09-17 13:51:06 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory).
> For detailed implementation history, always refer to `PROGRESS.md`.

## 📍 Where the project stands (2026-09-17 16:33:21)

- **Version 0.9.57 on `main`（2026-09-17 合併）；`dev` 為 0.9.58-dev.3（Task 165 第二階段 2a–2c，未推送；DEV Supabase 尚未部署）。前端由 Cloudflare Pages 從 `main` 自動部署。Task 165（Discord 每日總結）的 schema §13 與新版 `stock-report` 目前只在 DEV；PROD 尚未套用 §13、也未重新部署 `stock-report`，所以 PROD 主控台的 Discord 頁在部署前會回錯誤。** 驗收看畫面左下角的版本徽章。
  - Shipped 0.9.45 ~ 0.9.56 的逐版記述已移入 `TASK_ARCHIVE.md`（見該檔 `Shipped history` 區塊）與 `docs/agent/CHANGELOG.md`。
  - Verification (2026-09-17): 137 test files / **2,201** vitest tests passed, 7 skipped, exit 0；`npm run lint`、`npm run build`、`npm run typecheck:edge` 皆 exit 0。
  - Edge Functions（2026-09-17）: DEV `stock-report` **v12**（Task 165）；PROD `stock-report` 未變動（2026-09-15 記錄為 v8）。其餘三支同 2026-09-15 紀錄：`stock-price` DEV v18 / PROD v9、`backup-transactions` v4、`ai-proxy` v1。`verify_jwt`：`stock-price` 與 `ai-proxy` 為 true，`stock-report` 與 `backup-transactions` 為 false。
  - **前端由 Cloudflare Pages 自動部署。** 推上 GitHub 後數分鐘內生效，不需要手動上傳 `dist/`（0.9.53 以 bundle 位元組比對實測確認，流程寫在 `README.md` 步驟 9-1）。驗收看畫面左下角版本徽章。
  - **只有 `main` 會上正式站**（0.9.53 實測：09:21 推 `dev` 後七分鐘線上不變；09:27 推 `main` 後 1 分 40 秒線上換版）。Edge Function 不隨前端走，必須另外 `supabase functions deploy`。
  - Known and not done: Task 144 的資源用量監控與日誌檢視（Features 2, 3）；Task 85 只有 `borrow` 一個視窗完成重調；`成交金額` / `昨量` 仍缺資料來源；end-to-end Playwright run for the 融券 flow；`.inst-matrix tfoot td` hardcoded white overlay inverted under light theme。

## 📋 Active Tasks

### Task 166: 全專案稽核修補（139 項發現，分 5 批）
- **Status**: 🔄 IN PROGRESS
- **Agent**: Claude
- **Timestamp**: 2026-09-23 09:49:00 Asia/Taipei
- **Spec**: docs/agent/specs/166-audit-remediation.md
- **Note**: ES-04（外資 TOP50 的 NaN 防護）查證後為誤報，已有防護；其餘項目照原範圍執行。
- 來源：2026-09-22 全專案稽核報告（2 項 P1、25 項 P2、112 項 P3；另排除 12 項誤報）。
- 使用者決策：保留公開註冊但要求信箱驗證與 8 碼密碼；AI 只開放管理員；R2 完全移除；每批 DEV 驗證後直接上 PROD。
1. ~~第 1 批 0.9.63：AI-01、OP-02、TX-01/02/06/08、ER-01/02/03/06/07、SH-01、移除 R2~~ ✅
2. ~~第 2 批 0.9.64：金額引擎與資料功能 — EN-01（股利）、EN-02～EN-10、TX-03/04/09（分割與重算原子化）、DA-07、BUG-079、BUG-084~~ ✅
3. ~~第 3 批 0.9.65：Edge 穩定性與維運 — ER-04、ER-08～ER-17、EP-01～EP-07、ES-01～ES-08、ED-01～ED-09、AD-02、DB-01～DB-05、OP-01~~ ✅
4. ~~第 4 批 0.9.66：前端體驗與無障礙 — SH-02～05、TX-05/07、DA-*、PR-*、DT-*、FU-*、AI-02～07、MA-*、AD-01、AD-03～11、OP-03～07~~ ✅
5. 第 5 批 0.9.67：結構性 — ER-05（可測試路由）、TX-10、TX-11 —— ⏳

### Task 165: Discord daily market summary (Phase 1 market-wide; Phase 2 per-user holdings)
- **Status**: 🔄 IN PROGRESS — **0.9.61 released and deployed to DEV and PROD** (2026-09-21, steps 2e–2h); remaining: watch one real PROD round (18:00 快報＋tick, 21:00 完整版) and the first real `discord-account-tick` run
- **Agent**: Claude
- **Timestamp**: 2026-09-21 16:37:49 Asia/Taipei
- **Done**: items 1, 2, 3 — full text in `TASK_ARCHIVE.md`.
- **Spec**: docs/agent/specs/discord-daily-summary.md
- **Decisions (user, 2026-09-17)**: multi-user app; shared Discord server; the admin sets one site-wide webhook in the admin console (server-only storage); weekdays 17:05 brief + 21:30 full, normal pushes; no TAIEX row for today → skip; all four blocks; 8 indices; Phase 2 decisions superseded — see the next line.
- **Phase 2 decisions (user, 2026-09-17 16:57 Asia/Taipei)**: each user sets their own webhook (nothing per-user goes to the site-wide webhook); the card always shows full amounts (shares, cost, market value, unrealized/realized P&L) — supersedes the earlier "percent + ticker" cap; all workspaces merged into one card, TWD and USD kept separate (no FX); once a day at 17:15 after the brief; server uses `workspaces.fee_rate` (already in DB) and the default minimum fees. Spec: docs/agent/specs/discord-holdings.md (approved 2026-09-17 17:20, adding D6: existing core code is not modified; BUG-084 difference accepted).
- **Step 2d decisions (user, 2026-09-18)**: the admin console manages every Discord webhook; the per-user settings dialog is removed; per account: 經濟快報 (= the full edition) inherits the global webhook by default (inherit sends nothing extra; only a custom URL gets a second copy) and 個人持股報告 (no inherit); the brief and every holdings card go out together (default 17:05); two drop-downs set the brief+holdings time (17:05–20:55) and the full time (21:00–23:55). Supersedes "each user sets their own webhook" and "daily 17:15" above. Spec: docs/agent/specs/discord-admin-accounts.md.
- **Step 2d revision 2 (user, 2026-09-18 12:00)**: layout 全域 → 帳號 → 排程 → 說明 with explanations at the bottom; the account editor switches with one click and always names the account; a per-account 「完整推送測試」 sends the real holdings card; the schedule is a half-hour drop-down (快報＋持股 17:30–20:30, 經濟快報 21:00–23:30) and the default becomes 17:30 (17:00 is when the FX file refreshes, so 17:05 is gone); UI polish. Spec §9.
- **Card P&L (user, 2026-09-18 13:00)**: the holdings card adds 今日已實現 per currency, per-position 累計已實現 (only when ≠ 0) and per-position 均價／保本價 (break-even for LONG only). Spec: docs/agent/specs/discord-holdings.md, "Revision 3".
- **Card parity + quote bug (2026-09-18 13:40)**: each position also shows 市值 and 成本 (SHORT: 價金), so the card covers every 庫存總覽 column; quote fetches are limited to 2 at a time and the missing-quote count is reported; and the reason every real card showed `--` is fixed — the quote request carried no `User-Agent`, so Yahoo refused it. Spec: docs/agent/specs/discord-holdings.md, "Revision 4" and "Revision 5".
- **Card layout (user, 2026-09-18 14:00–15:15)**: after seeing four layouts on a canvas (現況 / A 原生欄位 / B 24 欄等寬 / C 混合 / D Markdown) the user shipped B (dev.10), then asked for a markdown probe (dev.11) and chose markdown for both cards (dev.12). The holdings card is now one total line (未實現合計, 今日) plus one line per position: 代號名稱｜張數（整張 N 張、零股 N 股）｜均價｜未實現. Spec: docs/agent/specs/discord-holdings.md, "Revision 6", "Revision 7", "Revision 8".
- **Step 2e decisions (user, 2026-09-19)**: Discord webhook 下放到各帳號自助設定。「沿用全域」= 沿用**內容**不是沿用頻道（全域快報的同一份 payload 發到使用者自己的頻道）；經濟快報與個人持股各一支 webhook；管理員保留全域 webhook 與代編各帳號的權限；自訂 webhook 快報與完整版**兩版都發**（原本只有完整版）；新增 `market_enabled` 讓使用者暫停而不必清掉網址；測試按鈕一律以 DB 已存網址為準，Edge 不接受 request body 傳來的 URL。Supersedes step 2d 的「the per-user settings dialog is removed」。Spec: docs/agent/specs/discord-user-self-service.md.
- **Step 2e Revision 1 + step 2f decisions (user, 2026-09-20/21)**: 所有帳號（含 admin）共用同一個自助頁面，後台只保留全站設定（全域經濟快報 webhook＋發送排程），各帳號區塊改為唯讀清單；經濟快報狀態改為兩行（全域頻道／我的頻道），繼承全域時不渲染無法作用的啟用開關與測試按鈕；各帳號可自訂三個發送時間（`market_brief_time` / `market_full_time` / `holdings_time`，NULL＝跟隨全域），以一個 30 分鐘 `discord-account-tick` 取代三個固定 cron job，`discord-holdings-daily` 退役。Specs: docs/agent/specs/discord-user-self-service.md（§Revision 1、§R8）、docs/agent/specs/discord-account-schedule.md.
- **Step 2g decisions (user, 2026-09-21)**: 管理後台只保留全域經濟快報 webhook 與各帳號唯讀狀態清單，發送排程 UI 移除，時間完全下放各帳號；Edge 的 `set-schedule` op 與 `saveDiscordSchedule()` 保留（沿用 §R7 前例，只移 UI），全域時間之後由資料庫端調整；「跟隨全域」改為「預設（HH:MM）」；Discord 通知設定頁間距收成單一節奏（區塊內 12px、區塊間 24px），並修好網址框與按鈕列 0px 貼死的問題；`.hint` 的修正只作用於 `.dsc-block` 內。Spec: docs/agent/specs/discord-admin-slim.md.
- **Step 2h decisions (user, 2026-09-21)**: 經濟快報比照個人持股，補上送真實內容的驗證按鈕，每個 edition 一顆（「預覽快報」「預覽完整版」）；標題標【預覽】，非交易日回退最近一個交易日，帳號暫停時仍可用，訊息只到自己的頻道所以不做二次確認。一併修掉每日手動發送配額對經濟快報從未生效的缺陷（`finishMarket` 改為必填 `kind`）。後台 preview 的 gather+build 抽成 `buildMarketPreview` 共用。Spec: docs/agent/specs/discord-market-preview.md.
4. ~~Set the webhook in the DEV admin console and run 測試發送~~ ✅ (2026-09-17: test 15:11, previews from 15:25, all HTTP 200) · watch one real 17:05 and 21:30 round; check phone alignment of the 國際指數 / 美國總經 tables —— ⏳
5. PROD: ~~merge `main`~~ ✅ 0.9.57 (2026-09-17) · ~~apply schema §13 on PROD, deploy `stock-report`, set the PROD webhook~~ ✅ (2026-09-18) · ~~PROD 補齊 steps 2e–2g（schema、Edge v11、cron tick）~~ ✅ 2026-09-21
6. Phase 2: per-user holdings card (full amounts, merged workspaces, sent with the brief; D6 core untouched) —— ~~2a Edge engine copy~~ ✅ 0.9.58-dev.1 · ~~2b card modules~~ ✅ 0.9.58-dev.2 · ~~2c schema §14 / Edge / settings UI~~ ✅ 0.9.58-dev.3 · ~~2d admin-managed webhooks + adjustable schedule (spec discord-admin-accounts.md)~~ ✅ 0.9.58-dev.4 (`247b37f`) · ~~merge `main` as 0.9.58~~ ✅ 2026-09-18 · ~~push `dev` and `main`~~ ✅ · ~~PROD: §14 + §15, clone cron `discord-holdings-daily`, schedule 17:30 / 21:30, deploy `stock-report` v10, `verify_setup()` 10/10 PASS~~ ✅ 2026-09-18 · watch one real 17:30 and 21:30 round on PROD —— ⏳ · accepted risks RISK-015/016/017, BUG-084
7. Step 2e: 自助 webhook 設定（spec discord-user-self-service.md）—— ~~schema `market_enabled` + 一次性 backfill~~ ✅ · ~~Edge `discord-my-settings` action、`toMarketOverride`、兩版都發~~ ✅ · ~~前端自助頁 `Settings/DiscordMySettings.tsx` + AppShell 入口~~ ✅ · ~~review（兩輪）~~ ✅ PASS · ~~commit 0.9.60-dev.1~~ ✅ · ~~DEV 套用 schema + 部署 `stock-report`~~ ✅ · ~~PROD 同步~~ ✅ 2026-09-21
8. Step 2f: 各帳號自訂發送時間（spec discord-account-schedule.md）—— ~~schema 三個時間欄位 + kind CHECK + 兩個 partial unique index~~ ✅ · ~~`accountTick.ts`（`dueAt` 純函式 + `runAccountTick`），claim→post→finish~~ ✅ · ~~退役 `discord-holdings-daily`、新增 `discord-account-tick`~~ ✅ · ~~前端三個時間下拉~~ ✅ · ~~測試修復 28 項~~ ✅ · ~~commit 0.9.60-dev.3~~ ✅ · ~~DEV 套用 schema + 部署~~ ✅ · ~~PROD 同步（schema + Edge v11 + cron）~~ ✅ 2026-09-21 · 觀察 PROD 首次實跑 —— ⏳
9. Step 2g: 後台瘦身 + 間距統一（spec discord-admin-slim.md）—— ~~移除後台排程 UI（`ScheduleSection` / `GlobalScheduleBlock`）~~ ✅ · ~~「跟隨全域」改「預設」~~ ✅ · ~~`.dsc-block` 間距單一節奏 + 三個下拉左緣對齊~~ ✅ · ~~測試（刪 5 條排程測試、新增 3 條）~~ ✅ · ~~review PASS，接受 RISK-018/019/020~~ ✅ · ~~commit + 定版 0.9.60~~ ✅ · ~~合併 `main` 並推送~~ ✅ · ~~PROD 部署 + `verify_setup()` 10/10 PASS~~ ✅ 2026-09-21
10. Step 2h: 經濟快報個人預覽（spec discord-market-preview.md）—— ~~`buildMarketPreview` 自後台 preview 分支抽出共用~~ ✅ · ~~Edge `preview-market` op（檢查順序 bad-request→not-configured→quota→no-market-data）~~ ✅ · ~~修正 `finishMarket` 的 `kind`，讓 10 次/日配額真的生效~~ ✅ · ~~前端兩顆按鈕 + `previewMyMarketSummary`~~ ✅ · ~~測試 16 條先紅後綠~~ ✅ · ~~review PASS 零 findings~~ ✅ · ~~定版 0.9.61、合併 `main`、推送~~ ✅ · ~~部署 Edge PROD v12 / DEV v23~~ ✅ 2026-09-21

### Task 164: 總體經濟 — 國際指數下鑽、報價時間與走勢區間（Phase C 待辦）
- **Status**: ⏸️ **Phase A & B 已於 0.9.56 完成結案；Phase C（台指期夜盤）待後續獨立排程實作**
- **Agent**: Antigravity
- **Timestamp**: 2026-09-16 10:10:00 Asia/Taipei
- **Spec**: `docs/agent/specs/164-macro-index-drilldown.md`
- **Phases**: A 卡片列表 ✅／B 指數詳情頁 ✅／C 台指期夜盤（TAIFEX 自建 tick 儲存）⏸️
- **Verification**: `npm run build && npm test` 於 `sources/` 執行全綠：`tsc -b && vite build` exit 0，全套 129 個測試檔、2,033 條測試全數通過，`npm run lint` 0 errors。
- **Done**: Phase A（TW 加權指數群組、各區開盤時間標籤、asOf 報價時間戳、卡片點擊下鑽）與 Phase B（IndexDetail 詳情頁、7 走勢區間切換、dailyProxy 支援 market 參數隔離快取、次分頁重構整合加權指數下鑽台股、大盤看板解耦常態渲染、開盤前即時報價 fallback）已於 0.9.56 正式發布。
- **Phase C (待後續獨立排程實作)**: 台指期夜盤自建 tick 儲存（需規劃資料表、輪詢 cron 與保留策略，待獨立開案排程實作）。

### Task 160: 全專案快照與還原腳本（snapshot / restore / wipe-dev）
- **Status**: 🔄 **Phase A + A-2 程式完成並實測；破壞性演練待使用者決定 CRON_SECRET 方案**
- **Spec**: `docs/agent/specs/160-snapshot-restore.md`（含 §3a、§3b 兩項設計修正）
- **Done**:
  - `sources/scripts/lib/snapshotPlan.cjs` — 純邏輯核心，21 條測試（`snapshotPlan.test.mjs`）
  - `sources/scripts/snapshot.cjs` — 產生快照包，目的地 local / storage / r2
  - `sources/scripts/restore.cjs` — 從快照包還原，支援 `--dry-run`
  - `sources/scripts/wipe-dev.cjs` — 破壞性演練，五道守衛
  - `sources/package.json` — 新增 `snapshot` / `restore` / `wipe:dev` 三個指令
  - `.gitignore` — 擋下 `.snapshots/` 與 `*.sql.gpg`
  - DEV `backup_run_log` 補上 `r2_status` / `r2_error` 兩欄
- **Deferred (使用者決定 2026-09-14)**: 破壞性演練暫不執行。DEV 維持現狀，未做任何 wipe / restore 往返。
- **Resume 時要先決定**: 還原會重建 7 個 cron job，需要真正的 CRON_SECRET，但 Supabase 只回得出 SHA256 摘要、讀不回原值。方案 A 是產新密鑰並 `supabase secrets set` 寫進目標專案（能驗證 placeholder 窄替換，但會換掉現有密鑰）；方案 B 是跳過 cron（不動設定，但 placeholder 替換就驗不到，而那正是 2026-08-31 的失敗點）。
- **Out of scope (使用者決定 2026-09-14)**: Cloudflare R2。`snapshot.cjs` 的 `r2` 目的地與 SigV4 簽章已全部移除，`--to` 只接受 `local` 與 `storage`。詳見 spec §9。
- **Not done**: 實際的 wipe → restore 往返。所有其他環節都已對 DEV 實測：snapshot 產包 1.6 MB / 137 檔 sha256 吻合、restore `--dry-run` 六步全過（6 URL + 6 secret header 窄替換）、wipe-dev 對 PROD ref 與未知 ref 皆以離開碼 1 拒絕。

### Task 159: Desktop and general UI/UX fixes
- **Status**: 🔄 IN PROGRESS
- **Agent**: Claude
- **Timestamp**: 2026-09-11 12:37:31 Asia/Taipei
- **Done**: items D2, D4, D6, D8, D9, D11, D12 (0.9.45) — full text in `TASK_ARCHIVE.md`.
- **Decision (0.9.47)**: D9 reverted by user decision — desktop uses the floating 「新增交易」 button again and the header button was removed. `main.container` already reserves 96 px at the bottom above 720 px, so only mid-scroll overlap remains.
- **Spec**: `docs/design/desktop-ux-audit.html` (item numbers D1–D15 match the report)
- **What is this**: Audit measured at 1440×900 and 1024×768, light + dark theme, local mode, 0.9.44. Batch 1 shipped in 0.9.45 = D2, D4, D6, D8, D9, D11, D12, plus the title half of D1 and the 「Active 持股」 half of D13. Side finding recorded as BUG-079.

- D1. Page switch does not change the URL (stays `/`). The `document.title` half shipped in 0.9.45 (「<頁名> · 股票小幫手」). — ⏳ batch 2
- D3. 5 native `confirm()` calls; no undo after delete. — ⏳ batch 2
- D5. 7 error messages append raw Supabase `error.message` (`dataProvider.ts:281–360`). — ⏳ batch 2
- D7. Holdings rows carry ~20 numbers (未含費 / 淨收 / 券商 sub-lines). — ⏳ batch 3
- D10. At 1024 px the holdings table is 1,023 px wide in a 974 px box. — ⏳ batch 3
- D13. Terminology: 工作區 (16) / 帳戶 (5) / 投資組合. 「Active 持股」→「目前持股」 shipped in 0.9.45; the account noun needs a user decision. — ⏳ user decision
- D14. 20 help buttons sit in the Tab order before table content. — ⏳ batch 3
- D15. 11 components format numbers with `toFixed()` instead of `utils/formatters.ts`. — ⏳ batch 3

### Task 158: Mobile UI/UX fixes from the iPhone 13 mini audit
- **Status**: 🔄 IN PROGRESS
- **Agent**: Claude
- **Timestamp**: 2026-09-11 12:37:31 Asia/Taipei
- **Done**: items 2, 5, 6, 9, 15, 16 (0.9.45), 12 and 18 (0.9.48) — full text in `TASK_ARCHIVE.md`.
- **Spec**: `docs/design/mobile-ux-audit-iphone13mini.html` — items 1–17 match the report (it holds exactly 17 `class="finding"` blocks). **Items 18 and 19 were added later and are not in that file.**
- **What is this**: Audit measured at 375×629 (Playwright `iPhone 13 Mini`, local mode, 0.9.44). Batch 1 shipped in 0.9.45 = items 2, 5, 6, 9, 15, 16. Item 8 deferred (needs a real iPhone); item 11 re-scoped (see item). Batches 2–3 = the rest.

1. Holdings / transactions / yearly tables show 33–40% of their width at 375 px; P&L is columns 9–10. Card list at ≤560 px. — ⏳ batch 2
3. Tap targets under 44 px (28 of 30 on the dashboard; 14×14 help icons, 16×16 checkboxes, 39 px nav tabs). — ⏳ batch 2
4. 92% of dashboard text is 12 px; the ≤1120 px shrink rule also applies on phones. — ⏳ batch 2
7. The first screen shows only summary cards; 「Active 持股」 wraps. — ⏳ batch 2
8. No `viewport-fit=cover`, so `env(safe-area-inset-*)` resolves to 0. Deferred from batch 1: verify on a real iPhone in standalone mode before changing. — ⏳ batch 2
10. Charts handle mouse events only (`chartFrame.tsx`); no pointer/touch. — ⏳ batch 3
11. The manifest `theme_color` / `background_color` are fixed at `#161616` (dark splash for light-theme users). Correction: `applyTheme()` already updates the `theme-color` meta at runtime (`utils/settings.ts:43–45`). — ⏳ batch 3 (low)
13. The add-transaction modal is not full-screen on phones; the save button is below the fold. — ⏳ batch 3
14. Cloud-mode bottom nav has 6 tabs; proposal is 5 with 「更多」. — ⏳ batch 3, user decision
17. Flag emoji render as empty boxes without a colour emoji font. — ⏳ batch 3
19. The 交易紀錄 empty-state copy says 「點右下角『新增交易』…或用『匯入 CSV』」, but at ≤720 px the add button is icon-only and 匯入 CSV sits in the 「工具」 sheet. — ⏳ batch 3

### Task 144: Admin Enhancements, Execution Logs, Resource Usage & Multi-Target Backups
- **Status**: 🔄 **IN PROGRESS — Features 1 & 4 shipped (0.9.49)**
- **Agent**: Antigravity
- **Timestamp**: 2026-09-14 12:30:00 Asia/Taipei
- **Done**: items 1, 4 — full text in `TASK_ARCHIVE.md`.
- **Spec**: `docs/agent/specs/144-admin-enhancements-and-backups.md`
- **What is this**: 4 interrelated system feature additions requested by user:
  2. **Admin Cron & Probe Execution Logs**: Add detailed execution log viewer in Admin Console for `cron.job_run_details`, `source_probe_tick` anomalies, and batch run errors (shares `logs` panel in `LogsSection.tsx` added in Spec 146).
  3. **Supabase Cloud Usage & Limit Monitor**: Expose database size, storage usage, and plan thresholds (Free 500MB DB / 1GB Storage) directly in the Admin Console.
- **Remaining**: Implementation of Features 2, 3 across frontend and backend RPCs.

### Task 85: 0.7.8 / 0.7.9 探針命中直接觸發抓取，且要確認資料到位
- **Status**: 🔄 **shipped everywhere and proven live; landing windows measured, retune needed**
- **Agent**: Claude
- **Timestamp**: 2026-08-11 19:00:00 Asia/Taipei
- **Done**: items 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 — full text in `TASK_ARCHIVE.md`.
- **Remaining work**: Retune configured windows in `sourceProbePlan.ts` to match measured timings:
  - mops_profit: 12:00
  - bfi82u: 15:05-19:40
  - t86: 16:05-16:45
  - twt38u: 17:00-17:10
  - bwibbu: 17:05-17:35
  - margin: 20:45-21:00
  - borrow: 22:15-23:30

### Task 76: Checks that can only be made during market hours
- **Status**: 🔄 **Items 1, 2, 3 answered; item 4 remains open**
- **Agent**: Claude / Grok
- **Timestamp**: 2026-08-06 10:00:00 Asia/Taipei
- **Done**: items 1 (market-daily landing confirmed), 2 (volume discrepancy resolved in SPEC), 3 (t86 stabilization confirmed).
- **Remaining work**: Item 4: Trial-matching UI — confirm 「試撮」 badge on dashboard + 「預估」 on quote card in an auction window (08:30–09:00 or 13:25–13:30).

### quote-yahoo-a data source: stats grid omits 均價 / 成交金額 / 昨量
- **Status**: ⏳ **OPEN — Code shipped, data source decision pending**
- **Agent**: —
- **Timestamp**: 2026-08-25 15:41:49 CST
- **What is this**: 0.9.17 shipped the 個股分析 quote tab with a redesigned stats grid. The design mockup (`docs/design/quote-redesign-mockups.html`) shows three additional cells (均價, 成交金額, 昨量) beyond the current seven. The shipped grid omits these three because `PriceQuote` has no data source for them today.
- **Open work**: Data source decision (schema table, batch service, or external API integration) for the three omitted columns.

### Task 47: Refresh next year's release calendar every December (recurring)
- **Status**: 🔁 **Recurring**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **What to do**: Update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates.
- **Why manual**: BLS schedule page returns 403, so it cannot be synced automatically. `sources/scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.

### Task 132 & Task 133: Supabase Redirect URLs allow-list & DEV auth URLs
- **Status**: 🔄 **PROD 已設定；DEV 未驗證**
- **Timestamp**: 2026-09-10 15:41:33 Asia/Taipei（原開立 2026-08-31 16:45:40）
- **What is this**:
  - ~~Add app origin to Supabase Redirect URLs allow-list (`authRedirect.ts`).~~ ✅
  - In DEV (Supabase Cloud `zyebvayngwrqzoaicbwd`), update `ADDITIONAL_REDIRECT_URLS` and `SITE_URL` in Auth Settings —— ⏳ 本次的 access token 讀不到 DEV 的 auth 設定（權限不足），待有管理員權限時於 Supabase 控制台或 API 驗證。

**PROD 設定內容（2026-09-10 經 Management API 寫入，並以獨立查詢回讀確認）**

`site_url` 維持 `https://stock-pnl-web.pages.dev/`，`uri_allow_list` 由**空值**改為：

```
https://stock-pnl-web.pages.dev/**
https://*.stock-pnl-web.pages.dev/**
http://localhost:5173/**
http://localhost:5174/**
http://localhost:5175/**
```

**為什麼原本是空的卻還能登入**：`site_url` 本身永遠允許，而正式站的 `origin + pathname` 剛好等於它。第一條是把這件事寫明，不再依賴那個隱含規則。

**實際受影響的只有重設密碼**。`mailer_autoconfirm = true`，註冊確認信根本不寄，所以 `AuthContext.tsx:86` 的 `emailRedirectTo` 目前不會觸發；`AuthContext.tsx:101` 的 `resetPasswordForEmail` 一定寄信，過去從 localhost 或 preview 網址觸發時，重導目標會被悄悄換成 `site_url`，人被送回正式站。

**localhost 列了三個 port**：vite 預設 5173，但被占用時會自動遞增 —— 本次 session 實際跑到 5175。

**未動到的設定**（寫入後確認）：`disable_signup=false`、`mailer_autoconfirm=true`、`password_min_length=6`、`jwt_exp=3600`。

**日後綁自訂網域時**：新增 `https://<網域>/**`，並把 `site_url` 一併改過去。若之後開啟 email 確認（`mailer_autoconfirm` 改 false），註冊回跳會開始使用同一份清單，`authRedirect.ts:19` 已能處理 `type=signup`。
