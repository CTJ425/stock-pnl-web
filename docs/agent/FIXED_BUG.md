# Fixed Bugs History (FIXED_BUG.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-07-27 22:20:00 Asia/Taipei

---

## 🐛 Historical Bug Fixes

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
- **Verification**: 以實際抓下來的兩份檔案覆驗 —— 修正前位元組不同、修正後語意指紋相同。
  另加 6 個測試，含「真正的改寫仍測得出來」與「少一列」兩個反向案例
  （避免修過頭變成什麼都測不出來）。線上驗證看 `batch_run_log` 是否出現
  `skipped=true / skip_reason=complete` 且 `duration_ms` 掉到幾十毫秒。
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
