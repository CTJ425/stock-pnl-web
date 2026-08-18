# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Task 114 + 114b recording — probe retirement on settled content + testable wiring, shipped as 0.7.21
- Status: **✅ RECORDED to PROGRESS.md, PROGRESS_ARCHIVE.md, CHANGELOG.md, TASK.md**
- Timestamp: 2026-08-18 16:06:44 Asia/Taipei

---

## 📅 Log: 2026-08-18 16:06:44 Asia/Taipei (Task 114 + 114b: Probe source retirement on settled content + testable wiring extraction, shipped 0.7.21)

### Task 114 — Probe source retirement condition: content must have stopped changing

- **Problem**: Previous rule retired a source purely on landed-hit count. Count proves "we measured it N times"; it cannot prove "upstream will not revise it again". T86 is the standing counter-example, revised every 15 minutes from 16:00, which is why `nextT86State` exists. Once a source retires nothing re-reads it that day, so a premature retirement silently freezes the day.
- **Solution**: Source now retires only when landed-hit count is reached **and** its content has stopped changing (last two landed ticks carry same non-empty fingerprint).
- **New in `sourceProbePlan.ts`**:
  - `REQUIRE_SETTLED_CONTENT: Record<ProbeSourceId, boolean>` — `true` for six daily sources (`bfi82u`, `t86`, `bwibbu`, `twt38u`, `margin`, `borrow`); `false` for MOPS (exception deliberate: landing judgement already uses period comparison, target is single landing).
  - `contentSettled(fingerprints)` — fewer than two entries, or null/undefined/empty in either of last two, returns `false`. Absent evidence never counts as settled.
  - `retiredSources` gained third `settled` parameter defaulting to `{}`, so daily source does not retire without stability evidence.
- **Measurements (PROD `source_probe_tick`, 2026-08-01 onward)**:
  - Every source writes non-null fingerprint on every hit — no source starved by new rule.
  - Within single day each source shows exactly one distinct fingerprint, so rule costs no extra probe rounds in practice.
  - Simulated against 19 real source-days: retirement timing identical to old rule. Rule has teeth only when upstream revises.

### Task 114b — Extract probe wiring into testable pure function

- **RISK from Reviewer**: wiring inside `readDoneSourcesToday` (grouping landed ticks per source, sorting by time, applying per-active-window filter, deriving `settled`) had no test coverage. Two catastrophic failure modes live there: `settled` stuck always-false makes every daily source probe whole window every day; stuck always-true makes sources retire early and freeze the day.
- **Resolution (RISK closed, not accepted)**: wiring moved into `sourceProbePlan.ts` as `summariseLandedTicks(ticks, slotMinutes) -> { counts, settled }`, covered by 7 new tests including `bfi82u` dual-window case (15:00–16:30 / 19:30–20:15), input-order independence, null `taipei_time`. `readDoneSourcesToday` now only queries and delegates.
- **Verification**: tested against same 19 real source-days: **0 behavioural differences** before and after extraction.
- **Files changed** (both tasks): `sourceProbePlan.ts`, `sourceProbePlan.test.ts` (13 new tests, TDD), `index.ts`.
- **Tests**: `npx vitest run` — 68 files / **1001 tests passed** (was 987). `npx tsc -p tsconfig.edge.json` clean, `npx tsc --noEmit` clean, `npm run build` ok, `npx oxlint src supabase` 0 errors.
- **Reviewer verdict on 114**: **PASS** with one RISK, now closed by 114b.

## 📅 Log: 2026-08-18 15:46:30 Asia/Taipei (BUG-028: BWIBBU endpoint cache poisoning on unpublished state)

- **Issue**: Dated BWIBBU endpoint returns HTTP 200 with no `data` field before ~17:15 Taipei; `readLatest` cached any non-exception, poisoning the day's valuation cache. PROD saw 0 `bwibbu` landings across 6 trading days (2026-08-10 through 2026-08-17); fundamental files stale for 6 days.
- **Root cause**: `readLatest` was not guarding cache write; first `generate-market-data` before 17:15 wrote empty payload, then every later run read it back and skipped all fundamental files for the day.
- **Fix**: `readLatest` gained optional `isValid` predicate; BWIBBU call site passes `bwibbuDatedUsable` (defined in `twFundamental.ts` as mirror of `normaliseBwibbuDated` logic so they cannot drift).
- **Risk accepted**: Weekend / holiday without usable BWIBBU means re-fetches every round (~30 extra TWSE requests) instead of caching once; chosen over a full day of silently stale valuations.
- **Tests**: 987 vitest passed (was 984), 3 new tests in `twFundamental.test.ts`, `tsc -p tsconfig.edge.json` 0 errors, `oxlint` 0 errors. Reviewer **PASS**.
- **Version**: **0.7.20** (official release, no `-dev` suffix).
