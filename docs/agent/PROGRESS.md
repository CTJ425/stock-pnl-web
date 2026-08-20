# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Version 0.9.7 fingerprint fix recorded (BUG-035); FIXED_BUG.md updated; PROGRESS entries rolled
- Status: **✅ 0.9.7 RECORDED**
- Timestamp: 2026-08-20 20:45:00 Asia/Taipei

---

## 📅 Log: 2026-08-20 20:45:00 Asia/Taipei (Version 0.9.7 foreign top fingerprint — from raw text to hash)

- **Release**: Version 0.9.7 fixes one probe storage efficiency issue (BUG-035), previously flagged as "known but not fixed" in 0.9.6 changelog.
- **Change (BUG-035)**: `twt38u` (foreign top 50) content fingerprint was raw table text joined with U+001F, stored as-is in two places (`source_probe_tick.fingerprint` and `market/foreign_top50.json` idempotency key), totalling ~10KB per row per day × 2 locations. Every other probe source uses the short `<length>:<djb2>` hash form from `pollPlan.ts` `fingerprint()`. Fix: `foreignTopFingerprint()` in `twForeignTop.ts` now returns `fingerprint(cells.join(UNIT_SEP))`, preserving the U+001F collision-detection property from AUDIT-04. This was an inconsistency and storage cost, not a correctness bug.
- **Test change**: Old test asserted the fingerprint string contained U+001F (unobservable once hashed). Replaced with behavioural assertion that `['12','3']` and `['1','23']` produce different fingerprints, plus format assertion that fingerprint matches the short hash form.
- **Expected one-time side effect, already documented in changelog**: On first deploy, `syncForeignTop` sees old raw-format fingerprint in `market/foreign_top50.json`, re-uploads once, then self-heals. `source_probe_tick` compares only within a day's window, unaffected from the next day onward.
- **Files changed**: `twForeignTop.ts` (import + one-line fix), `twForeignTop.test.ts` (test refactored).
- **Verification**: `npx vitest run supabase/functions/stock-report/` → 366 tests passed, 0 failed. `npm test` → 75 files, 1136 tests passed. `npx tsc --noEmit` clean. `npm run typecheck:edge` clean.
- **Deployment status**: DEV Edge **deployed** 2026-08-20 20:45 Asia/Taipei by volume copy plus `docker compose up -d --force-recreate functions`. PROD Edge **deployed** 2026-08-20 21:05 Asia/Taipei — `supabase functions deploy stock-report --project-ref kxnxadaghidwumqsqneu --no-verify-jwt` from a clean `main` @ `9db87d3`, carrying 0.9.6 and 0.9.7 in one bundle. Evidence is the hash, not the version number: `ezbr_sha256` went `420050a1...` -> `f776a7a0...` (version 54 -> 55), and `verify_jwt` is still `false` so the pg_cron calls do not 401. `stock-price` untouched (v18, sha unchanged). A `main` push deploys Pages only and never an Edge Function — the two are separate actions.
- **DEV end-to-end verification of the new retire gate (2026-08-20 20:45-21:00)**: `margin` landed on three consecutive rounds (20:45 / 20:50 / 20:55) with the identical fingerprint `174457:1s4vqtw`, and no `margin` row was written at 21:00 — the trailing run of 3 retired it. The same rows also prove BUG-033 fixed: the fingerprint is a real hash rather than the constant `0:45h`, and `rows` reports 1295 instead of null.
- **Records finalized**: FIXED_BUG.md gained BUG-035 entry (prepended, newest-first). PROGRESS.md header updated; this entry added; oldest entry (2026-08-20 15:07:12) rolled to PROGRESS_ARCHIVE.md. All files match.
- **Unfinished**: None — 0.9.7 recording complete.

---

## 📅 Log: 2026-08-20 17:55:00 Asia/Taipei (Version 0.9.6 probe system fixes — margin fingerprint constant, retire gate rewritten)

- **Release**: Version 0.9.6 fixes two independent probe defects affecting `source_probe_tick` correctness and retirement logic.
- **Change 1 (BUG-033)**: Margin probe fingerprint was always `0:45h` (empty string hash). Root cause: `probeSource` read from `(resp as { data? }).data`, but `MarginDatedResponse` has no `data` field (rows under `tables[]`). Fix: new `marginDatedFingerprint()` in `twChips.ts` using existing `marginTable()` helper. Impact: content-settled gate now functions; `rows` count now accurate.
- **Change 2 (BUG-034)**: Retire gate had two holes: `A → B → B` would retire despite `A → B` proving upstream was revising; `contentSettled` lost all intermediate revisions. Fix: rewrite to trailing-run rule: `counts[id]` = length of identical-fingerprint run (new `trailingRun` in `sourceProbePlan.ts`); `retiredSources` checks `counts[id] >= required[id]`. Any content change resets run to 1.
- **Files changed**: `twChips.ts` (new exported functions), `index.ts` (margin branch rewrite), `sourceProbePlan.ts` (new `trailingRun`), test files (365 tests passed).
- **Version bump**: `sources/src/version.ts`, `sources/package.json`, `sources/package-lock.json`, `README.md` set to 0.9.6.
- **Verification**: `npx vitest run supabase/functions/stock-report/` → 365 tests passed, 0 failed. `npm test` → 75 files, 1135 tests passed. `npx tsc --noEmit` clean. Reviewer (both changes): **PASS**, no findings.
- **Deployment status**: DEV Edge **deployed** 2026-08-20 17:55 Asia/Taipei by volume copy into `volumes/functions/stock-report/` plus `docker compose up -d --force-recreate functions`; `diff -rq` clean. PROD Edge **deployed** 2026-08-20 21:05 Asia/Taipei together with 0.9.7 in one bundle (`ezbr_sha256` `f776a7a0...`); see the 0.9.7 entry above. A `main` push deploys Pages only, never an Edge Function — the two are separate actions.
- **Records finalized**: CHANGELOG.md gained 0.9.6 entry (Traditional Chinese, house style). FIXED_BUG.md gained BUG-033 and BUG-034 entries with full resolution. PROGRESS_ARCHIVE.md gained oldest PROGRESS entry (14:59:05). PROGRESS.md header updated; this entry added; oldest entry moved to archive. All files match.
- **Unfinished**: None — 0.9.6 recording complete.

---

