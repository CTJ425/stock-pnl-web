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

> **環境變數**：即點即產只用到 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（Supabase 內建自動注入，不用設）。若要啟用「盤後自動產報」，需**額外**設一個 `CRON_SECRET`（見下方章節）。

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

## 盤後自動產報（選用）：排程產生 + Storage 保留 7 天

除了「即點即產」，`stock-report` 另有 `action: 'generate-all'`：盤後由 pg_cron 觸發，一次產出全體使用者持有台股的**共用**報告（三大法人 / 融資融券 / 借券本就全市場共用），存進公開的 `reports` Storage bucket。前端改為 **Storage-first** 讀取（快、免每次打 TWSE），查無再 fallback 即點即產；個人「持股概況」由前端疊加。只保留最近 **7 天**，同批次順便清掉更舊的報告與 `chip_raw_cache`。

**啟用步驟：**

1. **設定批次密鑰**（防止公開端點被任意觸發寫入 Storage）：
   ```bash
   supabase secrets set CRON_SECRET=<自訂一長串隨機字串>
   ```
   （或 Dashboard → Edge Functions → stock-report → Secrets）
2. **重跑 `schema.sql`**：第 6 段會建立 `reports` bucket、啟用 `pg_cron` / `pg_net`、並排定每交易日 20:30（台北）呼叫 `generate-all`。執行前把 SQL 內兩個佔位符換掉：`<PROJECT_REF>`（專案 ref）、`<CRON_SECRET>`（與上一步相同）。
3. **手動驗證一次**（不必等排程）：
   ```bash
   curl -X POST 'https://<PROJECT_REF>.supabase.co/functions/v1/stock-report' \
     -H 'Content-Type: application/json' -H 'x-cron-secret: <CRON_SECRET>' \
     -d '{"action":"generate-all"}'
   ```
   → 回 `{ ok:true, ymd, generated, total }`；`reports` bucket 內應出現 `manifest.json` 與 `{ymd}/2330.json` 等物件。

> **空間**：每份報告是 ~5KB 的 HTML+JSON；150 檔 × 7 天 ≈ 5MB，遠低於 Free 1GB Storage。PDF 不存於伺服器（Edge Function 無瀏覽器無法產），維持前端即點即下載。

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
| `generate-all` 回 **401** | `CRON_SECRET` 未設，或呼叫帶的 `x-cron-secret` 與環境變數不符 |
| 排程沒跑 / `reports` bucket 是空的 | `schema.sql` 第 6 段未執行，或 `<PROJECT_REF>` / `<CRON_SECRET>` 佔位符沒換掉 |
