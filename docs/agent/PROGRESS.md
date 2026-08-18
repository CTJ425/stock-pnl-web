# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: BUG-029 recording — TWT38U probing dispatch path gaps, fixed in 0.7.22-dev.1
- Status: **✅ RECORDED to FIXED_BUG.md, CHANGELOG.md, TASK.md, PROGRESS.md**
- Timestamp: 2026-08-18 21:20:00 Asia/Taipei

---

## 📅 Log: 2026-08-18 21:20:00 Asia/Taipei (BUG-029: TWT38U probing never ran — dispatch path gaps in source list and probe handler)

### Background & Discovery

Task 113b (0.7.19) introduced TWT38U as the 8th probe source with window 17:00–18:00, 3-landing target. It recorded `⚠️ Reviewer: NOT RUN` honestly due to dispatch-path complexity and lack of review. Verification came late: probing never executed a single time on PROD or DEV. Root-cause analysis found two independent gaps:

1. **Gap 1 — Source list omission**: `sourceProbePlan.ts` function `sourcesForTaipeiTime()` iterated a hardcoded tuple `['bfi82u','t86','bwibbu','margin','borrow']` that omitted `'twt38u'`. Despite `DAILY_WINDOWS.twt38u` being defined, landing target set, fingerprint rule wired, and `sourceLanded('twt38u')` implemented, the scheduler never emitted it because derivation started from a second literal list.

2. **Gap 2 — Missing probe handler**: `probeSource()` in `index.ts` had no `if (id === 'twt38u')` branch. Every 5-minute tick would fall through to `fail('unknown source')`, never hit, never retire, re-probing the entire 17:00–18:00 window forever.

### Why Test Suite Stayed Green

- `sourceProbePlan.test.ts` assertions at 17:00 and 18:00 locked the five-source output as correct.
- `index.ts` is Deno-only, so no vitest test executes `probeSource()`, leaving Gap 2 undetected.
- Integrated test on real schedule would catch it, but none existed before fix.

### Fix

1. `sourceProbePlan.ts` — `sourcesForTaipeiTime()` now derives from `Object.keys(DAILY_WINDOWS)` instead of hardcoded tuple, so adding a source to the windows table can no longer skip it silently.
2. `index.ts` — new `if (id === 'twt38u')` branch: `fetchRwdJson(twt38uUrl(todayYmd))` with null guard, `parseForeignTop`, `hit = parsed !== null && parsed.rawDate === todayYmd`, `fingerprint` via `foreignTopFingerprint`, `rows = buyTop.length + sellTop.length`.
3. `sourceProbePlan.test.ts` — window assertions updated to expect `twt38u`, plus new tests for 17:00–18:00 boundary and weekend case.

### Verification

- `npx vitest run supabase/functions/stock-report/` — 15 files, 352 tests passed, 0 failed. The 2 new assertions failed before fix, pass after.
- `npm run typecheck:edge` — no errors.
- `npx oxlint supabase/functions/stock-report/` — clean.
- Reviewer: FAIL round 1 (found Gap 2), PASS round 2 after fix.

### Accepted Risk

`probeRound.ts:95–98` has no per-source deadline/budget check (only follow-up loop does). At 17:00 three windows now overlap (`t86` ends 17:00 inclusive, `bwibbu` and `twt38u` start at 17:00); at 17:15/17:20 four sources are scheduled. Each fetch carries 10s timeout, worst case moves closer to 60s Edge Function limit. Accepted deliberately, not fixed.

### NOT Done — Must Be Stated Plainly

Fix is **code-only and uncommitted**. PROD is still running the old bundle, so TWT38U still will not probe there until the Edge Function is redeployed. Deployment was not performed (project rule: no deploy without explicit user instruction).

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
