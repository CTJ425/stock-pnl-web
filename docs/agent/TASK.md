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

### Task 184: 月退 decides the recorded fee, and the fee-rate base is editable
- **Status**: ✅ DONE — released as **0.10.11** then **0.10.12** (`c320006`), on `main` and `dev`
  (identical), both Releases published by CI, CI green. vitest 2,697 pass / 7 skipped,
  `npm run build` and `typecheck:edge` exit 0. **Neither release was checked in a browser** — the
  user asked to ship fast; the change is covered by App-level tests that render the real form.
- **Reversed in 0.10.12, on the user's decision after seeing it**: 月退 no longer writes the
  statutory rate into a transaction. A recorded fee is what the trade finally costs you, and
  nothing here records the monthly refund, so the list price would leave that money outside the
  ledger (~1,112 元 on their 1,258,800 position). The rebate still decides the dashboard headline,
  and the 券商 column stays on 牌告 for every TWD row (`holdingRows.ts:111`), so both numbers remain
  visible. `chargedFeeRate` is gone; see RISK-022 for the cost of this choice.
- **Agent**: Claude
- **Timestamp**: 2026-10-01 14:36:00 Asia/Taipei
- **Why**: the dashboard read 79,523 against 玉山 App's 78,276. The 1,247 is entirely the sell-fee
  rate (2303 matched to the dollar: 460 − 138 = 322), which proves 玉山 bills the statutory 0.1425%
  and refunds the discount — **月退**. `fee_rebate` only reached `pnlBasis`, so 新增交易 and 批次重算
  recorded the *discounted* fee: a number no settlement statement shows, and the discount never
  comes back to that row.
- **Shape**: `chargedFeeRate(rate, rebate)` in `utils/pnlBasis.ts`, derived from `pnlBasis` so they
  cannot drift. Recording paths use it; estimates keep using `pnlBasis`.
- **Done**:
  1. `chargedFeeRate` wired into `TransactionForm`, `RecalcFeesModal` (+ 月退 hint) and `StockSplitModal`.
  2. Trap A: a moved 生效日 on a workspace with no rate writes `fee_rate = 0.001425` **plus** the
     segment, instead of making the discount the base and re-pricing the whole ledger.
  3. Trap B: the 費率變更紀錄 base row has a 「改」 inline editor, the only exit when the base is
     already the discounted rate (saving the same rate from a date is not a change, so the segment
     was dropped). It re-normalises the history against the new base.
  4. 月退 is the default once a discount is picked, 現折 at the list price; a stored value equal to
     the old default does not count as a choice, so a workspace is never pinned to 現折. Persisted
     on save because the Edge holdings card reads `fee_rebate` from the row.
- **Items**:
  5. ~~Commit to `dev`, run the gates, release~~ ✅ 0.10.11 (14:45) and 0.10.12 (15:38). No deploy
     was needed for either: neither diff touches `sources/supabase/**`, so Edge and DDL are
     untouched and Cloudflare Pages serves the new frontend from `main` on its own.
  7. **Confirm 現折 vs 月退 from a settlement statement** ⏳ — the whole 月退 reading came from 玉山
     App's *estimate* screen, never from an actual deduction. One buy's 交割金額 (0.1425% or
     0.0541%?), or a 折讓金 credit on last month's statement, settles it. Since 0.10.12 a wrong
     guess only mislabels the dashboard headline, so this is no longer urgent — but it is still
     unproven, and the setting is one click either way.
  6. User's own save ⏳: PROD 玉山證卷 → 「改」 on 「一直以來 3.8 折」 → 不打折, then 3.8 折 from
     2026-10-01. Under 月退 the recalculation uses 0.1425% for every date anyway, so this is about the
     record being true, not about today's numbers.
- **Not done, named on purpose**: 最低手續費 still has no date dimension (`settings.ts:152`, global,
  BUG-084), so a recalculation applies today's 20 元 / 1 元 to every date. Narrow (small odd lots
  only) and only wrong if the broker's minimum changed with the agreement. **Nowhere records a
  月退 折讓金** — 0.10.12 side-steps it by folding the discount into every trade, which assumes the
  refund always arrives; a 現金收入 entry like 現金股利 would close it properly (RISK-022).
- **Warn before any 批次重算 on a ledger built from broker statements**: since 0.10.12 the wizard
  re-prices rows at the discounted rate, so rows entered or imported at the real (full) deduction
  get overwritten with an estimate, moving 投入成本 and 已實現損益. The list is pre-checked.

### Task 182: Fee rate as a fact with a validity period (玉山 3.8 折 from 2026-10-01)
- **Status**: 🔄 IN PROGRESS — infrastructure complete (2026-10-01). DDL on DEV **and** PROD,
  `verify_setup()` 10/10 PASS on both, Edge `stock-report` redeployed (DEV v35 / PROD v23, ezbr
  `056ef180e20bdba5…` on both). Verified in a browser against **cloud** DEV: saving 3.8 折 effective
  2026-10-01 no longer errors and the history reads back. **Only item 4 is left, and it is the user's.**
- **Agent**: Claude
- **Timestamp**: 2026-10-01 11:20:00 Asia/Taipei
- **Why**: 玉山 moved from 6.5 折 to 3.8 折 on 2026-10-01. A single `workspaces.fee_rate` cannot say
  "before this date it was 6.5 折", so 批次重算 re-priced the whole history at the new rate — measured
  on a seeded store: it listed all three September rows, pre-checked, and applying moved 投入成本
  450,417 → 450,244, 保本價 904.39 → 903.69, 已實現 +22,720 → +23,075, and overwrote every row's
  `fee_rate`. See `PROGRESS_ARCHIVE.md` 2026-09-30 18:40:00 Asia/Taipei.
- **Shape**: `workspaces.fee_rate_history` JSONB `[{from, rate}]`; `fee_rate` keeps its meaning as the
  rate **before** the first segment. `utils/feeRateHistory.ts` `rateOn(history, base, date, fallback)`
  is the one lookup; a recorded trade asks with its own `tx_date`, an unrealized / break-even estimate
  asks with today.
- **Done**: items 1-3 — full detail in `PROGRESS.md` 2026-10-01 11:20:00 Asia/Taipei.
- **Items**:
  4. ~~Set the real 玉山 workspace to **3.8 折 from 2026-10-01** in the UI (user did this on both
     DEV and PROD, 2026-10-01)~~ ✅ — **but PROD landed in the wrong shape**: 玉山證卷 had no rate at
     all, so the save became the base and the dialog reads 「一直以來 3.8 折」, i.e. every trade ever
     made counts as 3.8 折. DEV (SNAP-Ivan正式區) already had 原價 as its base and reads correctly
     (「2026-10-01 起 3.8 折 / 2026-10-01 之前 不打折」). The fix is Task 184's 「改」 button —— ⏳ one
     save left for the user, tracked in Task 184.

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
