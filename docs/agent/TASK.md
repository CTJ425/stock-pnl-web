# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-09-30 17:20:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory).
> For detailed implementation history, always refer to `PROGRESS.md`.

## 📍 Where the project stands (2026-09-27)

- 2026-09-27: every task opened before Task 170 (167, 166, 165, 164, 160, 159, 158, 144, 85, 76, the quote-yahoo data source, 132/133) was moved verbatim to `TASK_ARCHIVE.md` → `## Archived 2026-09-27 —— unfinished tasks before Task 170 (user request)`. Their open items are **not** done; `grep` that section before picking any of them up again.
- Front end deploys from `main` via Cloudflare Pages; Edge Functions and DDL never travel with a push (see CLAUDE.md § Release workflow).

## 📋 Active Tasks

### Task 178: Prove the shared ship/versioning skills on a real release
- **Status**: 🔄 IN PROGRESS
- **Agent**: Claude
- **Timestamp**: 2026-09-30 16:05:30 Asia/Taipei
- **Background**: `ship` and `versioning` now live in `script-docs/AI/skill/`, are installed globally (`~/.claude/skills/`), and read this repo's paths from `.claude/release.config.json`. The project copies under `.claude/skills/` were `git rm`'d — recover from git if the cutover has to be undone. See `PROGRESS.md` 2026-09-30 16:05:30.
- **Items**:
  1. Commit both repos: ~~`stock-pnl-web` (config in, project skills out, `CLAUDE.md` trimmed) — done 2026-09-30 in the 0.10.9 bookkeeping commit~~ · `script-docs` (new `AI/skill/` subproject, installer, manifest, CI job, renamed `.claude/release.config.json`) —— ⏳
  2. Run the next release of this repo through the global `ship` skill end to end and record where it needed a human that the skill should have handled. ⏳
  3. Check the pieces the config expresses for the first time for real: ~~`type: "npm"` writing both `sources/package.json` and the lockfile — confirmed on 0.10.9, `npm version` wrote `version` and `packages[""].version` together~~ · `release.publishedBy: "ci"` — the skill must **confirm** the Release `release.yml` created, not try to create it —— ⏳ (0.10.9 is the first push to test it)
  4. Pre-existing and unrelated: `script-docs` CI runs `shellcheck` with `|| fail=1`, and `script/setup-en-cli-zh-tw-desktop/setup-en-cli-zh-tw-desktop.sh:60` emits SC2016 (info) on shellcheck 0.10.0. Decide there whether to silence it or pin severity — it can turn the new CI job red for reasons that have nothing to do with the skills. ⏳

### Task 179: Set Ron的投資組合 to 整筆 fee rounding in the UI (user's own call)
- **Status**: ⏸️ WAITING ON USER
- **Agent**: Claude
- **Timestamp**: 2026-09-30 17:40:00 Asia/Taipei
- **What**: BUG-088's code is fully released (front end 0.10.5, Discord card 0.10.6) and the PROD `fee_rounding` DDL is applied and verified (`verify_setup()` 10/10 PASS). The only thing left is a preference: open 手續費設定 → 「分批買進時，預扣的費用怎麼算」 for that workspace and pick 整筆, which makes its figures match 元大 instead of 玉山. Nothing to build. Full history: `FIXED_BUG.md` BUG-088.

### Task 180: Deploy `stock-report` for the BUG-087 day-trade tax rule
- **Status**: ⏸️ WAITING ON USER (needs an explicit OK per CLAUDE.md)
- **Agent**: Claude
- **Timestamp**: 2026-09-30 17:40:00 Asia/Taipei
- **What**: 0.10.9 changed `sources/supabase/functions/` (`holdingsCard.ts`, `holdingsRun.ts`, `_shared/engine/pnlEngine.ts`), and a `main` push never deploys Edge. Until `stock-report` is deployed the Discord holdings card still withholds the full 0.3% on a same-day lot while the web app does not. Deploy on **DEV** first and verify, then **PROD** (`supabase-ops`).
- **Also worth one check**: whether the broker halves the tax **per lot within one ticker**. The 2303-vs-6560 evidence is cross-ticker; buying more of an already-held position would settle it. The implementation is per lot.

### Task 47: Refresh next year's release calendar every December (recurring)
- **Status**: 🔁 **Recurring**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **What to do**: Update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates.
- **Why manual**: BLS schedule page returns 403, so it cannot be synced automatically. `sources/scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.
