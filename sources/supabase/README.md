# Supabase 後端（schema + Edge Functions）

本目錄集中放置後端所需的一切：

```
supabase/
├── schema.sql                    # 資料庫綱要 DDL（含 RLS），貼到 SQL Editor 執行
└── functions/
    ├── stock-price/              # Edge Function：現價 / 搜尋 / 匯率報價代理（4 檔）
    ├── stock-report/             # Edge Function：盤後籌碼、技術面、基本面、匯率、總經（多檔）
    └── backup-transactions/      # Edge Function：每日備份使用者資料至 backups bucket（2 檔）
```

前端以**函數名稱**呼叫（`supabase.functions.invoke('stock-price')`），所以函數名必須**完全等於** `stock-price` / `stock-report`，不可改名。

## 先決條件

1. 已在 [Supabase Console](https://supabase.com) 建立專案。
2. **已在 SQL Editor 執行 `schema.sql`**，建好 `price_cache`、`stock_names`、`chip_raw_cache` 等快取表。
   函數會寫入這些表，缺表會在執行時回 `relation does not exist`。

## 三支函數

| 函數 | 檔案 | 作用 |
|---|---|---|
| `stock-price` | `index.ts` + `intradayParse.ts` + `misParse.ts` + `quoteWindow.ts` | 伺服器端代抓現價（台股 MIS、美股 Yahoo）、模糊搜尋與外幣即時中價，繞開瀏覽器 CORS |
| `stock-report` | 17 個 `.ts`（`index.ts`、`report.ts`、`twChips.ts`、`twDaily.ts`、`twFundamental.ts`、`twProfitHistory.ts`、`twRevenueHistory.ts`、`twMarket.ts`、`twForeignTop.ts`、`usMacro.ts`、`macroCalendar.ts`、`fxRates.ts`、`pollPlan.ts`、`probeRound.ts`、`sourceProbePlan.ts`、`batchTickers.ts`、`backupAdmin.ts`） | 代抓 TWSE 盤後籌碼、日線、基本面、月營收、新聞、FRED 總經與匯率，產生**結構化報告資料**（含近 7 個交易日 history） |
| `backup-transactions` | `index.ts` + `backupPlan.ts` | 由 `backup-daily` 排程觸發，把每個帳號的 `workspaces` / `transactions` / `user_settings` 匯出成 JSON 存進私有的 `backups` bucket，每帳號保留最新 7 份 |

> **環境變數**：即點即產只用到 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（Supabase 內建自動注入，不用設）。若要啟用「盤後自動產報」，需**額外**設一個 `CRON_SECRET`（見下方章節）。

---

## 方式 A：Supabase Dashboard（免安裝任何工具）

### 建立 `stock-price`

1. 左側選單 → **Edge Functions** → 右上 **Create a function**。
2. 名稱填 `stock-price`（全小寫、連字號，與資料夾同名）。
3. 進編輯器，把 `functions/stock-price/` 下的 4 個 `.ts` 檔（`index.ts`、`intradayParse.ts`、`misParse.ts`、`quoteWindow.ts`）**全文**貼上（覆蓋範本）。
4. **JWT 驗證維持開啟**（預設值）—— Supabase 模式一定是登入後才用，前端 `functions.invoke` 會帶使用者 JWT。
   關掉只會讓它變成誰都能打的公開端點，白送 Edge Function 額度。
5. **Deploy**。

### 建立 `stock-report`（多檔，重點）

1. 一樣 Create a function，名稱 `stock-report`。
2. 編輯器左側用 **＋ 新增檔案**，逐一建立並貼上 `functions/stock-report/` 下的**所有** `.ts` 檔（檔名一字不差）：
   `index.ts`、`report.ts`、`twChips.ts`、`twDaily.ts`、`twFundamental.ts`、`twProfitHistory.ts`、
   `twRevenueHistory.ts`、`twMarket.ts`、`twForeignTop.ts`、`usMacro.ts`、`macroCalendar.ts`、
   `fxRates.ts`、`pollPlan.ts`、`probeRound.ts`、`sourceProbePlan.ts`、`batchTickers.ts`、`backupAdmin.ts`
   - ⚠️ 所有 `*.test.ts` 是單元測試，**不要上傳**。
   - ⚠️ 檔案共 **17 個**，逐檔貼幾乎必漏；**強烈建議改用下方方式 B 的 CLI**。
   - ℹ️ v0.3.7-dev.3 起已無 `reportHtml.ts`（畫面改由前端 React 繪製）。若函數是舊版部署上去的，
     請把該檔**刪除**，否則會留下沒人引用的死碼。
3. 這支**要**關閉 **Enforce JWT Verification** → **Deploy** —— pg_cron 是帶 `CRON_SECRET` 呼叫、不帶 JWT，
   不關的話盤後批次會全數 401。

### 建立 `backup-transactions`

1. Create a function，名稱 `backup-transactions`。
2. 貼上 `functions/backup-transactions/` 下的 `index.ts` 與 `backupPlan.ts`（`backupPlan.test.ts` 不要上傳）。
3. 這支**也要**關閉 **Enforce JWT Verification** → **Deploy** —— 它同樣由 pg_cron 帶 `CRON_SECRET` 呼叫。

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
#    stock-price 維持預設的 verify_jwt=true —— 前端是帶 anon JWT 呼叫的，
#    關掉只會讓它變成誰都能打的公開端點（Edge Function 額度濫用風險）。
supabase functions deploy stock-price
#    stock-report 一定要關 —— pg_cron 帶 CRON_SECRET 呼叫、不帶 JWT，
#    被重設成 true 的話盤後批次會全數 401。
supabase functions deploy stock-report --no-verify-jwt
#    backup-transactions 同樣要關 —— 它也是由 pg_cron 帶 CRON_SECRET 呼叫。
supabase functions deploy backup-transactions --no-verify-jwt
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
2. **重跑 `schema.sql`**：第 6 段會建立 `reports` bucket、啟用 `pg_cron` / `pg_net`、並排定每交易日 **16:00–23:45 每 15 分鐘**（台北，＝ UTC 8:00–15:45）呼叫 `generate-all`。執行前把 SQL 內兩個佔位符換掉：`<PROJECT_REF>`（專案 ref）、`<CRON_SECRET>`（與上一步相同）。
   **套用完一定要跑 §6d 的覆驗查詢**：`cron.schedule` 對沒替換的佔位符照收不誤，
   「SQL 執行成功」不等於「值填對了」——正式區就曾因此整段時間批次從沒靠 cron 跑起來過（BUG-002）。
   **只是要改時間**的話用 `cron.alter_job`，它保留原本的 command，密鑰碰都不用碰。
3. **手動驗證一次**（不必等排程）：
   ```bash
   curl -X POST 'https://<PROJECT_REF>.supabase.co/functions/v1/stock-report' \
     -H 'Content-Type: application/json' -H 'x-cron-secret: <CRON_SECRET>' \
     -d '{"action":"generate-all"}'
   ```
   → 回 `{ ok:true, ymd, generated, total, historyDays, dailySynced }`；`reports` bucket 內應出現
   `manifest.json`、`{ymd}/2330.json` 與 `daily/2330.json` 等物件。
   `historyDays` 是這次組到幾個交易日（滿載為 7）；**第一次執行通常只有 5**，見下方「歷史回補」。
   `dailySynced` 是這次更新了幾檔日線；**第二次執行應為 0**（已是最新就跳過，見下方「日線」）。

> **為什麼是輪詢而不是排幾班**（0.6.1 改）：原本排三班（17:30 / 22:30 / 23:30），
> 時間點是照「各源大約幾點公布」的認知訂的，而那個認知在 2026-07-27 一天內被實測推翻三處
> （T86 的時間窗被與 BFI82U 混為一談、借券 17:07 就有了、借券那份資料的語意也記錯）。
> 結論是**別再用時鐘猜發布時間**，改成密集輪詢＋看內容判斷，讓資料自己說話。
>
> 一天 32 次不會爆額度，靠的是三道閘門（實作在 `pollPlan.ts`，每條判斷都有測試釘住）：
> 1. **短路**：今天該有的都到齊且 T86 已定稿，該輪一個對外請求都不發。
> 2. **改寫偵測**：T86 自 16:00 起每 15 分鐘更新，當天第一次抓到的不一定是定稿；
>    定稿前每輪重抓比對，連續兩次相同才凍結。少了這道，早抓會把初版鎖成當天的答案。
> 3. **當日上限 40 次**：防的是我們自己的判斷邏輯出錯，以及 `CRON_SECRET` 外流。
>
> 資料尚未到齊的那幾輪只有部分區塊有內容，是**預期行為不是故障** ——
> `sources` 欄位會逐項標明各自的資料日與抓取時間。詳見 `schema.sql` §6c 的註解。

> **空間**：每份報告是 ~5KB 純 JSON（v0.3.7-dev.3 起不再存 `html` 欄位，體積約砍半）；150 檔 × 7 天 ≈ 5MB，遠低於 Free 1GB Storage。PDF 不存於伺服器（Edge Function 無瀏覽器無法產），維持前端即點即下載。

## AI 助理設定：`app_settings` 的 `ai_*` 欄位

> ⚠️ 這一節在 0.6.5 更正過。原文寫的是「`user_settings` 的 `ai_*` 欄位」，
> 那是 0.6.0-dev.1 的作法，後來改成**全站共用單列**（`app_settings`）並由
> `schema.sql` 把 `user_settings.ai_*` 五欄 DROP 掉，但這份文件沒跟著改。

`schema.sql` **§4.1** 的 `app_settings` 是單列表（`id SMALLINT PK CHECK (id = 1)`），
供「AI 分析」分頁存放**全站共用**的 AI 供應商設定：

| 欄位 | 內容 |
| ---- | ---- |
| `ai_provider` | `'google'` 或 `'openai-compatible'` |
| `ai_base_url` | OpenAI 相容端點（Ollama / vLLM）；`google` 留空 |
| `ai_model` | 模型名稱，例如 `gemini-2.5-flash` / `llama3` |
| `ai_api_key` | 明文 |
| `ai_updated_at` | 最後更新時間 |

**權限**：所有登入帳號可 SELECT；只有 `app_metadata.role = 'admin'` 可 INSERT / UPDATE。
金鑰仍會回到瀏覽器（前端直連供應商），存 DB 換到的是**全站共用一組設定**，
不是「金鑰不進瀏覽器」—— 後者要等 Edge Function 代理。

**要在既有環境套用**：只執行 §4.1 那幾行 `ALTER TABLE` / `CREATE TABLE`。
⚠️ **不要整份重跑 `schema.sql`**（見本檔開頭的警告）。

沒套用的後果：AI 設定按下儲存會回 `column "ai_provider" does not exist`，
其餘功能不受影響（報告、K 線都不讀這張表）。

### 報告 JSON 結構（目前 schema 3）

```jsonc
{
  "ticker": "2330",
  "dataDate": "2026-07-22",
  "generatedAt": "2026-07-22T12:30:00.000Z",
  "data": {
    "schema": 3,              // 前端以 MIN_REPORT_SCHEMA = 2 搭配 >= 比對（0.4.1 修）：
                              // 小於 2 才當未命中改走即點即產，新增欄位對舊前端是無害的加法
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

### 日線 OHLCV（技術面用，0.5.0 起）

同一個 `generate-all` 批次順帶抓每檔的**一年日線**，存成 `daily/{ticker}.json`（整份覆寫）。

| 項目 | 說明 |
|---|---|
| 來源 | Yahoo `query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1y`，上市 `.TW` 先試、查無再試 `.TWO` |
| 體積 | 實測 **10.8KB / 檔**（243 個交易日） |
| 跳過條件 | 既有檔案的 `lastDate >= 本次資料日` 就不重抓 —— 一天 32 輪只有第一次真的去抓 |
| 失敗處理 | 單檔失敗跳過，不影響其他檔，也不影響籌碼報告 |
| 保留期 | **不需要**。覆寫制不累積，`pruneStorage` 只認 `^\d{8}$` 的目錄名，不會碰到 `daily/` |

檔案結構：

```jsonc
{
  "schema": 1,
  "ticker": "2330",
  "asOf": "2026-07-27T09:31:00.000Z",  // 我們抓到它的時間
  "lastDate": "2026-07-24",            // 最新一根的交易日
  "rows": [                            // 由舊到新；[日期, 開, 高, 低, 收, 量]
    ["2026-07-24", 2355, 2365, 2345, 2350, 21646770]
  ]
}
```

> **兩個實測過的陷阱**（改這段程式前先讀）：
> 1. 回應會包含**五欄全 null 的假日格**（實測 2025-08-01），必須丟棄而非補 0。
> 2. `timestamp` 是 UTC 秒數、指向當地開盤時刻。**一律先加 `meta.gmtoffset` 再取 UTC 日期** ——
>    直接 `toISOString()` 在台股時區碰巧會對，但那是巧合。

### 基本面與新聞（0.6.0-dev.4 起）

同一個 `generate-all` 批次另外產出兩類覆寫制檔案，佈局與 `daily/` 同款
（不符 `^\d{8}$`，`pruneStorage` 不會碰、也不需要保留期）。

| 檔案 | 來源 | 跳過條件 | 失敗處理 |
|---|---|---|---|
| `fundamental/{ticker}.json` | OpenAPI `exchangeReport/BWIBBU_ALL`（估值）、`opendata/t187ap05_L`（月營收）、`opendata/t187ap03_L`（產業別） | 既有檔的 `dataDate >= 本次資料日` | 三份大檔全失敗就整段跳過（不把既有檔覆寫成空殼）；單檔失敗跳過 |
| `macro/us.json` | FRED 五序列（**全域單檔，非 per-ticker**）| 同一台北日曆日已抓過 | 全部失敗不覆寫既有檔 |
| `news/{ticker}.json` | Google News RSS `news.google.com/rss/search?q={股票名稱}` | 既有檔的 `asOf` 是同一個台北日曆日 | fetch 失敗 / 逾時 10 秒 / 解析 0 則時**不覆寫**既有檔（留舊新聞勝過空檔） |

三份 OpenAPI 大檔一樣走 `chip_raw_cache`（dataset key：`BWIBBU_ALL` / `T187AP05_L` / `T187AP03_L`），
所以一天 32 輪只有第一次真的去抓 —— 這正是輪詢改版沒有把流量乘上 10 倍的原因。

> **三個實測過的陷阱**（改這段程式前先讀）：
> 1. `BWIBBU_ALL` 是**英文鍵**（`Code` / `PEratio`），另外兩支是**中文鍵**（`公司代號`）。
> 2. 日期是民國制：`BWIBBU_ALL` 的 `Date` 為 7 碼（`1150724`）、`t187ap05_L` 的「資料年月」為 5 碼（`11506`）。
> 3. **產業別在兩支 API 的形態不同**：`t187ap05_L` 直接給中文（`半導體業`），
>    `t187ap03_L` 給兩位數代碼（`24`）需查 `INDUSTRY_NAMES` 對照表。故優先採用前者。
>
> 上櫃股不在這三份檔內：`fundamental/` **仍會寫檔**（欄位為 null＋`notes` 註記），
> 讓前端區分得出「批次跑過但無資料」與「批次還沒跑」。

月營收採**檔內自累積**：每次批次把最新月份併進既有的 `revenueMonths`（依年月去重、上限 12 個月），
所以首次執行只有 1 筆，逐月長到 12 筆。

#### 獲利能力比率（0.6.5 起）

同樣併在 `fundamental/{ticker}.json` 內（`FUNDAMENTAL_SCHEMA` 2 起）。

| 項目 | 內容 |
|---|---|
| 來源 | `https://openapi.twse.com.tw/v1/opendata/t187ap17_L`（上市公司營益分析查詢彙總表） |
| 欄位 | 毛利率 / 營業利益率 / 稅前純益率 / 稅後純益率（**單位 %，證交所已算好**） |
| 頻率 | 季更，**只回最新一季** |
| 累積 | 檔內自累積，最多 8 季（`PROFIT_QUARTERS_CAP`），**不做歷史回補** |

> 選它而不是綜合損益表 `t187ap06_L_ci`：比率是現成欄位，不必分五張產業別表
> 自己抓分子分母做除法。`PLAN.md §N2` 當初以「欄位解析繁瑣」否決季報，
> 那條理由在這個端點上不成立（見 §Q1）。
>
> 欄位名帶著括號說明（例：`毛利率(%)(營業毛利)/(營業收入)`），是端點原樣，
> **不要「順手整理」** —— 那是查表的鍵，改了就查不到。

#### 管理員後台 `admin-status`（0.6.12 起）

唯讀彙總，供前端「抓取狀況」頁使用。**授權是使用者 JWT + `app_metadata.role === 'admin'`，
不是 CRON_SECRET** —— 那把密鑰不能進前端（進了等於公開，任何人都能觸發整批抓取）。

| 項目 | 內容 |
|---|---|
| 授權 | `assertAdmin()`：驗 `Authorization: Bearer <使用者 JWT>` 且 `app_metadata.role === 'admin'` |
| 排程 | RPC `public.admin_schedule_status()`（schema.sql §11，只 GRANT service_role） |
| 其他 | manifest / macro / fx / 各目錄檔案數 / `batch_run_log` / `source_probe_log` |
| 耗時 | 實測 0.9–1.2 秒 |

> ⚠️ **`cron.job.command` 內含 `x-cron-secret` 明文。** §11 的函式只挑
> jobname / schedule / active / action / 目標 ref 五個欄位，**擴充回傳內容前務必重讀那段註解**。
>
> 觀測表 `batch_run_log` / `source_probe_log` 維持「有 RLS、無 policy」——
> **不要為了這個後台去加 policy**，service role 在 Edge Function 內讀完再吐出即可。

#### 美國總經指標（0.6.5 起）

**本專案第一份非個股資料**，寫成 `macro/us.json` **全域單檔**。

| 項目 | 內容 |
|---|---|
| 來源 | `https://fred.stlouisfed.org/graph/fredgraph.csv?id={序列}&cosd={起始日}` |
| 序列 | `CPILFESL` / `PPIFES` / `PCEPILFE` / `PAYEMS` / `UMCSENT` |
| 金鑰 | **不需要**（FRED 的 REST API 要，fredgraph 的 CSV 匯出不用） |
| 觸發 | 獨立的 `macro-daily` cron（`0 13,15 * * *`）打 `{"action":"sync-macro"}`，**不進 tickers 迴圈、不進 warm**（0.6.5-dev.1 曾掛在 `generate-all` 內，dev.2 拆出來） |
| 跳過 | **內容指紋一樣才跳過**，不看日期（0.6.11 起，見下方 BUG-008） |
| 快取 | **不寫 `chip_raw_cache`**（月份鍵會被 prune 依 8 碼日期字典序刪光） |

> **抓原始值自己算年增 / 月增**，不用 `transformation=pc1`：同一份序列可算出多種口徑，
> 算法是純函式測得到；交給對方轉換就得為每種口徑各抓一次，也失去驗算能力。
>
> **實測要點**：CSV 會有空值列（例 `1952-12,`），必須保留為 null ——
> 跳過會讓「前一期」錯位，補 0 會讓年增率變天文數字。
>
> **冪等為什麼不是日期（BUG-008，0.6.11 修）**：原本是「同一台北日抓過就跳過」，
> 但 `macro-daily` 排兩班的用意就是「第一班沒接到就讓第二班補」——
> 第一班「成功」抓到一份**還沒更新**的資料時，日期冪等會讓第二班一個請求都不發。
> 2026-07-30 的核心 PCE 就是如此：BEA 美東 8:30 發布、FRED 匯入更晚，
> 13:00 那班拿到的序列還沒有 2026-06；冬令時發布時間是 13:30 UTC，13:00 那班
> 甚至跑在發布之前，每個月固定慢一天。改成 `macroFingerprint` 比對整段 points 後解決。
>
> 指紋**要涵蓋整段序列而非只比最新一期** —— FRED 會回頭修正歷史值
> （2026-07-30 那次 vintage 同時改了 2026-04 與 2026-05，最新期別沒變）。
>
> 檔案有兩個時間欄位，別搞混：`asOf` 是**資料最後變動**的時間（沒新數據就不動，
> 月度資料一個月才跳一次，那是正常的）、`checkedAt` 是**最後一次問過 FRED** 的時間
> （每班都更新）。查健康度看 `checkedAt`，查資料新舊看 `asOf`。

#### 月營收歷史回補（0.6.4 起）

上面的自累積要**整整一年**才長滿，因為 `t187ap05_L` 只回最新月份、端點不吃年月參數。
0.6.4 起另接公開資訊觀測站的分月報表，把缺的月份一次補齊：

| 項目 | 內容 |
|---|---|
| 來源 | `https://mopsov.twse.com.tw/nas/t21/{sii\|otc}/t21sc03_{民國年}_{月}_0.html` |
| 觸發 | `generate-all` 每輪順手跑；另有 `POST { action: 'backfill-revenue' }`（需 `x-cron-secret`） |
| 目標 | 最近 12 個**已公布**月份（月營收次月 10 日前公布，故 10 日前只算到上上個月） |
| 單次上限 | 4 個月（`MAX_BACKFILL_MONTHS`），12 個月分 3 輪補完 |
| 短路 | 缺口為空就直接回，**一個對外請求都不發** |
| 快取 | **不進 `chip_raw_cache`**（`pruneChipCache` 按 8 碼日期字典序刪，月份鍵每輪都會被清掉）；`fundamental/*.json` 本身就是快取 |

> **三個實測過的陷阱**（2026-07-28 確認，改這段程式前先讀）：
> 1. **host 是 `mopsov` 不是 `mops`** —— `mops.twse.com.tw` 的同一條路徑已回 404。
> 2. **編碼是 big5**，要用 `new TextDecoder('big5')` 解，當 UTF-8 讀會整份變亂碼。
> 3. **年增率那格的 tag 是大寫 `<Td nowrap>`**（上市上櫃皆然）。
>    cell 比對必須大小寫不敏感，否則會少抓一欄、後面全部位移。
>
> 另外兩件事：月份**不補零**（1 月是 `115_1` 不是 `115_01`）；
> 各產業末尾的「合計」列首格是 `<th>` 而非代號，以「首格須為 4 碼數字」即可自然排除。

回補**只填缺口、不覆蓋既有值**（`mergeRevenueMonths` 的 `fillGapsOnly`）：
月營收會更正重發，讓一份較舊的爬取蓋掉 `t187ap05_L` 的更正後數字，
等於補歷史反而弄髒現況。

上市 / 上櫃兩份的代號不重疊（實測 991 / 860 家），每個月兩份都抓再合成一張表，
所以**毋需判斷某檔是上市還是上櫃** —— `transactions` 裡本來就沒存這件事。

### 歷史回補行為

報告內嵌最近 7 個交易日。單次呼叫最多實抓 **5 個**缺漏日（Edge Function 有 wall-clock 上限，T86 單檔 1–2MB），
已有快取的日子不佔額度，週六日直接跳過不抓。因此：

- **第一次**執行只會補到 5 天，`notes[]` 會寫「歷史資料回補中」，圖照樣出得來。
- 之後每天只有 1 天未命中，隔日排程自然補齊到 7 天。
- 想一次補滿，隔幾分鐘重跑 `generate-all` 即可（第二次會命中前次的快取）。

---

## 部署後驗證

1. **列表**：Edge Functions 頁應出現三支函數，狀態 Deployed；JWT 驗證 `stock-price` 為**開啟**，`stock-report` 與 `backup-transactions` 為**關閉**。
2. **實測**（前端 `.env.local` 填好 URL/anon key 後）：
   - Dashboard 持股能抓到現價 → `stock-price` 正常。
   - 台股個股按「分析」→ 個股分析頁的籌碼分頁有內容 → `stock-report` 正常。
3. **看 log**：函數的 **Logs / Invocations** 分頁，失敗會有紅色錯誤。

## 常見問題

| 症狀 | 原因 |
|---|---|
| 盤後批次全數 **401** | `stock-report` 忘了關 Enforce JWT Verification（或 CLI 少了 `--no-verify-jwt`） |
| 前端呼叫 `stock-price` 回 **401** | 未登入就呼叫（Supabase 模式應登入後使用），或函數被改成不吃 JWT 又沒帶授權標頭 |
| 部署/執行 import `./xxx.ts` 失敗 | `stock-report` 漏貼了某個檔（共 17 個 `.ts`，建議用 CLI 部署） |
| 報告功能點了沒反應 / 找不到函數 | 函數被改名，前端 `invoke('stock-report')` 對不上 |
| 前端顯示「伺服器回傳的報告格式不符」 | 函數還是舊版（產 HTML 的 schema 1）。重新部署 `stock-report` 即可 |
| 走勢圖只有幾天 | 正常，歷史回補中（見上）。隔日排程會補齊，或重跑一次 `generate-all` |
| `relation ... does not exist` | 尚未執行 `schema.sql`，快取表不存在 |
| `generate-all` 回 **401** | `CRON_SECRET` 未設，或呼叫帶的 `x-cron-secret` 與環境變數不符 |
| 排程沒跑 / `reports` bucket 是空的 | `schema.sql` 第 6 段未執行，或 `<PROJECT_REF>` / `<CRON_SECRET>` 佔位符沒換掉 |
