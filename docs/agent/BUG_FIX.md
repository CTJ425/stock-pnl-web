# Active Bug Fixes (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-07-27 22:20:00 Asia/Taipei

---

## 🐛 Currently Active / Open Bugs

目前暫無開啟中的 Bug。

BUG-003（測試區 cron 打到正式區）已於 2026-07-27 20:15 修復並驗證，
BUG-004（T86 列順序不穩定害輪詢永不收工）已於同日 22:10 修復並部署，
兩者皆移至 `FIXED_BUG.md`。

**BUG-004 的線上驗證尚未完成** —— 要看正式區 `batch_run_log` 出現
`skipped=true / skip_reason=complete`。若到 23:45 收工都沒出現，
代表還有第二層問題，屆時重新開一個 Bug 追蹤。


若發現新 Bug，請在此記錄：

```markdown
### Bug ID: BUG-XXX
- Description: 
- Root Cause:
- Impact:
- Status: OPEN
```
