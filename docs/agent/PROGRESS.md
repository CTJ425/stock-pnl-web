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
- **Deployment status**: DEV Edge **deployed** 2026-08-20 20:45 Asia/Taipei by volume copy into `volumes/functions/stock-report/` plus `docker compose up -d --force-recreate functions`. PROD Edge **not deployed and not authorized** — Supabase CLI access token expired (HTTP 401 on `functions list`). Record that both 0.9.6 and 0.9.7 remain undeployed on PROD Edge. A `main` push deploys Pages only, never an Edge Function.
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
- **Deployment status**: DEV Edge **deployed** 2026-08-20 17:55 Asia/Taipei by volume copy into `volumes/functions/stock-report/` plus `docker compose up -d --force-recreate functions`; `diff -rq` clean. PROD Edge **not deployed and not authorized**. A `main` push deploys Pages only, never an Edge Function, so this fix is not live in PROD until `supabase functions deploy stock-report` is run with explicit approval.
- **Records finalized**: CHANGELOG.md gained 0.9.6 entry (Traditional Chinese, house style). FIXED_BUG.md gained BUG-033 and BUG-034 entries with full resolution. PROGRESS_ARCHIVE.md gained oldest PROGRESS entry (14:59:05). PROGRESS.md header updated; this entry added; oldest entry moved to archive. All files match.
- **Unfinished**: None — 0.9.6 recording complete.

---

## 📅 Log: 2026-08-20 15:07:12 CST (0.9.5 official release — 損益試算成本基數精確度修正：舍入、費用、透明標籤)

- **Release**: Version 0.9.5 shipped to `main` branch; GitHub Pages deployment automatically triggered by `main` push; official GitHub Release created by `.github/workflows/release.yml`.
- **Scope**: Official release consolidating precision fixes for P&L simulator cost basis, confirmed via extended E2E verification (75 files / 1127 tests pass, E2E scripts cross-check).
- **What shipped**: (1) 買進價 rounding precision: 104.225's binary trap fixed with `roundPrice()` helper using `Math.round((value + Number.EPSILON) * 100) / 100`, used by both seed and ladder pricing. (2) 買進費用 no longer recalculated from workspace config: `whatIf()` gains optional `buyFee` override, WhatIfTab supplies real fee, achieving exact parity with 庫存總覽 (−3,298 on reference position). (3) 帳單標籤 transparency: buy side shows 成交均價（未含費）& 實付手續費; sell side shows 現價; sources stated in hints.
- **E2E coverage added**: Two new test artefacts closed gaps in prior dev.1 (75 files, 1127 tests vs 74/1125): (1) `sources/src/components/StockDetail/AnalysisPage.whatif.test.tsx` (jsdom) — real prop chain holding → StockDetailPage → WhatIfTab against reference position; (2) `sources/scripts/verify-whatif-e2e.cjs` (Playwright) — cross-checks sell price = quote case, credentials from env vars only.
- **Testing verified**: `npx vitest run` → 75 files / **1127 tests** all pass; `npx tsc --noEmit` 0 errors; `npx oxlint src` 0 errors; `npm run build` ok. E2E `verify-whatif-e2e.cjs` against DEV → **PASS**; `verify-watchlist-e2e.cjs` → **10/10 PASS** (no regression).
- **Durable finding**: CSV import is **append, not replace**, with **no duplicate detection** (`sources/src/services/dataProvider.ts:116` / `:204`). Re-importing the same export file to the same workspace creates new transaction entries for every row. This is not a bug — it is correct behaviour for an append operation — but users may misinterpret duplicate line items as account discrepancies. Present user's concern has been resolved; no code changes made to this behaviour.
- **Records finalized**: CHANGELOG.md retitled 0.9.5-dev.1 → 0.9.5, updated test counts (75/1127), added two new test artefact bullets. TASK.md moved Task 124 to TASK_ARCHIVE.md (marked ✅). PROGRESS.md header updated; this entry added; oldest entry (2026-08-20 14:41:35) rolled to archive. All files match (grep verified).
- **Unfinished**: None — 0.9.5 complete and live.

