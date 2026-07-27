# Active Bug Fixes (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-07-27 19:30:47 Asia/Taipei

---

## 🐛 Currently Active / Open Bugs

### Bug ID: BUG-003 — 測試區的盤後 cron 沒跑（正式區同日已修好並驗證通過）
- **Status**: OPEN（已定位範圍，未進入診斷 —— 需 link 測試區，見下方）
- **Discovered**: 2026-07-27 19:20 Asia/Taipei，Claude（驗收 BUG-002 時順帶發現）
- **Description**: 測試區 `wqetxuhncvfidqnklyew` 的 `reports/manifest.json` 仍停在
  `generatedAt = 2026-07-27T06:03:54.938Z`、`ymd = 20260724`（上週五），
  17:30 那班沒有推進。同一時間正式區已由 `08:04:50Z` 推進到 `09:46:47Z`。
- **已知條件**:
  - 測試區的 `<CRON_SECRET>` 佔位符故障已於同日 14:04 修復（與 BUG-002 同源）。
  - 測試區 `stock-report` 已於 16:38 重部署為 v13（含 `logBatchRun`），逐檔 diff 一致。
  - 測試區 `batch_run_log` 表存在。
  - 部署的 v13 無論如何都會覆寫 `manifest.json`，所以「有跑但沒寫」不成立 ——
    要嘛 cron 沒觸發、要嘛函式在寫 manifest 之前就整個失敗。
- **待查（優先序）**:
  1. `select jobname, schedule, active from cron.job;` —— job 是否存在且 `active`。
  2. `select id, status_code, error_msg from net._http_response order by id desc limit 5;`
     —— **只保留 6 小時**，17:30 那班的紀錄約 23:30 就會消失，要查要趁早。
  3. `select * from batch_run_log order by id desc limit 5;` —— 有列＝有跑進函式。
  4. 14:04 那次修復是否只改了密鑰而 `<PROJECT_REF>` 仍是佔位符（用 FIXED_BUG.md
     BUG-002 的偵測 SQL，它同時檢查 url 與密鑰長度）。
- **阻塞**: 上述皆需 `supabase db query --linked` 對測試區執行，而 `supabase link`
  有全域副作用（§13.3），會把使用者目前 link 著的正式區清掉。**需使用者同意後再進行。**
- **Impact**: 僅測試區。測試區報告停留在上週五的資料，dev 分支的線上驗證會拿到過期資料
  —— 不是應用程式故障，但會讓「測試區驗證過了」這句話失去意義。

---

若發現新 Bug，請在此記錄：

```markdown
### Bug ID: BUG-XXX
- Description: 
- Root Cause:
- Impact:
- Status: OPEN
```
