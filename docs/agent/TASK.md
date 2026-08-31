# Task Backlog & Tracking (TASK.md)

- Agent: Antigravity
- Status: ACTIVE
- Timestamp: 2026-08-14 13:28:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory) ——
> This file must be loaded in every session. Before archiving, it had 38.6K tokens, of which 90% were completion history.
> For detailed implementation history, always refer to `PROGRESS.md`, which is the proper place for narratives.

## 📍 Where the project stands (2026-08-24 11:37)

- **Version 0.9.9**:
  - Code: Finalized. Features: 儀表板觀察清單區塊（圖卡/條列雙視圖、localStorage 記憶、N/30 容量）、設計翻轉完稿（初稿庫存總覽駁回 → 0.9.0 發布個股分析 tab 4 → 0.9.9 儀表板）、死碼清理。Tests: 1145 passed (77 files, −3 from 0.9.8's 1148 via +10 WatchSection −13 WatchTab).
  - Schema: No changes in 0.9.9.
  - Unfinished: (1) PROD merge (dev → main) — **in progress by user**; (2) Deferred design variants scheduled for later.
- **Version 0.7.26**:
  - Releases: All 84 versions (`0.2` to `0.7.18`) backfilled to GitHub Releases; `.github/workflows/release.yml` created for automatic release sync on push to `main`.
  - Probe: Narrowed `t86` probe window from `15:30–17:30` to `16:00–17:00` (saving 6 daily no-op probes).
  - UI: `MechanismGuide` and `ProbeWarRoom` updated with T86 16:00–17:00 window description.
- **DEV cron count: 5**: `source-probe`, `macro-daily`, `fx-daily`, `market-data-daily`, `history-daily`.
- **All tests green**: 66 test files / 963 vitest tests 100% passed; `typecheck:edge`, `build`, `oxlint` 0 errors.

## 📋 Active Tasks

### Task 129: ETF constituents in 個股分析 (deferred after investigation)
- **Status**: ⏳ **OPEN — Investigated, deferred; research documented**
- **Agent**: Scribe
- **Timestamp**: 2026-08-24 13:33:13 Asia/Taipei
- **What is this**: Explore adding ETF constituent holdings display to 個股分析 page, showing what a selected ETF owns.
- **Investigation outcome**:
  - **Taiwan Stock Exchange has NO official ETF constituent API.** `openapi.twse.com.tw/v1` has two ETF-related endpoints: `/opendata/t187ap47_L` (fund master data — fund code, tracking index, whether it holds foreign constituents, establishment/listing dates) and `/ETFReport/ETFRank` (monthly regular-savings account counts). Neither provides holdings detail.
  - **Daily PCF (實物申購買回清單) published by each issuer, not TWSE.** TWSE ETF section only links out to issuer sites.
  - **Three candidate data sources if this is built later**:
    1. **MoneyDJ** — uniform URL pattern `https://www.moneydj.com/etf/x/basic/basic0007.xdjhtm?etfid=<ticker>.tw`, server-rendered HTML; verified working for 0050. Gives ticker / weight % / shares held / as-of date. One parser covers all TW ETFs, but it is a third-party site and breaks on redesign.
    2. **Per-issuer PCF pages** (元大 / 國泰 / 富邦 / 群益 / 統一 …) — most authoritative, but needs 10+ parsers plus a ticker→issuer mapping table.
    3. **Paid APIs** — TEJ "ETF 持股(日)" — authoritative but requires subscription.
  - **ETF detection** — no new data needed: `sources/src/utils/fees.ts:59` already infers ETF from ticker starting with `00`; authoritative list available at `t187ap47_L`.
  - **Data layer constraint** — No per-ticker metadata table exists in schema; building this feature requires: new table (holdings index) + new Edge Function proxy (browser CORS blocked) + caching strategy. Pattern exists (`supabase/functions/stock-price/` and `supabase/functions/stock-report/`). Lane classification: **Lane 2 (backend, schema, Edge)**.
- **Next step**: If user decides to build this, start with data source validation (which MoneyDJ parser is robust enough, or evaluate issuer pages), then design schema, then Edge Function.
- **Unfinished**: Everything (architecture through implementation).

### Task 125: Deferred watchlist card design variants (Sparkline / Chips & PE / Range Bar)
- **Status**: ⏳ **OPEN — Design documented, implementation deferred by scope**
- **Agent**: —
- **Timestamp**: 2026-08-24 11:37:39 Asia/Taipei
- **What is this**: During 0.9.9 implementation, three advanced card variants were designed but deferred due to scope constraints (basic card 股代 / 股名 / 價格 / % 變化 shipped; richer variants held for later).
- **Three variants documented in** `docs/architecture/watchlist_6_design_variants.md` **+ .html**:
  1. **Sparkline card** — 7-day price trend miniature line chart, visual at-a-glance trend without numbers.
  2. **Chips & PE card** — Institutional flow badges (籌碼) with buying/selling icons, P/E badge, 機構法人 buy/sell flow indicator.
  3. **Range Bar card** — Intraday high/low range bar (open/close markers), today's trading envelope without historical context.
- **Scope decision**: All three variants add complexity (data fetch, rendering, state management, testing) without changing core watchlist UX. Ship basic card first, validate user interaction, then evaluate demand for variants.
- **Next step**: When scheduling variants, start with design finalization (existing docs are draft), then estimate implementation effort, decide priority relative to other features.
- **Unfinished**: Everything (design validation to implementation).

### quote-yahoo-a data source: stats grid omits 均價 / 成交金額 / 昨量
- **Status**: ⏳ **OPEN — Code shipped, data source decision pending**
- **Agent**: —
- **Timestamp**: 2026-08-25 15:41:49 CST
- **What is this**: 0.9.17 shipped the 個股分析 quote tab with a redesigned stats grid. The design mockup (`docs/design/quote-redesign-mockups.html`) shows three additional cells (均價, 成交金額, 昨量) beyond the current seven (成交量/開盤/最高/最低/昨收/漲跌幅/振幅). The shipped grid omits these three because `PriceQuote` has no data source for them today.
- **Open work**: Data source decision (schema table, batch service, or external API integration) for the three omitted columns. Implementation is straightforward once the source is decided; the scope gate is architecture, not code.
- **Unfinished**: Data source definition.

### Task 85: 0.7.8 / 0.7.9 探針命中直接觸發抓取，且要確認資料到位
- **Status**: 🔄 **shipped everywhere and proven live; landing windows measured, retune needed**
- **Agent**: Claude
- **Timestamp**: 2026-08-11 19:00:00 Asia/Taipei
- **Done**: items 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14 — full text in `TASK_ARCHIVE.md`.

**0.7.9**: retiring a source now needs `data_landed`, judged by `sourceLanded` reading the artifact's
own date —— not by whether the fetch threw. Validated against today's real DEV artifacts (the chips
report for 20260811 has a null `margin` stamp and an unflipped `borrow` while returning ok, which is
precisely what 0.7.8 would have mis-retired).

9. **Watch one live round with a hit** —— ✅ **Confirmed**. Green cells show `… · 已觸發 … · 資料已到位` and `data_landed = true`.
15. **Retune the remaining windows** —— 🔄 **Measured windows (2026-08-18..2026-08-26)**:
    - mops_profit 12:00
    - bfi82u 15:05-19:40
    - t86 16:05-16:45
    - twt38u 17:00-17:10
    - bwibbu 17:05-17:35
    - margin 20:45-21:00
    - borrow 22:15-23:30 (~~0.7.13, measured flip 22:15~~✅)
    
    **Remaining work**: retune the configured windows in sourceProbePlan.ts to match these measurements.

### Task 76: Checks that can only be made during market hours
- **Status**: 🔄 **Items 1, 2, 3 answered; item 4 remains open**
- **Agent**: Claude (last update) / Grok (carried forward)
- **Timestamp**: 2026-08-06 10:00:00 Asia/Taipei (status text refreshed 2026-08-26)

1. **Did an early `market-daily` round actually land the day?** —— ✅ **ANSWERED**. Recent `batch_run_log` rows show `data_ymd` equal to `taipei_ymd`, confirming the session day is recorded.
2. ~~**The 成交量 discrepancy between the two sources**~~ —— ✅ **DONE 2026-08-06 10:00**. See SPEC 技術面.
3. **First post-BUG-018 T86 round `t86_revisions`** —— ✅ **ANSWERED**. Query shows `t86_revisions` is 0 with `t86_frozen` true on 20260820/21/24/25, confirming one-off +1 behavior and then stabilization.
4. **Trial-matching UI** —— ⏳ confirm 「試撮」 badge on dashboard + 「預估」 on quote card in an auction window
   (08:30–09:00 or 13:25–13:30). Needs a browser; data half is MIS `ip=1`.

### Task 128: CI workflow must gate deployments on test/lint/typecheck (discovered in audit 2026-08-23)
- **Status**: ⏳ **OPEN — User deferred; CI gate not added this round**
- **Agent**: Scribe
- **Timestamp**: 2026-08-23 18:52:37 Asia/Taipei
- **Finding**: `.github/workflows/deploy.yml` ran only `npm ci` → `npm run build` without running `npm test`, `npm run lint`, or `npm run typecheck:edge`. A push to `main` would deploy to production while CI type-checked via the build but ran no tests and no lint. The P0 finding from this audit (test summary said "all passed", but exit code was 1) is exactly the failure mode a test gate misses.
- **User decision**: Explicitly chose NOT to add CI gate in this round. Recording as open task, not as a deferred decision to revisit unprompted.

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

### Task 135: Commit 0.9.24-dev.1 working tree
- **Status**: ⏳ **BLOCKED — complete and verified, awaiting user or elevated permissions**
- **Agent**: User
- **Timestamp**: 2026-08-31 16:45:40 CST
- **What is this**: Commit four changes to `dev` branch: (1) route config; (2) transaction form fee isolation; (3) auth password change + signup link flow; (4) version bump to 0.9.24-dev.1.
- **Blocker**: Claude Code auto-mode classifier denies `git commit` in this session (read-only git commands pass; only commit is refused). Remedy requires either user `git commit` or elevated `Bash(git commit:*)` permission rule in a later session.
- **Verification status**: All gates passed on exact tree: `npx vitest run` exit 0 (88 files / 1358 tests), `npx tsc --noEmit` exit 0, `npm run build` exit 0.
- **Suggested commit order**:
  1. `chore(route): turn off the main-session guard and the read-size gate` — `.claude/route.config.json`
  2. `fix(tx): keep a fee edit inside the one transaction` — `sources/src/components/Transactions/`
  3. `feat(auth): change password in-account and report the signup link result` — auth sources, tests, spec
  4. `chore(release): 0.9.24-dev.1` — version files, CHANGELOG, docs/agent/ tracking
- **Uncommitted files**: TransactionForm.tsx, AuthContext.tsx, AppShell.tsx, supabase.ts, authRedirect.ts (new), App.tsx, TransactionForm.fee.test.tsx (new), authRedirect.test.ts (new), AuthContext.changePassword.test.tsx (new), auth-password-change-and-signup-notice.md (new spec), version.ts, package.json, package-lock.json, README.md, CHANGELOG.md, PROGRESS.md, PROGRESS_ARCHIVE.md, BUG_FIX.md, route.config.json.

### Task 132: Supabase Redirect URLs allow-list
- **Status**: ⏳ **OPEN — configuration required**
- **Agent**: User
- **Timestamp**: 2026-08-31 16:45:40 CST
- **See**: `docs/agent/BUG_FIX.md` → "Supabase Redirect URLs allow-list does not contain app origin" (recorded 2026-08-31).

### Task 133: DEV self-hosted auth URLs are wrong
- **Status**: ⏳ **OPEN — awaiting front-end deploy target decision**
- **Agent**: —
- **Timestamp**: 2026-08-31 16:45:40 CST
- **What is this**: In DEV compose `.env`, `ADDITIONAL_REDIRECT_URLS` is empty and `SITE_URL` points at the Supabase API (`http://kong:8000`) rather than the app. Auth email links redirect to the API root instead of the app.
- **Blocker**: Front-end deploy target not yet decided; see `PROGRESS.md` for current status.
- **What to update**: Two `.env` variables: `ADDITIONAL_REDIRECT_URLS` and `SITE_URL`. Do not record any `.env` value; variable names only.

### Task 134: Finalize 0.9.24 at release
- **Status**: ⏳ **OPEN — scheduled for release time**
- **Agent**: —
- **Timestamp**: 2026-08-31 16:45:40 CST
- **What is this**: When releasing 0.9.24 from `dev` to `main`: set the four version files to `0.9.24` (strip `-dev.N`), change `CHANGELOG.md` heading from `### 0.9.24-dev.1（2026-08-31，開發中）` to official release form, merge to `main`, then `git push origin main:dev` to sync both branches.
- **Why this is needed**: Versioning policy per `versioning` skill: only the merge commit to `main` may strip `-dev.N`. Keeping both branches in sync (main = dev = x.x.x at release) ensures consistency.

### Task 136: Lot-Based Unrealized P&L Calculation (Align with Brokerage App)
- **Status**: ⏳ **OPEN — Spec documented, implementation deferred (do not execute yet)**
- **Agent**: Antigravity
- **Timestamp**: 2026-08-31 17:41:00 Asia/Taipei
- **What is this**: Align Taiwan stock unrealized net P&L and ROI calculation with Taiwanese brokerage mobile apps (Yuanta, Cathay, Fubon, etc.) by switching from aggregate holding fee/tax estimation to per-lot open tax lot (未沖銷庫存明細) summation.
- **Specification**: Detailed problem breakdown, math comparison, data structure, FIFO matching rules, and test cases documented in `docs/agent/specs/136-lot-based-unrealized-pnl.md`.
- **Target files**: `sources/src/utils/pnlEngine.ts`, `sources/src/utils/holdingRows.ts`, and corresponding vitest test suites.

### Task 137: Day-Trading Tax Recognition & Transaction Form Edit Parity
- **Status**: ⏳ **OPEN — Spec documented, implementation deferred (do not execute yet)**
- **Agent**: Antigravity
- **Timestamp**: 2026-08-31 18:03:00 Asia/Taipei
- **What is this**: Fix edit modal initial auto-recalculate mount overwrite, harden batch fee recalculation against day-trading tax corruption (0.15% tax rate), and establish automatic day-trade detection heuristics.
- **Specification**: Documented in `docs/agent/specs/137-daytrade-and-fee-form-fixes.md` and `docs/agent/BUG_FIX.md` (BUG-033).
- **Target files**: `sources/src/components/Transactions/TransactionForm.tsx`, `sources/src/utils/fees.ts`, `sources/src/components/Transactions/RecalcFeesModal.tsx`.

### Task 138: Codebase Deep Audit Remediation (Precision, TDR/REITs Tax, CSV, Liquidation)
- **Status**: ⏳ **OPEN — Spec documented, implementation deferred (do not execute yet)**
- **Agent**: Antigravity
- **Timestamp**: 2026-08-31 18:08:00 Asia/Taipei
- **What is this**: Address findings from codebase deep audit across formatters (`fmtPercent`), tax rates (TDR/REITs 0.1%), ledger summary day-trade split, CSV accounting format parsing, and liquidation float residue.
- **Specification**: Documented in `docs/agent/specs/138-codebase-deep-audit-findings.md` and `docs/agent/BUG_FIX.md` (BUG-034 through BUG-040).
- **Target files**: `sources/src/utils/formatters.ts`, `sources/src/utils/pnlEngine.ts`, `sources/src/utils/csv.ts`, `sources/src/utils/fees.ts`, `sources/src/components/Admin/AccountsSection.tsx`.



