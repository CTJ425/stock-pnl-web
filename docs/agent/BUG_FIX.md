# Active Bug Fixes (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-07-27 19:30:47 Asia/Taipei

---

## 🐛 Currently Active / Open Bugs

### Bug ID: BUG-003 — 測試區的 cron 打的是**正式區**的端點，而且被 401 擋下
- **Status**: ROOT CAUSE IDENTIFIED；schema 與函式已修，**cron job 待重建（缺密鑰明文）**
- **Discovered**: 2026-07-27 19:20 Asia/Taipei，Claude（驗收 BUG-002 時順帶發現）
- **Description**: 測試區 `wqetxuhncvfidqnklyew` 的 `manifest.json` 停在
  `2026-07-27T06:03:54.938Z` / `ymd=20260724`（上週五），17:30 那班沒有推進。
- **Root Cause**（2026-07-27 19:45 查證，兩個錯疊在一起）:
  1. **URL 指向正式區**。測試區 `cron.job` 的 command 內是
     `https://kxnxadaghidwumqsqneu.supabase.co/...` —— 那是**正式區**的 ref。
     測試區的排程從來不是在呼叫自己的函式。
  2. **密鑰對不上**。job 帶的是一組 43 碼字串（`Qea5…wvro`），
     `net._http_response` 顯示 09:30:00Z（台北 17:30）那次回 **401 `{"error":"Unauthorized"}`**。
  值得注意的是同一組 URL＋密鑰在 08:04:43Z（台北 16:04）還回 200 ——
  中間正式區重設過 `CRON_SECRET`（PROGRESS 記載 16:03:55 與 16:40–16:55 兩次動作）。
  **也就是說在被 401 擋下之前，測試區的排程確實有能力觸發正式區的批次。**
- **這是 BUG-002 的變種，不是新品種**: 同樣是「§6c 需人工替換的佔位符」，
  只是這次不是忘了換，而是**換成了另一個環境的值**（推測為 14:04 修復時從正式區複製 SQL）。
  BUG-002 的偵測 SQL 只檢查「密鑰長度是不是 13」，抓不到這種。
  **偵測條件要補上「url 的 project ref 必須等於本專案的 ref」** —— 已補進 `schema.sql` §6d。
- **Fix（進行中）**:
  - [x] `batch_run_log` 補 12 個欄位＋`(taipei_ymd, id DESC)` 索引（26 欄）
  - [x] `stock-report` 部署為 **v14**，`verify_jwt=false`；`functions download` 逐檔 diff 一致
  - [ ] **重建 cron job**：URL 改為測試區自己的 ref、填入測試區的 `CRON_SECRET`、
        排程改 `*/15 8-15 * * 1-5`。卡在**沒有測試區 `CRON_SECRET` 明文**
        （`secrets list` 只回雜湊），需使用者提供或重設。
- **Impact**: 僅測試區資料過期。但它同時是一個**跨環境誤觸發**的通道 ——
  測試區的資料庫有能力對正式區發批次請求，這比「測試區沒資料」嚴重。

---

若發現新 Bug，請在此記錄：

```markdown
### Bug ID: BUG-XXX
- Description: 
- Root Cause:
- Impact:
- Status: OPEN
```
