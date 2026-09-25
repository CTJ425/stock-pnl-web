# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 169 done — 0.9.70 on `main` (年度收益 search auto-expands matched years / sells)
- Status: ✅ `main` = `dev` = 0.9.70 (13ed768); frontend only, no Supabase change
- Timestamp: 2026-09-25 23:30:00 Asia/Taipei

---

## 📅 Log: 2026-09-25 23:30:00 Asia/Taipei (Task 169, 0.9.70 released)
- User asked to merge straight to `main`. 8b0e663 (0.9.70-dev.1) pushed to `dev`, CI success; 13ed768 finalized 0.9.70, `main` fast-forwarded, `main:dev` synced (both tips 13ed768).
- `main` CI + Sync GitHub Releases success; Release 0.9.70 published. Pages `appLog-*.js` carries `0.9.70`. Frontend-only change: no Edge / DDL to deploy. No browser check of the search behaviour itself (covered by the unit test only).

---

## 📅 Log: 2026-09-25 15:20:00 Asia/Taipei (Task 169, 年度收益 search auto-expand)
- User: searching a stock on 年度收益 showed nothing until the 2026 year row was expanded by hand. Cause: the search re-aggregates rows but `expanded` / `expandedTickers` stay at their default (collapsed), so the matching ticker and sell rows are hidden.
- Fix (`YearlyPage.tsx` `YearlySection`): when the trimmed query changes, set state during render — non-empty query opens every matched year and every ticker with sells; clearing it folds back to collapsed. Manual toggles still work until the query changes.
- New test in `YearlyPage.test.tsx` fails without the fix, passes with it. `npm test` 2,471 passed / 7 skipped; `npm run build` green. Not committed, not browser-checked.

---
