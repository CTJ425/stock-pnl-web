# Fixed Bugs History (FIXED_BUG.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-07-29 17:10:00 Asia/Taipei

---

## 🐛 Historical Bug Fixes

### Bug ID: BUG-007 — 當天的融資融券永遠進不了報告，籌碼頁那一區恆為空
- **Date**: 2026-07-31（0.6.1-dev.1 `7e27a58` 引入，0.6.10-dev.1 修復）
- **Discovered by**: 使用者回報「融資融券此欄位好像都沒有抓到資料」
- **Symptom**: 個股分析籌碼頁的融資融券表恆顯示
  「今日融資融券尚未公布（約 21:00–22:00），稍晚的排程會自動補上」，
  深夜與隔天早上看也一樣；7 日餘額走勢圖恆少最新的一天。
- **證據鏈**（三段分別驗過，2026-07-31 08:50 實測）:
  1. **抓取與解析正常**：`rwd/zh/marginTrading/MI_MARGN?date=20260730` 回 200，
     `tables[1]` 為 16 欄、`fields[0]='代號'`，與 `MARGIN_IDX` 完全吻合。
  2. **快取正常**：正式區 `20260729/0050.json` 的
     `sources.margin.fetchedAt = 2026-07-29T13:00:03Z`（台北 21:00）——
     當晚那輪確實抓到並寫進 `chip_raw_cache`。
  3. **報告沒被重寫**：正式區 manifest 指向 `20260730`，該檔
     `generatedAt=2026-07-30T08:15:04Z`（台北 16:15）、`margin: null`。
     而 `20260729` 那份是**隔天 16:00** 才寫出來的（`batch_run_log` 按 `taipei_ymd` 查，
     隔天第一輪 `last=null` → `runSig` 必不同 → 強制重產），那時才帶上 07-29 的數字。
- **Root Cause**: `index.ts` 重產閘門的 `runSignature` 傳入
  `margin: series.marginDatedFailed ? '' : series.dataYmd`。
  `marginDatedFailed` 問的是「這 7 天有沒有**任何**一天抓到」，歷史日必定有，
  所以它整天都是 `false`，這一段整天等於 `dataYmd` 這個常數。
  於是 21:00 那輪抓到當天的融資融券、寫進快取，**指紋卻沒變 → `regenerate=false`**；
  21:15 起 `decideSkip` 判定 `complete` 全數短路，當天報告的 `margin` 就永遠停在 null。
- **Fix**:
  - `SeriesResult` 新增 `marginYmds`（視窗內**實際有**融資融券的交易日，由舊到新），
    `marginDatedFailed` 改由它推導（語意不變，只是更精確地限縮在視窗內的日子）。
  - 重產閘門改用 `marginSigPart(series.marginYmds)`（`pollPlan.ts` 的純函式）。
    當天資料一到就會讓指紋改變、剛好觸發一次重產；歷史日回補也一併涵蓋。
- **Changed Files**: `sources/supabase/functions/stock-report/index.ts`、
  `pollPlan.ts`、`pollPlan.test.ts`
- **教訓**: `pollPlan.test.ts` 原本就有一條「融資融券由無到有 → 指紋不同」，測的是純函式
  （`margin: ''` vs `'b'`）而**呼叫端根本產不出 `''`** —— 測試的意圖沒被實作滿足。
  純函式測試必須連「呼叫端會餵什麼」一起釘住，否則測的是一個不存在的輸入。
- **Verification**: `npm run lint` / `npm run build` 通過；`npm test` 622/622
  （原 618 + 新增 4）。線上覆驗見 `PROGRESS.md`（需先部署 Edge Function）。

### Bug ID: BUG-006 — 手機上個股切換選單被擠成一小塊，只看得到「18…」
- **Date**: 2026-07-29（0.6.7 引入，0.6.9-dev.1 修復）
- **Discovered by**: 使用者切到手機版時回報，附截圖
- **Symptom**: 個股分析頁首的個股切換選單在手機上寬度只剩幾十像素，
  代號被 ellipsis 截成「18…」，看不出現在選的是哪一檔。
  實測 390px 時容器只剩 **48px**、360px 只剩 **33px**。
- **Root Cause**: `index.css` 的 `@media (max-width: 720px)` 裡有一條
  `.ws-select { flex: 1; min-width: 0 }`，註解寫著「工作區選單吃掉頁首剩下的橫向空間」——
  **它是為頁首寫的**。

  而 BUG-005 的修法讓個股分析的選單也用 `.ws-select`（為了與頁首共用同一套外觀），
  於是連這條手機規則一起繼承了。兩個容器的處境完全不同：

  | | 同一列還有什麼 |
  | ---- | ---- |
  | `.app-header` | 品牌、工作區、帳號 —— 空間充裕，`flex: 1` 正好把剩餘寬度吃滿 |
  | `.detail-head` | 標題（`flex: 1 1 auto`）＋ 兩顆按鈕 —— 四個子項在搶 390px |

  `flex: 1` 的 `flex-basis` 是 **0**，跟 `flex: 1 1 auto`（basis 為內容寬）的標題競爭時，
  分到的空間趨近於零。桌機因為寬度夠所以看不出來，只有手機會爆。
- **Fix**: 把那條規則收斂成 `.app-header .ws-select`（回到它原本的對象），
  並給個股選單自己的手機行為：`.detail-head .ws-select { flex: 1 0 100% }` 獨占一列。
  順帶讓標題也獨占一列（`.detail-head .detail-title { flex: 1 0 100% }`），
  兩顆按鈕才會併在同一列 —— 否則標題會吃掉中間寬度，只擠得下一顆、另一顆被推到第四列。
- **Verification**: Playwright 量 320／360／390／430／720／721／1280px 七個寬度：
  觸發鈕一律 105px、代號零截斷、兩顆按鈕同列、無橫向溢出；
  長股名「00929 復華台灣科技優息」（200px）在 390px 下仍完整顯示。
  另確認頁首工作區選單不受影響（仍 `flex: 1/1/0%`，容器 252～612px）。
- **教訓**: **共用 class 之前先看它的 media query 是為誰寫的。**
  BUG-005 讓兩處共用外觀是對的，但共用 class 就等於連同所有斷點規則一起繼承 ——
  而那些規則往往帶著「當初那個容器」的隱含前提。
  這次的具體作法是把容器專屬的規則加上祖先選擇器（`.app-header .ws-select`），
  讓它的適用範圍與註解描述的一致。

### Bug ID: BUG-005 — 個股分析的個股切換下拉退化成沒有樣式的原生 select
- **Date**: 2026-07-29（0.6.6 引入，0.6.7-dev.1 修復）
- **Discovered by**: 使用者回報「個股分析的下拉跟頁首那顆框長得不一樣」，附截圖
- **Symptom**: 個股分析頁左上的個股切換，從 0.6.6 起變成瀏覽器預設的白底方框
  （無深色底、無圓角、無邊框、chevron 也不見了），在玻璃擬物風的深色介面上非常突兀。
  頁首的工作區選單則正常。
- **Root Cause**: 0.6.6（commit `674fa75`，手機底部導覽列）刪掉了 `index.css` 的
  `.ws-select select` 與 `.ws-select select option` 整段，commit 說明寫
  「dev.3 之後就選不到任何元素的死 CSS」。

  **那個判斷只對頁首成立。** 頁首的工作區選擇器確實在 0.6.5-dev.3 換成了
  `HeaderMenu`（`<button>`），但 `AnalysisPage.tsx` 從頭到尾都還在用
  `<div class="ws-select"><select>` —— 那段 CSS 一直有作用對象。

  會誤判是因為「用 grep 找 `.ws-select select` 這個**選擇器字串**」找不到東西：
  它是由 `<div className="ws-select">` 與其中的 `<select>` 兩處拼出來的，
  沒有任何一行原始碼長得像那個選擇器。
- **Fix**: 不是把 CSS 補回來，而是把兩處收斂到同一個元件 ——
  `HeaderMenu` 從 `AppShell.tsx` 搬到 `components/Common/HeaderMenu.tsx`，
  `AnalysisPage` 改用它（觸發鈕沿用 `.hmenu-ws`，依使用者選擇不放前置圖示、只留 chevron；
  清單用 `menuitemradio` + Check，與工作區選單一致）。
  各留一份樣式正是這次會走鐘的原因，補 CSS 只會讓下次再走一次。
- **順帶修掉兩個原本就會出事的點**（新的呼叫端才會踩到）：
  - `.hmenu-pop` 是 `right: 0`（為頁首右側選單設計）。個股選單在畫面**左側**，
    沿用會往左展開而跑出畫面 → 新增 `.hmenu-pop-left`。
  - 彈出層沒有限高。持股數十檔時清單會長到超出視窗 → 新增 `.hmenu-pop-scroll`。
- **Verification**: `AnalysisPage.test.tsx` 由 `selectOptions(combobox)` 改為
  點按鈕 → 點 `menuitemradio`，並新增三個案例（觸發鈕顯示目前這檔、
  選中項的 `aria-checked` 唯一、選完自動關閉）。568 tests 全綠。
- **教訓**: **刪 CSS 前要搜 class 名稱，不要搜完整選擇器。**
  複合選擇器（`.a b`）在 JSX 裡永遠不會以字面形式出現。
  這次該搜的是 `ws-select`（會命中兩個 .tsx），而不是 `.ws-select select`（零命中）。

### Bug ID: BUG-004 — T86 的列順序每次都不同，害輪詢永遠等不到定稿、永遠不收工
- **Date**: 2026-07-27（0.6.1 上線當晚發現並修復，0.6.2）
- **Discovered by**: Claude，看正式區 `batch_run_log` 的第一批實測資料
- **Symptom**: `t86_unchanged` 在 0/1 之間跳、**到不了 `T86_STABLE_POLLS = 2`**，
  於是 `t86_frozen` 永遠 false、`decideSkip` 永遠不短路。一天 32 輪全部真的去抓，
  0.6.1 的三道閘門等於全廢，`generatedAt` 也每輪都跳。

  ```
  20:30 u=0 regen=true   21:15 u=1 regen=false   21:45 u=0 regen=true
  20:45 u=0 regen=true   21:30 u=0 regen=true    22:00 u=1 regen=false
  21:00 u=0 regen=true
  ```

- **Root Cause**: 直接抓兩次 `rwd/zh/fund/T86`（間隔 3 秒），
  長度同為 194,959 位元組但**位元組不同**。逐列比對後：
  **1334 列的內容與集合完全相同，只有 7 列的順序換了** ——
  末欄相同的那幾列之間，端點的排序不穩定。
  `fingerprint()` 是對 `JSON.stringify` 算的，順序一變指紋就變，
  於是每輪都被 `nextT86State` 判定成「又被改寫了」。
- **Fix**: 新增 `pollPlan.ts` 的 `t86Fingerprint()`：把 `data` 各列 join 後**排序**，
  只取 `date` / `total` / 排序後的列來算。`index.ts` 的四處 T86 指紋呼叫全部改用它。
  其餘欄位（title / fields / notes / hints）刻意排除 —— 那是固定樣板，
  而且快取走 Postgres jsonb，**jsonb 會重排物件的鍵**，是第二個獨立的不穩定來源。
- **Verification**: ✅ **通過**（2026-07-27 23:00，正式區）。
  離線：以實際抓下來的兩份檔案覆驗 —— 修正前位元組不同、修正後語意指紋相同。
  另加 6 個測試，含「真正的改寫仍測得出來」與「少一列」兩個反向案例
  （避免修過頭變成什麼都測不出來）。
  線上：部署後四輪一路走完預期路徑，**與修復前的 0/1 震盪形成對照**：

  ```
  22:15 u=0 frozen=false regen=true  8509ms  ← 換演算法，重新起算
  22:30 u=1 frozen=false regen=false 8467ms
  22:45 u=2 frozen=true  regen=false 7749ms  ← 定稿
  23:00 u=2 frozen=true  skip=true/complete   753ms  ← 短路，零對外抓取
  ```

  當日彙總：13 輪 / 1 次短路 / 6 次重產；短路平均 **753ms**、實跑平均 **10,025ms**。
  T86 定稿時刻 22:45、融資融券最早 21:00。
  （753ms 而非「幾十毫秒」：短路路徑仍有 3 次 Postgres 來回 ——
  讀上一輪狀態、查今日快取、寫觀測列。重點是**零對外抓取**。）
  ⚠️ `t86_revisions=5` 這個數字**今天不可信**：它含修復前位元組雜訊灌進去的假改寫。
  第一個乾淨的數字要看明天。
- **教訓**: **內容指紋要當「東西有沒有變」的判準，必須先正規化到語意層。**
  外部端點沒有義務保證序列化穩定 —— 這裡是列順序、jsonb 那邊是鍵順序，
  兩個獨立來源，都會讓位元組比對失效。

### Bug ID: BUG-003 — 測試區的 cron 打的是正式區的端點，而且被 401 擋下
- **Date**: 2026-07-27（發現並修復）
- **Discovered by**: Claude，驗收 BUG-002 時發現測試區 `manifest.json` 沒推進
- **Root Cause**（兩個錯疊在一起）:
  1. **URL 指向正式區**：測試區 `cron.job` 的 command 內是
     `https://kxnxadaghidwumqsqneu.supabase.co/...`。測試區的排程從來不是在呼叫自己的函式。
  2. **密鑰對不上**：帶的是一組 43 碼字串，`net._http_response` 顯示
     09:30:00Z（台北 17:30）那次回 **401**。
- **這是 BUG-002 的變種**：同樣是「§6c 需人工替換的佔位符」，
  但不是忘了換，而是**換成了另一個環境的值**（推測 14:04 修復時複製了正式區的 SQL）。
  BUG-002 的偵測 SQL 只檢查「密鑰長度是不是 13」，抓不到這種。
- **值得警惕**: 同一組 URL＋密鑰在 08:04:43Z（台北 16:04）**還回 200**，
  是正式區後來重設 `CRON_SECRET` 才變成 401。
  也就是說在那之前，**測試區的資料庫有能力觸發正式區的批次**。
- **Fix**: 重建測試區 cron job（url 改回自己的 ref、填入測試區自己的 `CRON_SECRET`、
  排程改 `*/15 8-15 * * 1-5`）。`schema.sql` §6d 的覆驗清單補上
  「**url 的 project ref 必須是自己**」這條判準。
- **Verification**: ✅ 2026-07-27 20:15 那輪跑通 —— `manifest.json` 由
  `06:03:54Z` / `ymd=20260724` 推進到 `12:15:05Z` / `ymd=20260727`，
  `batch_run_log` 寫入第一列（`t86_today=true`、`generated=5`、`duration_ms=15361`）。

### Bug ID: BUG-002 - 正式區 cron 的 `<CRON_SECRET>` 佔位符從未替換，盤後批次從來沒自動跑過
- **Date**: 2026-07-27（發現並修復）
- **Discovered by**: Claude，0.6.0 定版後的兩區部署稽核
- **Root Cause**: `schema.sql` §6c 的 `cron.schedule` body 內有兩個佔位符
  （`<PROJECT_REF>` 與 `<CRON_SECRET>`），需人工替換。正式區當初套用時未替換，
  cron job 因此以字面值 `'<CRON_SECRET>'`（長度 13）呼叫函式。
- **Impact**: 正式區 `stock-report` 以 `--no-verify-jwt` 部署、授權完全靠 `x-cron-secret`，
  故三班全數 401。**正式區的盤後批次從未靠 cron 產出過報告**，過去所有報告都是手動觸發的。
  更麻煩的是它**無聲**：失敗只留在 `net._http_response`（保留 6 小時），隔天就查無痕跡，
  而 Storage 裡又一直有（手動產的）報告，從前端完全看不出異常。
- **同源前例**: 測試區同一個佔位符故障已於 2026-07-27 14:04 修復。同一顆地雷踩了兩次，
  因為兩區是各自獨立套用 schema 的，修好一邊不會連帶修好另一邊。
- **Fix**: 重新 `cron.unschedule` + `cron.schedule`，填入真實 project ref 與 CRON_SECRET 明文。
  修復後覆驗：`active=true`、URL 為 `https://kxnxadaghidwumqsqneu.supabase.co/functions/v1/stock-report`、
  密鑰長度不再是 13。
- **偵測方法**（往後可直接重用，只回頭尾 4 碼故可安全外流）:
  ```sql
  SELECT jobname, schedule, active,
         (regexp_match(command, 'url\s*:=\s*''([^'']*)'''))[1] AS url,
         left(s,4) || '…' || right(s,4) || ' 長度=' || length(s) AS 密鑰片段
  FROM (SELECT jobname, schedule, active, command,
               (regexp_match(command, $$'x-cron-secret',\s*'([^']*)'$$))[1] AS s
        FROM cron.job WHERE jobname = 'stock-report-nightly') t;
  ```
  **長度 13 = `<CRON_SECRET>` 沒換掉。**
- **Verification**: ✅ **通過**（2026-07-27 19:20 查證，Claude）。
  `manifest.json` 的 `generatedAt` 由基準 `08:04:50Z` 推進到 `09:46:47Z`；
  `batch_run_log` 寫入兩列（`17:30` cron ＋ `17:46`），皆 `t86_today=true`、`generated=5`；
  `cron.job` `active=true`。**cron 通了，正式區的盤後批次第一次真的自動跑起來。**
  順帶推翻舊註解：**17:30 就拿得到當天的 T86**（`data_ymd=20260727`）。
  ⚠️ 同日測試區 `manifest.json` 仍停在 `06:03:54Z`，其 cron 未見動靜 —— 另立 BUG-003。
- **教訓**: 需要人工替換佔位符的 schema 段落，**套用完必須有一次獨立的覆驗查詢**。
  「SQL 執行成功」不等於「值填對了」—— `cron.schedule` 對佔位符字串照收不誤。

### Bug ID: BUG-001 - 庫存總覽與券商 APP 均價與損益率口徑不一致
- **Date**: 2026-07-17
- **Root Cause**:
  1. **均價落差**: 手續費登錄為 80 元（實際券商為 40 元），導致計算買入均價由 102.44 升至 102.48。
  2. **損益率落差**: 原系統庫存總覽混入歷史已結清週期之損益與成本（分母含已結清部位成本），導致計算總報酬率與證券 APP 的未實現報酬率口徑不同。
- **Fix**:
  1. 交易紀錄更新手續費登錄值。
  2. 修改 Dashboard 元件與損益計算邏輯：移除「已實現損益」「累計總損益」欄位，總報酬率調整為僅採計當前部位之「未實現報酬率」（未實現損益 / 當前部位總成本）。
- **Changed Files**: `sources/src/components/Dashboard/`, `sources/src/utils/pnlEngine.ts`
- **Verification**: 通過單元測試與手動比對證券 APP 口徑。
