# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Task 135 recorded (Workspace fee rate persistence / Supabase)
- Status: **✅ RECORDED**
- Timestamp: 2026-08-31 18:35:00 Asia/Taipei

---

## 📅 Log: 2026-08-31 18:35:00 Asia/Taipei (Workspace fee rate persistence to Supabase)

- **Status**: ✅ **COMPLETED (DEV verified, PROD pending schema)**
- **Task**: Task 135 — `Workspace fee rate persistence (Supabase)`
- **Routing**: Lane 2 (schema + Edge) — scout mapped spec + failing tests → builder (2 rounds) → reviewer (2× PASS) → adjudicate
- **Work Summary**: Moved persistent fee rate storage from `localStorage` to `workspaces.fee_rate` column, implementing sync logic for cache/remote reconciliation.
- **Key Changes**:
  - New `utils/feeSync.ts`: pure function `planFeeSync()` with three-way reconciliation (adopt-remote, push-local, default fallback).
  - `WorkspaceContext.tsx`: calls `syncWorkspaceFees()` before `setWorkspaces()` renders, ensuring first view has synced values.
  - `SupabaseProvider.listWorkspaces()`: queries with `fee_rate` column, retries with legacy column list if schema not deployed yet (fail-safe for staggered rollout).
  - No signature changes; six callsites of `getFeeRate()` require zero edits.
- **Schema (DEV)**: Applied and verified — `workspaces.fee_rate NUMERIC` + range check, PostgREST confirms HTTP 200 with `fee_rate` in response.
- **Schema (PROD)**: Pending — blocked by no access token. Recorded as BUG-041, requires manual execution (three ALTER statements + schema reload).
- **Tests**: 19 new across 3 files (`utils/feeSync.test.ts`, `services/feeSettings.test.ts`, `services/dataProvider.workspaces.test.ts`). Full suite: 91 files / 1377 tests, exit 0; `tsc --noEmit` and `npm run build` both exit 0.
- **Risks Accepted** (BUG-042, BUG-043): Silent fallback error swallowing, pattern-matching existing `LocalProvider` style.
- **Edge Deployment**: Not needed — no Edge Function changes.
- **Files Changed**: 5 source + 3 test, plus CHANGELOG.md, TASK.md, BUG_FIX.md recorded.

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

---
