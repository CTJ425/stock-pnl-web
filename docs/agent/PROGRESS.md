# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.21 release recorded (當日大盤面板完善：重新整理按鈕、日期徽章、法人側欄、六項缺陷修復)
- Status: **✅ RECORDED**
- Timestamp: 2026-08-27 11:20:00 Asia/Taipei

---

## 📅 Log: 2026-08-30 23:15:34 Asia/Taipei (Task 130: Auto chip warm for newly added symbol — Code complete)

- **Task**: 130 — Auto chip warm for a newly added symbol (chips backfill for up to 7 trading days on first add).
- **Status**: ✅ **CODE COMPLETE** — Not yet deployed to DEV, not yet committed to git.
- **Implementation**: New `phase: 'chips'` on `stock-report` warm action. Reuses `chip_raw_cache` (whole-market TWSE payload) unfiltered, so a warm cache means ZERO upstream calls. New `maxUpstreamDays` option on `loadSeries` caps user-triggered path at 2 upstream fetches. Idempotence gate skips work when `reports/{ymd}/{ticker}.json` already exists. Chips path does not write `manifest.json`.
- **Files Changed**: 
  - `warmStock.ts` (new `warmStockChips`)
  - `prefetchStockData.ts`
  - `watchlistService.ts` (`addWatch` triggers prefetch)
  - `stock-report/index.ts`
  - Three matching `.test.ts` files (10 new tests)
- **Testing**: 85 files / 1345 tests passed, exit 0; `npm run lint` exit 0; `npm run typecheck:edge` exit 0.
- **Reviewer Verdict**: PASS with one accepted RISK.
- **RISK to Record**: Historical chip report files keep a permanent "回補中" note (low-severity, accepted). See BUG_FIX.md.
- **Pending**: DEV deployment, manual DEV verification (add symbol, check reports/{ymd}/{ticker}.json, confirm skip on re-add, nightly generate-chips unchanged). See spec § Coverage gap.
- **Spec**: `docs/agent/specs/130-new-symbol-chip-warm.md`

---

## 📅 Log: 2026-08-27 14:10:56 Asia/Taipei (Probe retire-gate re-verified on DEV and PROD — no regression)

- **Question Raised**: Does a probe still retire too early after it finds new data? Expected rule: 1 landed hit plus 2 more ticks with an unchanged fingerprint (trailing run of 3); any content change resets the run to 1.

- **Verdict**: The rule is correct in code and in live data. No code change made.

- **Code Location**: `sources/supabase/functions/stock-report/sourceProbePlan.ts` — REQUIRED_LANDED_COUNTS (L59-68), trailingRun (L77-87), retiredSources (L95-104), summariseLandedTicks (L182-195). Non-landed ticks contribute no fingerprint, so they cannot retire a source.

- **Prior Fixes Confirmed**: BUG-034 (0.9.6, 2026-08-20) and Task 133 (0.9.14, 2026-08-25) still in place.

- **Live Evidence (2026-08-26)**:
  - **Decisive Case**: `borrow` shows 21 consecutive ticks with identical fingerprint (hit=false) that did NOT retire; content changed at 22:40 (PROD) / 22:45 (DEV), then exactly 2 more ticks ran and source stopped.
  - **PROD Per-Source Counts** (ticks/hits): t86 5/3, bwibbu 5/3, twt38u 3/3, margin 6/3, borrow 23/3, bfi82u 7/6 (two windows). DEV matches.
  - **Background**: mops_revenue and mops_profit never retire by design.

- **Open Observation (not a confirmed defect)**: bfi82u hit 6 times across its 15:00 and 19:30 windows with the same fingerprint. Commit 911c490 added the second window deliberately. Flagged for a later decision; not filed as a bug.

- **Verification Method**: DEV via `docker exec stock-pnl-web-dev-db-1 psql`; PROD via Supabase Management API query endpoint. Do not use `supabase db query --linked`.