# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.21 release recorded (當日大盤面板完善：重新整理按鈕、日期徽章、法人側欄、六項缺陷修復)
- Status: **✅ RECORDED**
- Timestamp: 2026-08-27 11:20:00 Asia/Taipei

---

## 📅 Log: 2026-08-31 15:09:49 Asia/Taipei (Post-release cleanup: GitHub Pages removal, documentation updates)

- **Status**: ✅ **COMPLETED**
- **Work Summary**: Five parallel improvements after 0.9.22 PROD release.
- **1. GitHub Pages removed entirely**:
  - Live Pages site disabled via GitHub API (`DELETE /repos/CTJ425/stock-pnl-web/pages` — now returns 404).
  - Deployment workflow `.github/workflows/deploy.yml` deleted by user (commit `3634dca`).
  - `.github/workflows/release.yml` retained (GitHub Releases, separate from Pages).
- **2. All GitHub Pages references cleaned**:
  - Provider names generalized across repo and archives: 前端部署 / 靜態託管 / front-end deployment / static hosting (no provider name).
  - PROD deploy target currently unconfigured.
  - `sources/src/components/AppShell.tsx` left untouched (its "Pages" means application pages, not GitHub Pages).
- **3. README.md rewritten**:
  - Removed: `GitHub Actions 自動部署`, `環境變數與 Secrets` sections.
  - Added: `初始化與部署` section — 10-step from-scratch runbook: clone → create Supabase project → generate `CRON_SECRET` → apply schema with 18 placeholder substitutions → set secrets → deploy 3 Edge Functions → verify cron → Auth setup → promote admin → build → acceptance checklist → common errors. Both WebUI and CLI paths for each step.
- **4. sources/supabase/README.md corrected**:
  - Function count: 2 → 3 (added `backup-transactions`).
  - `stock-price` source files: 2 → 4.
  - `stock-report` source files: 10 → 17.
  - Removed stale reference to deleted `twNews.ts`.
- **5. Stale README numbers fixed**:
  - Version: 0.9.21 → 0.9.22.
  - Test suite: 66 files / 962 tests → 85 files / 1345 tests.
- **Correction recorded**: Early scout report claimed all three Edge Functions deploy with `--no-verify-jwt`. **Incorrect.** `sources/supabase/functions/stock-price/index.ts:11-12` requires `verify_jwt=true` (deploying with `--no-verify-jwt` would expose the quote endpoint publicly). README documents the correct per-function setting.
- **Verification**: `npm run build` exit 0. `npm test` exit 0 — 85 files / 1345 tests passed.

## 📅 Log: 2026-08-31 10:06:22 Asia/Taipei (Task 130: Release 0.9.22 to PROD — Edge deployed, smoke tests pass)

- **Task**: 130 — Auto chip warm for newly added symbol (chips backfill).
- **Status**: ✅ **PROD RELEASED** — Version 0.9.22, commit ea750a0, all smoke tests pass.
- **Release Gate Results** (all exit 0):
  - `npm test`: 85 files / 1345 tests
  - `npx tsc --noEmit`
  - `npm run typecheck:edge`
  - `npm run build`
- **Merge to main**: `dev` → `main` fast-forward, pushed `b0f0de3..ea750a0`.
- **PROD Edge Deploy**: `supabase functions deploy stock-report --project-ref kxnxadaghidwumqsqneu --no-verify-jwt`
  - `stock-report` version: 61 (up from prior)
  - `ezbr_sha256`: `1e0924a33035722307d3b481682510cd1485c460e07cbfa6769d3635da026b39`
  - `updated_at`: 2026-08-31 10:04:26 +08
  - Note: pre-deploy hash not captured (user auto-mode classifier blocked the command); post-deploy verified by fresh timestamp + version bump.
- **PROD Smoke Tests** ✅ **ALL PASS** (identical results to DEV build):
  1. Bad ticker `!!bad` + `phase:'chips'` → HTTP 400 `ticker 格式不正確` (pre-auth validation, no data leak)
  2. Valid ticker, anon key only → HTTP 401 Unauthorized (service-role also 401; requires real user JWT)
  3. Unknown action → HTTP 400 `Unknown action` (no 500)
- **Interim Risk CLOSED**: Between `main` push and Edge deploy, PROD ran new frontend against old Edge. Old `parseWarmPhase` (b0f0de3:606-610) fell back to `'full'` for unknown phase, so new symbols fired two full warms (no crash, but quota waste). New Edge now deployed. **Lesson recorded**: when a release touches `sources/supabase/functions/`, deploy Edge immediately after `main` push.
- **Risk-003 Status**: Still open and accepted in BUG_FIX.md — do not close.
- **Full Track Record**: DEV code complete (2026-08-30 23:15:34), DEV verified (2026-08-31 09:36:46), PROD released (2026-08-31 10:06:22 Asia/Taipei).

---
