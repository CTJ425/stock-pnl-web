# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 盤後批次改為輪詢（0.6.1-dev.1）；測試區已部署；BUG-003 根因查明
- Status: IN PROGRESS — 測試區 schema＋函式已上（v14），**cron 待重建（缺密鑰明文）**；
  正式區依 §13.1 按兵不動，等 dev 驗證過再併 main
- Timestamp: 2026-07-27 19:52:00 Asia/Taipei

---

## 📅 Log: 2026-07-27 20:30:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.1 兩區上線並驗證；個股分析頁切回前景自動換新報告 (0.6.2)
- **Status**: 0.6.1 兩區皆已上線；0.6.2 閘門全綠（**346 tests**）並上 dev 與 main

### 0.6.1 上線結果

| | 正式區 `kxnxadaghidwumqsqneu` | 測試區 `wqetxuhncvfidqnklyew` |
| --- | --- | --- |
| `stock-report` | v10 | v14 |
| `verify_jwt` | false ✅ | false ✅ |
| `batch_run_log` | 26 欄 | 26 欄 |
| cron | jobid 11 / `*/15 8-15 * * 1-5` / url 自己 / `a7a6` | jobid 8 / 同左 / url 自己 / `54cc` |

測試區 20:15 第一輪的實測資料，形狀完全符合設計：

```
taipei_time=20:15  data_ymd=20260727  t86_today=true
t86_unchanged=0  t86_frozen=false   ← 第一次抓到，還沒定稿（要再兩輪相同）
margin_today=false                  ← 融資融券約 21:00 才到 → 不會短路，正確
borrow_data_date=2026-07-27  bwibbu_date=1150724  ← 估值檔還是上週五的
runs_today=1  skipped=false  regenerated=true  generated=5  duration_ms=15361
```

`bwibbu_date` 這欄第一天就發揮作用：它說明**基本面的資料日與籌碼的資料日不同步**，
而這件事原本只能靠猜。

### 我犯的錯：`db query` 打進了另一個專案

19:52 那次「重建測試區 cron」實際寫進了**正式區** —— `functions download` 把 cwd 留在
scratchpad，之後的 `db query --linked` 在那個沒有 link 設定的目錄下執行，CLI 退回全域設定。

**最惡劣的是它驗得過**：緊接著的覆驗查詢也在同一個錯的資料庫，
所以「url 是 wqetx、排程 `*/15`」看起來全部正確，其實是正式區被改成指向測試區。
19:53 改正式區時覆蓋掉了，期間無 cron 觸發，**無實害**，但這是運氣不是設計。

對策已寫進 `CLAUDE.md §13.3`：**任何會寫入的 `db query`，把「專案身分欄位」放進同一次查詢**
（例：`(SELECT count(*) FROM batch_run_log)`，正式區 2 / 測試區 0）。
分兩次查（先驗身分、再寫入）擋不住 —— cwd 可能在兩次之間被別的指令改掉。

### 0.6.2：切回前景時自動換上最新報告

使用者回報測試區籌碼仍顯示 `2026-07-24 · 更新於 2026-07-25 12:02`。
對檔後確認**那正是舊檔 `20260724/2609.json` 的內容**，而今天的檔是好的
（`institutional.date=2026-07-27`、20:15 抓的）—— 問題在前端只在開頁抓一次。

三班制時代一天才更新 3 次，這個缺口還藏得住；改成 32 輪之後，
**報告會在使用者看著的當下更新**，缺口就浮出來了。這是輪詢改版的連帶影響，不是舊 bug。

作法與取捨見 `SPEC.md`「前端的重抓時機」。四個測試釘住：換過一份才替換、
`generatedAt` 沒變不動 state、切到背景不抓、查無時保留現有那份。

### 0.6.1 上線當晚就抓到的真 bug：T86 指紋永遠不穩定

「待觀察」的預期形狀當場被推翻。正式區 20:30–22:00 七輪的實測：

```
20:30 unchanged=0 regenerated=true   21:15 unchanged=1 regenerated=false
20:45 unchanged=0 regenerated=true   21:30 unchanged=0 regenerated=true
21:00 unchanged=0 regenerated=true   21:45 unchanged=0 regenerated=true
                                     22:00 unchanged=1 regenerated=false
```

`t86_unchanged` 在 0/1 之間跳、**到不了 2**，所以 `t86_frozen` 永遠 false、
`decideSkip` 永遠不短路。一天 32 輪全跑，三道閘門等於全廢。

**根因**：直接抓兩次 T86 端點比對（間隔 3 秒），檔案長度同為 194,959 位元組但**位元組不同**。
逐列比對後真相是：1334 列的**內容與集合完全相同，只有 7 列的順序換了** ——
末欄相同的那幾列之間，端點的排序不穩定。

`fingerprint` 是對 `JSON.stringify` 算的，順序一變指紋就變。

**修法**：新增 `t86Fingerprint()`，先把 `data` 各列 join 後排序，
只取 `date` / `total` / 排序後的列來算 —— 看語意，不看端點今天高興怎麼排。
其餘欄位（title / fields / notes / hints）刻意排除：它們是固定樣板，
而且快取走 Postgres jsonb，**jsonb 會重排物件的鍵**，算進去等於自找另一個不穩定來源。

以實際抓下來的兩份檔案覆驗：修正前位元組不同、修正後語意指紋相同。
另加 6 個測試釘住（含「真正的改寫仍測得出來」與「少一列」兩個反向案例）。

**教訓**：內容指紋若要拿來當「東西有沒有變」的判準，
**必須先正規化到語意層**。外部端點沒有義務保證序列化穩定 ——
這裡是列順序，jsonb 那邊是鍵順序，兩個獨立的來源，都會讓位元組比對失效。

### 待觀察（今晚）

```sql
SELECT taipei_time, t86_today, t86_unchanged, t86_frozen,
       margin_today, skipped, skip_reason, regenerated, duration_ms
FROM batch_run_log WHERE taipei_ymd = '20260727' ORDER BY id;
```

預期：T86 連兩輪相同後 `t86_frozen` 轉 true；約 21:00 後 `margin_today` 轉 true；
兩者都滿足的下一輪起 `skipped=true / skip_reason=complete`，`duration_ms` 掉到幾十毫秒。
**若到 23:45 收工都沒出現 `skipped`，就是短路判斷有問題，要回頭查。**

---

## 📅 Log: 2026-07-27 19:52:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 測試區套用 0.6.1；BUG-003 根因查明
- **Status**: 測試區 2/3 完成；正式區未動
- **授權範圍**: 使用者明確授權操作正式區與測試區的 Supabase

### BUG-003 根因：測試區的 cron 打的是正式區的端點

查測試區 `cron.job`：

| 欄位 | 值 |
| --- | --- |
| url | `https://kxnxadaghidwumqsqneu.supabase.co/...` ← **正式區的 ref** |
| 密鑰 | 43 碼（`Qea5…wvro`），非佔位符 |
| `net._http_response` | 09:30:00Z（台北 17:30）→ **401 Unauthorized** |

**測試區的排程從來不是在呼叫自己的函式。** 這是 BUG-002 的變種：
同一顆「§6c 需人工替換的佔位符」地雷，只是這次不是忘了換，
而是**換成了另一個環境的值**（推測 14:04 修復時複製了正式區的 SQL）。

值得警惕的是：同一組 URL＋密鑰在 08:04:43Z（台北 16:04）**還回 200**，
是正式區後來重設 `CRON_SECRET` 才變成 401。也就是說在那之前，
**測試區的資料庫有能力觸發正式區的批次** —— 這比「測試區沒資料」嚴重。
BUG-002 的偵測 SQL 只看「密鑰長度是不是 13」，抓不到這種，已在 §6d 補上
「url 的 project ref 必須是自己」這條。

### 測試區已完成

- [x] `batch_run_log` 補 12 個新欄位＋`(taipei_ymd, id DESC)` 索引 → 共 26 欄
      （原本 14 欄、0 列資料，因為從來沒跑成功過）
- [x] `stock-report` 部署 **v14**、`--no-verify-jwt`（`verify_jwt=false` 確認未被改動）
- [x] `functions download` 逐檔 diff：僅 `*.test.ts` 不在線上（本來就不上傳），
      `pollPlan.ts` 等原始碼全部一致
- [ ] **cron job 重建** —— 卡在沒有測試區 `CRON_SECRET` 明文（`secrets list` 只回雜湊，
      §13.3）。`supabase secrets set` 也被權限規則擋下。需使用者提供或重設。

### 正式區：刻意不動

依 §13.1 dev 先行。0.6.1 只在 `dev`，正式區的基準是 `main`。
**特別危險的是排程**：若只把正式區 cron 改成 `*/15` 而程式碼仍是 0.6.0，
等於一天 32 次**沒有任何閘門**的全跑 —— 三道閘門全在 0.6.1 的程式碼裡。
正確順序是 dev 驗證一晚 → 併 main → 正式區照「ALTER → deploy → alter_job」三步走。

---

## 📅 Log: 2026-07-27 19:30:47 Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後批次由三班制改為 15 分鐘輪詢（0.6.1-dev.1）；順帶驗收 BUG-002
- **Status**: 本地完成 —— lint（3 個既有 warning）／test **342 passed**（+17）／build 全綠。
  **尚未部署任何環境，cron 也還沒改**（§13.2：對外操作需明確指示）

### BUG-002 修復驗證通過（正式區）

上一則留的「待驗證：今晚 17:30 那班」現在有答案了。正式區讀庫查證（唯讀，`db query --linked`）：

| 證據 | 值 |
| --- | --- |
| `manifest.json` `generatedAt` | `2026-07-27T09:46:47Z` ← 基準值 `08:04:50Z`，**已推進** |
| `batch_run_log` | 兩列：`17:30`（cron）與 `17:46`，皆 `t86_today=true`、`generated=5` |
| `cron.job` | `active=true`、`schedule='30 9,14,15 * * 1-5'` |

**cron 通了、`batch_run_log` 寫得進去、正式區三件事全部到位。** BUG-002 可結案。

順帶推翻一條舊認知：**17:30 就拿得到當天的 T86**（`t86_today=true`、`data_ymd=20260727`）。
`schema.sql` 原註解寫的「15:00–15:30」與 15:42 實測「還沒有」都不對，真實區間在兩者之間。

**測試區則沒跑**：`manifest.json` 仍停在 `06:03:54Z`、`ymd=20260724`（上週五）。
測試區的佔位符是 14:04 修的，理應同樣生效卻沒有 —— **待查**（見 BUG_FIX.md BUG-003）。
未再深入是因為要查得 `supabase link` 到測試區，而 link 有全域副作用（§13.3），
會把使用者目前 link 著的正式區清掉，不宜擅自為之。

### 為什麼把三班改成輪詢

「幾點公布」這個認知在 2026-07-27 一天之內被實測推翻**三次**：

| 註解寫的 | 實測 |
| --- | --- |
| T86 約 15:00–15:30 | 15:42 仍未發布；17:02 已有（15:00–15:30 其實是 BFI82U 大盤買賣金額統計表的時間窗，兩份報表被混為一談） |
| 借券約 21:00–22:30 | 17:07 就有當天的了 |
| 抓的是「借券賣出餘額」 | 實際抓的 TWT96U 是「當日可借券賣出股數」，語意根本不同 |

三次都錯在同一個地方：**用時鐘去猜一件我們沒有觀測資料的事**。
再挪一次班次只是換一個猜法。所以改成 **16:00–23:45 每 15 分鐘輪詢（32 輪）＋看內容判斷**，
並把「它幾點到的」記進 `batch_run_log`，讓下一次調整有事實可依。

還有一個獨立的理由：使用者指出 T86 **自 16:00 起每 15 分鐘更新一次**。
這直接推翻舊的 `loadT86`（當天第一次抓到就快取、之後永不更新）——
**早抓會把初版鎖成當天的答案，比晚抓一次還糟**。不做改寫偵測就不能提早抓。

### 三道閘門讓 32 輪不等於 32 倍成本

判斷邏輯全抽到新檔 `pollPlan.ts`（129 行）並以 17 個測試釘住。
**為什麼一定要獨立成檔**：`index.ts` 在模組載入時就呼叫 `Deno.serve`，vitest 匯入不了，
寫在那裡的判斷等於沒有測試 —— 而判斷寫錯的代價已從三班時代的 3 倍變成 32 倍。

1. **短路** `decideSkip`：今天 T86 已到**且已定稿**、且今天融資融券已到 → 一個對外請求都不發。
   條件必須含融資融券，否則 17:00 就收工，當天約 21:00 才發布的那份永遠抓不到。
2. **T86 改寫偵測** `nextT86State`：定稿前每輪重抓比對指紋，連續 2 次相同才凍結。
   指紋是「長度＋djb2」，刻意含內容雜湊 —— T86 被改寫的真實形態是**筆數不變、
   某幾檔的數字被更正**，只比長度或筆數會漏掉。
3. **當日上限** `MAX_RUNS_PER_DAY = 40`：cron 只排 32，正常碰不到。它防的是
   自己的判斷邏輯出錯（0.3.9 燒光額度正是這個形狀）與 `CRON_SECRET` 外流。

另外兩個省法：
- **重產閘門** `runSignature`：輸入沒變就不重產報告。省的不是空間（5 檔 × 5KB），
  是讓 `generatedAt` 只在真有變動時才跳，否則 32 輪會把「什麼時候變的」這個訊號洗掉。
- **借券快取** `loadBorrow(minYmd)`：該端點沒有 date 參數，原本每次執行都無條件重抓 244KB。
  三班時代是一天 3 次，32 輪就是一天 7.8MB 純浪費。已有「日期 ≥ 今天」的快取就直接用
  （rwd 版 title 自帶的日期是下一個交易日，所以 `>= 今天` 正是我們要的那份）。

實測位元組（2026-07-27）：T86 194KB／融資融券 128KB／借券 244KB／估值 116KB／
月營收 603KB／公司資料 1.32MB。每天實際對外抓取約 **8.7MB**；
Function 呼叫 **704 次/月**，免費額度 500,000，佔 0.14%。

### 跨輪次狀態放在觀測表，不另建表

`readLastRun` 從 `batch_run_log` 今天的最後一列取回 `runs_today` 與 T86 狀態。
這些欄位**本來就是我們想觀測的東西**（改寫幾次、什麼時候定稿），沒必要為同一份資料再建一張表。
代價是它變成半承載狀態：`logBatchRun` 刻意吞例外，寫入失敗時下一輪會當成當天第一次跑，
於是重抓一次 T86 並重新計數 —— **多做事而不是做錯事**，可接受，但別把這個特性忘了。

### 一個當場抓到的錯（靠實測資料，不是靠讀程式碼）

`margin_today` 原本寫成 `cachedToday.has(...) || (!series.marginDatedFailed && t86Today)`。
查正式區 17:46 那筆時發現 `margin_ok=true`，但 `chip_raw_cache` 裡今天的 `MI_MARGN_D`
**根本不存在**（只有 20260724 那份）——`margin_ok` 問的是「有沒有任何一天抓成功」，
不是「今天的到了沒」，拿它當備援會把整欄污染成恆真。
改為在批次跑完後重讀一次快取（`cachedAfter`），只認今天的那筆。
**這欄正是用來回答「融資融券幾點到」的，寫錯等於這次改版白做。**

### 異動範圍

- 新增：`supabase/functions/stock-report/pollPlan.ts` + `pollPlan.test.ts`（17 tests）
- 修改：`stock-report/index.ts`（`loadT86` refresh 模式、`loadBorrow` 快取、
  `readLastRun`、`handleGenerateAll` 短路與重產閘門、`syncFundamental` 回傳 `bwibbuDate`）
- 修改：`supabase/schema.sql` §6c 改排程 `*/15 8-15 * * 1-5`、新增 §6d 佔位符覆驗查詢、
  §7 以 `ADD COLUMN IF NOT EXISTS` 補 12 個欄位＋`(taipei_ymd, id DESC)` 索引
- 文件：`SPEC.md`（新增「盤後批次排程」節）、`supabase/README.md`、`README.md` 版本紀錄
- 版號三處 → `0.6.1-dev.1`

### 待辦（需使用者明確指示，§13.2）

1. **兩區重跑 `schema.sql` §7 的 ALTER**（12 個新欄位）—— 不加欄位就部署新程式碼的話，
   `logBatchRun` 會整列寫入失敗（它吞例外，所以是**無聲**的），跨輪次狀態也就永遠讀不回來，
   等於三道閘門全部失效、每輪都全跑。**順序必須是先 ALTER 再部署。**
2. **兩區部署 `stock-report`**，一定要帶 `--no-verify-jwt`（§13.3）。
3. **改 cron 排程**：用 `cron.alter_job` 而不是重跑 §6c 的 schedule ——
   後者會重寫整段 command，等於再踩一次 BUG-002 的佔位符地雷。
   ```sql
   SELECT cron.alter_job(jobid, schedule := '*/15 8-15 * * 1-5')
   FROM cron.job WHERE jobname = 'stock-report-nightly';
   ```
4. 測試區 cron 為何沒跑（BUG-003）。
5. 上一則提的安全建議仍然成立：正式區 `CRON_SECRET` 是 8 碼可猜字串，
   而 `generate-all` 的授權完全靠它。輪詢改版後端點被打的價值更高，建議改成隨機長字串。

---

## 📅 Log: 2026-07-27 16:38:10 Asia/Taipei

- **Agent**: Claude
- **Action**: 稽核 0.6.0 定版後的兩區實際狀態，補上中斷處的缺口
- **Status**: 部署已補齊並驗證；**正式區 `batch_run_log` 建表待使用者在 SQL Editor 執行**
- **授權範圍**: 使用者明確授權三項對外操作（測試區 `stock-report` 重部署、正式區
  `stock-price` 重部署、正式區建表）

### 稽核發現：一組會互相掩蓋的交叉錯配

0.6.0 定版後的部署在正式區做到一半中斷，留下的狀態是**兩區各缺對方有的那一半**：

| 項目 | 正式區 `kxnxadaghidwumqsqneu` | 測試區 `wqetxuhncvfidqnklyew` |
| --- | --- | --- |
| `stock-report` 程式碼 | ✅ v7（16:02 部署）與 main 逐檔一致 | ❌ v12 落後，缺 `logBatchRun` / `taipeiHhmm` |
| `batch_run_log`（§7） | ❌ **不存在**（REST 回 PGRST205） | ✅ 存在 |
| `app_settings`（§4.1） | ✅ | ✅ |
| `CRON_SECRET` | ✅ 16:03:55 設定 | ✅ |
| 批次產出 | ✅ 16:04 完成，0050 / 2609 / 1802 的籌碼＋日線＋基本面＋新聞皆 200 | ✅ |

**兩邊都不會報錯**，所以不主動查就看不出來：正式區有寫入程式碼但沒有表，
而 `logBatchRun` 刻意吞掉例外（觀測失敗不能拖垮批次）；測試區有表但沒有寫入程式碼。
這正是「觀測資料寫入失敗要靜默」這個正確設計的副作用 —— 它同時也讓漏套 schema 變得無聲。
**教訓：凡是刻意靜默的寫入路徑，上線後要有一次獨立的存在性檢查，不能等它自己喊。**

另外 `stock-price` 在正式區落後一行過時註解（`build-docs/supabase_schema.sql`），
是 2026-07-20 舊部署的殘留，功能無異，順手一併重部署。

### 稽核方法（可重複）

- 程式碼：`supabase functions download <slug> --project-ref <ref>` 後 `diff -r`，
  **不看版本號推論**（§13.3）。正式區比 `main`、測試區比 `dev`（本次兩者同 commit）。
- 資料表存在性：用**公開 anon key** 打 REST。缺表回 `PGRST205 / 404`，
  有表但被 RLS 擋回 `200 []` —— 兩者可區分，足以判斷 schema 有沒有套。
  正式區的 anon key 直接取自 GitHub Pages 的 bundle（本來就是公開資訊）。
- 產出檔：公開 bucket 逐個 HTTP 探測 `20260724/<t>.json`、`daily|fundamental|news/<t>.json`。
  （`object/list` 需要 policy，anon 一律回 `[]`，不能拿來判斷「沒有檔案」。）

### 已完成

- [x] 測試區 `stock-report` 重部署 → v13，`--no-verify-jwt`（`verify_jwt` 仍為 false）
- [x] 正式區 `stock-price` 重部署 → v9，用預設（`verify_jwt` 仍為 true）
- [x] 兩支重新下載逐檔 diff，皆與分支程式碼一致
- [x] 本地閘門：lint 3 個既有 warning / test **325 passed** / build 通過

### 正式區 SQL（使用者執行，16:40–16:55）

- [x] **建 `batch_run_log`**（§7）。覆驗：REST 由 `PGRST205 / 404` 變成 `200 []`
      —— 有表，且 RLS 擋住 anon 讀取，與「只由 service role 寫入、不建 policy」的設計相符。
- [x] **修好 cron 的佔位符故障** —— 詳見 FIXED_BUG.md **BUG-002**。
      診斷發現密鑰是字面值 `<CRON_SECRET>`（長度 13），亦即**正式區的盤後批次從來沒靠
      cron 跑起來過**，過去所有報告都是手動觸發的產物。這與測試區 14:04 修掉的是同一顆地雷
      —— 兩區各自套 schema，修好一邊不會連帶修好另一邊。
      修後覆驗：`active=true`、URL 正確、密鑰長度不再是 13。

### 待驗證（今晚 17:30 那班）

修復是否真的生效，只能看批次跑起來沒有。**基準值（2026-07-27 16:49 記錄）**：

| 區 | `manifest.json` 的 `generatedAt` |
| --- | --- |
| 正式區 | `2026-07-27T08:04:50.805Z`（＝台北 16:04，手動觸發那次） |
| 測試區 | `2026-07-27T06:03:54.938Z` |

17:30 之後這兩個值若往前推進，就代表 cron 通了；`batch_run_log` 也應各寫下第一列
（測試區驗證的是新部署的 v13 寫入路徑，正式區驗證的是新建的表）。

註：`secrets list` 回的是雜湊，且**不是裸 sha256**（實測 `sha256('明文')` 對不上），
所以無法用它離線驗證密鑰是否一致 —— 別把「雜湊對不上」當成密鑰錯誤的證據。

### 安全備註

正式區 `CRON_SECRET` 目前是 8 碼的可猜字串，而 `stock-report` 以 `--no-verify-jwt` 部署、
網址就在公開 bundle 裡 —— 授權完全靠這一個 header。`generate-all` 不吃白名單保護
（`generate` / `warm` 才有 `heldTwTickers` 把關），被猜中即可反覆觸發對 TWSE 的抓取。
0.3.9 燒光額度的前例值得參考。建議今晚確認批次跑通之後，改成隨機長字串並同步更新
secret 與 cron job 兩處。

---

## 📅 Log: 2026-07-27 15:57:19 Asia/Taipei

- **Agent**: Claude
- **Action**: 新增 `batch_run_log`；0.6.0 定版
- **Status**: 閘門全綠（325 tests）

### 為什麼要加 batch_run_log

排程時段的認知被證明是錯的：`schema.sql` §6c 註解寫「三大法人個股買賣超 (T86)
約 15:00–15:30」，但 2026-07-27 15:42 實測 T86 仍未發布，**同一時間 BFI82U
（大盤買賣金額統計表）已經有資料**。兩份報表被混為一談 —— 15:00–15:30 是大盤統計表的
時間窗，而我們實際在抓的個股日報要更晚（使用者提供的資料指向 16:00–17:00）。

要微調時段就需要「那一班跑的時候，當天資料到了沒」這個事實，而現有的東西都答不出來：

- `net._http_response` 只保留 6 小時
- `chip_raw_cache.updated_at` 只記「成功抓到的時間」，不記「試了但還沒發布」

故新增 `batch_run_log`（schema §7），每次 `generate-all` 寫一列。
關鍵欄位是 **`t86_today`**（`data_ymd === 執行當天的台北日期`），微調時段時看的就是它。
寫入失敗完全不影響批次 —— 這是觀測資料，不是產出。

查詢方式（累積幾天後再看）：

```sql
SELECT taipei_time, count(*) AS 跑了幾次,
       count(*) FILTER (WHERE t86_today) AS 拿到當天T86
FROM batch_run_log GROUP BY taipei_time ORDER BY taipei_time;
```

### 尚未決定：要不要加第四班

使用者問「改成四班如何」。評估結論（成本可忽略：4 班 × 22 交易日 = 88 次 invocation／月）：

**應該「加一班」而不是「挪一班」**。17:30 那班即使拿不到 T86 也不是白跑——
台股 13:30 收盤，Yahoo 日線這時早就有今天的 K 棒，`syncDaily` / `syncFundamental` /
`syncNews`（當天只抓一次，就是這班抓的）三件事都在這班完成。往後挪會連帶延後這三樣。

建議時段 `30 9,10,14,15 * * 1-5`（台北 17:30 / **18:30** / 22:30 / 23:30），
把最壞情況的延遲從 5 小時（等 22:30）縮短為 1 小時。**決定前先看 batch_run_log 的實測資料。**

另有一個未驗證的疑慮：使用者提供的資料指出官方檔案在 18:00（不含鉅額）與 20:00（含鉅額）
各產一次。若網頁版 T86 也跟著更新，18:30 抓到的可能不含鉅額——那影響的是**數字正確性**
而不只是有無。網頁端點與付費檔案是兩套發布管道，需實測比對同日 18:30 與 20:30 的數字才知道。

---

## 📅 Log: 2026-07-27 15:30:18 Asia/Taipei

- **Agent**: Claude
- **Action**: 新增 `warm` action —— 技術面與基本面即點即產
- **Status**: VERIFIED — lint / test 325 passed（+8）/ build 全綠；測試區已部署並實測

### 起因

使用者問「全新的股票是不是就不會產出基本面」。追下去確認：`heldTwTickers()` 是動態掃
`transactions`，新股票**會**被納入，但要等下一班批次（平日 17:30 / 22:30 / 23:30）。
在那之前三個分頁的行為並不一致：

- 籌碼：**立刻有**（`fetchStoredReport` 查無時 fallback 到 `generate` 即點即產）
- 技術面 / 基本面：空狀態，等批次
- AI 解讀：**直接失敗**——`AiTab` 硬性依賴日線，拿不到就 throw，不是降級

### 設計：為什麼這樣做不會重演 0.3.9

0.3.9 燒光額度的成因是「無驗證的公開端點」＋「prune 單位錯配讓每晚做白工」，
不是正常使用量。新增 fallback 的風險評估與對策：

1. **沿用 `heldTwTickers()` 白名單**（與 `generate` 同一道防線）。函式以 `--no-verify-jwt`
   部署、網址就在公開 bundle 裡，這是把濫用上限壓到最低的關鍵。
2. **查無資料也要寫檔**——這是最重要的一條。`syncFundamental` 本來就會寫（null＋notes），
   但 `syncDaily` 原本是 `if (rows.length === 0) continue`、**什麼都不寫**。
   若直接加 fallback，一檔 Yahoo 查不到的股票會變成「每次開頁都重打、永遠不會停」。
   故新增 `DailyFile.emptyCheckedDate`：查無時寫空殼檔並記下查詢日。
3. **批次刻意不看 `emptyCheckedDate`**（仍以 `lastDate` 判斷），三班要留給剛上市、
   Yahoo 還沒補資料的代號重試的機會；只有即點即產路徑吃這個條件。
4. **前端節流**：`warmStock.ts` 以 `attempted` Set 確保同代號整個 session 只送一次，
   即使伺服器回「沒產出任何東西」也不重試；`inflight` Map 處理併發去重。
5. **不含新聞**：它只服務 AI 解讀，而 AI 缺新聞本來就能正常降級（prompt 有缺料文案），
   沒必要為它在開頁路徑上多付一次 10 秒逾時的 RSS 請求。

量級：每檔新股票一次性 2 次 invocation（免費約 500K/月），可忽略。

### 線上實測（測試區）

部署後直接打端點驗證，**不是只看單元測試**：

| 測試 | 結果 |
| --- | --- |
| 已賣光的代號 2338（net = 0） | HTTP 403 ✅ |
| 從未持有 9999 / 2317 | HTTP 403 ✅ |
| 格式不正確 `../etc` | HTTP 400 ✅ |
| 持股且資料已最新 2609 | `0/0` 跳過 ✅ |
| 持股但缺資料 2330 | `dailySynced:1, fundamentalSynced:1` ✅ |
| 2330 第二次呼叫 | `0/0` 不重複做事 ✅ |

**過程中的自我修正**：我原本預期 2330 會被 403 擋下（先前批次只產出 3 檔），
結果它成功產出。查 `transactions` 後確認 **2330 台積電淨持有 2000 股、確實在白名單內**
——是使用者在 14:00 批次跑完之後才加的，這正是他發問的來源。白名單沒有問題，是我的預期錯了。
教訓：驗證防護時要先確認「測試樣本真的屬於該被擋的那一類」，否則會誤判成功或失敗。

產出內容核對：2330 產業別「半導體業」、本益比 31.59、6 月營收 442,679,969 千元（年增 +67.87%）、
日線 242 根到 2026-07-27，與 TWSE 原始 API 一致。

### 待辦

- [ ] UI 實測：加一檔新股票後開技術面／基本面，應該當場就有資料。
- [x] 正式區已於 16:02–16:04 套用（函式、§4.1、CRON_SECRET、批次產出），
      2026-07-27 16:38 稽核確認；唯一缺口是 §7 `batch_run_log`，見該則紀錄。

---

## 📅 Log: 2026-07-27 14:32:04 Asia/Taipei

- **Agent**: Claude
- **Action**: 修正 Gemini Flash 解讀被截斷；截斷不再靜默
- **Status**: IMPLEMENTED — lint / test 317 passed（+9）/ build 全綠

### 症狀與根因

使用者回報切到 Gemini Flash 後輸出被截斷，實例只有一句：
「元大台灣50（0050）於 2026 年 7 月 24 日收盤價為 101.7 元，下跌 2.2 元，跌幅」

根因有兩層，第二層是關鍵：

1. `aiClient.ts` 的 Google 請求把 `maxOutputTokens` 寫死 **1200**。0.6.0-dev.3/4 之後
   輸出要求變長（多了建議操作、注意事項兩小節，以及基本面與消息面的內容），1200 本來就偏緊。
2. **Gemini 2.5 起的「思考」（thinking）token 也計入 `maxOutputTokens`**
   （查證來源見下）。1200 額度幾乎被思考吃光，正文只剩幾十個字就被切斷 ——
   這解釋了為什麼斷點遠早於 1200 token 該有的長度。

### 修法

- `GOOGLE_MAX_OUTPUT_TOKENS = 8192`（上限不是預約量，調高不增加實際用量與費用）。
- `generationConfig.thinkingConfig = { thinkingBudget: 0 }` 關閉思考 ——
  這份工作的數字全由程式算好、prompt 又明令不得自行計算，模型只負責寫成白話，不需要推理。
- **模型不接受該參數（HTTP 400）時自動去掉重送一次。** 刻意不用模型名稱判斷支援度：
  各世代的控制欄位不同（2.5 用 thinkingBudget、3 改 thinkingLevel）且還會再變，
  寫死清單一定會過時。只退回一次，不會無限重試。
- **截斷不再靜默**：`extractGoogleText` 先前完全沒看 `finishReason`，半截文字會被當成
  完整結果回傳（就是使用者遇到的情況）。現在：有內容但 `MAX_TOKENS` → 保留文字並附上
  `TRUNCATION_NOTICE`（使用者已為它付費，丟掉更浪費）；完全沒有正文 → 拋錯並點明是
  思考吃光額度；`SAFETY` / `RECITATION` 各有專屬訊息。
- 同一類問題也存在於 OpenAI 相容路徑（`finish_reason: 'length'`，ollama 的 `num_predict`
  截斷會長一樣），一併補上。**未**替該路徑加 `max_tokens` —— 目前不設上限沒有問題，
  加了反而可能製造新的截斷。

### 查證

Google 官方文件頁當下抓不到（工具受限），改以社群與 SDK issue 佐證，多來源一致：
`thinking tokens are counted against maxOutputTokens`，額度不足時會出現
「`finishReason: MAX_TOKENS` 但 `content` 整個缺席」。相關討論：
googleapis/python-genai #2062、#782、google-gemini/gemini-cli #2104、
Google AI Developers Forum「Thinking ate all the tokens and hit MAX_TOKENS」。

### 待辦

- [ ] 使用者以 Gemini Flash 實測，確認解讀能完整寫到免責聲明那段。
- [ ] 若仍截斷（例如模型忽略 thinkingBudget），下一步是把 8192 再往上調，
      或在 UI 開放讓使用者自訂上限。

---

## 📅 Log: 2026-07-27 14:04:27 Asia/Taipei

- **Agent**: Claude
- **Action**: 測試區部署 0.6.0-dev.4/5 並線上驗證；修 2 個實測才發現的問題 + 1 個既有故障
- **Status**: VERIFIED — 測試區三檔持股（0050 / 1802 / 2609）的基本面與新聞皆已產出並核對正確
- **授權範圍**: 使用者明確授權「對 dev 都新增上去」→ **只動測試區**（`wqetxuhncvfidqnklyew`），正式區完全未觸碰

### 🔴 既有故障：測試區的夜間 cron 從來沒有真正跑起來過

觸發批次時噴 `invalid URL "https://<PROJECT_REF>.supabase.co/..."` ——
`cron.job.command` 裡是**字面的 `<PROJECT_REF>` 與 `<CRON_SECRET>` 佔位符**，當初建排程時沒代入真值。

佐證：`cron.job_run_details` **0 筆**；`net._http_response` 只有 7/26 15:09 一筆成功
（時間不對應排程三段，是手動觸發）；bucket 最新資料停在 `20260724/`。

**為什麼之前沒發現**：7/26 的稽核只查了 `active=true` 與 schedule 字串，沒看 command 內容。
**教訓**：查 cron 健康度必須看 command 本身（至少驗 `command NOT LIKE '%<PROJECT_REF>%'`），
`active=true` 完全不代表它跑得起來。

**修法**：`secrets list` 只回雜湊、拿不到舊密鑰明文，故由使用者執行一行指令產新 `CRON_SECRET`、
`secrets set` 後以真值重建排程（舊密鑰無任何東西在用，因為排程本來就是壞的）。
現況：`has_ref_placeholder=false / has_secret_placeholder=false / has_real_url=true / timeout=60000 / active=true`。

### 🔴 實測才發現的問題 1：新聞查詢撞名（已修，dev.5）

只用股票名稱查 Google News 會抓到完全無關的東西：**「陽明」回的 10 則全是陽明交通大學的校園新聞**
（教評會、國安疑慮…），與陽明海運（2609）毫無關係。這種內容餵進 AI 會產出離題的「消息面分析」。

改成 `{名稱} {代號}` 後實測三檔全部命中：`陽明 2609` / `台玻 1802` / `元大台灣50 0050` 各回 100 則正確結果。
台股名稱與機構、地名撞名太常見，**代號是唯一可靠的消歧依據**。

### 🟡 實測才發現的問題 2：ETF 被誤稱為上櫃股（已修，dev.5）

0050 三份 API 都查無 → 觸發缺料註記，但原文寫「可能為上櫃股票」。0050 是 **ETF** 不是上櫃股。
改為「查無公司基本面資料：ETF 與上櫃（TPEx）標的不在 TWSE 這三份資料中」。

### 線上驗證結果（測試區）

部署以 `functions download` 逐檔 diff 確認（§14.3 準則，不看版本號推論）：
`index.ts / twChips.ts / twDaily.ts / report.ts / twFundamental.ts / twNews.ts` 六檔與本機一致；
`stock-report` 的 `verify_jwt=false` 維持正確。

schema §4.1：`app_settings` 六欄位齊全、RLS 已啟用、單列 CHECK 在、三條 policy 正確
（SELECT 開放 authenticated、INSERT/UPDATE 限 `app_metadata.role='admin'`）、
`user_settings` 舊 `ai_*` 欄位剩 0 個。

批次產出（`fundamentalSynced: 3 / newsSynced: 3`，跳過條件二次觸發時正確生效）：

| 代號 | 產業別 | 本益比 / 殖利率 / 淨值比 | 6 月營收（千元） | 新聞 |
| --- | --- | --- | --- | --- |
| 1802 台玻 | 玻璃陶瓷 | 392.31 / — / 2.99 | 4,207,055（月增 +7.34% / 年增 +27.00%） | 10 則，皆命中 |
| 2609 陽明 | 航運業 | 16.72 / 3.88% / 0.55 | 16,591,195（月增 +9.85% / 年增 +20.18%） | 6 則，皆命中 |
| 0050 元大台灣50 | —（ETF） | — | — | 10 則 |

**交叉驗證**：台玻的新聞標題「6月營收42.07億元年增率高達27％」與我們解析出的
`4,207,055 千元 / +27.00%` 完全吻合，確認欄位對應與單位換算正確。

**Google News RSS 沒有被 Supabase 機房 IP 擋**（原本列為最大風險，實測三檔皆正常）。

### 操作備忘（下次會用到）

- `supabase db query --linked` 的輸出前面有一行 `Initialising login role...`，
  直接餵給 JSON parser 會炸，要先 `sed -n '/^{/,$p'`。
- `supabase storage ls/rm` 需要 `--experimental`；且 **`storage rm` 實測刪不掉**
  （回 `deleted: []` 且無錯誤）。要刪檔改用 Storage REST：
  `curl -X DELETE -H "Authorization: Bearer <service_role>" .../storage/v1/object/reports/<path>`，
  service key 可由 `supabase projects api-keys --reveal` 取得。
- 強制重產某類檔案時，刪掉 Storage 上的檔即可繞過跳過條件（fundamental 看 `dataDate`、news 看 `asOf` 的台北日曆日）。

### 待辦

- [ ] **使用者需登出再登入**：admin tag 是台北 11:31 貼的、最後登入是 10:32，
      目前手上的 JWT 還沒有 admin claim，AI 設定表單不會出現。
- [ ] 重新填一次 AI 設定（dev.2 的 schema 改版把舊的個人設定清掉了）。
- [ ] UI 實測：基本面分頁、產業別 badge、AI 解讀是否引用到基本面與消息面。
- [ ] 正式區未套用任何 dev.2–dev.5 的異動（schema §4.1、新版函式），併 main 時要一起處理。

---

## 📅 Log: 2026-07-27 11:25:16 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.0-dev.4 —— 基本面（估值＋月營收）、產業別、新聞入 AI
- **Status**: IMPLEMENTED — lint / test 307 passed（+13）/ build 全綠；線上部署待使用者

### 做了什麼

三項需求都沿用既有的「盤後批次 → Storage JSON → 前端直讀」管線，**無 DB schema 變更**
（`chip_raw_cache` 的 PK `(ymd, dataset)` 直接容納新 dataset key）。設計理由見 PLAN.md §N。

- **Edge Function**：新增純函式模組 `twFundamental.ts`（估值 / 月營收 / 產業別解析）與
  `twNews.ts`（Google News RSS regex 解析）；`index.ts` 加 `syncFundamental()` / `syncNews()`
  掛在 `handleGenerateAll` 的籌碼與 manifest 之後、prune 之前。
- **前端**：`fundamentalProxy.ts` / `newsProxy.ts`（照 dailyProxy 模板，schema 閘門一律 `>=`）；
  新增 `FundamentalTab.tsx`；`StockDetailPage` 加第三個分頁籤「基本面」、標題旁產業別 badge，
  並在該層載入 fundamental 一次分發給三處（badge / 分頁 / AiTab）。
- **AI**：`AiPayload` 加 `fundamental` / `news` 兩區塊（沿用 chip 的 hasData 缺料模式、單位寫進欄位名）；
  user prompt 加【基本面摘要】【近期新聞標題】兩段與缺料替代文案；
  system prompt 新增準則 7（新聞只能依標題字面判斷、不得臆測擴寫），準則 4 補上千元 / 百分比單位。

### 實測記錄（curl，2026-07-27，寫進程式註解與 supabase/README.md）

| 端點 | 筆數 | 關鍵欄位形態 |
| --- | --- | --- |
| `BWIBBU_ALL` | 1080 | **英文鍵** `Code/PEratio/DividendYield/PBratio`，`Date` 民國 7 碼 `1150724` |
| `t187ap05_L` | 1082 | 中文鍵，「資料年月」民國 5 碼 `11506`，「產業別」**直接給中文**「半導體業」 |
| `t187ap03_L` | 1092 | 中文鍵，「產業別」是**兩位數代碼** `24` → 需 `INDUSTRY_NAMES` 對照表 |
| Google News RSS | 105 則 | 單行 XML；`<title>標題 - 來源</title>` 純文字＋entity（未見 CDATA）、`<source url=...>` |

三個因此而生的實作決定：產業別**優先取 t187ap05_L 的中文名**（免維護對照表）；
民國日期分 7 碼 / 5 碼兩個轉換函式各自測試釘住；RSS 解析同時支援 CDATA 與純文字兩形態
（Google 端格式可能變動）。

### 待辦（線上操作，需使用者執行）

- [ ] **重新部署**：`cd sources && supabase functions deploy stock-report --no-verify-jwt`
      （`--no-verify-jwt` 不可省，見 CLAUDE.md §13.3）。
- [ ] （選）手動觸發一次 `generate-all` 立即回填，確認 bucket 出現 `fundamental/`、`news/` 兩個前綴。
      CRON_SECRET 明文 Agent 拿不到，需使用者自己執行。
- [ ] 實測：基本面分頁的估值數字對得上 TWSE 網站、產業別正確、AI 解讀有提到基本面與消息面且無臆測數字。
- [ ] 月營收首次只會有 1 筆（檔內自累積設計），逐月長到 12 筆——這是預期行為不是 bug。

---

## 📅 Log: 2026-07-27 10:30:22 Asia/Taipei

- **Agent**: Claude（規格 / 審查 / 驗證）＋ agy `flash`（實作，使用者以 /antigravity:delegate 明確指定）
- **Action**: 0.6.0-dev.3 —— AI 提示詞加上「建議操作」與「注意事項」
- **Status**: IMPLEMENTED — lint / test 260 passed / build 全綠

### 內容與關鍵決策

使用者要求在既有解讀之外加「建議操作與注意事項」。這與原 system prompt 準則 5
「絕對不得提供任何買賣建議、操作訊號」直接衝突——**經使用者指示放寬**：
「建議操作」僅限中性、條件式的觀察性參考，仍禁止明確買賣/加碼/出清指令、
目標價、進出場價位、報酬預期；免責聲明字句不變（測試鎖定）。

- `aiPayload.ts` `renderAiPrompt()`：準則 1 加輸出結構要求；準則 5 改寫；新增準則 6
  （注意事項＝風險訊號＋資料侷限）；免責聲明移為準則 7。user prompt 結尾加請求句。
- `aiPayload.test.ts`：補 5 條斷言（建議操作/注意事項/不得給出明確的買進），既有斷言未動。
- SPEC.md 新增「輸出結構與建議的邊界」段落；README dev.3 段落；版號三處 bump。
- 委派驗收：diff 僅涉 2 個允許檔案，Claude 逐行審過並親自重跑完整閘門（不採信 agy 自述）。

---

## 📅 Log: 2026-07-27 09:52:26 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.0-dev.2 —— AI 逾時 30s→180s；AI 設定由每帳號一份改為全站共用
- **Status**: IMPLEMENTED — lint / test（260 passed，+3 新測試）/ build 全綠；線上套用待使用者

### 變更一：AI 逾時放寬為 180 秒

使用者的 local model 30 秒跑不完。`aiClient.ts` 新增 `export const AI_TIMEOUT_MS = 180_000`
作為 `requestJson` 預設值；`AiTab.tsx` 兩處「30 秒」字樣改由 `AI_TIMEOUT_MS` 推導，
不再硬編碼（先前 UI 字串與程式值是兩份，會不同步）。逾時錯誤訊息本來就是動態組字，未動。

### 變更二：AI 設定全域化（app_settings 單列 + admin tag）

使用者要求「不分帳號、不分工作區」。評估過四案（共用 DB 表 / VITE_ 環境變數 /
Edge Function 代理 / localStorage），使用者選定共用 DB 表；寫入權限要「可指定、不綁死 email」，
採 `app_metadata.role = 'admin'` tag（只能由 Dashboard / SQL 設定，使用者無法自改）。

- `schema.sql` §4.1 **整段改版**：DROP 掉 `user_settings.ai_*` 五欄位（dev.1 的設計，僅測試區套過），
  新建 `app_settings`（`id SMALLINT PK DEFAULT 1 CHECK (id=1)` 恆為單列 + 同名五個 ai_* 欄位）。
  RLS：SELECT 開放 authenticated 全員（前端直連，金鑰必須能進瀏覽器）；
  INSERT / UPDATE 僅 `(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`。
- `aiSettings.ts`：load / save / clear 改打 `app_settings`（`id = 1` / `onConflict: 'id'`），
  移除 getUser + user_id 邏輯；新增 `isAiAdmin()`。
- `AiTab.tsx`：非管理員隱藏「AI 設定」按鈕與表單，header 顯示「全站共用，僅管理員可修改」；
  未設定時顯示「請聯絡管理員完成設定」。管理員體驗不變。
- 測試：`AiTab.test.tsx` 補 `isAiAdmin` mock 與 2 個非管理員案例（共 260 passed）。
- 文件：SPEC.md（儲存範圍、權限、180 秒）、README（dev.2 段落）、版號三處 bump `0.6.0-dev.2`。

### 待辦（線上套用，需使用者執行）

- [ ] **測試區重新套用 schema §4.1**：上一輪（00:30）套的是舊版 §4.1（user_settings.ai_* 欄位），
      新版會 DROP 舊欄位並建 `app_settings`。SQL Editor 貼新版 §4.1 段落即可（冪等、可重跑）。
      注意：舊欄位裡已存的個人 AI 設定會一併清掉，需在新表單重填一次。
- [ ] **貼 admin tag**（SQL Editor，語法見 schema.sql §4.1 註解），貼完該帳號**重新登入**才生效。
- [ ] 測試區實測：admin 可存設定；非 admin 帳號看到唯讀並可產生解讀；local model 在 180 秒內完成。
- [ ] 正式區照舊**不動**（0.6.0 併 main 時一次套用新版 §4.1）。

---

## 📅 Log: 2026-07-27 00:30:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 測試區套用 `schema.sql` §4.1（AI 設定欄位）並驗證
- **Status**: COMPLETED
- **授權範圍**: 使用者「先幫我測試一下 SQL 的部分」→ 僅動**測試區**（`wqetxuhncvfidqnklyew`）；
  **正式區完全未觸碰**，依 §14.2 需另外明確指示。

### 執行方式（可重複）

`supabase db query --linked` **不能直接把 SQL 當引數傳**：§4.1 開頭是 `--` 註解，
CLI 會把它當成旗標而噴 `UnrecognizedOption`。改用 `-f <檔>` 餵檔即可，
順便驗證了 `schema.sql` 的原文可直接執行、不必手改。

```bash
sed -n '/^-- 4.1 AI 助理設定/,/ai_updated_at TIMESTAMPTZ;/p' supabase/schema.sql > /tmp/ai_columns.sql
supabase db query --linked -f /tmp/ai_columns.sql      # 在 sources/ 底下執行
```

### 六項驗證（全通過）

| # | 檢查 | 結果 |
| --- | --- | --- |
| 1 | 套用前的失敗模式 | PostgREST 回 `42703 column user_settings.ai_provider does not exist`（與文件記載一致） |
| 2 | 欄位形狀 | `ai_provider/base_url/model/api_key` = TEXT nullable、`ai_updated_at` = TIMESTAMPTZ nullable，皆無預設值 |
| 3 | 冪等性 | 同一份 SQL 再跑一次，無錯誤（`ADD COLUMN IF NOT EXISTS` 生效） |
| 4 | RLS | `rls_enabled = true`、policy `Users can manage their own settings` 的 `polcmd = *`（ALL）—— 新欄位自動被既有 policy 覆蓋，不需新增 policy |
| 5 | PostgREST schema cache | 套用後 `select=ai_provider,…` 回 `[] / HTTP 200`（不再 42703）→ **cache 自動重載，不需手動 `NOTIFY pgrst`** |
| 6 | 匿名寫入防護 | 未登入的 upsert 被擋：`42501 new row violates row-level security policy` / HTTP 401 → 金鑰欄位不會被未登入者寫入 |

### 為什麼沒做「真的 insert 一列」的測試

`saveAiSettings` 的 upsert 只帶 `user_id` + `ai_*`，能否成功取決於其餘 NOT NULL 欄位有沒有預設值。
實際 insert 會寫進**使用者本人的資料列**，所以改用靜態證明：
`default_fee_rate` 預設 `0.001425`、`theme` 預設 `'dark'::text`、`created_at` 預設 `now()`
—— 三者都有預設，故只帶 `user_id` + `ai_*` 的 upsert 建列不會違反 NOT NULL。結論相同，且不動使用者資料。

### 待辦

- [ ] **正式區套用 §4.1**（需明確指示）。指令與上面相同，只是把 link 換成正式區
      —— 或直接在正式區 SQL Editor 貼那五行 `ALTER TABLE`（**不必重跑整份 schema.sql**）。
      提醒：`supabase link` 有全域副作用，為此重新 link 會清掉目前指向測試區的 link。
- [ ] 登入測試區實測 AI 解讀（測試區 schema 已就緒，現在可以測了）。

---

## 📅 Log: 2026-07-27 00:05:00 Asia/Taipei

- **Agent**: agy（實作）／Claude（規格、審查、修正、驗證）
- **Action**: 0.6.0-dev.1 —— 個股分析新增「AI 解讀」分頁
- **Status**: IMPLEMENTED
- **規格**: `PLAN.md §M`；**委派單**: `TASK.md` Task 17

### 使用者五項定案

UI 放個股分析頁的第四個分頁籤／金鑰存 Supabase `user_settings`（非 localStorage）／
第一版只做前端直連（代理留 0.6.1）／payload 含技術面＋籌碼 7 日但**不含持股**／
失敗與逾時行為由 Claude 決定。

### 產出

新增 `aiSettings.ts`、`aiClient.ts`（兩支 adapter：`google` 與 `openai-compatible`）、
`aiPayload.ts`（純函式）、`AiTab.tsx` 與四份測試；`StockDetailPage` 加第四個分頁籤；
`schema.sql` §4.1 五個 `ai_*` 欄位（Claude 自己寫，未委派）。

**閘門（Claude 親跑）**：lint 3 個既有 warning（未增加）、**test 258 passed**（基準 221）、build 通過。
**未動禁區**：`supabase/functions/`、`TechnicalTab` / `ChipsTab` / `HoldingTab`、無新增 npm 依賴。

### 審查抓到的 5 個問題（詳情見 TASK.md Task 17）

最嚴重的是**漲跌幅小 100 倍**：`technicalView.ts:140` 的 `changePct` 是小數比例，
UI 在顯示時會乘 100（`TechnicalTab.tsx:240`），但 agy 把原始值直接接 `%` 送進 prompt。
其餘四項：連續天數正負號未說明、三大法人漏了買進 / 賣出拆項、逾時沒包住讀 body、CSS 用了
不存在的 `var(--shadow)` 與硬寫深色疊層。全部已修正並補測試。

### 寫給後續 Agent 的三條教訓

1. **委派 AI 相關功能時，要把「數字的單位與正負號語意」當成硬性驗收項。**
   模型不會質疑你給的數字，錯誤會被包在流暢的中文裡送到使用者眼前 —— 這正是
   PLAN.md §M1.1「指標由程式算好再餵給模型」要防的事，而 0.6.0 證明**光是算好還不夠，
   標示也得對**。`changePct` 這個坑之所以存在，是因為它在 UI 端是「顯示時才乘 100」。
2. **逾時要包住讀取回應主體。** `fetch` 收到 headers 就 resolve，在那之後 clearTimeout
   等於對「headers 來了但 body 卡住」完全沒有保護。
3. **加測試時要順手驗證錯誤分類，不只驗成功路徑。** 這輪就是在補逾時測試時，
   抓到自己第一版修正把 body 階段的 `AbortError` 誤分類成 `bad-response`。

### 待辦（需使用者授權 / 執行）

- [ ] 兩區套用 `sources/supabase/schema.sql` **§4.1**（五行 `ALTER TABLE`）。
      未套用時 AI 設定按儲存會回 `column "ai_provider" does not exist`，其餘功能不受影響。
- [ ] 登入測試區實測：設定 Google AI 金鑰 → 產生解讀 → 對照技術面分頁確認漲跌幅、
      買賣超單位、連續天數方向是否一致；1280 / 390px 無水平溢出。
- [ ] **Ollama / vLLM 本機端點尚未實機驗證**（PLAN.md §M7 風險 1）：
      從 `https://` 網域打 `http://localhost` 除了 `OLLAMA_ORIGINS`，
      還可能被瀏覽器私有網路限制擋下。README 目前刻意標為「尚未實機驗證」，實測後再改寫。

---

## 📅 Log: 2026-07-26 23:15:00 Asia/Taipei

- **Agent**: Claude（驗證）／使用者（執行觸發）
- **Action**: 0.5.0 線上收尾 —— `generate-all` 觸發後的資料驗證
- **Status**: COMPLETED

### 執行與結果

使用者在兩區 SQL Editor 各跑一次前一則紀錄的 `DO` 區塊（重放 `cron.job.command`）。
批次於 `2026-07-26T15:09Z` 完成，兩區 `manifest.json` 的 `generatedAt` 同步更新。

| | `daily/*.json` | 報告本體 |
| ---- | ---- | ---- |
| 正式區 | 2609(243) / 0050(244) / 009816(119) / 1802(243) 皆 200 | `history` 7 筆，7/16–7/24 |
| 測試區 | 2609(243) / 0050(244) / 1802(243) 皆 200 | `history` 7 筆，7/16–7/24 |

兩區代號數不同是**正確的**：`heldTwTickers()` 依各環境自己的持股算，測試區沒有 009816。
009816 只有 119 筆（首日 2026-01-23）是該 ETF 上市較晚，非資料缺漏 —— 仍 > 60，MA60 畫得出來。

### 資料完整性檢查（全部通過）

- `schema = 1`，與前端 `dailyProxy.ts` 的 `MIN_DAILY_SCHEMA = 1`（`>=` 比對）相符。
- `lastDate = 2026-07-24`，等於 `dataDate`。
- 日期嚴格遞增、無重複、**無週末列**（`extractDaily` 的假日格丟棄有生效）。
- 每列 `low <= open/close <= high`、量非負、**零筆 null**（§L 的「五欄全 null 假日格丟棄」成立）。
- 兩區同代號的 `rows` 逐值相同（`asOf` 各自獨立，符合預期）。

### 結論

**0.5.0 至此完全落地**：程式碼、兩區部署、線上資料三者到位，技術面分頁不再是空狀態。
下一次排程 `30 9,14,15 * * 1-5`（台北 17:30 / 22:30 / 23:30）會以 `lastDate >= targetDate`
判斷跳過重抓，只在有新交易日時更新。

---

## 📅 Log: 2026-07-26 23:04:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.5.0 線上收尾稽核（唯讀），本機 `main` ref 快轉
- **Status**: PARTIAL — 稽核完成；觸發批次由使用者執行
- **起因**: 使用者要求「依 PLAN.md 部署 0.6.0」。實際查核發現 **0.6.0 尚未實作**（見下方「0.6.0 現況」），
  改為先收尾 0.5.0（使用者定案）。

### 稽核結果（公開 URL 探測，未異動任何環境）

`git push origin main` 已完成 —— `origin/main` = `origin/dev` = `dbf662d`（0.5.0），前端已上 Pages。

| | `manifest.json` | 20260724 報告 | `daily/*.json` |
| ---- | ---- | ---- | ---- |
| 正式區 | `ymd 20260724`，`generatedAt 2026-07-25T18:01:44Z` | 2609 / 0050 / 009816 / 1802 皆 200 | **全數 400（不存在）** |
| 測試區 | `ymd 20260724`，`generatedAt 2026-07-25T17:57:59Z` | 2609 / 0050 / 1802 皆 200 | **全數 400（不存在）** |

**為什麼日線是空的**：最後一次批次跑在 `2026-07-25T18:01Z`，而含 `syncDaily` 的
`stock-report` v5（正式）/ v8（測試）是 `2026-07-26T04:10Z` 才部署 —— 批次跑在部署之前，
`syncDaily` 一次都沒執行過。這不是故障，`TechnicalTab` 的 `'empty'` 狀態正常運作中。

`manifest.json` 的 `ymd` 停在 20260724 是**正確的**（7/24 為週五，7/25 起為週末，cron `1-5` 不跑）。
但兩區的 `generatedAt` 都落在 7/25 18:01Z 前後 4 分鐘、不對應排程三段（UTC 09:30 / 14:30 / 15:30），
研判是當時的**手動觸發**，非排程產物。

測試區 cron 完好：`stock-report-nightly | 30 9,14,15 * * 1-5 | active=true`（唯讀查詢，未動）。

### 觸發批次可以完全不碰密鑰明文（新發現，寫給後續 Agent）

`cron.job.command` 就是單一句 `net.http_post(... body '{"action":"generate-all"}' ... timeout 60000)`。
因此不需要（也不該）把 `CRON_SECRET` 取出來貼進 curl，直接讓資料庫重放那句即可：

```sql
do $$
declare c text;
begin
  select command into c from cron.job where jobname = 'stock-report-nightly';
  if c is null then raise exception 'cron job stock-report-nightly 不存在'; end if;
  execute c;
end $$;
```

在該環境的 SQL Editor 執行即可（每區各自帶自己的 URL 與密鑰，同一段 SQL 兩區通用）。
`pg_net` 是非同步，回應要等約 20–40 秒後查 `net._http_response`。
**此法取代舊紀錄裡「請使用者自己 curl」的做法** —— 密鑰始終不離開資料庫。

### 本機整理

- 本機 `main` ref 停在 `558f0c2`（0.3.6），`origin/main` 早已是 `dbf662d`。
  以 `git branch -f main origin/main` 快轉（已先確認是 fast-forward，無 rebase / 無 push）。
  這正是 7/26 11:40 那次「拿 main 當測試區基準」誤判的溫床，一併清掉。

### 0.6.0 現況（接手前必讀）

- **0.6.0 AI 助理尚未實作**：`sources/src` 內零 AI 相關程式碼，版號仍 0.5.0。
- **PLAN.md §6 指向的 `~/.claude/plans/k-ai-toasty-pearl.md` 已不存在**（該目錄現存最新者為
  籌碼 v2 的 `groovy-plotting-parnas.md`）。0.6.0 目前只剩 PLAN.md §6 三條約束
  ＋ TASK.md Task 16 的三點使用者定案，**不足以直接出委派單**。
  仍待使用者定案：UI 位置、API key 存放處（localStorage vs Supabase）、
  第一版支援哪些 provider、餵給模型的 payload 規格、失敗與逾時行為。

### 待辦（使用者執行）

- [ ] 兩區各跑一次上述 `DO` 區塊 → 查 `net._http_response` 應為 `status_code 200`、
      body 含 `dailySynced` 大於 0；之後 `daily/{ticker}.json` 公開 URL 應回 200。
      使用者已表明兩區皆自行執行。

## 📅 Log: 2026-07-26 11:58:00 Asia/Taipei

- **Agent**: Claude
- **Action**: `dev` 併入 `main` 定版 0.5.0，並部署 K 線後端
- **Status**: PARTIAL
- **起因**: 使用者「直接幫我先把 0.5-dev 合併到 main 去，不然現在好像有點混亂」

### 已完成

- [x] 先提交 main 上未提交的文件異動（`9c80241`、`63084e2`），避免與 merge 衝突糾纏。
- [x] `git merge origin/dev --no-ff` → `4189ab0`。
      衝突僅 `PROGRESS.md` 一處（兩側都在檔首新增紀錄），保留雙方條目、依時間新到舊排列。
- [x] 依 §17.3 去掉 `-dev.1` 定版 **0.5.0**，四處同步：
      `version.ts`、`package.json`、`package-lock.json`(×2 處)、`README.md` 第 3 行；
      README 版本紀錄由「0.5.0（開發中）/ dev.1」改寫為「0.5.0（2026-07-26）」定稿。
- [x] 驗證：oxlint 通過（3 個既有 fast-refresh warning）；vitest **221/221**（併入前 183）；
      `npm run build` 通過。
- [x] **測試區** `stock-report` v7 → **v8**，`--no-verify-jwt`；
      重新 download 驗證 `index.ts`/`report.ts`/`twChips.ts`/`twDaily.ts` 四檔逐位元相同，
      `verify_jwt=false` 維持不變。

- [x] **正式區** `stock-report` v4 → **v5**（使用者授權後執行），
      同樣四檔逐位元驗證通過、`verify_jwt=false` 維持不變。
- [x] 兩區 cron 皆確認為 0.4.0 的三段式 `30 9,14,15 * * 1-5`（正式區這次才補查）。

**部署後兩區最終狀態：**

| | `stock-price` | `stock-report` | cron |
| ---- | ---- | ---- | ---- |
| 正式區 | v7 `verify_jwt=true` | **v5** `verify_jwt=false` | `30 9,14,15 * * 1-5` |
| 測試區 | v3 `verify_jwt=true` | **v8** `verify_jwt=false` | `30 9,14,15 * * 1-5` |

### 待辦（下一個 Agent 接手）

- [ ] `git push origin main` 尚未執行。**推上去會觸發 GitHub Pages 自動部署**
      （`deploy.yml` 的 trigger 是 `push: branches: [main]`），前端 K 線 UI 即上線。
      後端已就緒，可以直接推。

### ⚠️ 我造成的副作用：使用者原本的 link 被清掉

使用者原先在 `/home/ivan/`（家目錄）執行過 `supabase link`，link 狀態存於
`/home/ivan/supabase/.temp/`。我為了查正式區 cron，在暫存目錄另跑了一次
`supabase link --project-ref <prod>`，**原本那個目錄整個消失**——
推測 CLI 的 link 狀態是全域單一份，重新 link 會清掉前一個，而非各目錄獨立。

已重建到**正確位置**：`sources/supabase/.temp/`（指向測試區），
`sources/supabase/.gitignore` 已忽略 `.temp`，不會弄髒 repo。
現在在 `sources/` 下可直接用 `supabase db query --linked`，已實測可用。

**教訓**：`supabase link` 有全域副作用，不是 per-directory。要查另一個專案時，
優先用支援 `--project-ref` 的指令（`functions list/deploy/download`、`secrets list`），
不要為了查詢而重新 link。只有 `db query --linked` 沒有 `--project-ref` 可用。

### 為什麼「前端先上、後端沒跟上」這次不會重演 0.4.0 故障

0.4.0 的坑是前端用 `===` 比對 schema，後端一升版就全掛。這輪不同：

1. `dailyProxy.ts` 的 `MIN_DAILY_SCHEMA` 用 **`>=`**，且在註解裡明寫這是 0.4.0 的教訓。
2. `fetchDailySeries` 查無檔案 / 格式不符 / 無有效列一律回 `null`，
   `TechnicalTab` 有獨立的 `'empty'` 狀態，顯示「這檔還沒有歷史股價」而非崩潰。

所以正式區在後端補上前，技術面分頁只會是空狀態，不是故障。

### 資料何時才會出現

`syncDaily` 掛在盤後批次裡，下次觸發是**週一 17:30**（三段式排程第一段）。
在那之前 `daily/*.json` 不會存在。若要提前驗證需手動打 `generate-all`，
但那需要 `CRON_SECRET` 明文 —— `supabase secrets list` 只回雜湊，Agent 取不到值，
必須由使用者執行。

---

## 📅 Log: 2026-07-26 11:40:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 以 supabase CLI 稽核兩區環境，補部署測試區 `stock-price`
- **Status**: COMPLETED
- **授權範圍**: 使用者明確授權 supabase CLI 操作**測試區**（`wqetxuhncvfidqnklyew`）

### 稽核方法（可重複）

用 `supabase functions download` 把線上實際跑的程式碼抓下來，跟 repo 逐檔 `diff`。
**不要只看 `functions list` 的 version / updated_at 去推論**——本次就是靠逐檔比對才發現，
版本號較新的那支反而是舊程式碼。

### ⚠️ 稽核基準錯誤（已修正，留作教訓）

第一次稽核時我人在 `main`，就拿 `main` 的程式碼去比對**測試區** —— 基準錯了。
依 CLAUDE.md §18，測試區對應的是 **`dev` 分支**，不是 main。
因此我一度得出「`stock-report` 兩區都已最新」的錯誤結論，實際上測試區缺了整個
0.5.0-dev.1 的 K 線後端。**比對環境前先確認該環境對應哪個分支。**

### 稽核結果（已用正確基準重測）

| 項目 | 測試區 (dev) — 基準 `origin/dev` | 正式區 (prod) — 基準 `main` |
| ---- | ---- | ---- |
| `stock-report` | **落後 187 行**：缺 `twDaily.ts`(115) 與 `index.ts` 的 `syncDaily`(+73)，即 0.5.0-dev.1 的 K 線後端 | 與 `main` 逐位元相同 |
| `stock-price` | **落後 137 行**，缺整個 TWSE MIS 即時報價、`misParse.ts` 根本不存在（兩分支此檔相同，故補 main 版即正確） | 僅 1 行註解路徑過時，功能等價 |
| cron 排程 | 已是 0.4.0 的三段式 `30 9,14,15 * * 1-5` | 未查（link 指向 dev） |
| `reports` bucket | 公開可讀正常 | 公開可讀正常 |
| `CRON_SECRET` | 已設定 | 未查 |

### 已執行

- [x] `supabase functions deploy stock-price --project-ref wqetxuhncvfidqnklyew`
      → v2 → v3，`verify_jwt=true` 維持不變（config.toml 無 per-function 覆寫，預設即 true）。
- [x] 驗證：重新 download 後與 repo 逐位元相同（`index.ts`、`misParse.ts` 皆是）。
- [x] 煙霧測試：`action:'prices'` 打 2330 回 `HTTP 200 {"price":2350}`。

### 刻意未動

- **正式區一律未異動。** 依 CLAUDE.md §14，正式區需另外明確指示；且該處只有一行註解漂移，
  功能等價，不值得為此重新部署。
- ~~測試區的 `stock-report` 尚未補上 K 線後端~~ → 已於 11:55 隨 0.5.0 併入 main 後補上，
  見下一則紀錄。

### 0.5 K 線後端的重點（接手前先讀）

- 版本 `0.5.0-dev.1`（commit `7c90742`，只在 `dev` 分支）。
- **不需要 schema migration。** PLAN.md §G 原本設想建 `price_daily` 資料表，實作時改為
  存進既有 `reports` bucket 的 `daily/{ticker}.json`（整份覆寫），故 `schema.sql` 未動。
  理由寫在 `stock-report/index.ts` 的 `syncDaily` 註解裡。
- 資料源是 Yahoo chart 端點（`range=1y&interval=1d`，2330 實測回 244 個交易日 / 16.8KB），
  `stock-price` 本來就在用同一個端點取現價，只是丟掉了 `timestamp` 與 `indicators`。

### 順帶記錄

- `manifest.json` 停在 `20260724` 是**正確的**：7/24 是週五，7/25、7/26 為週末，
  排程 `1-5` 本就不跑。查到日期落後時先確認星期，別誤判為故障。
- 0.4.1 只改前端（`reportProxy.ts`），**不含任何 Edge Function 異動**，
  故該版無需部署後端，走 GitHub Pages 即可。
- 使用者的 `supabase link` 執行在 `/home/ivan/`（家目錄）而非 `sources/`，
  link 狀態落在 `/home/ivan/supabase/.temp/`。因此 `supabase db query --linked`
  必須在 `/home/ivan/` 下執行；其餘指令改帶 `--project-ref` 明確指定，較不易出錯。

---

## 📅 Log: 2026-07-26 10:40:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 技術面分頁上線：日 K + 均線、成交量、KD、指標摘要 (0.5.0-dev.1)
- **Status**: COMPLETED
- **起因**: 使用者「如果我現在想要把 K 線補上，可以怎麼做？」
- **計畫檔**: `~/.claude/plans/k-ai-toasty-pearl.md`（含 0.6.0 AI 助理的規劃，本輪未實作）

### 與 PLAN §G 的偏離：日線存 Storage，不新增 `price_daily` 資料表

§G 原本設想 `price_daily(ticker,date,ohlcv)` + 約 400 天保留期。改為
**`reports` bucket 內每檔一份 `daily/{ticker}.json`、每晚整份覆寫**：

1. **沒有保留期問題**。覆寫不累積、不需要 prune —— 而 prune 的保留期單位錯配
   （砍日曆日 vs 數交易日）正是 0.3.9 修過的坑，不要再造第二個。
2. **前端直接下載、不耗 Edge Function 額度**（0.3.9 的教訓：額度燒光會連帶讓 `stock-price` 停擺）。
3. **體積實測 10.8KB / 檔**（243 個交易日），與規劃時估的約 10KB 一致。

代價是每晚重抓整年而非增量，5 檔持股 = 5 個請求，可忽略。

### 資料源實測（先驗證再寫程式）

`query1.finance.yahoo.com/v8/finance/chart/2330.TW?interval=1d&range=1y`：

| 項目 | 結果 |
| --- | --- |
| HTTP / 大小 | 200、16.8KB |
| 交易日數 | **244**（季線只需 60，餘裕充足） |
| `indicators.quote[0]` | open / high / low / close / volume 五欄齊全 |
| `meta.gmtoffset` | 28800 |
| 最後一根 | `2026-07-24`，與籌碼報告的最新交易日一致 |

**兩個實測發現的坑（不是防禦性臆測）**：
1. 回應包含**沒有資料的交易日**：2025-08-01 那格五欄全 null。這種列直接丟棄
   （244 → 243 根），留著只會讓每一條均線都要處處防 null。
2. `timestamp` 是 UTC 秒數、指向當地開盤時刻（台股 09:00 → 01:00Z）。直接
   `toISOString().slice(0,10)` 在台股時區**碰巧**會對，但那是巧合 ——
   一律先加 `gmtoffset` 再取 UTC 日期。測試以 UTC+9 的反例把這件事釘住。

### 實作

- **`twDaily.ts`（新增）**：`dailyUrl` / `yahooDailySymbols`（.TW → .TWO）/ `tradingDateOf` / `extractDaily`。純函式、可測。
- **`index.ts`**：`syncDaily()` 掛進 `handleGenerateAll`。既有檔案的 `lastDate >= 本次資料日`就跳過，
  所以三段式 cron 只有第一班真的去抓。單檔失敗不影響其他檔與籌碼報告。回應新增 `dailySynced`。
  **cron 排程完全不動** —— 日線收盤後就有，17:30 那班必定抓得到。
- **`indicators.ts`（新增）**：`sma` / `ema` / `macd` / `kd` / `rsi` / `maAlignment` / `lastValue`。
  三條共同規則寫在檔頭：輸出與輸入等長、**null 不當成 0**、遞迴狀態遇 null 不更新。
- **`technicalView.ts`（新增）**：把「先算指標、後裁切」這個順序獨立成純函式並加測試 ——
  反過來寫的話，切到「近 3 月」時 MA60 會整條變成 null。
- **`dailyProxy.ts` / `reportsBucket.ts`（新增）**：`downloadJson` 原本是 `reportProxy.ts` 的私有函式，
  日線也要用，**抽成共用模組而非複製**（比照 `holdingRows.ts` 的前例）。
- **圖表**：`CandleChart`（蠟燭 + 均線疊圖）、`MultiLineChart`（KD 雙線 + 20/80 參考線）、
  `chartPath.ts`（`lineSegments` 三處共用）。`ChartFrame` 只加一個選用的 `labelIndices`
  （未傳時行為完全不變）—— 一年 244 根不可能每根標日期。

### Verification

- `npm run test` 182 → **221 passed**（twDaily 9、indicators 14、dailyProxy 6、technicalView 7、StockDetailPage +3）
- `npm run build` 通過；`npm run lint` **維持既有 3 個 warning**
  （中途一度變 4：從 `chartFrame.tsx` 匯出非元件會觸發 `only-export-components`，
  故把 `lineSegments` 移到獨立的 `chartPath.ts`）
- Edge Function 以 esbuild bundle 過（Deno 檔不在 tsc 的 include 範圍內）
- **瀏覽器實測（Playwright，1280 / 390px）**：以本次實抓的 2330 真實資料（243 根）餵進
  臨時 mock storage server，跑的是 `dailyProxy` → supabase-js storage client → 圖表的**完整真實路徑**，
  沒有把服務層 mock 掉。結果：3 張圖、3 條均線、X 軸 6 個等距標籤、
  兩種寬度皆 `scrollWidth == clientWidth`（無水平溢出）、tooltip 含 OHLC + 三條均線 + 量、
  切到「近 3 月」後**均線仍是 3 條**（先算後裁切確實生效）、無 console error。
- **數字交叉驗證（不接受「圖看起來對」）**：以另一份獨立實作重算，
  全部與畫面逐項相符 —— MA5 2377.00 / MA20 2416.75 / MA60 2345.83、漲跌 −55.00（−2.29%）、
  量能比 0.71、KD 44.8 / 43.9、RSI14 46.2。

### 實測抓到並修掉的視覺缺陷

指標摘要用「容器底色 + 1px gap」畫分隔線，但指標有 7 個、每列格數不一定整除，
最後一列空出來的格子被整塊塗成邊框色，在 390px 下看起來像壞掉的空面板。
改成把分隔線畫在格子上（`border-right` / `border-bottom`）。

### Outstanding

1. **尚未部署到任何 Supabase 環境**（CLAUDE.md §18：需使用者明確要求）。
   部署後要驗：`daily/2330.json` 存在、`rows.length` 合理、
   第二次觸發 `generate-all` 時 `dailySynced` 為 0（跳過邏輯生效）。
   在那之前，線上的技術面分頁會顯示「這檔還沒有歷史股價」空狀態。
2. **PDF 不含技術面**。「下載 PDF」按鈕只在籌碼分頁出現（既有行為，本輪未動），
   所以 K 線不會進到 PDF。原計畫寫著「驗 K 線在 `.report-surface` 下的呈現」，
   實測才發現那個前提不成立 —— 要不要把 PDF 擴到技術面是另一個決定，本輪刻意不擴張範圍。
3. 上櫃（.TWO）路徑未經實測，只有單元測試涵蓋 —— 目前持股清單裡沒有上櫃股可驗。

---

## 📅 Log: 2026-07-26 02:40:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 修正 0.4.0 造成的線上故障 (0.4.1)
- **Status**: COMPLETED
- **回報者**: 使用者（「伺服器回傳的報告格式不符，請稍後再試 這是怎麼回事?」）

### 故障
0.4.0 上線後，個股分析的籌碼分頁**一律**顯示「伺服器回傳的報告格式不符」。
Storage-first 全數判為未命中、即點即產也被擋，整個分頁不可用。

### 原因（我造成的）
0.4.0 把 `REPORT_SCHEMA` 升到 3（新增 `sources`），但前端 `reportProxy.ts` 的守門是
`r.schema === REPORT_SCHEMA` 且 `REPORT_SCHEMA = 2` —— **等號比對**，於是 schema 3 全被拒。

更該檢討的是：我在 0.4.0 的 PLAN、README、commit message 都寫「前端接受 `schema >= 2`」，
**但那個改動從未進到這一版**。`>= 2` 是 0.3.7-dev.5（EPS）時做的，隨著 EPS 被回退（688d9ec）
一起消失了，我卻把那個說法沿用下來、沒有回頭確認程式碼實際長什麼樣。
**文件寫了什麼不等於程式碼做了什麼。**

### 為什麼測試沒抓到
- `reportProxy.test.ts` 的 fixture 是 schema 2 → 等號比對照樣通過
- `StockDetailPage.test.tsx` 把整個 `reportProxy` 模組 mock 掉 → 根本沒執行到守門
- 兩者都沒有「後端回新版、前端要收」這個案例

### 修正
`MIN_REPORT_SCHEMA = 2` + `>=` 比對，並在常數註解寫明「為什麼必須是 >=」。
補上回歸測試：schema 3 與 schema 99 都必須被接受。
**已反向驗證**：該測試在修正前會失敗、修正後通過 —— 確認它真的擋得住這個錯。

### 教訓（寫給後續 Agent）
1. 伺服器的結構版本升級對舊前端是**加法**，守門一律用 `>=`，不要用 `===`。
2. 元件測試把資料層整個 mock 掉時，資料層自己的邊界必須另有測試涵蓋 ——
   否則「兩邊各自通過、串起來壞掉」不會被發現。
3. 跨版本的相容性宣稱要當成**行為**來測，不能只寫在文件裡。

---

## 📅 Log: 2026-07-26 02:10:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後批次分段執行、逐區塊標示資料時間、借券改用自帶日期的端點 (0.4.0)
- **Status**: COMPLETED
- **起因**: 使用者提議「不能分段執行嗎？能更新的就先更新，並且標註更新時間」

### 為什麼這個提議成立
1. **`generate-all` 本來就冪等且會自我補完** —— 每次重讀快取、只抓缺的、覆寫整份報告。
   「跑三次、能更新的先更新」不需要新機制，加 cron 條目就會發生。
2. **逐項更新時間的資料早就存在** —— `chip_raw_cache.updated_at` 就是「這份 dataset 何時抓到的」，
   逐日逐 dataset 都有，只是沒放進報告。

### 但分段執行會放大一個既有的坑（實測確認）
借券與備援融資融券的回應**完全沒有日期欄位**（實測：`['TWSECode','TWSEAvailableVolume',
'GRETAICode','GRETAIAvailableVolume']`，裸陣列）。而 `readLatest` 是「有快取就直接用」：
早班（17:30）抓到的其實是前一天的借券、卻存成今天，後面幾班因快取已存在而**永遠沿用那份錯的**。
從偶發變成必然。

**解法**：找到帶日期的 rwd 端點 `rwd/zh/marginTrading/TWT96U`。
`date` 參數實測**無效**（三個不同日期回同一份），但 **`title` 自帶日期**
（`115年07月27日 當日可借券賣出股數`），足以判斷拿到的是哪一天 —— 以此為快取鍵（新 dataset `SBL_D`）。

**順帶修正語意錯位**：「可借券賣出股數」是**下一個交易日**的額度，不是收盤那天的數字
（實測最後交易日 07/24 時 title 為 07/27）。原本混在收盤日底下顯示，現在各自標日期。

### 實作
- `twChips.ts`：`BORROW_DATED_URL` / `parseRocTitleDate` / `extractBorrowDated` /
  `borrowDatedOk` / `borrowDatedDate`。rwd 的儲存格把代號包在 `<a>` 裡、每列是兩欄配對（4 格），都已處理。
- `report.ts`：新增 `SourceStamp` / `ReportSources`，`REPORT_SCHEMA` 2 → **3**。
- `index.ts`：`fetchedAtByDataset` 在讀/寫快取時記下時間；`loadLatestOnlySources` 拆成
  `loadBorrow`（以資料自己的日期為鍵）與 `loadMarginFallback`；`assembleOne` 組出 `sources`。
- 前端：`SourceTag` 元件逐區塊顯示「資料日 X · 更新於 Y」；融資融券未到的文案改為
  「今日尚未公布（約 21:00–22:00），稍晚會自動補上」並點明三大法人不受影響。
- cron：`'30 15 * * 1-5'` → **`'30 9,14,15 * * 1-5'`**（17:30 / 22:30 / 23:30 台北）。

### 驗證（兩區皆已部署）
- `chip_raw_cache` 出現 `SBL_D` 且 **ymd = 20260727**（借券自己的日期），
  而非籌碼的 20260724 —— 早晚班不會互相污染。
- 報告 `schema: 3`，`sources` 三項的 `fetchedAt` **各不相同**
  （institutional 04:02、margin 07:32、borrow 17:57 UTC），逐項新鮮度確實生效。
- `npm run test` 170 → **182 passed**；`build` 通過；`lint` 維持 3 個既有 warning。
- Edge Function 檔案先以 esbuild parse 過再部署（Deno 檔不在 tsc 的 include 範圍內）。

### Outstanding
第一次三段式自動執行是 **2026-07-27（週一）** 的 17:30 / 22:30 / 23:30。
預期 17:30 那班只有三大法人、`sources.margin` 為 null，22:30 或 23:30 補齊 —— 這正是要驗的行為。

---

## 📅 Log: 2026-07-26 11:10:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 夜間排程時間 20:30 → 23:30 (0.3.10)
- **Status**: COMPLETED
- **起因**: 使用者問「為什麼是 20:30？」，接著要求查各網站的實際更新時間

### 查證結果（各資料源的公布時間）
| 資料 | 公布時間 | 原本的 20:30 |
| --- | --- | --- |
| 三大法人個股買賣超 (T86) | 約 15:00–15:30，大行情可能延至 16:30 | ✅ 來得及 |
| 融資融券餘額 | 約 21:00–22:00，偶爾延至 22:30–23:00 | ❌ 太早 |
| 借券賣出餘額 | 約 21:00–22:30，每晚二次更新 | ❌ 太早 |

**證據來源與其限制**：TWSE 官網的 T86 與融資融券頁面**都沒有標示更新時間**（已實際抓取確認），
所以無法取得一手文件。融資融券的 21:30 來自 Yahoo 股市說明頁，與使用者提供的整理表
（21:00–22:00）一致 —— 兩個獨立來源相符。T86 的差異（表 15:00–15:30 vs Yahoo 17:00）
可解釋為「證交所發布」與「Yahoo 轉載上架」的時間差，我們直接打 TWSE，故採前者。
使用者那張表標題掛「臺灣證券交易所」但含期交所項目，應為多來源彙整而非官方文件。

### 原設定的實際後果（照程式碼推導，非臆測）
20:30 執行時 T86 已有 → 當天**算得上交易日**、被收進 history；但：
1. `loadMarginDated` 抓不到當天資料 → 該日 `margin: null`
2. 備援不會啟動 —— `marginDatedFailed` 判斷的是「**整批**都沒有 margin」，
   而較舊的日子在快取裡有值，故為 false，OpenAPI 備援被跳過
3. 前端頂層 `margin` 為 null → **融資融券區塊每天顯示「查無此股當日資料」**
4. **借券更糟**：`readLatest` 用的 SBL 端點無 date 參數，回「目前最新」卻被
   `writeCache(dataYmd, ...)` 存成今天 → **把前一天的數字當成今天的顯示**，且快取後不再更新

這不會自己好：隔天批次補上前一天的，但「最新的一天」又換成新的、又是空的。

### 修正
`schema.sql` §6c 由 `'30 12 * * 1-5'` 改為 `'30 15 * * 1-5'`（23:30 台北），
並把上表的公布時間與「為什麼別再往前挪」寫進註解。兩區以相同 SQL 重新排定，
保留既有 `CRON_SECRET` 與 0.3.8 加的 `timeout_milliseconds := 60000`。

驗證：兩區皆 `schedule = "30 15 * * 1-5"`、`active = true`、`has_timeout = true`。

23:30 仍在台北當日內，不影響 `taipeiYmd` 的交易日判斷。

### Outstanding
第一次自動觸發是 **2026-07-27（週一）23:30**。屆時可查（`pg_net.ttl` 為 6 小時，隔天早上仍查得到）：
`select id, status_code, error_msg, left(content,200) from net._http_response order by id desc limit 3;`
並確認 manifest 的 `ymd` 等於當天、且最新一天的 `margin` 不為 null。

---

## 📅 Log: 2026-07-26 10:20:00 Asia/Taipei

- **Agent**: Claude
- **Action**: `generate` 端點加代號白名單、修正 `prune` 過度清除快取 (0.3.9)
- **Status**: COMPLETED

### 1. `generate` 端點的濫用防護
**問題**（實測確認）：函數以 `--no-verify-jwt` 部署（夜間 cron 只帶 `x-cron-secret`），
不帶任何 key 也回 200；而專案網址就在 GitHub Pages 的公開 bundle 裡
（實測線上站台的 `assets/index-*.js` 含 `https://kxnxadaghidwumqsqneu.supabase.co`，repo 為 PUBLIC）。

**這不是資料安全問題**，而是額度問題：
- 回傳的是純公開的 TWSE 資料；`holding` 是請求方自己傳進來、原樣回傳的，讀不到別人的持股
- 唯一可寫的 `chip_raw_cache` 內容來自 TWSE，攻擊者無法注入
- 不碰 `transactions` / `workspaces`；會寫 Storage 的 `generate-all` 有 `CRON_SECRET` 保護
- 真正的風險：每次呼叫 = 1 次 Edge Function invocation（免費約 500K/月），
  實測快取暖時每次約 2.3–2.6 秒。額度燒光會**連帶讓 `stock-price` 一起停擺**

**修正**：`handleGenerate` 加上 `heldTwTickers()` 白名單，非持股回 403（不透露清單內容或長度）。
攻擊者最多只能打持有的那幾檔，而它們早已被夜間批次快取 → **TWSE 放大效應歸零**。
前端不受影響：下拉選單本來就只列使用者自己的持股。

實測（兩區）：持有的代號 200；未持有、以及**曾持有但已賣光**（`net > 0` 過濾）的代號皆 403；
`generate-all` 走自己的清單、不受白名單影響。

### 2. `prune` 保留期的單位錯配
`RETAIN_DAYS = 7` 砍的是**日曆日**，但 `HISTORY_DAYS = 7` 數的是**交易日** ——
7 個交易日要跨 9–11 個日曆日，於是每晚都把隔天還要用的 2–3 天一起砍掉，隔天再重抓。

實證：正式區 prune 後 `chip_raw_cache` 只剩 6 個交易日（20260717 起），
我幾次匿名 `generate` 呼叫又把它補到 9 天（20260714 起）—— 也就是每天都在做白工，
這正是 `generate-all` 每天第一次要 10–13 秒的原因之一。

**修正**：拆成兩個常數。`REPORT_RETAIN_DAYS = 7`（Storage，前端只讀最新一份）、
`CACHE_RETAIN_DAYS = LOOKBACK_DAYS`（原始檔快取，必須涵蓋 `loadSeries` 會回頭找的整個範圍）。

### 未處理（需使用者自行操作）
**Supabase 用量警示**：CLI 與 Management API 都沒有對應指令，只能在 Dashboard 設定
（Organization → Billing → Usage / Spend cap）。這是唯一能在額度燒光前得到通知的方式。

### 踩到的坑
`functions deploy` 第一次失敗：`entrypoint path does not exist (/home/ivan/supabase/...)`
—— shell cwd 被重置，deploy 必須在 `sources/` 下執行。所幸當下的驗證如實反映
「正式區仍是舊版（未持有代號仍回 200）」，沒有誤判成功。**部署指令一律與 `cd` 寫在同一行。**

---

## 📅 Log: 2026-07-26 09:35:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.3.8 定版、併入 `main`
- **Status**: COMPLETED

### 版號定稿（CLAUDE.md §17.3）
`0.3.8-dev.2` → **`0.3.8`**（三處同步）。README 把 dev.1 / dev.2 併成一則 0.3.8 正式紀錄。

### 本次不需要動 Supabase 的部署
0.3.8 的前端改動（分析頁獨立、移除服務狀態）**不涉及 Edge Function 或報告 JSON 結構**，
兩區的 `stock-report` 維持既有部署即可。唯一的後端異動是 cron 的 `timeout_milliseconds`，
已於 dev.2 當下同步套用到兩區並驗證。因此本次**先合併再部署前端**沒有空窗風險
（不像 0.3.7 當時正式區根本沒有 `stock-report`，必須先補後端）。

---

## 📅 Log: 2026-07-26 09:20:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 修正夜間排程的 pg_net 逾時 (0.3.8-dev.2)
- **Status**: COMPLETED
- **起因**: 使用者要求分析「免費 Supabase + GitHub Pages 的隱藏問題」，盤點時實測發現此問題

### 問題
`schema.sql` §6c 的 `net.http_post` 沒指定 `timeout_milliseconds`，而 pg_net 的**預設值是 5000ms**
（實測 `pg_get_function_arguments`：`timeout_milliseconds integer DEFAULT 5000`）。
但 `generate-all` **每天第一次執行要 10–13 秒**（抓當天的 T86 與融資融券大檔），
第二次因快取全命中只要約 2 秒 —— 也就是說**每天唯一有意義的那一次必定逾時**。

### 實測（dev，以 `timeout_milliseconds := 1000` 強制重現）
| 觀察點 | 結果 |
| --- | --- |
| `net._http_response` | `error_msg = "Timeout of 1000 ms reached"`、`status_code = null` |
| Storage `manifest.generatedAt` | 16:02:25 → **16:03:37（前進）** |

**結論：批次本身沒壞** —— 客戶端逾時後 Edge Function 仍在伺服器端跑完、報告正常寫入。
真正的損失是**可觀測性**：每晚都記成失敗，導致「逾時但成功」與「真的失敗」無法區分，
而這是唯一的伺服器端訊號（服務狀態頁已於 dev.1 移除）。

### 修正
`schema.sql` 的 cron 補上 `timeout_milliseconds := 60000` 並加註原因，
兩區的 `cron.job` 皆以相同 SQL 重新排定（保留原有的 `CRON_SECRET`，從既有 command 取出）。

驗證：dev 直接執行修正後的 cron 指令 → `net._http_response` 記錄
`status_code = 200`、`error_msg = null`、含完整回應內容 `{"ok":true,...,"historyDays":7}`。
兩區皆確認 `command like '%timeout_milliseconds := 60000%'` 且 `active = true`。

### 同時盤點到、但**未**在本輪處理的免費方案議題
- **`stock-report` 的 `generate` 是完全公開端點**：實測不帶任何 key 也回 200
  （函數以 `--no-verify-jwt` 部署，且專案 URL 就在 GitHub Pages 的公開 bundle 裡）。
  `generate-all` 有 `CRON_SECRET` 保護，只有 `generate` 是開的。
- **可觀測性**：dev.1 移除服務狀態後，排程失敗不會有任何地方顯示（症狀只是開頁變慢）。
- **免費方案**：每組織 2 個 active 專案（**已用滿**）、7 天無活動自動暫停、無 PITR/備份保障
  （`transactions` 是唯一不可重建的資料，建議定期 CSV 匯出）。
- **實測後確認不是問題**：dev 全庫 13MB、`chip_raw_cache` 含 TOAST 僅 1.68MB
  （22 筆、原始 JSON 3.99MB 壓到 1.45MB，遠低於 PLAN 當初估的 15–25MB）；
  前端 bundle 508KB + 動態載入的 PDF 函式庫，對 Pages 頻寬無感；
  Storage bucket 匿名無法列舉（400），但直接猜路徑可探測「全體持有哪些代號」（無股數、無個資）。

---

## 📅 Log: 2026-07-26 00:30:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 個股分析改為獨立導覽分頁（下拉切換持股）、服務狀態功能整個移除 (0.3.8-dev.1)
- **Status**: COMPLETED
- **Task**: `TASK.md` Task 15；計畫檔 `~/.claude/plans/nested-sauteeing-boole.md`

### 1. 移除服務狀態
- 刪除 `components/ServiceStatus/`（整個目錄）、`services/serviceHealth.ts`、`serviceHealth.test.ts`
- `AppShell`：移除 `Activity` import、`ServiceStatusPage` import、`Tab` 的 `'status'`、TABS 項、渲染條件
- `index.css`：刪除服務狀態專用的 75 行（20 個 `.status-*` / `.uptime-*` class，全庫僅該頁使用）。
  刪除前以程式斷言確認未含 `.spin` / `.section-title` 等共用樣式
- 連帶清掉 dead code：`twMarketData.ts` 的 `readTwListCacheMeta`（唯一呼叫者是 serviceHealth）；
  `priceProxy.ts` 的 `readPriceCache` 保留（內部仍在用），只修註解
- **GitHub 連結改置於頁尾**免責聲明下方（依使用者指示）；專案簡介文案不保留（README 仍有）

### 2. 個股分析獨立成頁
- 新增 `components/StockDetail/AnalysisPage.tsx`（容器）：`useWorkspace` + `useStockPrices` + `getFeeRate`，
  過濾台股後作為下拉選單來源；`selectedKey` state，選中的代號因交易異動而消失時自動回退第一檔
- 下拉沿用既有 `.ws-select` 樣式（後代選擇器，無需新 class）
- `StockDetailPage` 的 `onBack` 改為 **`selector?: ReactNode`** —— 已無下鑽，頁首左側改放下拉選單。
  以 `key={holding.key}` 強制換股時重置整組 state，避免看到上一檔的殘留
- `AppShell`：移除 `detail` state 與 `goTab`，新增 `analysis` 分頁；
  **未設定 Supabase 時該分頁隱藏**（`isReportConfigured` 閘門，與盤後報告入口規則一致）
- `DashboardPage`：移除「個股分析」欄、`onOpenDetail` / `openDetail` 與相關 import

### 3. 共用計算：`utils/holdingRows.ts`
`buildRows` / `HoldingRow` 原本是 `DashboardPage` 的 module-local。分析頁需要同一份
「每檔的 price / unrealized / roi」（含台股零股最低手續費、預扣賣出費稅），**抽成共用模組**而非複製。
`DashboardPage` 改 import，行為不變。

### Verification
- `npm run test` 159 → **170 passed**（刪 serviceHealth 4 筆、改 smoke 2 筆並新增 2 筆、
  新增 holdingRows 6 筆 + AnalysisPage 7 筆）
- `npm run build` 通過；`npm run lint` warning 由 4 降到 **3**（ServiceStatusPage 那筆隨檔案消失）
- 瀏覽器實測（Playwright，本機模式）：
  - 導覽列 `庫存總覽 / 年度收益 / 交易紀錄`（服務狀態已無、個股分析在本機模式正確隱藏）
  - 庫存總覽表頭已無「個股分析」欄
  - 頁尾：免責聲明 + 其下的 GitHub 連結，`href` 正確
  - 分析頁（臨時 harness 掛 AuthProvider + WorkspaceProvider）：下拉只列 `1802 / 2330 / 2609`
    （美股 AAPL 不在內）、切換後標題與內容同步更換、「我的持股」數字由 ledger 正確帶入、
    390px 無水平溢出、無 console error
- **不需要動 Supabase**：純前端呈現層改動，報告 JSON 結構與 Edge Function 完全不變

### 踩到的小坑
- `tsc` 抓到我新寫的 `holdingRows.test.ts` fixture 少了 `PriceQuote` 的 `asOf` / `source`
  —— vitest 不做型別檢查所以測試先過了，`npm run build` 才擋下來。這正是 PLAN 一直寫
  「`build` 不可略過」的理由。
- 臨時 harness 這次**一律用絕對路徑刪除**，未再發生前兩輪 cwd 被重置導致 `rm -f` 靜默失敗的情況。

---

## 📅 Log: 2026-07-25 23:45:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.3.7 定版、併入 `main`、正式區（`kxnxadaghidwumqsqneu`）後端部署
- **Status**: COMPLETED

### 版號定稿（CLAUDE.md §17.3）
`0.3.7-dev.6` → **`0.3.7`**（三處同步）。README 版本紀錄把 dev.1–dev.6 **併成一則 0.3.7 正式紀錄**：
從 `main` 的角度 EPS 從未存在（dev.5 已回退），故不列入；dev.6 只留「版號格式與徽章」這兩項淨效果。

### ⚠️ 正式區原本停在 v0.3.6 的狀態
盤點結果：只有 `stock-price`(v6)、**沒有 `stock-report`**、**沒有 `chip_raw_cache`**、
沒有 `reports` bucket、沒有 `pg_cron`/`pg_net`、沒有 `CRON_SECRET`。有 126 筆真實交易。

與 v0.3.6 的 schema 差異只有第 5、6 段（第 1–4 段未變動），故**只套這兩段**，不在有真實資料的庫上重跑既有表。

### 部署順序刻意先後端、後 git
`.github/workflows/deploy.yml` 是 **push 到 `main` 就觸發 Pages 部署**。若先合併，
線上會有一段「分析」按鈕點了就失敗的空窗（前端已上線但正式區沒有 `stock-report`）。
故順序為：正式區後端就緒 → 驗證 → 才合併推 main。

### 正式區執行內容
1. schema 第 5 段 → 建 `chip_raw_cache`
2. `functions deploy stock-report --no-verify-jwt`
3. `secrets set CRON_SECRET=<token_urlsafe(32)>`
4. schema 第 6 段（代入實際 project ref 與 secret）→ `reports` bucket(public)、`pg_cron`/`pg_net`、
   cron job `stock-report-nightly | 30 12 * * 1-5 | active=true`
5. 手動觸發 `generate-all` 兩次：首次 5 檔 / 5 天（回補上限，13.3 秒），第二次補滿 **7 天**（12.3 秒）
6. 驗證 5 份報告（0050、00685L、009816、1802、2609）皆 `schema 2`、`history` 7 天且
   融資融券 7 天齊全、`holding: null`（共用報告不含個資）、`notes` 空

### ⚠️ 踩到的陷阱：Supabase CLI 的 link 是**依 cwd 解析**
從 repo 根目錄執行 `--linked` 指向 **dev**，從 `sources/` 執行才指向**正式區**
（link 檔在 `sources/supabase/.temp/project-ref`）。一開始從根目錄查，`projects list` 回報
正式區 `linked=False`，與使用者所述不符 —— 換到 `sources/` 才對得上。
**對策**：函數部署一律明確帶 `--project-ref`；每次寫入 DB 前先斷言 linked 專案是預期的那個。

### Verification
- `npm run test` 159 passed / `build` / `lint` 全過（版號改動不影響邏輯）
- 正式區與測試區後端狀態一致（皆有 `chip_raw_cache`、`stock-report`(no-verify-jwt)、
  `reports` bucket、每交易日 20:30 排程）

### Outstanding
- 兩區的夜間排程都尚未經歷一次自動觸發（每週一~五 12:30 UTC / 台北 20:30，最快下週一）。
- `TechnicalTab` 仍為佔位頁（需 `price_daily` 與約 400 天保留期，見 PLAN §G / §L）。

---

## 📅 Log: 2026-07-25 23:10:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 依使用者指示移除基本面（EPS）全部實作；版號格式改為不帶 `v`；徽章不再顯示作者 (0.3.7-dev.6)
- **Status**: COMPLETED

### 1. 移除 EPS（dev.5 全數回退）
- `git revert ec12206`（乾淨套用，無衝突）→ 刪除 `twFundamentals.ts(+test)`、`FundamentalsTab.tsx(+test)`、
  `fundamentalFormat.ts(+test)`；`report.ts` 回到 `REPORT_SCHEMA = 2`；`index.ts` 移除
  `syncFundamentals` / `BWIBBU` / `STOCK_DAY_AVG`；`StockDetailPage` 回到三個分頁籤；
  `reportProxy.ts` schema 守門回到 `=== 2`。實測 `grep -rl "EPS|fundamental|每股盈餘|本益比|BWIBBU"` 於
  `src/` 與 `supabase/` **零命中**。
- **Supabase 端必須跟著回退，不是選項**：部署中的函數回 schema 3，而回退後的前端只接受 `=== 2`，
  Storage-first 與即點即產兩條路都會被判為不支援 → 籌碼頁會整個壞掉。故：
  - 重新部署 `stock-report`（回 schema 2）
  - 重跑 `generate-all` 把 Storage 內 3 份 schema 3 JSON 覆寫回 schema 2（實測 1802/2609/0050 皆已無 `fundamentals` 欄位）
  - `DROP TABLE stock_fundamentals`（1070 列，全為公開 TWSE 資料、無使用者資料、可一道指令重抓）
  - 刪除 `chip_raw_cache` 的 `BWIBBU` / `STOCK_DAY_AVG` 兩筆（否則會閒置 7 天才被 prune）
  - 驗證後 `chip_raw_cache` 只剩 `MI_MARGN, MI_MARGN_D, SBL, T86` 四個 dataset
- `schema.sql` 的第 7 段（`stock_fundamentals`）已隨 revert 移除，檔案回到 6 段。

### 2. 版號格式（CLAUDE.md §17 已更新）
- **一律不帶 `v` 前綴**，只有 `x.x.x`（正式）或 `x.x.x-dev.x`（測試）兩種形式。
- `version.ts` 的 `APP_VERSION` 由 `'v0.3.7-dev.4'` 改為 `'0.3.7-dev.6'`；
  README 第 3 行與「開發中」標題同步去掉 `v`。
- README **歷史版本標題保留原樣**（`### v0.2.5` 等）—— 使用者說的是「以後」，那些是既成紀錄，
  改了只是製造 diff 噪音。

### 3. 徽章不再顯示作者
- `APP_AUTHOR` 常數與其 export **整個移除**（不只是不顯示）；`App.tsx` 的徽章由
  `{APP_VERSION} | {APP_AUTHOR}` 改為 `{APP_VERSION}`。
- `App.smoke.test.tsx` 的斷言改為 `toBe(APP_VERSION)` 並加驗「不以 v 開頭」「不含 Ivan」，
  讓格式規則有測試把關而非只寫在文件。

### 版號選擇說明
本輪進到 **dev.6 而非重用 dev.5**：dev.5 已被 EPS 用掉並推上 remote，重用會讓同一版號指向兩份不同內容。

### Verification
- `npm run test` **159 passed**（回到 dev.4 的基準；EPS 的 40 筆測試隨功能一併移除）
- `npm run build` 通過；`npm run lint` 無新增 warning（維持既有 4 筆）
- dev Supabase：2330 / 0050 實測皆回 `schema 2`、無 `fundamentals` 欄位、`history` 7 天完好
- 籌碼功能未受影響（history、走勢圖、逐日檢視、法人並排全部保留）

---

## 📅 Log: 2026-07-25 16:45:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 籌碼逐日檢視 + 法人並排比較 (v0.3.7-dev.4)
- **Status**: COMPLETED
- **使用者需求**: (1) 三大法人表格能 review 1~7 天的資料 (2) 買賣超圖在右側空白處顯示圖例

### Completed Tasks
- [x] **三大法人表格可切換 7 天中任一天**：日期鈕列於區塊標題旁，預設最新交易日。
- [x] **連買連賣改為前端計算**（`chipStreak.ts` 的 `streakAt`）：伺服器的 `report.streaks` 只有最新日，
      表格能回看任一天就必須算「到那一天為止」的連續天數。UI 一律走前端這條路（含融資融券），
      不混用兩種來源。行為必須與 Edge Function 的 `computeStreak` 一致，兩邊各有測試。
- [x] **`BarSeriesChart` 支援多序列並排**（grouped bars），同組內留 2px 間隙。
- [x] **新增「全部（並排）」模式**：四個法人同時比較，各一類別色 + 右側 `ChartLegend`。
      hover 一次列出當日四個法人的數字。
- [x] **新增 `chartColors.ts` 的 `CATEGORICAL_COLORS`**（見下方配色決策）。
- [x] **報告表頭加上「報告更新時間」**（`fmtUpdatedAt`），且表頭移進 PDF 擷取範圍內。

### 配色決策（依 dataviz 指引，非憑感覺挑色）
- **顏色一次只能做一件事**：單一序列時顏色表達極性（紅正綠負）；多序列並排時顏色表達身分，
  正負改由長條在零軸上下的方向表達。兩者不可疊在同一組標記上。
- 類別色取自參考配色的固定順序 slot 1–4，**依序指派不循環**。
- **選 dark steps 而非 light steps**：本專案圖表色必須是單一組字面值（html2canvas 限制），
  需同時服務深色主題、淺色主題與淺底 PDF。以 `validate_palette.js` 實測：
  light steps 在深底 **FAIL 亮度帶**；dark steps `#3987e5,#d95926,#199e70,#c98500`
  在淺底 `#fcfcfb` 與深底 `#131a2b` **全部 PASS**（淺底 contrast 2.99 為 WARN，
  需「可見標籤或表格檢視」作緩解 —— 本頁同時有圖例文字與完整數字表格，成立）。
- **合計不與其組成並排**：三大法人合計＝四項之和，一起畫等於同一筆量重複計算。

### Verification
- `npm run test` 150 → **159 passed**（新增 `chipStreak` 6、`StockDetailPage` 3）
- `npm run build` 通過；`npm run lint` 無新增 warning（維持既有 4 筆）
- 瀏覽器實測（Playwright + 臨時 harness，驗完刪除）：7 個日期鈕、圖例 4 項、
  並排長條 7×4=28 根、切單一法人後 7 根且圖例改為買超/賣超、切日期後表格與連買連賣同步重算、
  多序列 tooltip 一次列出四個法人、PDF 實跑成功（453KB）、390px 無水平溢出（日期鈕換行、圖例移至圖下）

### 已知限制（資料本質，非缺陷）
- 並排模式下若某法人量級遠大於其他（例如外資 990 萬 vs 外資自營商 2.2 萬），
  小的那幾根會接近看不見。這是共用同一縱軸的必然結果；要細看請切到單一法人（各自獨立縱軸），
  或看上方表格的數字。**刻意不做雙縱軸** —— 那會讓兩個量級的高低變得無法比較。

---

## 📅 Log: 2026-07-25 15:20:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後籌碼報告 v2 —— 個股分析頁 + 籌碼走勢圖 (v0.3.7-dev.3)
- **Status**: COMPLETED
- **Task**: `docs/agent/TASK.md` Task 11；架構決策見 `docs/agent/PLAN.md` §A–J

### Completed Tasks
- [x] **版號規範改版**：CLAUDE.md §17 改為 main `x.x.x`（依序遞增，除非大版本異動）／dev `x.x.x-dev.x`（點號）。
      全庫由 `0.3.7-dev-2` 遷移為 `0.3.7-dev.2`，本次進版至 `0.3.7-dev.3`。
- [x] **`twChips.ts`**：新增 `ChipLeg`（buy/sell/net）；`InstitutionalChip` 五項全部改為 leg
      （自營商買進/賣出由「自行買賣」+「避險」相加，買賣超取官方欄位；三大法人買進/賣出由五個 leg 加總）；
      `MarginChip` 擴充買進/賣出/償還並加 `source` 欄；新增 `marginDatedUrl` / `extractMarginDated`（**位置索引**）
      / `marginDatedOk`（欄序防護）。
- [x] **`report.ts`**：新增 `ChipDay`、`REPORT_SCHEMA = 2`、`history`、`ChipStreaks`；
      純函式 `computeStreak` / `computeStreaks` / `isWeekendYmd`。`buildReport` 改吃 history。
- [x] **`index.ts`**：`loadDaySources` → `loadSeries`（回推 14 日曆日、跳過週六日、快取優先、
      併發上限 3、單次回補上限 5 天、滿 7 個交易日即停）；每日大檔抽成 per-ticker 切片後即釋放，
      避免同時持有數十 MB；移除 html 產生與上傳。**刪除 `reportHtml.ts`**。
- [x] **`reportProxy.ts`**：以結構化型別取代 `data: unknown`；`isSupportedReport` 守門，
      `schema !== 2` 視為未命中；刪除 `applyHoldingOverlay` / `renderHoldingSection`（與 `reportHtml.ts` 重複的手抄複本）。
- [x] **`components/Charts/`（新增）**：`chartScale.ts`（`niceDomain` / `domainTicks` / `tickStep` / `scaleY` /
      `fmtAxisNumber`，純函式有測試）、`chartColors.ts`、`chartFrame.tsx`（軸線、命中區、tooltip）、
      `BarSeriesChart.tsx`、`LineSeriesChart.tsx`。
- [x] **`components/StockDetail/`（新增）**：`StockDetailPage.tsx`（三分頁籤 + PDF）、`ChipsTab.tsx`、
      `HoldingTab.tsx`、`TechnicalTab.tsx`（佔位）、`chipFormat.ts`。
- [x] **`AppShell.tsx`**：新增 `detail` state 作為下鑽檢視，`goTab()` 點導覽分頁即清空；
      `DashboardPage` 改吃 `onOpenDetail`，**刪除 `ReportModal.tsx`**。
- [x] **`reportPdf.ts`**：擷取前後動態掛上／移除 `.report-surface`，深色主題也輸出淺色文件 PDF。
- [x] **`index.css`**：新增個股分析頁、二級分頁籤、圖表、持股卡片與 `.report-surface` 樣式。
- [x] 文件：`README.md`（dev.3 版本紀錄）、`sources/supabase/README.md`（schema 2 結構、
      `MI_MARGN_D` dataset、回補行為、新增症狀對照）、`TASK.md`（補 v1 摘要 + Task 11）、`SPEC.md`（新增章節）。

### Verification
- `npm run test`：**148 passed**（基準 113；新增 twChips 6、report 12、chartScale 12、reportProxy 4、StockDetailPage 9）
- `npm run build`（`tsc -b && vite build`）通過；`npm run lint` 無新增 warning（維持既有 4 筆）
- 瀏覽器（Playwright + 臨時 preview harness，驗完刪除）：
  1280px / 390px 皆無水平溢出（寬表格在自身 `.table-scroll` 內滾動）、hover tooltip 內容與定位正確、
  `.report-surface` 淺色容器正確、`generatePdfBlob` 實跑成功（388KB PDF）、
  本機模式回歸（分析入口正確隱藏、四個導覽分頁切換無 console error）。
- **圖表兩個實測修正**：軸標籤原本隨 viewBox 等比縮放（寬螢幕變兩倍大 / 手機太小），改為量測容器寬度以 1:1 繪製；
  `fmtAxisNumber` 加入 step 參數，修正融資餘額 31,100–31,928 這種序列相鄰刻度全標成「3.1 萬」的問題。

### Supabase 部署（使用者於同一 session 明確授權後執行）

- **只動 dev 專案** `wqetxuhncvfidqnklyew`（Stock-Pnl-Web-Dev）；正式區 `kxnxadaghidwumqsqneu` 未觸碰、CLI 亦未 link。
- `supabase functions deploy stock-report --no-verify-jwt` → **version 1 → 2、`verify_jwt` true → false**。
  `stock-price` 未動（本次無變更），仍為 version 1 / `verify_jwt: true`。
  順帶修掉一個既有問題：舊部署是 `verify_jwt: true`，但 schema.sql §6c 的 cron 只帶 `x-cron-secret`
  不帶 Authorization，代表夜間批次本來就會被 gateway 擋 401。
- **無需 schema migration**（實證）：`chip_raw_cache.dataset` 無 CHECK 約束，
  新的 `MI_MARGN_D` 已正常寫入 9 筆（20260714–20260724），與既有 `T86` / `MI_MARGN` / `SBL` 並存。

### 線上實測（真實 TWSE 資料，2330）

| 項目 | 結果 |
| --- | --- |
| HTTP / 耗時 | 200、約 8 秒（Edge Function wall-clock 內） |
| `schema` / `html` | `2`；回應已無 `html` 欄位 |
| 第一次呼叫 | `history` **5 天**（= `MAX_BACKFILL_DAYS`），`notes` 正確說明「歷史資料回補中」 |
| 第二次呼叫 | `history` **7 天**（07/16、17、20、21、22、23、24 —— 正確跳過 07/18–19 週末），`notes` 清空 |
| 三大法人 | 五項 buy/sell/net 皆有值（外資 buy 8,879,341 / sell 18,515,947 / net −9,636,606） |
| 融資融券 | `source: 'rwd'`（新端點成功），買進 797 / 賣出 454 / 償還 360 / 今日餘額 31,915 張 |
| 交叉驗證 | 2026-07-22 融資餘額 **31,928 張**，與 PLAN.md §C 當初手動實測的 2330 fixture 完全一致 |
| 借券 | `availableVolume: 11,853,736` |
| history 完整性 | 7 天皆 `institutional` 與 `margin` 有值 → 走勢圖資料齊全 |

**回補機制實證有效**：第二次呼叫命中前次快取，額度得以用在剩下 2 天，如 README 所述。

### schema.sql §6 套用（dev.2 遺留缺口，本次一併補上）

dev 專案原本沒有 `reports` bucket、沒有 `CRON_SECRET`，代表 dev.2 的「盤後自動產報」從來沒真的啟用過。
使用者授權後補齊（**只套 §6，前 5 段既有表未重跑**）：

- `supabase secrets set CRON_SECRET=<token_urlsafe(32)>` → 已確認出現在 secrets 清單。
  值同時存在 Edge Function secrets 與 `cron.job.command`；需要取回時查
  `select command from cron.job where jobname='stock-report-nightly'`。
- `supabase db query -f`（§6 代入實際 `<PROJECT_REF>` / `<CRON_SECRET>`）→ 驗證結果：
  `reports` bucket 存在且 public、`pg_cron` / `pg_net` 已啟用、
  cron job `stock-report-nightly | 30 12 * * 1-5 | active=true`。

### 批次與 Storage-first 線上實測

- 手動觸發 `generate-all`（**只帶 `x-cron-secret`、不帶 Authorization**）→
  `{"ok":true,"ymd":"20260724","generated":3,"total":3,"historyDays":7}`，4 秒完成（raw 檔已在快取內）。
  這同時證明 `--no-verify-jwt` 生效 —— 修好前，夜間 cron 會被 gateway 擋 401。
- Bucket 內容：`manifest.json`（0.1KB）+ `20260724/{0050,1802,2609}.json`（各約 5KB，與估算一致）。
- 報告 JSON 檢查（0050）：`schema: 2`、**上下層都無 `html` 欄位**、`history` 7 天且每日 `institutional`
  與 `margin` 皆有值、`holding: null`（共用報告不含個資）、`notes` 空、`margin.source: 'rwd'`。
- Anon 讀取權限：`manifest.json` / 存在的代號 → 200；不存在的代號 → 400（前端據此 fallback 即點即產）。
- **效能**：Storage-first 兩次下載共 **0.8 秒**，對比即點即產 **8 秒** —— 約 10 倍差距，
  這就是套用 §6 的實際價值。

### Outstanding

- **未在瀏覽器走完整登入流程驗證**：dev 為 Supabase 模式需帳密登入，改以 curl 打真實端點 +
  jsdom 元件測試涵蓋。UI 版面另以 fixture 在瀏覽器實測（見上）。
- 夜間排程的首次自動執行時間：**每週一~五 12:30 UTC（台北 20:30）**，尚未經歷一次自動觸發。

---

## 📅 Log: 2026-07-25 12:27:06 Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後籌碼報告 v2 架構規劃與資料源實測（PLAN.md）
- **Status**: COMPLETED（規劃）

### Completed Tasks
- [x] 實測確認帶 `date` 的 rwd 融資融券端點欄位（16 欄、名稱重複需位置索引），記下 2330 實測列當 fixture。
- [x] 確認 T86 同一份回應已含各法人買進 / 賣出（19 欄），拆項無需新資料源。
- [x] 決定移除 HTML 產生路線、改由 React 繪製；`PLAN.md` 寫入架構決策 A–J 與風險。

---

## 📅 Log: 2026-07-25 (dev.2) Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後籌碼報告自動產生 + Storage 快取 (v0.3.7-dev.2，commit 9d62546)
- **Status**: COMPLETED

### Completed Tasks
- [x] `stock-report` 新增 `generate-all` 批次動作，由 `pg_cron` 每交易日 20:30（台北）觸發，
      產出全體持有台股的共用報告存入公開 `reports` bucket；新增 `CRON_SECRET` 驗證。
- [x] 前端改 Storage-first（先讀預產報告，查無再即點即產），個人持股概況由前端疊加。
- [x] 只保留 7 天：同批次清理舊報告與 `chip_raw_cache`。

---

## 📅 Log: 2026-07-24 (dev.1) Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後籌碼報告 v1 (v0.3.7-dev.1，commit 038cdd8)
- **Status**: COMPLETED

### Completed Tasks
- [x] 新增 Edge Function `stock-report`：抓 TWSE 三大法人買賣超、融資融券、借券，產生報告 HTML。
- [x] 庫存總覽台股列新增「報告」按鈕與彈窗，可下載 PDF（`jspdf` / `html2canvas` 動態載入）。
- [x] 新增 `chip_raw_cache` 依交易日共用快取；Supabase 檔案集中至 `sources/supabase/`。

---

## 📅 Log: 2026-07-22 15:40:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner / Reviewer**: Claude
- **Action**: 庫存總攬面板縮小為主副層級式 (v0.3.6)
- **Status**: COMPLETED

### Completed Tasks
- [x] `DashboardPage.tsx`: 每張面板改為 `.metric.metric-hero`（持倉市值）+ `.metric-row` 兩欄（投入總成本、未實現淨損益）；縮小欄位 skeleton 寬度 120 → 90。三態顯示、格式化參數、tooltip 文案不變。
- [x] `index.css`: `.market-panel` padding 縮小；`.kpi-value` 24px → 16px、新增 `.metric-hero .kpi-value` 22px（小螢幕 20px）；新增 `.metric-row` 兩欄網格（上邊線 + 欄間左分隔線）；刪除舊的直向 `.metric + .metric` 分隔規則；`.kpi-sub` 11.5px → 11px。
- [x] 版本號升至 0.3.6 / v0.3.6。
- [x] Claude 親自 review diff 並重跑 `npm run build` 通過。

---

## 📅 Log: 2026-07-22 15:20:00 Asia/Taipei

- **Agent**: Gemini
- **Action**: Dashboard 庫存總攬改版為台美股雙面板 (v0.3.5)
- **Status**: COMPLETED

### Completed Tasks
- [x] `DashboardPage.tsx`: 新增 `twCost` / `twRawCost` / `usCost` / `usRawCost` 4 個成本聚合運算。
- [x] `DashboardPage.tsx`: 將 4 張卡片改版為 `.market-grid` 下的 2 張 `.market-panel`（🇹🇼 台股 TWD / 🇺🇸 美股 USD）。
- [x] `DashboardPage.tsx`: 調整指標順序為：1. 持倉市值 2. 投入總成本 3. 未實現淨損益。
- [x] `index.css`: 新增 `.market-grid` / `.market-panel` 相關樣式與小螢幕 media query 覆寫，維持 `.kpi-grid` / `.kpi` 既有樣式不動。
- [x] `package.json` 與 `version.ts`: 版本號同步升級至 0.3.5 / v0.3.5。
- [x] 執行 `npm run build` 通過驗證。

---

## 📅 Log: 2026-07-21 14:45:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner**: Claude
- **Action**: Implementation
- **Status**: COMPLETED

### Completed Tasks
- [x] 新增服務狀態頁面 (`ServiceStatusPage.tsx`) 與檢測邏輯 (`serviceHealth.ts`)。
- [x] 移除畫面左下角固定版本標籤。
- [x] 更新 `AppShell.tsx` 分頁選項加入服務狀態。
- [x] 升級版本至 v0.3.0。

---

## 📅 Log: 2026-07-21 15:05:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 服務狀態頁 review 修復與視覺收尾 (v0.3.0)
- **Status**: COMPLETED

### 修復的缺陷（agy 交付版本無法執行）
- [x] **白屏（阻斷級）**：`ServiceStatusPage.tsx` 將純型別以一般 import 匯入，`verbatimModuleSyntax`
      下 Vite 執行期報 `does not provide an export named 'ComponentId'`，整個應用無法啟動。改用 `import type`。
- [x] **白屏（阻斷級）**：lucide-react 1.24 已移除品牌圖示 `Github`，改用 `Code2`。
- [x] **型別錯誤**：`serviceHealth.ts` 閉包內 `supabase` 的 non-null narrowing 失效，收斂至區域常數 `sb`。
- [x] `serviceHealth.test.ts` 同樣的 type-only import 問題（TS1484）。

### 驗收流程修正
- `npx tsc --noEmit` 與 `npm test` **均無法**攔截上述白屏：前者走的 tsconfig 不含 `verbatimModuleSyntax`，
  後者的 esbuild transform 會 tree-shake 未使用的 type import。實測反證確認唯有 **`npm run build`（`tsc -b`）** 會報 TS1484。
  往後驗收一律以 `npm run build` 為準。

### 視覺與一致性收尾
- [x] 版本字串 `v0.3.0` → `v0.3`（依需求），README 同步。
- [x] uptime 條說明由每個元件重複 8 次改為整頁一次；空格子改用 `--border-strong` 以免條狀圖看似只有半截。
- [x] 檢測時間改用 `zh-TW` 24 小時制，與 Dashboard「現價更新於」一致。
- [x] `lastSample?.results?.x` 防禦，避免歷史資料損毀時整頁崩潰。
- [x] `App.smoke.test.tsx` 新增服務狀態分頁斷言（本機模式後端為「未啟用」且整體仍為正常）。
- [x] 驗證：`npm run build` 通過、`npm test` 10 檔 90/90、Playwright 深淺兩主題與四個分頁零 pageerror。

## 📅 Log: 2026-07-21 15:35:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 頁首維持單行（使用者回饋：新增分頁後右側控制項被擠到第二行）
- **Status**: COMPLETED

### Completed Tasks
- [x] 量測確認換行門檻：1100px 時子元素合計 1143px 超出可用 1060px 約 83px。
- [x] `AppShell.tsx` / `index.css`: 頁首改為逐級讓步——1180px 起縮間距與 tab padding、
      1060px 起收起品牌文字、960px 起分頁只留圖示（名稱移至 title / aria-label）。
- [x] 手機版 (≤700px) 分頁改用短標籤（總覽／年度／紀錄／狀態）：四個分頁平分 390px 時
      四字標籤會折行成兩列。
- [x] 驗證：1280/1100/1000/820px 頁首皆為單行（高 63–70px，原本 112px），
      390px 分頁不再折行；`npm run build` 與 90/90 測試通過。

---

## 📅 Log: 2026-07-21 15:50:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 頁首換行修正補完 + 庫存總覽未實現損益加入未含費 (v0.3.1)
- **Status**: COMPLETED

### 頁首（使用者回報「還是一樣」）
- [x] 每 10px 密集掃描找出前次修正的缺口：**1080px 與 980px 仍換行**，
      原因是讓步門檻壓在 1060 / 960，恰好卡在需求曲線之上。
- [x] 門檻上移：品牌文字 1060 → 1120px、分頁文字 960 → 1020px；
      手機版斷點 700 → 720px 以接上 710px 的空隙。
- [x] 驗證：730–1600px 每 10px 掃描全部單行。版面左右維持原樣（使用者確認）。

### 庫存總覽未實現損益
- [x] `DashboardPage.tsx`: `HoldingRow` 新增 `rawUnrealized`（市值 − `rawCost`），
      與年度收益的 `rawRealized = sellGross − rawCostBasis` 同構。
- [x] 表格「未實現損益」欄改雙行，副行「未含費」；KPI 台股/美股各加「未含費」副行，
      台股原說明改為「主數字已預扣賣出手續費與證交稅」以區分兩個口徑。
- [x] 手算對帳：0050 買 100@120 費 50、現價 150 → 未含費 15000−12000=+3,000；
      含費扣手續費 21 與證交稅 15 後 +2,914。AAPL 買 10@100 費 5、現價 130 → +300 / +295。
- [x] `npm run build` 與 90/90 測試通過。

---

## 📅 Log: 2026-07-21 09:32:30 Asia/Taipei

- **Agent**: Gemini
- **Action**: Align project structure & persistent memory with `GEMINI.md`
- **Status**: COMPLETED

### Completed Tasks
- [x] 建立 `docs/agent/` 資料夾與持久記憶檔 (`PLAN.md`, `SPEC.md`, `PROGRESS.md`, `TASK.md`, `BUG_FIX.md`, `FIXED_BUG.md`)。
- [x] 重構文件目錄架構，將系統設計移至 `docs/architecture/`，資料庫 Schema 移至 `docs/database/`。
- [x] 前端 React + TypeScript 主體建置完成並通過測試（7/7 測試檔案、68/68 測試全數通過，包含 PnL 計算、CSV 匯入匯出與 App 煙霧測試）。
- [x] Dashboard 新增投入成本欄位，並將投入成本移至平均買入成本之前 (v0.2.4)。

---

## 📅 Log: 2026-07-21 09:52:39 Asia/Taipei

- **Agent**: Claude
- **Action**: 規劃交易紀錄搜尋欄位功能（Task 4），含完整功能規格與測試項目
- **Status**: COMPLETED（規劃）；實作待 agy 執行，Claude 負責 review

### Notes
- 規格與測試項目詳見 `TASK.md` Task 4。
- 關鍵設計決策：純函式過濾（`txSearch.ts`）、名稱比對需含 `displayStockName` 中文譯名、
  「刪除選取」計數需改為「勾選且可見」、CSV 匯出不受過濾影響。

---

## 📅 Log: 2026-07-21 09:58:00 Asia/Taipei

- **Agent**: Gemini
- **Action**: 實作交易紀錄搜尋欄位與過濾功能 (v0.2.5)
- **Status**: COMPLETED

### Completed Tasks
- [x] 建立純函式過濾模組 `txSearch.ts`，支援代號子字串、原始名稱與美股中文譯名 (`displayStockName`) 即時過濾。
- [x] 撰寫單元測試 `txSearch.test.ts`（涵蓋 U1–U8 全部測試案例，全數通過）。
- [x] 整合 `TransactionsPage.tsx` 工具列：新增搜尋輸入框、清除按鈕、筆數提示（「顯示 X / Y 筆」）與無結果提示畫面。
- [x] 修正勾選與刪除選取邏輯：「全選」與「刪除選取（n）」僅作用於當前過濾可見之列，過濾條件改變時保留既有勾選狀態。
- [x] 撰寫 UI 整合測試 `TransactionsPage.test.tsx`（涵蓋 I1–I7 全部測試案例，全數通過）。
- [x] 更新版號與文件：Bump package.json 至 `0.2.5`、`App.tsx` 的 `APP_VERSION` 至 `v0.2.5`、更新 `README.md`。
- [x] 驗證：`npm run lint`（0 error）、`npm test`（9/9 檔案、83/83 測試全數通過）、`npm run build`（打包成功）。

---

## 📅 Log: 2026-07-21 10:00:30 Asia/Taipei

- **Agent**: Claude
- **Action**: Task 4 Code Review（交易紀錄搜尋欄位 v0.2.5）
- **Status**: APPROVED（可 commit）

### Review 結果
- 規格 1–8 全數符合：純函式 `txSearch.ts`、displayStockName 中文譯名比對、filter→sort、
  筆數提示、勾選保留、無結果狀態區分、CSV 匯出未受影響、切換工作區清空搜尋。
- 「刪除選取」計數與刪除範圍已統一為「勾選且可見」（`visibleSelectedCount`），
  且批次刪除後只移除已刪 id、保留隱藏勾選——優於原規格的清空做法。
- 驗證：`npm test` 9 檔 83/83 通過、`npm run lint` 僅既有 3 個 fast-refresh 警告、
  `npm run build` 成功。
- 輕微議題（不擋驗收，留待後續順手處理）：
  1. `TransactionsPage.test.tsx` I5 直接覆寫 `window.confirm` 未還原，建議改用
     `vi.spyOn(window, 'confirm')` + afterEach 還原，避免測試順序耦合。
  2. 無結果狀態存在兩個「清除搜尋」同名按鈕（輸入框 X 與空狀態按鈕），
     螢幕閱讀器辨識略有重複；可改為不同 aria-label。
  3. 空狀態按鈕使用 inline style `marginTop`，可移入 CSS class。
- Scope 備註：`App.tsx`（APP_VERSION）與 `README.md` 版本紀錄不在原 Allowed Changes 清單，
  但屬既有版本 bump 慣例，予以接受；未來規劃時應將此二檔納入清單。

---

## 📅 Log: 2026-07-21 12:03:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Action**: 實作年度收益頁面三項功能 (v0.2.6)
- **Status**: COMPLETED

### Completed Tasks
- [x] `YearlyPage.tsx`: 移除表格排序，替換為純 HelpTh 表頭。
- [x] `DashboardPage.tsx`: 將 HelpTh 抽離至 `Common/HelpTh.tsx` 供共用。
- [x] `pnlEngine.ts`: 新增 `SellDetail` 介面，於 `YearTickerDetail` 紀錄逐筆賣出明細與超賣狀態。
- [x] `YearlyPage.tsx`: 實作第三層明細展開 (`expandedTickers`)，顯示逐筆賣出明細 (`.sell-row`)。
- [x] `pnlEngine.ts`: 於 `LedgerSummary` 新增 `buyCount` 與 `sellCount` 歷史累計買賣筆數。
- [x] `YearlyPage.tsx`: 於交易筆數 KPI 下方顯示買入/賣出拆分。
- [x] `pnlEngine.test.ts`: 新增 SellDetail 運算邏輯與買賣筆數測試驗證。
- [x] `package.json`: 版號更新至 0.2.6。
- [x] 更新文件 `SPEC.md`, `PROGRESS.md`, `TASK.md`。
- [x] 通過 `npm test` 與 `npx tsc --noEmit` 驗證。

---

## 📅 Log: 2026-07-21 12:35:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 年度收益視覺調整（使用者回饋，隨 v0.2.6 後續，commit 06b7be7）
- **Status**: COMPLETED

### Completed Tasks
- [x] `YearlyPage.tsx` + `index.css`: 三層縮排改固定 32px 一層（`.cell-tree` flex 排版），無展開鈕的列以 `.toggle-slot` 空槽補位，圖示/文字垂直對齊。
- [x] `index.css`: 年度表格加 `.table-scroll-y`（max-height 480px 垂直捲動 + sticky 表頭，底色 `--panel`）。
- [x] 逐筆賣出明細分隔符「@」改為「｜」。
- [x] Playwright 目測驗證對齊/捲動/釘選表頭，`npm run build` 與 85/85 測試通過，Pages 部署成功。

---

## 📅 Log: 2026-07-21 13:05:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 年度收益縮排再調整（使用者回饋：圖示排一直線、逐筆明細貼齊父層）
- **Status**: COMPLETED

### Completed Tasks
- [x] `YearlyPage.tsx`: 展開圖示改為全層級同一直欄（拿掉個股列的 32px 縮排），層級由列底色與字重呈現。
- [x] `YearlyPage.tsx`: 逐筆賣出文字縮排 96px → 32px，貼齊父層個股文字起點。
- [x] Playwright 驗證各層圖示/文字座標對齊，build 與 85/85 測試通過。

---

## 📅 Log: 2026-07-21 13:40:00 Asia/Taipei

- **Agent**: agy (delegated)，Claude 規劃/review/驗證
- **Action**: 年度收益展開圖示置中修正 + 分區「全部展開/全部收起」按鈕
- **Status**: COMPLETED

### Completed Tasks
- [x] `index.css`: `.year-toggle` 補 `padding: 0`（根因：全域 border-box 下瀏覽器預設按鈕 padding 擠壓 22px 盒，圖示偏移；修後 svg 與按鈕中心偏差 0px）。
- [x] `YearlyPage.tsx`: 各分區標題右側新增 `.btn btn-sm`「全部展開/全部收起」，一鍵開合該分區所有年度與逐筆賣出明細。
- [x] Playwright 驗證置中與開合行為，build 與 85/85 測試通過。

---

## 📅 Log: 2026-07-21 14:00:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 移除年度收益表格垂直捲動（使用者回饋：不要上下拉 bar）
- **Status**: COMPLETED

### Completed Tasks
- [x] `YearlyPage.tsx` / `index.css`: 移除 `.table-scroll-y`（480px 高度上限、sticky 表頭），表格恢復完整展開。
- [x] build 與 85/85 測試通過。

## 📅 Log: 2026-07-21 14:05:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner**: Claude
- **Action**: 歷史累計手續費拆分 (v0.2.7)
- **Status**: COMPLETED

### Completed Tasks
- [x] `pnlEngine.ts`: 於 `LedgerSummary` 新增 `feesBrokerage` 與 `feesTax`，並透過稅率反推估算手續費與交易稅。
- [x] `YearlyPage.tsx`: 將年度收益頁面的歷史累計手續費 KPI 拆分為手續費與交易稅雙行顯示。
- [x] `pnlEngine.test.ts`: 新增手續費與交易稅估算之測試案例驗證，確保拆分邏輯與總和不變。
- [x] `package.json` 與 `App.tsx`: 版號更新至 0.2.7。
- [x] 更新文件 `SPEC.md`, `PROGRESS.md`, `TASK.md`。
- [x] 通過 `npm test` 與 `npx tsc --noEmit` 驗證。

---

## 📅 Log: 2026-07-21 15:30:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner**: Claude
- **Action**: 年度明細下放手續費/交易稅拆分 (v0.2.8)
- **Status**: COMPLETED

### Completed Tasks
- [x] `pnlEngine.ts`: 於 `YearSummary`, `YearTickerDetail`, `SellDetail` 實作 `feesTax` 屬性與累加機制。
- [x] `YearlyPage.tsx`: 將年度、個股、逐筆賣出明細層級的手續費欄位，改用新增的 `FeeCell` 元件，顯示費稅拆分副行。
- [x] `YearlyPage.tsx`: 修正歷史累計手續費 KPI 與交易筆數 KPI 標籤（新增標註台美股合計）。
- [x] `pnlEngine.test.ts`: 擴展手續費測試，加入 invariants（年度總和 = 各個股總和）與各層級欄位斷言。
- [x] `package.json` 與 `App.tsx`: 版號更新至 0.2.8。
- [x] 更新文件 `SPEC.md`, `PROGRESS.md`, `TASK.md`。
- [x] 通過 `npm test` 與 `npx tsc --noEmit` 驗證。

---

## 📅 Log: 2026-07-21 16:30:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner**: Claude
- **Action**: Fix header wrapping & clarify unrealized P&L gap in UI (v0.3.2)
- **Status**: COMPLETED

### Completed Tasks
- [x] `index.css`: Fixed header wrapping in Supabase mode by moving `.app-header-inner`, `.tab`, and `.user-email` rules out of `@media (max-width: 1180px)` into unconditional rules. Root cause: fixed 1180px container makes viewport media queries ineffective above that width; local mode masked it because its meta area is much narrower than Supabase mode's email+logout.
- [x] `index.css`: Bounded `.ws-select select` with `max-width: 180px` unconditionally to prevent long workspace names from pushing the row over.
- [x] `DashboardPage.tsx`: Clarified the unrealized P&L fee gap tooltip text in table cells, KPIs, and help icon, detailing the gap composition (buy fee + estimated sell fee/tax, and buy fee only for US stocks).
- [x] `package.json`: Bumped version to `0.3.2`.
- [x] Verified with `npm run build` and `npm test -- --run`.

### Claude review 補正
- [x] agy 的修正解決了寬螢幕（≥1220px）的換行，但 review 時實測發現
      **窄寬度 + Supabase 模式仍換行**（1024 / 800 / 730px）：email 截斷後仍佔 132px，
      而窄寬度斷點當初是照本機模式調的。補一條 `@media (max-width: 1220px) { .user-email { display: none } }`
      ——完整信箱本來就在登出鈕的 title，收起不會遺失資訊。
- [x] 註解修正：原本寫「先收間距」與「手機版 ≤700px」，與實際的無條件套用及 720px 斷點不符；
      並補記「調整斷點務必以 Supabase 模式驗證」的教訓。
- [x] 驗證：**兩種模式**各自 730–1920px 每 10px 掃描，全部單行；`npm run build` 與 90/90 測試通過。

### 教訓
- 本機模式的「本機模式」標籤比 Supabase 模式的 email + 登出鈕窄約 140px，
  只測本機模式會漏掉正式環境的版面問題。往後頁首相關變更一律以 Supabase 模式為準。

---

## 2026-07-21 15:58:00 Asia/Taipei — 版本徽章回歸左下角、未實現損益改稱「淨」(v0.3.3)

- **Agent**: Claude（小幅 UI 調整，未達委派 agy 的損益平衡點）
- **Action**: Relocate version stamp; rename unrealized P&L to 「淨損益」
- **Status**: COMPLETED

### Completed Tasks
- [x] 新增 `src/version.ts` 作為版本資訊**單一來源**（`APP_VERSION` / `APP_AUTHOR`）。
      先前 v0.3.0 把版號硬編在 `ServiceStatusPage.tsx`，與 `package.json` 各走各的，已漂移成 `v0.3` vs `0.3.2`。
- [x] `App.tsx` + `index.css`：還原 v0.2.8 的 `.version-badge`（fixed、左下 14/12px、`pointer-events: none` 不擋點擊）。
- [x] `ServiceStatusPage.tsx`：移除「版本戳記」區塊；`runHealthCheck(APP_VERSION)` 改用共用常數，
      「應用程式」元件的檢測註記仍帶版號，功能不受影響。
- [x] `DashboardPage.tsx`：表格欄位與兩張 KPI 一律改名為「未實現淨損益」；
      欄位 `?` 說明改以「『淨』代表把交易成本都算進去」開頭，明列買入手續費 / 台股賣出手續費 + 證交稅。
- [x] `DashboardPage.tsx`：台股 KPI 的「主數字已預扣賣出手續費與證交稅」那行改收進卡片標題 `title` tooltip；
      美股 KPI 標題同步補 tooltip 說明「不預扣賣出費用」，避免「淨」字被誤讀為兩市場口徑相同。
- [x] `App.smoke.test.tsx`：新增 2 個測試鎖住上述行為（徽章存在且含版號、狀態頁無「版本戳記」、
      KPI 名稱與 tooltip、預扣說明不再單獨成行），並在既有流程補驗表頭為「未實現淨損益」。
- [x] `package.json` 版本 bump 至 `0.3.3`。
- [x] 驗證：`npm run build` 通過；`npm test -- --run` 92/92 通過（原 90 + 新增 2）。

### 教訓
- `/verify` skill 記載的 Playwright 走法**此環境已失效**（`~/.npm/_npx` 快取與 `~/.cache/ms-playwright` 皆已無 playwright，
  npx 快取本來就會被清）。這次改以既有的 `App.smoke.test.tsx`（jsdom + Testing Library）驗證 UI 文案與 DOM，
  比一次性的瀏覽器腳本更耐久，且變成回歸測試。往後 UI 文案 / 結構類驗證優先走 smoke test，
  真正需要像素或版面掃描（例如頁首換行）時才補裝 Playwright。

---

## 2026-07-21 16:05:00 Asia/Taipei — 全站說明文案改寫為白話短句 (v0.3.4)

- **Agent**: Claude（文案判斷密集，不適合委派）
- **Action**: Rewrite all user-facing help text for stock novices
- **Status**: COMPLETED

### 背景
使用者回報既有說明「太長太攏統」，且**目標讀者是不熟股票的人**。
原文案的問題不是資訊錯誤，而是把公式（`市值 − 未含費成本`）、
交叉引用（「與年度收益頁的口徑一致」）、次要但書（「各券商收費結構差異大」）
全塞進同一段 tooltip，novice 讀不完也讀不懂。

### 改寫原則（後續新增文案請沿用）
1. **短句白話**，一則說明以 1–2 句為限。
2. **不放公式**：講「這些股票現在值多少錢」，不講「現價 × 持有股數」。
3. **去除內行黑話**：拿掉「移動平均成本法」「同口徑」「純價差」「反推」等詞。
4. **砍掉次要但書與交叉引用**，只保留使用者當下做決定需要知道的事。
5. 保留關鍵事實：費用是否計入、資料是否延遲、數字涵蓋範圍。

### Completed Tasks
- [x] `DashboardPage.tsx`：10 條欄位說明 + 8 個 inline tooltip 全面改寫。
      最長的 `unrealized` 由 5 句/約 130 字縮到 2 句。
- [x] `YearlyReport/columnHelp.ts`：6 條年度欄位說明改寫。
- [x] `YearlyPage.tsx`：超賣 badge、只買未賣、交易稅估算 3 個 tooltip 與空狀態文案。
- [x] `ServiceStatusPage.tsx`：「關於本專案」由技術規格（Edge Function、localStorage 降級）
      改為使用者視角的一句話；uptime 條說明白話化。
- [x] `AppShell.tsx` / `RecalcFeesModal.tsx` / `TransactionForm.tsx` / `TransactionsPage.tsx`：
      費率、最低手續費、證交稅、批次重算等 field-hint 與按鈕 tooltip 白話化。
- [x] `utils/csv.ts`：多工作區匯出檔的拒絕訊息改寫（原文用「成本互相污染」）。
- [x] `App.smoke.test.tsx`：同步更新被鎖住的 tooltip 斷言。
- [x] `package.json` + `src/version.ts` bump 至 `0.3.4`。
- [x] 驗證：`npm run build` 通過；`npm test -- --run` 92/92 通過。

### 未更動（刻意）
- 程式碼註解（`/** */`、`//`）維持技術寫法——那是寫給後續 Agent 與開發者看的，
  與畫面上的說明文字是兩個不同的讀者群，不可一起「簡化」。
- 欄位名稱本身未動，只動說明。

---

## 🚧 Next Steps
1. 設定 GitHub Actions 自動部署流程 (Task 2)。
2. 配合使用者引導完成 Supabase 專案連結與 Edge Function `stock-price` 部署 (Task 3)。
