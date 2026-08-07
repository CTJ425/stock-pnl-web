# Task Backlog & Tracking (TASK.md)

- Agent: Grok
- Status: ACTIVE
- Timestamp: 2026-08-07 15:10:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md §4.1) ——
> This file must be loaded in every session. Before archiving, it had 38.6K tokens, of which 90% were completion history.
> For detailed implementation history, always refer to `PROGRESS.md`, which is the proper place for narratives.

## 📍 Where the project stands (2026-08-07 15:10)

- **Version 0.6.44** (working tree / about to ship on `dev`): full-market search on the individual stock
  analysis page; `stock-report` `generate`/`warm` gated by `assertUser` + `warm_quota` (30/day).
- **0.6.43 remains the last fully deployed baseline** until Edge Function + `warm_quota` DDL land in both
  environments. Frontend-only deploy without those will 401/403 non-holding warm/generate.
- **Open bugs: none.**
- **Task 76 items 1/3/4** were clock-bound on 2026-08-06 and were never written back as verified. Re-check
  is cheap (read-only Storage / `batch_run_log`); left open rather than closed by assumption.

⚠️ **Environment facts**:
1. `supabase link` may still point at **production** (`kxnxadaghidwumqsqneu`). Re-link before any
   `db query --linked` against test (`wqetxuhncvfidqnklyew`).
2. Project keys pasted in chat on 2026-08-05 — rotation was advised; **not confirmed done**.
3. **Deploy checklist for 0.6.44** (user must request; do not freestyle):
   - Apply `schema.sql` §5a on **test**, then **prod**: table `warm_quota` **and** function
     `take_warm_quota` (order: table first, then function).
   - `supabase functions deploy stock-report` (test first, `--no-verify-jwt`) then prod.
   - Smoke: signed-in warm of a non-held ticker → 200; anon → 401; 31st warm same day → 429;
     missing table/function → 503 (not unlimited).

## 📋 Active Tasks

### Task 77: Ship 0.6.44 (full-market analysis search)
- **Status**: 🔄 **Code + tests + docs ready; deploy / DDL pending user confirmation**
- **Agent**: Grok
- **Timestamp**: 2026-08-07 15:10:00 Asia/Taipei

1. ~~Frontend: search box, non-holding path, one-shot quote, stale daily re-warm~~ ✅
2. ~~Edge: `assertUser`, atomic `take_warm_quota`, unknown-ticker still runs `syncFundamental`, prune~~ ✅
3. ~~Schema: `warm_quota` table + `take_warm_quota` function in `schema.sql`~~ ✅ (file only — not applied yet)
4. ~~Tests: `warmStock`, `AnalysisPage` search paths, `StockDetailPage` name passthrough~~ ✅
5. ~~Version / CHANGELOG / SPEC / PROGRESS~~ ✅
6. **DDL + Edge deploy to test, smoke, then prod** —— ⏳ needs explicit user go-ahead (CLAUDE.md §13.2)
7. **Push `dev` → verify Pages/test → merge main** —— ⏳ after 6

### Task 76: Checks that can only be made during market hours
- **Status**: 🔄 **Item 2 closed 2026-08-06; items 1, 3, 4 still unrecorded**
- **Agent**: Claude (last update) / Grok (carried forward)
- **Timestamp**: 2026-08-06 10:00:00 Asia/Taipei (status text refreshed 2026-08-07)

1. **Did an early `market-daily` round actually land the day?** —— ⏳ still open as a written answer.
   Watch which round first carries the session day's row in `market/daily.json` `asOf` / content.
   Premise warning from 08-06 still holds: pre-08-06 run history was only three hourly rounds on 08-05.
2. ~~**The 成交量 discrepancy between the two sources**~~ —— ✅ **DONE 2026-08-06 10:00**. See SPEC 技術面.
3. **First post-BUG-018 T86 round `t86_revisions`** —— ⏳ expected one-off +1; query
   `batch_run_log` for the first day after the 0.6.42 Edge deploy (2026-08-06 16:30 onward).
4. **Trial-matching UI** —— ⏳ confirm 「試撮」 badge on dashboard + 「預估」 on quote card in an auction window
   (08:30–09:00 or 13:25–13:30). Needs a browser; data half is MIS `ip=1`.

### Task 47: Refresh next year's release calendar every December (recurring)
- **Status**: 🔁 **Recurring**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **What to do**: update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates.
- **Why it is manual**: the BLS schedule page returns 403 for everything (changing the
  User-Agent does not help), so it cannot be synced automatically; BEA's page is fetchable.
  `sources/scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.
- **If it is forgotten**: nothing breaks — once the calendar runs out the code falls back
  to rule-based estimation and marks the entry `stale`. Only precision drops, because the
  scan window no longer lines up with the actual release time.
