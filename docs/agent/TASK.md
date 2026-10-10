# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-10-08 15:07:18 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory).
> For detailed implementation history, always refer to `PROGRESS.md`.

## 📍 Where the project stands (2026-09-27)

- 2026-09-27: every task opened before Task 170 (167, 166, 165, 164, 160, 159, 158, 144, 85, 76, the quote-yahoo data source, 132/133) was moved verbatim to `TASK_ARCHIVE.md` → `## Archived 2026-09-27 —— unfinished tasks before Task 170 (user request)`. Their open items are **not** done; `grep` that section before picking any of them up again.
- Front end deploys from `main` via Cloudflare Pages; Edge Functions and DDL never travel with a push (see CLAUDE.md § Release workflow).

## 📋 Active Tasks

### Task 198: Remove Fugle — TW quotes back to MIS → Yahoo; quote-path review
- **Status**: 🔄 IN PROGRESS
- **Agent**: Claude
- **Timestamp**: 2026-10-08 13:07:25 Asia/Taipei
1. ~~Remove every Fugle leg (prices, intraday, daily, `syncDaily`, `fugle-eval`); Edge files restored to `ceb539e^`~~ ✅ 0.10.36-dev.1
2. ~~Deploy to DEV, then PROD~~ ✅ 0.10.36 — DEV 2026-10-08 15:00; PROD 2026-10-08 15:20 by the user via `db-migrate.sh --functions-only` (all ✓: three functions ACTIVE, `CRON_SECRET` `21d0257c…` = cron, Auth Site URL `https://stock-pnl-web.pages.dev/` + 5 redirect URLs). Verified: PROD `market-data-daily` 200 with `total=5 dailySynced=1 dailySkipped=4`, `daily/6560.json` 244 rows; the live site (bundle points at `zizndnzibubcqdvnuhwr`) gets `stock-price` 200 for 2330 / 6560 / AAPL with its own publishable key.
3. User: delete `FUGLE_API_KEY` from DEV and PROD secrets (no longer read) — ⏳ (neither recreated project has it as of 2026-10-08)
5. Project refs changed: PROD is now `zizndnzibubcqdvnuhwr`, DEV `accmczhrqsilzrtyhyxa` (old `hrilemueiqyaoiwnkeuu` / `zyebvayngwrqzoaicbwd` return 404). CLAUDE.md § Branches & envs and the `supabase-ops` skill still name the old ones — ⏳ update with the user's OK
6. Script gaps found in the 2026-10-08 review, not fixed: `db-backup.sh` does not copy Storage files (the `backups` bucket's per-user snapshots were lost with the old PROD); `cron.sql` does not keep a job's `active` flag; `db-backup.sh`/`db-migrate.sh` need GNU `sha256sum` and bash 4 (not macOS) — ⏳ user to decide
7. User: revoke the access token and reset the DEV DB password pasted into the 2026-10-08 chat for the E2E — ⏳
4. Quote-path improvements proposed 2026-10-08 (single-flight on L2 miss, parallel MIS groups, browser reads `price_cache` before invoking Edge, one shared poll, Yahoo concurrency cap, MIS failure logging) — ⏳ user to pick

### Task 194: Show password, keep sign-in 7 days, sector money flow (類股資金流向)
- **Status**: 🔄 OPEN REMAINDER — **released as 0.10.30** (`6c25488`) and 0.10.31 (`872e620`, `main` = `dev`; 資金流向 windows 今日 / 近 3 日 / 近 5 日). PROD DDL applied and PROD Edge deployed (`stock-report` v29 `6cf00d27dc3d` = DEV v50, `verify_jwt` false kept); `verify_setup()` 11/11 PASS on PROD; Release 0.10.30 created by CI, body correct; production serves the build (live bundle carries `sector-flow` and `保持登入`).
- **Agent**: Claude
- **Timestamp**: 2026-10-05 14:52:00 Asia/Taipei
- **Spec**: docs/agent/specs/194-login-remember-and-sector-flow.md
- **Done**: items 1–3, 4a, 6, 7, 8 — password reveal, 保持登入 7 天, 資金流向 page (layout B, in-place details, per-group top-5 stocks, treemap removed), the 手動更新 button, the three free-tier optimisations on DEV **and PROD**. Full text in `TASK_ARCHIVE.md`.
- **Items**:
  4. **No `market/sector_flow.json` exists on DEV or PROD yet** — the page shows 尚無類股資金流向資料. The first automatic run is the first chips round after the probe sees T86 (Mon 2026-10-05, ~16:00 Taipei), or the 手動更新 button (`sync-sector-flow`) on either environment. Then check the page on PROD, and that the TPEx half arrives (`coverage.otc`) ⏳
  5. Real-login browser check: 保持登入 across a close/reopen on iOS Safari and Windows (the 7-day cap itself is unit-tested only) ⏳ — 2026-10-09 Playwright run (faked Supabase HTTP, no real login) passed the close/reopen and cap-on-reload cases but found BUG-119 (open tab), fixed and released in 0.10.37; iOS Safari / Windows still unchecked
  10. 資金流向 rebuilt as a treemap, **released as 0.10.32** (`1e8b24f`, `main` = `dev`; frontend only, no Edge or DDL). Open: look at it on the real file once item 4 produces one ⏳
  9. Probe schedule proof: on Mon 2026-10-05, `source_probe_tick` on DEV and PROD should show ticks only between 12:00 and 23:30 Taipei, none outside; the only proof today is structural (schedule read back, and a test ties `schema.sql` to every probe window) ⏳

### Task 193: Codebase review 2026-10-04 — fix the findings (B1–B4)
- **Status**: 🔄 OPEN REMAINDER — released as **0.10.29** (`f4d8420`); PROD DDL applied and PROD Edge deployed (`stock-report` v28 / `stock-price` v18 / `backup-transactions` v8, ezbr = DEV). Only item 6 is live.
- **Agent**: Claude
- **Timestamp**: 2026-10-04 15:53:11 Asia/Taipei
- **Spec**: docs/agent/specs/193-codebase-review-2026-10-04.md
- **Done**: items 1–5, 7 — full text in `TASK_ARCHIVE.md`.
- **Items**:
  6. Two Release titles already damaged by backticks (0.9.35, 0.9.33) — ask before `gh release edit`; also the Release for 0.7.25 never gets created (`gh release create 0.7.25 --target 5550979…` fails in CI on every `main` push, cause not read) ⏳

### Task 192: Discord 持股日報 — one message, one section per workspace
- **Status**: 🔄 OPEN REMAINDER — released as **0.10.27**; `stock-report` DEV v43 / PROD v27, both `92e139e7ab55…`. Only item 5 is live.
- **Agent**: Claude
- **Timestamp**: 2026-10-04 12:23:11 Asia/Taipei
- **Spec**: docs/agent/specs/task-192-holdings-by-workspace.md
- **Done**: items 1–4 — full text in `TASK_ARCHIVE.md`.
- **Items**:
  5. On 2026-10-05 (first weekday tick) look at a real per-workspace card ⏳

### Task 191: TW market holiday calendar — weekday-holiday guard + calendar for admin and users
- **Status**: 🔄 OPEN REMAINDER — released as **0.10.26** (`6fb3cf6`); DEV `stock-price` v27 / PROD v17 (`811480ed6d70…`). Only item 5 is live.
- **Agent**: Claude
- **Timestamp**: 2026-10-04 11:22:25 Asia/Taipei
- **Done**: items 1–4 — full text in `TASK_ARCHIVE.md`.
- **Why**: BUG-110 follow-up — MIS can serve test-session matches on any closed day; next weekday holiday is 2026-10-09.
- **Items**:
  5. On 2026-10-09: confirm PROD/DEV `price_cache` holds no `trade_date = 20261009` rows and the dashboard shows 「今天休市（國慶日）」 ⏳

### Task 190: Fee settings UX — broker presets and a sticky action bar (/impeccable)
- **Status**: 🔄 OPEN REMAINDER — released in **0.10.22**; items 5–6 in **0.10.24**. Only item 3 is live.
- **Agent**: Claude
- **Timestamp**: 2026-10-02 18:12:59 Asia/Taipei
- **Done**: items 1, 2, 4, 5, 6 — full text in `TASK_ARCHIVE.md`.
- **Brief (user-confirmed 2026-10-02)**: no change to the four stored settings or any figure. 「你的券商 App 怎麼算」 is a
  segmented choice 玉山 / 元大 / 其他券商／自訂, derived from the four fields (nothing new stored; a workspace that never
  saved any shows none picked); the four radio groups fold behind 改單項 and open for 自訂 or a non-matching mix. The
  action bar is sticky (above the bottom nav on phones) and, on the dashboard, prints 台股未實現淨損益 saved → previewed.
  The discount block (rate, date, history) stays as it was — the user's choice.
- **Items**:
  3. Not looked at in a browser: the workspace-menu modal home and dark theme ⏳

### Task 189: 月退 cost on the list-price fee; sell-fee basis split off the rebate (A2)
- **Status**: 🔄 OPEN REMAINDER — released as **0.10.21** (`99cbe50`, `main` = `dev`), DDL + Edge on DEV and PROD,
  PROD settings of 玉山證卷 / Ron的投資組合 set and checked. Only items 7 and 11 are live.
- **Agent**: Claude
- **Timestamp**: 2026-10-02 16:30:00 Asia/Taipei
- **Why**: 玉山 App showed 009828 at −610, the dashboard −515. 95 = floor(107,000 × 0.1425%) 152 − recorded 57:
  a 月退 broker deducts the list fee at settlement, so its app's cost holds it. 元大 (BUG-088) keeps the
  discounted fee in cost but withholds the posted rate on the sell — so 「月退」 could not keep meaning
  「賣出用牌告」.
- **Broker facts (2026-10-02 research)**: official — 玉山 月退, refund 次月13日, tiers by monthly volume
  (6 / 5 / 3.8 折; Unicard 2.8 折 to 2027-03-31) (esunsec.com.tw/campaign/trade-fee); 永豐 「扣款時仍扣全額」,
  refund 隔月16日前 (sinotrade.com.tw/richclub/dawhotou/campaign/faq); 台新 「單筆委託單，不同成交價，手續費分別
  計算收取」 (tssco.com.tw/FeeCalculator). Third-party only — 元大 日退 (official page says only 「電子交易另有折扣」),
  國泰/群益 日退, 富邦/凱基/元富 月退. App display rules (cost fee, sell rate, per-lot vs position flooring) are
  published by no broker; only app comparisons show them.
- **Shape**: `fee_rebate` = what settlement charged; new `workspaces.sell_fee_basis` ('list' | 'net', NULL =
  the old rule `monthly && discount → list`). Under 'monthly' the 券商 figure's cost = ledger cost +
  `monthlyRebateCostUplift` (per open lot: list fee of the original buy with min fee, × qty/origQty, minus the
  lot's recorded fee share, clamped ≥ 0; `OpenLot.origQty` added). Recorded fees, realized P&L and RISK-022
  unchanged. Discord card follows (its cost/ROI denominator still the ledger cost).
- **Items**:
  1. ~~Code, tests (2,817 pass), build / lint / `typecheck:edge`, edge-engine sync~~ ✅
  2. ~~Playwright: `scripts/verify-monthly-rebate-cost-e2e.cjs` (−610 / −515 / −420, PATCH, 1440 + 390) and
     `verify-pnl-rounding-e2e.cjs` moved to 元大 = 日退 + 牌告, both PASS~~ ✅
  3. ~~DEV DDL `sell_fee_basis` + updated `verify.sql`; `verify_setup()` 10/10 PASS~~ ✅
  4. ~~DEV Edge `stock-report` v40 from clean `8bd36d9`, `--no-verify-jwt`; ezbr 968b24fa… → b5f9b528…~~ ✅
  5. ~~User tested on DEV and asked for the release~~ ✅
  6. ~~PROD settings set by SQL on the user's request (each UPDATE gated on the old values): Ron的投資組合 → 現折／日退
     + 牌告 (`sell_fee_basis` list), 玉山證卷 → 月退 + 牌告. Before/after on PROD data and the same `price_cache`
     quotes (2026-10-02 06:52 UTC): 玉山 0050 61,528 / 2303 16,137 / 6560 −886 (= the 玉山 app screenshot),
     Ron 00685L −8,901 / 009828 −71 / 2303 −2,066 — identical to the dollar and the ROI before and after; transactions
     untouched. Before-image + figures: `~/stock-pnl-web-snapshots/2026-10-02-prod-before/` (outside the repo)~~ ✅
  7. Unverified: whether a 月退 app lowers its cost after the monthly refund (screenshots only show the same
     day); 融券 legs under 月退 were not changed ⏳
  8. ~~PROD: DDL with identity guard, `verify_setup()` 10/10 PASS; Edge `stock-report` v25 (ezbr 968b24fa… →
     c3e280bd0730…, same bundle as DEV v41); `main` pushed, CI + Release 0.10.21 by CI; live bundle carries
     `sell_fee_basis` / 「計成本與預扣」~~ ✅
  9. ~~PROD Ron的投資組合 snapshot → DEV demo01 「Ron」 (2026-10-02 06:31 UTC). PROD settings: 0.0004275, 月退,
     整筆 (`position`), `day_trade_tax_estimate` false, no history; 65 rows, Σfee_tax 11,926, Σprice×qty 7,446,140 —
     identical on DEV after the copy. Owner: matches the 元大 app on 0.10.20. Raw rows kept **outside the repo**
     (public repo, another user's ledger): `~/stock-pnl-web-snapshots/2026-10-02-ron/` (+ DEV before-image)~~ ✅
  10. **Regression found on that snapshot** — 2303 moves −1,070 → −1,393 at the same price (+323 = list fees
     232 + 228 − recorded 69 + 68), 009828 −10 (list 30 vs recorded min-fee 20), 00685L unchanged (recorded 459 is
     already the list fee). Cause: Task 189 applies the 月退 cost uplift to every `fee_rebate = monthly` workspace,
     although Ron's is 月退 only because 0.10.20 needed it for the posted-rate sell; 元大 is 日退 and its app keeps
     the recorded fee in cost. With 日退 + 牌告 the figures equal 0.10.20 exactly.
     ~~Fixed in 0.10.21-dev.2 (user's choice: old workspaces do not move): `listPriceCost(rebate, sellFeeBasis)` —
     the uplift needs 月退 **and** a saved `sell_fee_basis`. Re-run on the snapshot: 00685L / 009828 / 2303 under PROD's
     settings = 0.10.20 to the dollar (−11,775 / 567 / −1,070 at avg-cost prices). Guards: holdingsCard + Dashboard
     tests for 月退 + NULL. Consequence: a 玉山 workspace needs one 儲存 in 手續費設定 to show −610~~ ✅
  11. Ron的投資組合 00685L is never discounted (user, 2026-10-02; recorded 459 = list). The workspace has one rate, so
     新增交易 pre-fills 00685L at 3 折 and 批次重算 would propose lowering 459 — both need a manual override until a
     per-ticker rate exists. Not built; same item as Task 188 #9 ⏳

### Task 188: UX / a11y follow-ups from the 2026-10-02 DEV E2E
- **Status**: 🔄 OPEN — not started; pick up only when the user asks
- **Agent**: Claude
- **Timestamp**: 2026-10-02 12:52:00 Asia/Taipei
- **Source**: E2E report artifact https://claude.ai/artifact/GytThoezGWdHSAfQKBQFXg (138 checks: 127 pass / 7 warn / 1 fail / 3 info). Numeric defects are BUG-104..107.
- **Items**:
  1. Mobile touch targets < 44px: watch-card × 16×16, header 新增交易 32×40 / 工作區 103×36 / 帳號 32×32, bottom nav 60×39 ⏳
  2. Watch card nests a button inside `role=button` (axe nested-interactive, serious) ⏳
  3. 年度收益 `.dim` cells fail AA contrast (axe, 3 nodes) ⏳
  4. 新增工作區 with a blank name: 建立 does nothing and says nothing (`WorkspaceControls.tsx` submit early-return) ⏳
  5. Login error shows raw Supabase English (「Invalid login credentials」) ⏳
  6. 個股分析: no free search (holdings + watchlist only); US holdings absent with no note ⏳
  7. Tablet 768px: tx table 840px scrolls sideways; input text 14px triggers iPad zoom (16px rule is ≤720px only) ⏳
  8. Missing `fundamental/{ticker}.json` logs a 400 in the console (2454, 2317) ⏳
  9. Data: Ivan's 0050 name is full-width 「台灣５０」 (NFKC on save); Ron's 00685L 2026-06-23 buy fee 459 vs recalculated 137 — **intentional per the user (2026-10-02); to be discussed later, do not "fix" it** ⏳

### Task 185: Fix the findings of the 2026-10-01 codebase review
- **Status**: 🔄 OPEN REMAINDER — the task itself shipped as **0.10.13** (`dd5a727`) and the entry is
  archived; only items 7, 10 and 12 below are still live. Full text, evidence and the completed items:
  `TASK_ARCHIVE.md` → `### Task 185` (top of file).
- **Agent**: Claude
- **Timestamp**: 2026-10-01 23:10:00 Asia/Taipei
- **Spec**: docs/agent/specs/185-codebase-review-2026-10-01.md
- **Done**: items 1–6, 8, 9, 13 — full text in `TASK_ARCHIVE.md`.
- **Items still open** (numbers kept as they were — other documents cite them):
  7. B3 — the `CRON_SECRET` leak itself is **settled** (exposed 14.5 h, retired `*.ivan.lab` host,
     value in use nowhere, history rewritten 2026-10-01; full evidence in `TASK_ARCHIVE.md`).
     - ⏳ **Left for the user**: GitHub still serves the pre-rewrite objects by direct SHA (verified:
       `/commit/81cf71a` and the raw file there both answer 200). Only GitHub Support can purge them.
       The request to send, and the checks to run afterwards, are in
       `docs/agent/github-support-purge-request.md`.
     - ⏳ Pre-rewrite mirror backup `/home/ivan/stock-pnl-web-backup-20261001-102622.git` **still
       contains the secret** — delete it when you are satisfied.
  10. C2 verify when the bond-ETF securities-tax exemption ends and give `sellTaxRate` a date dimension ⏳
  12. **B1 is still open and it is the sharpest one** ⏳ — measured against deployed DEV and PROD:
     `Bearer <the sb_publishable_ key in the public bundle>` returns **200 with quote data**. 0.10.13
     validates *what* can be asked, not *who* asks. Closing it means `assertUser` plus a per-user quota
     like `stock-report`'s, which changes who can use the quote path — a product decision, so it was
     deliberately not taken here.

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
  2. ~~Run the next release of this repo through the global `ship` skill end to end and record where it
     needed a human that the skill should have handled~~ ✅ — 0.10.13 on 2026-10-01 was that run. The
     pipeline itself held: gates, bump, changelog finalised **before** the `main` push (so the Release
     body was right first time), deploy via `supabase-ops`, verify, then the step-8 stop. Three things
     the skills did not cover were measured and written back to
     `script-docs/AI/skill/{ship,versioning}/SKILL.md` (and reinstalled globally):
     **(a)** comparing a static host's asset hashes against a local `npm run build` is not a deploy
     check — the host builds in its own environment and the hashes legitimately differ; ~15 minutes
     were lost to that. Verify by content instead, and remember an SPA answers `200` with `index.html`
     for a missing asset. **(b)** a CI-created tag is not in the local clone, so after a history
     rewrite `git push --force --tags` silently leaves it pointing at a dead commit — one of 179 tags,
     and it was the newest. **(c)** `supabase db query` reads a leading `--` SQL comment as a flag, and
     `RAISE NOTICE` never comes back — both now in the `supabase-ops` skill, with the
     `--linked --project-ref` note.
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
- **What to do**: Update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates. Also add next year to `TW_HOLIDAYS` / `TW_HOLIDAY_YEARS` in `stock-price/quoteWindow.ts` from `https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json&date=<YYYY>0101` — leave out 「開始交易日」/「最後交易日」 markers and weekend days; an uncovered year loses the holiday guard (Task 191). Edge deploy needed (PROD + DEV).
- **Why manual**: BLS schedule page returns 403, so it cannot be synced automatically. `scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.
