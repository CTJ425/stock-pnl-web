# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 依稽核發現完成 P1~P4 架構、部署、測試與規格文檔全面校正同步
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-15 10:05:00 Asia/Taipei

---

## 📅 Log: 2026-09-15 10:05:00 Asia/Taipei (P1~P4 系統架構、部署與測試文檔同步)

依據稽核發現全面完成 P1~P4 文檔校正與現況同步：
1. **P1 (部署安全與 Edge 規範)**：
   - `docs/CLAUDE-tw.md`：更正 Edge Functions 部署指令，明確區分 `stock-price` 與 `ai-proxy` 維持 `verify_jwt=true`，而 `stock-report` 與 `backup-transactions` 帶 `--no-verify-jwt`；移除已廢除之 `architect` 角色與不存在之 `.claude/hooks/` 參照。
   - `sources/supabase/README.md`：新增 `ai-proxy` 部署說明（共 4 支 Edge Functions），更新 `backup-transactions`（含 `r2.ts`、`cronSecret.ts` 共 4 檔）與 `stock-report`（18 檔）、`stock-price`（7 檔）檔數；移除已廢棄之 PDF 下載與 Google News RSS 描述。
2. **P2 (專案總覽現狀同步)**：
   - `README.md`：移除 PDF 下載說明與死依賴（`jsPDF` / `html2canvas`）、目錄樹清除 `newsProxy` 與 `reportPdf`；更新測試規模至 121 檔 / 1,947 tests (100% PASS)；更正 pg_cron 排程數至 7 個；更新 AI proxy 架構與 Edge 4 支函數說明。
3. **P3 (追蹤檔案 Size Discipline 與缺陷分析)**：
   - `docs/agent/TASK.md`：將 Task 145 已完成項目 (BUG-063..071) 收攏為 `- **Done**: `，保留待處理的 OPT-1 / OPT-2；清除 Task 132/133 過時之 Docker Compose 敘述。
   - `docs/agent/BUG_FIX.md` / `FIXED_BUG.md`：將已於 PROD 配置之 Supabase Redirect URLs 移至 `FIXED_BUG.md` (BUG-082)；完成 BUG-079 程式碼深入分析，釐清 `estimateUnrealized`（取自 lot.feeRate）與 `breakEvenPrice`（取自 workspace feeRate 導致 0.6 解讀歧異）之根本原因。
4. **P4 (測試指南與架構歷程註記)**：
   - `docs/UnitTests/`：移除過時之 Docker 網域 `korq9tvdz0jd7yblr72p.ivan.lab` 並替換為 Supabase Cloud DEV ref `zyebvayngwrqzoaicbwd`；將 `backup-transactions`、`ai-proxy`、`stock-price` 之單元測試補入 `README.md` 與 `UNIT.md`；於 `E2E.md` 完整列出 10 支 E2E 與驗證腳本。
   - `docs/agent/SPEC.md` / `PLAN.md`：同步個股分析頁三層分頁結構（`analysis` 含籌碼/基本面/技術面、`whatif` 損益試算、`ai` AI分析）；註記已移除之 PDF / html2canvas；更新 0.9.51 AI proxy 金鑰隔離架構；釐清 `PLAN.md` 中 Cloudflare Worker 廢除與 R2 異地備份採用之邊界。

全套驗證：`npm test` 121 檔 / 1,947 測試 100% 通過；`npm run typecheck:edge`、`npm run build`、`npm run lint` 全數 exit 0。

## 📅 Log: 2026-09-15 09:16:32 Asia/Taipei (0.9.53, 死註解清理與部署敘述更正)

0.9.52 拔掉 PDF 產生器後，12 個檔案的註解仍在以「html2canvas 無法解析祖先層 CSS 變數」解釋圖表顏色為何寫死。該限制已不存在，註解改為陳述現況：一組字面值配色同時服務深淺兩個主題。顏色值一律未動。`StockDetailPage.tsx` 提到的 `surfaceRef` 早已不在程式中，只剩那句話。兩處刻意保留並標明為歷史記述 —— 刪掉會讓一個已做過的決定失去理由。

**更重要的是 README 被實測推翻。** 使用者問「CF page 不是會自己抓？」，查證結果是**會**。`0.9.52` 推上 GitHub 後數分鐘內，正式站就已經是該版本的建置產物：線上 bundle 含 `0.9.52` 版本字串、不含已刪的 `report-surface`，與本機建置的 JS 只差 50 個位元組 —— 差在 Supabase URL 與 publishable key，線上那份用 PROD 專案，本機用 DEV。CSS 檔 sha256 完全相同。沒有人手動上傳過。

README 步驟 9-1 原本明寫「本專案沒有前端自動部署」，已更正為 Cloudflare Pages 自動部署，手動上傳降為備援路徑。**這個錯誤有實際代價**：0.9.51 的上線順序因此被寫成「PART B 必須等人工上傳新前端之後」，但前端其實在推上 `main` 的當下就自動上線了。順帶一提，`.github/workflows/` 也不只有 `release.yml`，`ci.yml` 自 0.9.51 起就在。

**尚待確認**：Cloudflare Pages 綁的是 `main` 還是 `dev`。0.9.53 推 `dev` 之後、合併 `main` 之前查一次線上版號就能分辨。

**PROD 仍未部署（0.9.51 的 Edge 與 SQL）。** `supabase link --project-ref hrilemueiqyaoiwnkeuu` 被 Claude Code 自動模式的權限層以 `[Production Deploy]` 擋下，與 0.9.51 當時同一個攔截。PROD `functions list` 已確認沒有 `ai-proxy`，DEV 有。PROD 的 `get_ai_settings()` 是否存在則無法確認，查資料庫同樣需要先 link 到 PROD。

**分支歸屬已實測結清（2026-09-15 09:30:27 補記）。** 09:21:49 推 `dev`、不合併 `main`，正式站的 bundle 檔名七分鐘內完全沒變；09:27:34 推 `main`，1 分 40 秒後檔名換成 `index-DSrGpRJ9.js`，版本字串 `0.9.53`。**Cloudflare Pages 的正式站只建置 `main`**，推 `dev` 不會動到線上。README 步驟 9-1 已補上這一段。

**PROD 的 SQL 無法由 CLI 執行。** `supabase link --project-ref hrilemueiqyaoiwnkeuu` 回 `LegacyLinkAuthTokenError`，而且**對 DEV 執行同一條指令也回一樣的錯**，所以不是 PROD 權限不足，是 `link` 走的舊端點目前的憑證存取不到；現有的 DEV 連結是先前留下的殘存狀態，失敗的 link 沒有把它清掉。`db query --linked` 因此只能打到 DEV。剩下的路是 Supabase 後台的 SQL Editor（`--db-url` 需要資料庫密碼，會把密碼寫進指令列與對話記錄，本 repo 公開，不採用）。`functions deploy --project-ref` 是另一條驗證路徑，不受此問題影響。

**守衛已驗證有效**：帶身分守衛的 `prod-verify.sql` 對 DEV 執行時回 `is_dev=true` / `is_prod=false`，同時確認 DEV 的 0.9.51 遷移七項全部正確（`auth_reads_key=false`、`auth_execs_rpc=true`、`rpc_key_len=0` 等）。若誤把 `prod-partA.sql` / `prod-partB.sql` 打到 DEV，守衛會在同一個交易內 RAISE 並整批 rollback。

