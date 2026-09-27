# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-09-27 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory).
> For detailed implementation history, always refer to `PROGRESS.md`.

## 📍 Where the project stands (2026-09-27)

- 2026-09-27: every task opened before Task 170 (167, 166, 165, 164, 160, 159, 158, 144, 85, 76, the quote-yahoo data source, 132/133) was moved verbatim to `TASK_ARCHIVE.md` → `## Archived 2026-09-27 —— unfinished tasks before Task 170 (user request)`. Their open items are **not** done; `grep` that section before picking any of them up again.
- Front end deploys from `main` via Cloudflare Pages; Edge Functions and DDL never travel with a push (see CLAUDE.md § Release workflow).

## 📋 Active Tasks

### Task 171: Chart-first redesign of 個股分析 / 年度收益 / 總體經濟 / 外幣匯率 / 後台 (user, 2026-09-27)
- **Status**: 🔄 IN PROGRESS
- **Agent**: Claude
- **Timestamp**: 2026-09-27 12:11:35 Asia/Taipei
- **Spec**: approved demo `docs/design/statement-pages-demo.html` (artifact claude.ai/artifact/P5pYEvsoJ5qYvK4XeYyRvB, v2); `DESIGN.md`
1. ~~Implement all five pages chart-first, one commit~~ ✅ 0.9.72-dev.1
2. User review on DEV (logged-in pages were checked locally with a mocked login against DEV's public report files, not with a real account) —— ⏳
3. With the user's OK: release 0.9.72 to `main` (frontend only: no Edge or DDL change) —— ⏳

### Task 170: Redesign the whole UI as a broker statement (券商對帳單) (user, 2026-09-26)
- **Status**: 🔄 IN PROGRESS — only the PROD `fee_rebate` DDL (user) is left
- **Agent**: Claude
- **Timestamp**: 2026-09-27 05:37:04 Asia/Taipei
- **Spec**: `DESIGN.md`, `PRODUCT.md`, `.impeccable/surfaces/sources-src-components-dashboard-dashboardpage-tsx.md`
1. ~~Tokens, fonts, controls, navigation, notices restyled; dashboard rewritten; fee basis from 現折/月退~~ ✅ 0.9.71-dev.1
2. ~~DEV: `workspaces.fee_rebate` column + CHECK~~ ✅ 2026-09-27
3. ~~DEV `stock-report` redeploy for the re-synced engine `models.ts` (type-only change)~~ ✅ v31, ezbr `27ef30af…` from clean tree at bfb9e55; POST `{}` → 400 Unknown action (boots)
4. ~~User review on DEV~~ ✅ 2026-09-27 (user: 「目前這個版本看起來不錯」; logged-in pages were checked by the user, not by screenshot)
5. ~~Release 0.9.71 to `main`~~ ✅ 495d974 (main = dev; CI + Release sync success; Pages live bundle carries `fee_rebate`, new favicon served) · PROD DDL `fee_rebate` —— ⏳ **user**: the Management API call was denied by the permission classifier ([Production Deploy]); run `docs/agent/prod-0.9.71-migration.sql` in the PROD SQL Editor · PROD `stock-report` redeploy (type-only engine change, optional) —— ⏳ user: `supabase functions deploy stock-report --project-ref hrilemueiqyaoiwnkeuu --no-verify-jwt` from `main`
6. ~~App icons / favicon / manifest colours to the statement mark (user 2026-09-27)~~ ✅ 0.9.71-dev.2

### Task 47: Refresh next year's release calendar every December (recurring)
- **Status**: 🔁 **Recurring**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **What to do**: Update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates.
- **Why manual**: BLS schedule page returns 403, so it cannot be synced automatically. `sources/scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.
