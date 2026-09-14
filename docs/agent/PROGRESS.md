# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 修復台股代號與中文搜尋失敗（BUG-081）、多目標備份與本機匯出（Task 144 #4）、發布 0.9.49
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-14 12:30:00 Asia/Taipei

---

## 📅 Log: 2026-09-14 15:29:05 Asia/Taipei (Task 160 R2 removed from scope)

使用者決定把 Cloudflare R2 移出 Task 160 範圍。`sources/scripts/snapshot.cjs` 已刪除 `readR2Config`、`signR2Put`、`copyToR2` 與相關 SigV4 helper，`--to` 現在只接受 `local` 與 `storage`，未知目的地以離開碼 1 拒絕（先前是靜默記錄失敗）。四支腳本 `grep -ci r2` 皆為 0。刪除後重跑快照仍為 1.6 MB、EXIT 0。

刻意保留、未動的三處：`supabase/functions/backup-transactions/r2.ts`（0.9.49 已進 repo，從未部署，無 `R2_*` secrets 時回報 skipped）、`stock-report/index.ts` 對 `r2_status` / `r2_error` 的讀取、以及 DEV `backup_run_log` 的那兩個欄位。**那兩個欄位不可以刪** —— `stock-report/index.ts:3867` 的 SELECT 指名了它們，PostgREST 遇到不存在的欄位會讓整個請求失敗，一旦該函式被部署，後台備份頁會整頁掛掉。

代價要說清楚：快照包現在沒有任何存在於 Supabase 帳號之外的副本。`local` 是爆炸半徑圖裡唯一在專案被刪除後還活著的目的地。這是覆蓋率的實質下降，不是中性的簡化。

## 📅 Log: 2026-09-14 15:10:00 Asia/Taipei (Task 160 Phase A complete)

Task 160 第一階段完成。三支維運腳本寫好並對 DEV 實測（除破壞性步驟外）。

實測數據：快照包 1.6 MB、137 個檔案、sha256 全數吻合。`restore.cjs --dry-run` 六個步驟全過，窄替換對真實 `schema.sql` 做了 6 個 URL 與 6 個 secret header。`wipe-dev.cjs` 對 PROD ref 與未知 ref 皆以離開碼 1 拒絕，DEV dry-run 顯示爆炸半徑為 15 張表、1 個 auth 帳號、2 個 bucket、131 個物件。

過程中修正兩個設計錯誤。其一：`chip_raw_cache` 一張表就超過 20 MB（單列最大 846 KB），是可重抓的市場快取。改為預設排除 7 張快取／日誌表後，`data-public.sql` 從 32,030,658 降到 34,935 bytes，使用者資料一張未少。其二：`supabase db dump --schema public` 不含任何 `cron.schedule`，而對 `sources/supabase/schema.sql` 整檔替換 placeholder 會破壞它自己的守衛 —— 第 1230 行的 `WHERE command LIKE '%<PROJECT_REF>%'` 是對 `cron.job` 的搜尋樣式，替換後會變成「數有幾個 job 含新 ref」＝6，直接 RAISE EXCEPTION 中止還原。因此改為窄替換，只處理 `https://<PROJECT_REF>.supabase.co` 與 `'x-cron-secret', '<CRON_SECRET>'` 兩種形式，並把 `setup.sql` 一併放進快照包。

演練限制（必須記住）：在同一個專案上砍掉重灌，測不到 GoTrue schema 漂移，而那是真實災難中最大的風險。這次演練只證明腳本機制正確，不等於「換一個新專案也能還原」。

## 📅 Log: 2026-09-14 12:30:00 Asia/Taipei (0.9.49, Task 144 #4 + BUG-081)

- **What**: 修復台股代號與中文搜尋失敗（BUG-081）、實作 Task 144 第四階段多目標備份與本機匯出功能、清理 docs 90 個過時探索文件。
- **BUG-081 Fix**: TPEx OpenAPI 上櫃行情伺服器於單一 TCP 傳輸 > 192KB 斷線導致 Edge twlist 502。新增 `tpexFallback.ts` 靜態快照，Edge `handleTwList` 即時請求失敗時自動退回快照並記錄 `warn` 至 `app_log`；`twList.ts` 增強執行階段非陣列防禦；前端 `twMarketData.ts` 加強錯誤日誌露出。
- **Task 144 #4**: Cloudflare R2 異地備份純 Web Crypto SigV4 簽署函式庫 `r2.ts`（部分失敗語意不中斷主流程）；後台 `BackupsSection.tsx` 新增「下載所有帳號最新備份」打包功能；帳號選單新增「匯出我的紀錄」（`selfExport.ts`）；新增維運排程腳本 `backup-download.cjs`。
- **Verification**: Playwright 實體瀏覽器 E2E 測試 12/12 項斷言全數 PASS；單元測試 120 檔 / 1,908 條測試 100% PASS；`npm run build` 與 `npm run typecheck:edge` 皆 exit 0；DEV 雲端端點回傳 HTTP 200 與 28,798 筆證券資料。
- **Release**: 0.9.49 合併發布至 `main`，DEV 與 PROD 雲端 Edge Function `stock-price` 部署一致。

## 📅 Log: 2026-09-14 09:56:14 Asia/Taipei (docs cleanup + Task 144-4 design decisions)

**Documentation cleanup.** Removed 90 superseded design and artifact files from `docs/`. `docs/architecture/` dropped from 85 files to 3 — only `system_design.md` (cited by `SPEC.md`), `system-architecture.svg` (cited by `README.md`), and `architecture_workflow_0.6.9.html` remain. The removed sets were abandoned UI explorations: `admin_status_*` (12), `macro_*` (32), `mui_ux_*` (14 — `package.json` has no MUI dependency), `fin_ui_*` (8), `inst_ui_*` (7), `watchlist_*` (4), and 9 single files. Also removed `docs/e2e-report.html` (2.0 MB Playwright artifact, now listed in `.gitignore`), `docs/picture/Gemini_Generated_Image_mfrb2fmfrb2fmfrb.png` (4.7 MB), the duplicate `docs/avatar-icon-designs.html`, four unreferenced `docs/design/*13px*.png` mockups, `docs/design/quote-tabs-redesign-mockup.html`, and the untracked `docs/design/carbon-three-plans.html`. `docs/` shrank from 12.2 MB to 4.0 MB. Every deleted file stays in git history. A per-filename check proved that no surviving document links to a deleted file. `docs/picture/account-avatar-icons.jpg` (448 KB) is now unreferenced and is a candidate for the next cleanup.

**Task 144-4 (Cloudflare R2 offsite backup) design approved.** Four decisions are now recorded in `docs/agent/specs/144-admin-enhancements-and-backups.md`: R2 retention stays at 7 days to match Supabase Storage; the upload uses a hand-written SigV4 REST call instead of `@aws-sdk/client-s3`; an R2 error is partial and never fatal; and the local download sub-item ships in the same phase. The spec now names the new `r2.ts` module surface, the `backup_run_log` DDL that must land before the Edge deploy, and the five Phase 4 tests. No code changed.

