# Active Bug Fixes (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-07-27 22:20:00 Asia/Taipei

---

## 🐛 Currently Active / Open Bugs

There are currently no open bugs.

BUG-003 (cron from test area to official area) has been fixed and verified at 2026-07-27 20:15.
BUG-004 (T86 column order is unstable and polling never ends) has been fixed and deployed at 22:10 on the same day.
Both moved to `FIXED_BUG.md`.

The online verification of BUG-004 passed at 23:00 (`skip_reason=complete`, 753ms, zero external crawling).

**The first full 32 round day tomorrow (2026-07-28) is worth a look back** – today only from 20:30
13 rounds were run under the new schedule, and `t86_revisions` contained fake revisions before the fix. What needs to be checked is:
16:00–17:00 Will those rounds (not yet released for T86) have unintended behavior, and short circuit ratios throughout the day.


If you find a new bug, please record it here:

```markdown
### Bug ID: BUG-XXX
- Description: 
- Root Cause:
- Impact:
- Status: OPEN
```
