# 專案進度：已完成與未完成事項

> 更新日期：2026-07-16。前端（GitHub Pages 要部署的部分）程式碼已全部完成並通過驗證；
> 後端（Supabase）與部署尚未進行。

---

## ✅ 已完成

### 1. 設計與決策（build-docs/）
- 三份設計文件已依 2026-07-16 討論結論修訂：TypeScript、Supabase Edge Function 現價代理、
  CSV 匯入納入早期範圍、Schema 加 CHECK constraints 與 workspace 歸屬一致性驗證。
- `supabase_schema.sql`：可直接在 Supabase SQL Editor 執行的完整 DDL（含 RLS）。

### 2. 前端應用（sources/，React + TypeScript + Vite）
- **核心計算引擎** `src/utils/pnlEngine.ts`：移植 GAS `computeLedger_`（移動平均成本法、
  超賣以 0 成本計算並警告、年度彙整、台美股分開統計）；幣別改由 `market` 欄位判斷。
- **精算同構**：台股手續費/證交稅元以下無條件捨去、ETF（00 開頭）證交稅 0.1%、
  Dashboard 台股未實現損益預扣賣出費稅後 round 收整（`fees.ts`、`estimateUnrealized`）。
- **CSV 匯入/匯出** `src/utils/csv.ts`：支援舊試算表格式（`TPE:` 前綴拆解、
  「買入/賣出」轉 BUY/SELL）、逐列驗證、匯入預覽；匯出可再匯入（往返無損）。
- **三大頁面**：庫存總覽 Dashboard（KPI 大字報、台美股分區持股表、現價骨架屏與快取降級）、
  年度收益總覽（4 KPI、台美股分區、年度折疊個股明細）、交易紀錄（新增表單含代號反查、
  名稱模糊搜尋、張/零股換算、手續費自動估算；刪除；CSV 匯入/匯出）。
- **多工作區**：建立/重新命名/刪除/切換（頁首）。
- **雙模式資料層**：未設定 Supabase 環境變數 → 本機模式（localStorage、免登入，立即可用）；
  設定 `.env.local` 後自動切換 Supabase 模式（Auth + RLS）。介面同一套（`dataProvider.ts`）。
- **登入/註冊頁**（Supabase 模式用）、暗黑 Glassmorphism 主題、紅漲綠跌（數值帶 +/- 號）。
- **Edge Function 程式碼** `sources/supabase/functions/stock-price/index.ts`：
  Yahoo Finance 現價（台股自動試 .TW/.TWO）與搜尋代理，已寫好、尚未部署。
- **驗證全數通過**：`tsc` 型別檢查、`npm run build`（gzip 約 99KB）、
  25 個測試（pnlEngine/fees/csv 單元測試 + jsdom UI 煙霧測試走完「新增交易→三頁同步」
  與「CSV 匯入舊格式→損益重算」完整流程）。

### 3. 設計修正（實測發現）
- **TWSE / TPEx OpenAPI 實測未開放 CORS**（原設計假設部分端點可直連瀏覽器）。
  已調整：開發模式經 Vite dev proxy 直連（台股搜尋/現價本機可用）；
  **正式環境台美股現價與美股搜尋均依賴 Supabase Edge Function**（從「建議」升級為「上線必要」）。

---

## ⬜ 未完成（依先後順序）

1. **推上 GitHub 與部署**
   - [x] 首次 push（dev 分支）
   - [ ] GitHub Actions 自動 build 並部署 GitHub Pages（`vite.config.ts` 已設 `base: './'`）
2. **Supabase 後端建置**（使用者操作 + 少量程式配合）
   - [ ] 在 Supabase Console 建立專案
   - [ ] SQL Editor 執行 `build-docs/supabase_schema.sql`
   - [ ] `sources/.env.local` 填入 URL 與 anon key（範本見 `.env.example`）
   - [ ] 部署 Edge Function：`supabase functions deploy stock-price --no-verify-jwt`
   - [ ] Supabase Auth 設定 Site URL / Redirect URLs 為 GitHub Pages 網址
3. **正式環境驗證（原階段五）**
   - [ ] 無痕視窗走完註冊→登入→記帳→CSV 匯入→報表流程
   - [ ] 以舊試算表真實 CSV 匯入，核對持倉/已實現損益與原試算表一致
   - [ ] 安全自檢（無敏感資訊入版控、RLS 生效確認）
4. **待辦與已知限制**
   - [ ] `user_settings` 資料表尚未接上前端（手續費率目前存 localStorage，跨裝置不同步）
   - [ ] 本機模式下美股無現價、美股名稱需手動輸入（需 Edge Function 才有）
   - [ ] Supabase CLI 產生 `database.types.ts` 型別（目前以手寫型別對齊 schema）
