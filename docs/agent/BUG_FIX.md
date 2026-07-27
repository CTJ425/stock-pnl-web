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

BUG-004 的線上驗證已於 23:00 通過（`skip_reason=complete`、753ms、零對外抓取）。

**明天（2026-07-28）第一個完整的 32 輪日值得回頭看一次** —— 今天只從 20:30 起
在新排程下跑了 13 輪，且 `t86_revisions` 含修復前的假改寫。要驗的是：
16:00–17:00 那幾輪（T86 尚未發布）會不會有非預期的行為，以及一整天的短路比率。


若發現新 Bug，請在此記錄：

```markdown
### Bug ID: BUG-XXX
- Description: 
- Root Cause:
- Impact:
- Status: OPEN
```
