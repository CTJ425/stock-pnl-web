# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: BUG-028 fix recording — BWIBBU empty-payload cache poisoning, shipped as 0.7.20
- Status: **✅ RECORDED to FIXED_BUG.md, PROGRESS.md updated, CHANGELOG.md v0.7.20 added**
- Timestamp: 2026-08-18 15:46:30 Asia/Taipei

---

## 📅 Log: 2026-08-18 15:46:30 Asia/Taipei (BUG-028: BWIBBU endpoint cache poisoning on unpublished state)

- **Issue**: Dated BWIBBU endpoint returns HTTP 200 with no `data` field before ~17:15 Taipei; `readLatest` cached any non-exception, poisoning the day's valuation cache. PROD saw 0 `bwibbu` landings across 6 trading days (2026-08-10 through 2026-08-17); fundamental files stale for 6 days.
- **Root cause**: `readLatest` was not guarding cache write; first `generate-market-data` before 17:15 wrote empty payload, then every later run read it back and skipped all fundamental files for the day.
- **Fix**: `readLatest` gained optional `isValid` predicate; BWIBBU call site passes `bwibbuDatedUsable` (defined in `twFundamental.ts` as mirror of `normaliseBwibbuDated` logic so they cannot drift).
- **Risk accepted**: Weekend / holiday without usable BWIBBU means re-fetches every round (~30 extra TWSE requests) instead of caching once; chosen over a full day of silently stale valuations.
- **Tests**: 987 vitest passed (was 984), 3 new tests in `twFundamental.test.ts`, `tsc -p tsconfig.edge.json` 0 errors, `oxlint` 0 errors. Reviewer **PASS**.
- **Version**: **0.7.20** (official release, no `-dev` suffix).

## 📅 Log: 2026-08-18 11:45:16 Asia/Taipei (Task 113: TWSE TWT38U Foreign Investors Top 50 Net Buy/Sell implementation & verification)

1. **Edge Function & Top 50 Snapshot Publisher (`twForeignTop.ts`)**:
   - Parser for TWSE TWT38U (外資及陸資買賣超彙總表) endpoint; `FOREIGN_TOP_SCHEMA` validates structure and fingerprint gates duplicate fetches.
   - `syncForeignTop` action called from `runGeneratePhaseChips` (existing generate-chips phase, no new action or cron).
   - Publishes Top 50 net-buy and net-sell snapshot to `market/foreign_top50.json` in the `reports` bucket.
2. **Frontend: `ForeignTopSection` + Proxy Service**:
   - New component `ForeignTopSection.tsx` mounted in `TwMarketSection` under **總體經濟 > 台股**.
   - Proxy service `foreignTopProxy.ts` with boundary stub in tests (`TwMarketSection.test.tsx`).
   - Tables: Buy/Sell tabs, lots/shares toggle, block trade indicator.
3. **Testing & Verification**:
   - 68 test files / 980 vitest tests passed (was 66 / 963); 12 new Edge tests (`twForeignTop.test.ts`), 4 new Frontend tests (`ForeignTopSection.test.tsx`).
   - Build (`tsc -b && vite build`) and Edge typecheck (`tsc -p tsconfig.edge.json`) 0 errors.
   - `oxlint` 0 errors.
   - Live-data verified 6 trading days (20251114–20260817): matched independent reference implementation on all 600 ranked rows.
   - Reviewer verdict: **PASS**; one risk (unmocked proxy boundary) resolved by test stub.
4. **Design notes**:
   - TWT38U 146 KB chosen over T86 despite equivalent data: `T86` with `selectType=ALLBUT0999` broke top-50 ranking on 4 of 16 days (warrants broke into top 50), while TWT38U is both the exact source and cheaper than T86 (194 KB). `generate-chips` retriggers (t86/margin/borrow overlap 16:00–17:30), so no hole from probe retirement.
   - Parser sorts locally, does not rely on TWSE row order (PROPOSED draft's §2.3 claim verified but deliberately not relied on).
   - Probe suite stays at 7 sources (no dedicated `twt38u` source, no new cron, no Admin ProbeWarRoom card).

