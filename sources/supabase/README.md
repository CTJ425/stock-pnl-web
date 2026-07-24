# Supabase 後端（schema + Edge Functions）

本目錄集中放置後端所需的一切：

```
supabase/
├── schema.sql                    # 資料庫綱要 DDL（含 RLS），貼到 SQL Editor 執行
└── functions/
    ├── stock-price/              # Edge Function：Yahoo Finance 現價 / 搜尋代理（單一檔）
    └── stock-report/             # Edge Function：TWSE 盤後籌碼報告產生器（多檔）
```

前端以**函數名稱**呼叫（`supabase.functions.invoke('stock-price')`），所以函數名必須**完全等於** `stock-price` / `stock-report`，不可改名。

## 先決條件

1. 已在 [Supabase Console](https://supabase.com) 建立專案。
2. **已在 SQL Editor 執行 `schema.sql`**，建好 `price_cache`、`stock_names`、`chip_raw_cache` 等快取表。
   函數會寫入這些表，缺表會在執行時回 `relation does not exist`。

## 兩支函數

| 函數 | 檔案 | 作用 |
|---|---|---|
| `stock-price` | `index.ts` | 伺服器端代抓 Yahoo Finance 現價 / 搜尋，繞開瀏覽器 CORS |
| `stock-report` | `index.ts` + `report.ts` + `twChips.ts` + `reportHtml.ts` | 代抓 TWSE 盤後籌碼、產生報告 HTML |

> **環境變數不用設**：函數只用到 `SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY`，這兩個是 Supabase 為 Edge Functions 內建自動注入的 secret。

---

## 方式 A：Supabase Dashboard（免安裝任何工具）

### 建立 `stock-price`

1. 左側選單 → **Edge Functions** → 右上 **Create a function**。
2. 名稱填 `stock-price`（全小寫、連字號，與資料夾同名）。
3. 進編輯器，把 `functions/stock-price/index.ts` **全文**貼上（覆蓋範本）。
4. 於函數 **Settings** 關閉 **Enforce JWT Verification** —— 前端只帶 anon key、不帶登入 JWT，不關會被擋 401。
5. **Deploy**。

### 建立 `stock-report`（多檔，重點）

1. 一樣 Create a function，名稱 `stock-report`。
2. 編輯器左側用 **＋ 新增檔案**，逐一建立並貼上 `functions/stock-report/` 下的 4 個檔（檔名一字不差）：
   - `index.ts`
   - `report.ts`
   - `twChips.ts`
   - `reportHtml.ts`
   - ⚠️ `report.test.ts`、`twChips.test.ts` 是單元測試，**不要上傳**。
3. 同樣關閉 **Enforce JWT Verification** → **Deploy**。

---

## 方式 B：Supabase CLI（推薦，多檔函數尤其省事）

CLI 會自動打包整個函數資料夾上傳，不必逐檔貼。

```bash
# 1. 安裝（擇一）
npm i -g supabase                 # 或：brew install supabase/tap/supabase

# 2. 登入（開瀏覽器授權）
supabase login

# 3. 綁定專案（project-ref 見 Dashboard 網址或 Project Settings → General）
cd sources
supabase link --project-ref <你的-project-ref>

# 4. 部署（--no-verify-jwt 等同 GUI 關閉 JWT 驗證）
supabase functions deploy stock-price  --no-verify-jwt
supabase functions deploy stock-report --no-verify-jwt
```

`deploy` 需在 `sources/` 目錄下執行，CLI 會尋找 `./supabase/functions/`。

---

## 部署後驗證

1. **列表**：Edge Functions 頁應出現兩支函數，狀態 Deployed、JWT 顯示為關閉。
2. **實測**（前端 `.env.local` 填好 URL/anon key 後）：
   - Dashboard 持股能抓到現價 → `stock-price` 正常。
   - 台股個股「盤後報告」能產生內容 → `stock-report` 正常。
3. **看 log**：函數的 **Logs / Invocations** 分頁，失敗會有紅色錯誤。

## 常見問題

| 症狀 | 原因 |
|---|---|
| 前端呼叫回 **401** | 忘了關 Enforce JWT Verification（或 CLI 少了 `--no-verify-jwt`） |
| 部署/執行 import `./report.ts` 失敗 | `stock-report` 只貼了 `index.ts`，漏了其餘 3 檔 |
| 報告功能點了沒反應 / 找不到函數 | 函數被改名，前端 `invoke('stock-report')` 對不上 |
| `relation ... does not exist` | 尚未執行 `schema.sql`，快取表不存在 |
