# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.21 release recorded (當日大盤面板完善：重新整理按鈕、日期徽章、法人側欄、六項缺陷修復)
- Status: **✅ RECORDED**
- Timestamp: 2026-08-27 11:20:00 Asia/Taipei

---

## 📅 Log: 2026-08-31 16:27:23 Asia/Taipei (Fee fields fix, auth features, signup link confirmation)

- **Status**: ✅ **COMPLETED**
- **Work Summary**: Five improvements: two transaction fee bugs fixed, change password feature added, signup confirmation link issue resolved.
- **1. Transaction form fee fields no longer write to workspace default**:
  - Bug: `手續費率` and `最低手續費` inputs called `setFeeRate` / `setMinFee` from `utils/settings` in their `onChange`, writing edits back to the workspace default.
  - Fix: Both persistence calls removed. Form seeds from workspace default but keeps edits isolated to that transaction.
  - Workspace default remains owned by `AppShell.tsx:425-448` fee dialog, which also offers batch recalculation.
- **2. Regression fixed: manually typed `最低手續費` destroyed on `張`/`零股` switch**:
  - Cause: Re-seeding `useEffect` destroyed the typed value on every unit switch.
  - Fix: Form maintains per-unit `useRef` record; re-seeds from it. `workspaceId` change still clears and re-seeds from workspace default.
- **3. `手續費率` field hint now lists reference rates**: `原價 0.001425`, `6.5 折 0.00092625`, `3 折 0.0004275` — notes value applies to this transaction only.
- **4. Change password feature implemented**:
  - New `changePassword(currentPassword, newPassword)` in `AuthContext`.
  - Re-authenticates with `signInWithPassword` before `updateUser` (prevents passwordless change; wrong current password returns `目前密碼不正確`).
  - UI: `變更密碼` menu item in `AppShell.tsx`, gated by `!isLocal`, opens `ChangePasswordModal`.
  - Modal stays open on success with fields cleared and submit disabled (revised spec: hiding confirmation is worse).
- **5. Signup confirmation link now shows result**:
  - Root cause: `signUp` sets `emailRedirectTo` → Supabase verifies and redirects with `#access_token=...&type=signup`. Client's default options consumed and cleared the hash during async init. No callback route or notice left user seeing nothing while already verified (login worked).
  - Fix: `authRedirect.ts` exports `parseAuthRedirectHash`. `supabase.ts` computes `initialAuthNotice` from `window.location.hash` **before** `createClient`. `App.tsx` renders dismissible banner above `AuthPage` and `AppShell` branches. Expired link leaves user logged out.
  - Open item: Supabase Redirect URLs allow-list does not contain app origin (user action required, see BUG_FIX.md).
- **Files changed**: `TransactionForm.tsx`, `AuthContext.tsx`, `AppShell.tsx`, `supabase.ts`, `authRedirect.ts` (new), `App.tsx`, `.claude/route.config.json`
- **Test files added**: `TransactionForm.fee.test.tsx` (F1-F5), `authRedirect.test.ts` (R1-R5), `AuthContext.changePassword.test.tsx` (C1-C3)
- **Verification** ✅ **ALL PASS**: `npx vitest run` exit 0 (88 files / 1358 tests, up from 85/1345), `npx tsc --noEmit` exit 0, `npm run build` exit 0
- **Review verdicts**: Fee changes PASS with one RISK (Item 2 fixed). Auth changes adjudicated after spec revision (modal stays open instead of closing).

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

---
