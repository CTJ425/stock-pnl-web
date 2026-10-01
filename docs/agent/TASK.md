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

### Task 183: 股利專區 — the year's cash dividends under the yearly report
- **Status**: ✅ DONE — released as **0.10.10** (`abe8c38`), on `main` and `dev`, Release published by CI.
  No deploy was needed: the 股利 feature is frontend-only and changes no schema.
- **Agent**: Claude
- **Timestamp**: 2026-09-30 19:35:00 Asia/Taipei
- **Why**: the user could already record a 現金股利, but nothing showed them a year of dividends,
  and the 二代健保 deduction had to be looked up and typed from scratch every time.
- **Settled with the user before any code** (all four are implemented as stated):
  1. 總報酬 = 這一年的已實現損益 + 股利**實收**（不是配息總額）
  2. 逐筆明細帶「每股股利」欄，讓每一列自己可以驗算
  3. 個股占比只畫金額**前 4 大**，其餘折成灰色「其他」，固定排最後
  4. `tx_date` 就是**發放日**，不另加除息日欄位
- **The rule that must not be reversed**: the 二代健保 figure is computed at **write** time and
  stored in `fee_tax`. Nothing recomputes it on read — 衛福部 has a standing proposal to move
  dividends to an annual settlement, and a read-time formula would silently rewrite every
  historical dividend the user already reconciled against a broker notice. Since 0.10.10-dev.2 the
  field **fills itself and follows every edit**, exactly like 手續費 (the user's call); that is a
  write-time behaviour and does not weaken the rule.
- **Files**: `utils/nhiSupplement.ts`, `utils/dividendReport.ts`,
  `components/YearlyReport/DividendSection.tsx`, `YearlyPage.tsx` (wiring),
  `components/Transactions/TransactionForm.tsx` (the hint), `styles/dashboard.css`.
  Engine and Edge mirror untouched; **no schema change**.
- **Design record**: `docs/design/dividend-section-mockup.html`, `docs/design/dividend-data-flow.html`.
- **Left open on purpose** (not started, not blocking):
  - 匯費 is a constant 10 in the hint. If a broker charges something else, it becomes a workspace
    setting — deliberately not built on speculation.
  - The US section shows US dividends gross/net but offers no withholding hint; US dividends are
    withheld at source (30%) under a rule this module does not model.

### Task 182: Fee rate as a fact with a validity period (玉山 3.8 折 from 2026-10-01)
- **Status**: 🔄 IN PROGRESS — **shipped to PROD in 0.10.10 with its DDL still unapplied** (the user's
  call, 2026-10-01). Until the column exists, changing a workspace's 手續費率 throws
  「儲存費率生效日失敗」 — reads degrade safely, that one write does not
  (`dataProvider.ts:550` has no ladder; `WorkspaceFeeSettings.tsx:113-120` takes that path whenever
  the workspace already has a `fee_rate`). Fix: run the two statements already in
  `sources/supabase/schema.sql` against DEV then PROD, then redeploy `stock-report`.
- **Agent**: Claude
- **Timestamp**: 2026-09-30 18:40:00 Asia/Taipei
- **Why**: 玉山 moved from 6.5 折 to 3.8 折 on 2026-10-01. A single `workspaces.fee_rate` cannot say
  "before this date it was 6.5 折", so 批次重算 re-priced the whole history at the new rate — measured
  on a seeded store: it listed all three September rows, pre-checked, and applying moved 投入成本
  450,417 → 450,244, 保本價 904.39 → 903.69, 已實現 +22,720 → +23,075, and overwrote every row's
  `fee_rate`. See `PROGRESS.md` 2026-09-30 18:40:00 Asia/Taipei.
- **Shape**: `workspaces.fee_rate_history` JSONB `[{from, rate}]`; `fee_rate` keeps its meaning as the
  rate **before** the first segment. `utils/feeRateHistory.ts` `rateOn(history, base, date, fallback)`
  is the one lookup; a recorded trade asks with its own `tx_date`, an unrealized / break-even estimate
  asks with today.
- **Items**:
  1. Apply the DDL to **DEV**, then verify with `verify_setup()` ⏳
  2. Apply the DDL to **PROD** (separate, needs the user's OK; a `main` push never carries it) ⏳
  3. Deploy Edge `stock-report` **after** the DDL — `loadHoldingsWorkspaces` selects `fee_rate_history`
     and steps down one column set if it is missing, so the order is safe either way, but the card only
     follows the history once both are in ⏳
  4. Set the real 玉山 workspace to 3.8 折 from 2026-10-01 in the UI (one save; no recalculation needed) ⏳

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

### Task 181: Check whether the broker halves the day-trade tax per lot within one ticker
- **Status**: ⏸️ WAITING ON EVIDENCE (needs a real trade, no code change until then)
- **Agent**: Claude
- **Timestamp**: 2026-09-30 18:05:00 Asia/Taipei
- **What**: 0.10.9 halves the securities tax **per open lot** whose buy date is today (`lotSellTaxRate`). The evidence behind that choice is cross-ticker — 6560 bought that day at 0.15% next to 2303 held overnight at 0.3% — so it does not prove the broker looks at lots rather than at whole positions.
- **How to settle it**: buy more of a position you already hold, then read the broker's 預估收入 for that ticker the same day. Per lot ⇒ only the new shares get 0.15%. Whole position ⇒ every share does, and `estimateUnrealized` would need the halving applied to the position, not the lot loop.
- **Why it can wait**: the two answers differ by at most 0.15% of the older lots' market value, and only on a day you add to a holding.

### Task 47: Refresh next year's release calendar every December (recurring)
- **Status**: 🔁 **Recurring**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **What to do**: Update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates.
- **Why manual**: BLS schedule page returns 403, so it cannot be synced automatically. `sources/scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.
