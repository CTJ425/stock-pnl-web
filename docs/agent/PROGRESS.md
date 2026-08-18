# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.7.23 release recording — ForeignTopSection timestamp stamp
- Status: **✅ RECORDED**
- Timestamp: 2026-08-18 22:12:03 Asia/Taipei

---

## 📅 Log: 2026-08-18 22:12:03 Asia/Taipei (0.7.23 release: ForeignTopSection data update timestamp stamp)

- **Release**: Version 0.7.23 official release to `main` on 2026-08-18, going straight to production.
- **Feature**: 外資買賣超 TOP 50 section (總體經濟 > 台股) now shows data update time in its header, one line added to `ForeignTopSection.tsx`.
- **Design**:
  - Reuses `source-tag section-stamp` convention and `fmtUpdatedAt` helper already used by `TwMarketSection.tsx` and `MacroPage.tsx`, ensuring consistent wording, placement, and time format across sibling sections.
  - No new CSS, no new formatter.
  - Value is `ForeignTopData.asOf`, already exposed by `foreignTopProxy.ts`.
  - Stamp hidden when snapshot is empty (no "資料更新於 —" in empty state).
- **Testing**: 2 new test cases in `ForeignTopSection.test.tsx` (one asserting stamp and `section-stamp` class, one asserting absence in empty state). Stamp test failed before change, passes after. Time format match by pattern, not fixed instant, per `fmtUpdatedAt` viewer-timezone rendering.
- **Verification**: `npx vitest run src/components/Macro/ForeignTopSection.test.tsx` — 6 passed, 0 failed; `npx tsc --noEmit` — 0 errors; `npx oxlint src` — 0 errors.
- **Review**: Not dispatched. Recorded honestly: presentation-only change with passing test (failed before, passes after), touching no money, auth, persistence, API contract, background job, or control flow.

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

