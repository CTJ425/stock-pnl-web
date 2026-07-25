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
| `stock-report` | `index.ts` + `report.ts` + `twChips.ts` | 代抓 TWSE 盤後籌碼，產生**結構化報告資料**（含近 7 個交易日 history） |

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
2. 編輯器左側用 **＋ 新增檔案**，逐一建立並貼上 `functions/stock-report/` 下的 3 個檔（檔名一字不差）：
   - `index.ts`
   - `report.ts`
   - `twChips.ts`
   - ⚠️ `report.test.ts`、`twChips.test.ts` 是單元測試，**不要上傳**。
   - ℹ️ v0.3.7-dev.3 起已無 `reportHtml.ts`（畫面改由前端 React 繪製）。若函數是舊版部署上去的，
     請把該檔**刪除**，否則會留下沒人引用的死碼。
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

除了「即點即產」，`stock-report` 另有 `action: 'generate-all'`：盤後由 pg_cron 觸發，一次產出全體使用者持有台股的**共用**報告（三大法人 / 融資融券 / 借券本就全市場共用），存進公開的 `reports` Storage bucket。前端改為 **Storage-first** 讀取（快、免每次打 TWSE），查無再 fallback 即點即產；個人「持股概況」不進共用報告，由前端自行渲染。只保留最近 **7 天**，同批次順便清掉更舊的報告與 `chip_raw_cache`。

**啟用步驟：**

1. **設定批次密鑰**（防止公開端點被任意觸發寫入 Storage）：
   ```bash
   supabase secrets set CRON_SECRET=<自訂一長串隨機字串>
   ```
   （或 Dashboard → Edge Functions → stock-report → Secrets）
2. **重跑 `schema.sql`**：第 6 段會建立 `reports` bucket、啟用 `pg_cron` / `pg_net`、並排定每交易日**分三段**（17:30 / 22:30 / 23:30 台北）呼叫 `generate-all`。執行前把 SQL 內兩個佔位符換掉：`<PROJECT_REF>`（專案 ref）、`<CRON_SECRET>`（與上一步相同）。
3. **手動驗證一次**（不必等排程）：
   ```bash
   curl -X POST 'https://<PROJECT_REF>.supabase.co/functions/v1/stock-report' \
     -H 'Content-Type: application/json' -H 'x-cron-secret: <CRON_SECRET>' \
     -d '{"action":"generate-all"}'
   ```
   → 回 `{ ok:true, ymd, generated, total, historyDays }`；`reports` bucket 內應出現 `manifest.json` 與 `{ymd}/2330.json` 等物件。
   `historyDays` 是這次組到幾個交易日（滿載為 7）；**第一次執行通常只有 5**，見下方「歷史回補」。

> **為什麼分三段**：各資料源公布時間差很多 —— T86 約 15:00–15:30（可能延至 16:30）、
> 融資融券約 21:00–22:00（偶爾延至 23:00）、借券約 21:00–22:30。
> 等最晚的才產報，會讓最早就緒的三大法人白白晚 6 小時。批次冪等且自我補完，
> 多跑幾次自然逐步補齊；第二、三班幾乎全快取命中，實測約 2 秒。
> 17:30 那班只有三大法人是**預期行為不是故障** —— `sources` 欄位會逐項標明各自的時間。
> 詳見 `schema.sql` §6c 的註解。

> **空間**：每份報告是 ~5KB 純 JSON（v0.3.7-dev.3 起不再存 `html` 欄位，體積約砍半）；150 檔 × 7 天 ≈ 5MB，遠低於 Free 1GB Storage。PDF 不存於伺服器（Edge Function 無瀏覽器無法產），維持前端即點即下載。

### 報告 JSON 結構（schema 2）

```jsonc
{
  "ticker": "2330",
  "dataDate": "2026-07-22",
  "generatedAt": "2026-07-22T12:30:00.000Z",
  "data": {
    "schema": 2,              // 前端讀到非 2 一律當未命中，改走即點即產
    "ticker": "2330", "name": "台積電", "market": "TPE",
    "dataDate": "2026-07-22",
    "holding": null,          // 共用報告不含個資，持股概況由前端渲染
    "institutional": { /* history 最後一筆，方便前端直接取用 */ },
    "margin": { /* 同上 */ },
    "borrow": { "availableVolume": 100267 },
    "history": [ /* ChipDay[]，由舊到新，最多 7 筆 */ ],
    "streaks": { "foreign": 4, "margin": 2, "short": 0 /* … */ },
    "sources": {                // schema 3 起：各資料源各自的資料日與抓取時間
      "institutional": { "date": "2026-07-24", "fetchedAt": "2026-07-25T04:02:50.800Z" },
      "margin":        { "date": "2026-07-24", "fetchedAt": "2026-07-25T07:32:20.445Z" },
      "borrow":        { "date": "2026-07-27", "fetchedAt": "2026-07-25T17:57:58.880Z" }
    },
    "notes": ["歷史資料回補中：…"]
  }
}
```

三大法人各項都是 `{ buy, sell, net }`（單位：**股**）；融資融券含買進 / 賣出 / 償還 / 餘額（單位：**張**）。
`source: 'openapi'` 代表當日 rwd 端點失敗、改用備援來源，此時只有餘額、無買賣拆項。

### 資料來源與 `chip_raw_cache` 的 dataset

| dataset | 端點 | 有 date 參數 | 用途 |
|---|---|---|---|
| `T86` | `rwd/zh/fund/T86` | ✅ | 三大法人逐股買進 / 賣出 / 買賣超；也是「這天是不是交易日」的判定依據 |
| `MI_MARGN_D` | `rwd/zh/marginTrading/MI_MARGN` | ✅ | 融資融券逐股（含買進 / 賣出 / 償還），走勢圖靠它 |
| `MI_MARGN` | `openapi .../exchangeReport/MI_MARGN` | ❌ | 備援：只有最新交易日餘額 |
| `SBL_D` | `rwd/zh/marginTrading/TWT96U` | ❌（但 `title` 自帶日期） | 借券賣出可用股數。**以資料自己宣告的日期為快取鍵**，分段執行才不會用到前一天的 |
| `SBL` | `openapi .../SBL/TWT96U` | ❌ | 舊的借券來源，無任何日期欄位，已不再使用 |

> `MI_MARGN_D` 的欄位名稱**有重複**（「買進」「賣出」各出現兩次），解析一律用位置索引，不可用名稱比對。
> 欄序若被 TWSE 改動，`marginDatedOk()` 的防護會判定不可用並自動回退備援來源。

### 歷史回補行為

報告內嵌最近 7 個交易日。單次呼叫最多實抓 **5 個**缺漏日（Edge Function 有 wall-clock 上限，T86 單檔 1–2MB），
已有快取的日子不佔額度，週六日直接跳過不抓。因此：

- **第一次**執行只會補到 5 天，`notes[]` 會寫「歷史資料回補中」，圖照樣出得來。
- 之後每天只有 1 天未命中，隔日排程自然補齊到 7 天。
- 想一次補滿，隔幾分鐘重跑 `generate-all` 即可（第二次會命中前次的快取）。

---

## 部署後驗證

1. **列表**：Edge Functions 頁應出現兩支函數，狀態 Deployed、JWT 顯示為關閉。
2. **實測**（前端 `.env.local` 填好 URL/anon key 後）：
   - Dashboard 持股能抓到現價 → `stock-price` 正常。
   - 台股個股按「分析」→ 個股分析頁的籌碼分頁有內容 → `stock-report` 正常。
3. **看 log**：函數的 **Logs / Invocations** 分頁，失敗會有紅色錯誤。

## 常見問題

| 症狀 | 原因 |
|---|---|
| 前端呼叫回 **401** | 忘了關 Enforce JWT Verification（或 CLI 少了 `--no-verify-jwt`） |
| 部署/執行 import `./report.ts` 失敗 | `stock-report` 只貼了 `index.ts`，漏了其餘 2 檔 |
| 報告功能點了沒反應 / 找不到函數 | 函數被改名，前端 `invoke('stock-report')` 對不上 |
| 前端顯示「伺服器回傳的報告格式不符」 | 函數還是舊版（產 HTML 的 schema 1）。重新部署 `stock-report` 即可 |
| 走勢圖只有幾天 | 正常，歷史回補中（見上）。隔日排程會補齊，或重跑一次 `generate-all` |
| `relation ... does not exist` | 尚未執行 `schema.sql`，快取表不存在 |
| `generate-all` 回 **401** | `CRON_SECRET` 未設，或呼叫帶的 `x-cron-secret` 與環境變數不符 |
| 排程沒跑 / `reports` bucket 是空的 | `schema.sql` 第 6 段未執行，或 `<PROJECT_REF>` / `<CRON_SECRET>` 佔位符沒換掉 |
