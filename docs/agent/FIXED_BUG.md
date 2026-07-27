# Fixed Bugs History (FIXED_BUG.md)

- Agent: Gemini
- Status: ACTIVE
- Timestamp: 2026-07-21 09:32:30 Asia/Taipei

---

## 🐛 Historical Bug Fixes

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
