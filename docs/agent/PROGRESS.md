# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 修復台股代號與中文搜尋失敗（BUG-081）、多目標備份與本機匯出（Task 144 #4）、發布 0.9.49
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-14 12:30:00 Asia/Taipei

---

## 📅 Log: 2026-09-14 12:30:00 Asia/Taipei (0.9.49, Task 144 #4 + BUG-081)

- **What**: 修復台股代號與中文搜尋失敗（BUG-081）、實作 Task 144 第四階段多目標備份與本機匯出功能、清理 docs 90 個過時探索文件。
- **BUG-081 Fix**: TPEx OpenAPI 上櫃行情伺服器於單一 TCP 傳輸 > 192KB 斷線導致 Edge twlist 502。新增 `tpexFallback.ts` 靜態快照，Edge `handleTwList` 即時請求失敗時自動退回快照並記錄 `warn` 至 `app_log`；`twList.ts` 增強執行階段非陣列防禦；前端 `twMarketData.ts` 加強錯誤日誌露出。
- **Task 144 #4**: Cloudflare R2 異地備份純 Web Crypto SigV4 簽署函式庫 `r2.ts`（部分失敗語意不中斷主流程）；後台 `BackupsSection.tsx` 新增「下載所有帳號最新備份」打包功能；帳號選單新增「匯出我的紀錄」（`selfExport.ts`）；新增維運排程腳本 `backup-download.cjs`。
- **Verification**: Playwright 實體瀏覽器 E2E 測試 12/12 項斷言全數 PASS；單元測試 120 檔 / 1,908 條測試 100% PASS；`npm run build` 與 `npm run typecheck:edge` 皆 exit 0；DEV 雲端端點回傳 HTTP 200 與 28,798 筆證券資料。
- **Release**: 0.9.49 合併發布至 `main`，DEV 與 PROD 雲端 Edge Function `stock-price` 部署一致。

## 📅 Log: 2026-09-14 09:56:14 Asia/Taipei (docs cleanup + Task 144-4 design decisions)

**Documentation cleanup.** Removed 90 superseded design and artifact files from `docs/`. `docs/architecture/` dropped from 85 files to 3 — only `system_design.md` (cited by `SPEC.md`), `system-architecture.svg` (cited by `README.md`), and `architecture_workflow_0.6.9.html` remain. The removed sets were abandoned UI explorations: `admin_status_*` (12), `macro_*` (32), `mui_ux_*` (14 — `package.json` has no MUI dependency), `fin_ui_*` (8), `inst_ui_*` (7), `watchlist_*` (4), and 9 single files. Also removed `docs/e2e-report.html` (2.0 MB Playwright artifact, now listed in `.gitignore`), `docs/picture/Gemini_Generated_Image_mfrb2fmfrb2fmfrb.png` (4.7 MB), the duplicate `docs/avatar-icon-designs.html`, four unreferenced `docs/design/*13px*.png` mockups, `docs/design/quote-tabs-redesign-mockup.html`, and the untracked `docs/design/carbon-three-plans.html`. `docs/` shrank from 12.2 MB to 4.0 MB. Every deleted file stays in git history. A per-filename check proved that no surviving document links to a deleted file. `docs/picture/account-avatar-icons.jpg` (448 KB) is now unreferenced and is a candidate for the next cleanup.

**Task 144-4 (Cloudflare R2 offsite backup) design approved.** Four decisions are now recorded in `docs/agent/specs/144-admin-enhancements-and-backups.md`: R2 retention stays at 7 days to match Supabase Storage; the upload uses a hand-written SigV4 REST call instead of `@aws-sdk/client-s3`; an R2 error is partial and never fatal; and the local download sub-item ships in the same phase. The spec now names the new `r2.ts` module surface, the `backup_run_log` DDL that must land before the Edge deploy, and the five Phase 4 tests. No code changed.

