# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.21 release recorded (當日大盤面板完善：重新整理按鈕、日期徽章、法人側欄、六項缺陷修復)
- Status: **✅ RECORDED**
- Timestamp: 2026-08-27 11:20:00 Asia/Taipei

---

## 📅 Log: 2026-08-31 09:36:46 Asia/Taipei (Task 130: DEV deploy and manual verification — ALL PASS)

- **Task**: 130 — Auto chip warm for a newly added symbol (chips backfill for up to 7 trading days on first add).
- **Status**: ✅ **DEV VERIFICATION COMPLETE** — Manual testing completed on self-hosted DEV (`korq9tvdz0jd7yblr72p`). Merge to `main` and PROD Edge deploy pending explicit user authorization.
- **DEV Edge Deploy Method**:
  - Forced volume copy of `sources/supabase/functions/stock-report/*.ts` into `/root/container/supabase/stock-pnl-web-dev/volumes/functions/stock-report/`
  - Container restart: `docker restart stock-pnl-web-dev-functions-1`
  - Landing verified: md5 match on `index.ts`, `report.ts`, `twChips.ts` between repo and volume; `grep -c maxUpstreamDays = 3` in deployed copy; container healthy, no module-load errors
- **Manual DEV Verification — ALL 9 PASS**:
  1. Bad ticker `!!bad` with `phase:'chips'` → HTTP 400 `ticker 格式不正確` (unauthenticated). Pre-validation, no data leak. ✅
  2. Valid ticker, anon key only → HTTP 401 Unauthorized. Service-role key also 401 (no real user JWT). ✅
  3. Authenticated user, ticker not in holdings/watchlist → HTTP 403 `僅限持有或已加入觀察清單的台股代號`. Tickers `1802/2609/2356/3037/2615/00981A` correctly excluded (net_qty=0). ✅
  4. Buy-path ordering: `addTransactions()` awaited before `prefetchStockData()` — ownership gate runs on new position. ✅
  5. End-to-end write: added `2454` to watchlist, `phase:'chips'` returned HTTP 200 `{daysWritten:7, daysFetchedUpstream:1, durationMs:1169}`. Seven files written for 20260820–20260828. ✅
  6. Idempotence gate: second identical call returned HTTP 200 `{daysWritten:0, daysFetchedUpstream:0, skipped:'already-present', durationMs:17}`. ✅
  7. Manifest untouched: `manifest.json` `updated_at` stayed 2026-08-28 14:25:01Z (chips path does not write manifest). ✅
  8. Content check: `20260828/2454.json` structurally identical to cron-generated `20260828/2330.json` — schema 3, real institutional numbers. ✅
  9. RISK-003 confirmed: history grows 1,2,3,4,5,6 across six older dates; only newest file (20260828) has full 7-day history and no "回補中" note. Borrow present only on newest (loadBorrow has no date param). ✅
- **RISK-003 Update**: Confirmed by observation on DEV. Marked in BUG_FIX.md as "confirmed, still accepted, still no user-visible impact".
- **DEV State Restored**: Test watchlist row `2454` deleted, all seven test report files deleted via storage API. DEV data back to pre-test state.
- **Pending**: Merge to `main` and PROD Edge deploy (explicit user authorization required). Spec: `docs/agent/specs/130-new-symbol-chip-warm.md`

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

