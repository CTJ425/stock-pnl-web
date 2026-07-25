# 📈 股票小幫手 Web（React + TypeScript + Supabase）

由 Google Apps Script 版「試算表股票小幫手」移植而來的獨立網頁應用：
台美股交易紀錄、移動平均成本法損益、庫存總覽 Dashboard、年度收益總覽、CSV 匯入/匯出。

## 快速開始

```bash
npm install
npm run dev      # 開發伺服器（http://localhost:5173）
npm run test     # 單元測試 + UI 煙霧測試（vitest）
npm run build    # 型別檢查 + 打包（輸出 dist/，可部署 GitHub Pages）
```

## 兩種運作模式

| | 本機模式 | Supabase 模式 |
|---|---|---|
| 觸發條件 | 未設定環境變數（預設） | `.env.local` 填入 Supabase URL / Key |
| 登入 | 免登入 | Email / 密碼（Supabase Auth + RLS） |
| 資料儲存 | 瀏覽器 localStorage | Supabase PostgreSQL |
| 台股搜尋/現價 | ✅（dev 經 Vite proxy） | ✅（Edge Function 代理） |
| 美股搜尋/現價 | 需手動輸入名稱、無現價 | ✅（Edge Function 代理） |

### 切換到 Supabase 模式

1. 到 [Supabase Console](https://supabase.com) 建立專案。
2. 在 SQL Editor 執行 `supabase/schema.sql`。
3. 複製 `.env.example` 為 `.env.local`，填入 Project Settings → API 的 URL 與 anon key。
4. （建議）部署 Edge Functions（於 `sources/` 目錄，兩者皆需**關閉 Verify JWT**）：
   ```bash
   supabase functions deploy stock-price  --no-verify-jwt   # 現價 / 搜尋代理
   supabase functions deploy stock-report --no-verify-jwt   # 盤後籌碼報告
   ```
   > `stock-report` 為多檔函數；Dashboard GUI 部署與常見問題見 [`supabase/README.md`](supabase/README.md)。
5. 部署到 GitHub Pages 前，把 Supabase Auth 的 Site URL / Redirect URLs 設為 Pages 網址。

## 專案結構

```
src/
├── components/        # Auth / Dashboard / YearlyReport / Transactions / Common
├── context/           # AuthContext（登入）、WorkspaceContext（工作區與交易 + ledger 即時重算）
├── hooks/             # useStockPrices（背景非同步現價）
├── services/          # supabase 客戶端、資料層（Supabase / localStorage 雙實作）、現價與搜尋
├── types/             # 共用型別（Transaction / Workspace / Market …）
└── utils/             # pnlEngine（移動平均成本引擎）、fees、csv、formatters
supabase/
├── schema.sql                    # 資料庫綱要 DDL（含 RLS，貼到 SQL Editor 執行）
├── README.md                     # Edge Functions 建立 / 部署指南
└── functions/
    ├── stock-price/              # Edge Function：TWSE MIS / Yahoo 現價 / 搜尋代理
    └── stock-report/             # Edge Function：TWSE 盤後籌碼報告產生器
```

## 與 GAS 版的精算同構

- 移動平均成本法、超賣以 0 成本計算並警告（`pnlEngine.ts`，有單元測試對照）
- 台股手續費/證交稅元以下無條件捨去；ETF（00 開頭）證交稅 0.1%（`fees.ts`）
- Dashboard 台股未實現損益為「淨」值：預扣賣出手續費與證交稅後 round 收整
- 現價抓不到時市值/未實現留空（不誤顯示為全額虧損），並以上次快取價降級

## CSV 匯入（舊資料搬遷）

支援舊試算表「個股交易紀錄」匯出的 CSV：`TPE:2330` 前綴自動拆解為市場+代號、
「買入/賣出」自動轉為 BUY/SELL、日期格式 `2026/07/15` 或 `2026-07-15` 皆可。
匯入前有預覽與逐列錯誤提示。
