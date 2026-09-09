# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 全站 UI/UX 轉為 IBM Carbon Design（分支 feat/carbon-design）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-09 09:36:25 Asia/Taipei

---

## 📅 Log: 2026-09-09 09:36:25 Asia/Taipei (Task 147, 0.9.36, branch `feat/carbon-design`)

**The whole UI moves from the glassmorphism design system to IBM Carbon Design.**

- **Approach**: The stylesheet already routed every color through a token layer, so the conversion is a token rewrite plus a component-geometry rewrite in `sources/src/index.css`. No component file needed a class change. Carbon tokens are added under a `--cds-*` prefix, and every historic token name stays as an alias on top of them.
- **Changed**: Carbon Gray 100 (dark) and Carbon White (light) palettes; IBM Plex Sans and IBM Plex Mono; square corners; the Carbon spacing scale; Carbon tabs, buttons, text inputs, data tables, modals, inline notifications, overflow menus, content switchers and tags; a 2px `$focus` ring inside every control; Carbon motion curves; and the Carbon data-visualization palette in `chartColors.ts`.
- **Verified**: `npm run build` exit 0. `npm test` exit 0 — 103 files, 1732 tests passed. Playwright screenshots on both themes show the dashboard, the transactions table, the transaction modal and the yearly report.
- **Not done on purpose**: no version bump, no merge. The work sits on `feat/carbon-design`; `dev` and `main` are untouched.

---

## 📅 Log: 2026-09-07 11:35:00 Asia/Taipei (Session Memory Housekeeping & Archiving)

**Major memory cleanup across session hot files to reduce startup token burn.**

- **Problem**: Hot files read at session start (`PROGRESS.md`, `TASK.md`, `BUG_FIX.md`) grew to **45.3 KB (~12,000 tokens)**. `TASK.md` contained completed Task 146, outdated project status (referenced 0.9.30), and long-deferred tasks. `BUG_FIX.md` accumulated 0.6.x/0.7.x historical notes and repeated transcript token exposure logs.
- **Solution & Actions**:
  1. **`TASK.md` (20.8KB → 6.8KB, -67%)**:
     - Moved completed Task 146 (released in 0.9.35) and deferred tasks (Task 129, Task 125, Task 128, Task 140) to `TASK_ARCHIVE.md`.
     - Collapsed completed items in Task 85 and Task 76 per GEMINI.md size discipline.
     - Synchronized "Where the project stands" to current version **0.9.36**.
  2. **`BUG_FIX.md` (20.1KB → 5.2KB, -74%)**:
     - Moved obsolete 0.6.x/0.7.x historical notes (BUG-004, BUG-011, BUG-023, BUG-024, BUG-026, BUG-027) and stale ops heuristic notes to `FIXED_BUG.md`.
     - Consolidated repeated token exposure transcripts to `FIXED_BUG.md` with concise active security checklist remaining.
     - Preserved all active/accepted risks (`AUDIT-10`, `RISK-002..007`, `BUG-042..043`, `breakEvenPrice`).
  3. **`PROGRESS.md` (4.4KB → 3.9KB)**:
     - Rolled older 0.9.35 PROD rollout log to `PROGRESS_ARCHIVE.md`, keeping strict 2-log cap.
- **Result**: Startup hot context reduced from **45.3 KB down to 15.9 KB (65% reduction, saving ~7,500+ tokens on every future session boot)** with zero loss of historical records.
