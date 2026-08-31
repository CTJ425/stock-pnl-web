# Spec — account password change + signup confirmation notice

Two auth changes that share `AuthContext`. Implement both in one pass.

## Part 1 — change password from inside the account

### Contract

Add `changePassword(currentPassword, newPassword): Promise<string | null>` to `AuthState`.

1. Return `null` on success, an error message string on failure.
2. Re-authenticate first: call `supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })`.
   Supabase lets any live session change the password with no proof of the old one, so this
   step is the whole point of the feature.
3. If re-authentication returns an error, return the literal string `目前密碼不正確` and
   DO NOT call `updateUser`.
4. If re-authentication succeeds, call `supabase.auth.updateUser({ password: newPassword })`
   and return `error.message` on failure, `null` on success.
5. If `supabase` is null (local mode) or there is no `user`, return `null` and do nothing.
6. Do NOT touch the `recovery` flag. `updatePassword` keeps its current behaviour, unchanged.

### UI

- Add a `變更密碼` item to the user menu in `AppShell.tsx` (the menu that already holds 登出,
  around line 378). Show it only when `mode === 'supabase'` — the same `!isLocal` guard 登出 uses.
- Clicking it opens a modal titled `變更密碼` with three password inputs:
  `目前密碼`, `新密碼`, `確認新密碼`. Use `<Modal>` the same way `RecoveryPasswordModal` does.
- Validation, in this order, each shown in a `notice notice-error`:
  1. empty `目前密碼` -> `請輸入目前密碼`
  2. `新密碼` shorter than 6 characters -> `新密碼至少需要 6 個字元`
  3. `新密碼` !== `確認密碼` -> `兩次輸入的密碼不一致`
- On success show `密碼已變更` and close the modal.
- `autoComplete`: `current-password` for the first input, `new-password` for the other two.
- Reuse the existing markup idiom of `RecoveryPasswordModal` (`field`, `notice`, `btn btn-primary`).
  Extracting the shared form is allowed but not required; do not restructure `RecoveryPasswordModal`'s
  own behaviour either way.

## Part 2 — show the result of the signup confirmation link

### Root cause

`signUp` sets `emailRedirectTo` (AuthContext.tsx:84), so Supabase verifies the account and
redirects back with `#access_token=...&type=signup`. The client is created with default options
(`services/supabase.ts:19`), so `detectSessionInUrl: true` and `flowType: 'implicit'` apply:
auth-js consumes that hash during its async init and clears it. The app never shows anything.
The account is already verified, which is why login works.

### Contract

Create `sources/src/services/authRedirect.ts`:

```ts
export type AuthRedirectNotice =
  | { kind: 'signup-confirmed' }
  | { kind: 'error'; message: string }

export function parseAuthRedirectHash(hash: string): AuthRedirectNotice | null
```

- Parse with `URLSearchParams(hash.replace(/^#/, ''))`.
- `error` present -> `{ kind: 'error', message: error_description ?? error_code ?? error }`.
  `URLSearchParams` already decodes `+` and `%xx`; do not decode a second time.
- `access_token` present AND `type === 'signup'` -> `{ kind: 'signup-confirmed' }`.
- Anything else, including `type=recovery` -> `null`.

In `sources/src/services/supabase.ts`, capture the hash **before** `createClient` runs,
because auth-js clears it:

```ts
export const initialAuthNotice: AuthRedirectNotice | null =
  typeof window !== 'undefined' ? parseAuthRedirectHash(window.location.hash) : null
```

Put that statement above the `createClient` call. Nothing else in that file changes.

### UI

In `App.tsx`, render a dismissible banner above both `<AuthPage />` and `<AppShell />` when
`initialAuthNotice` is not null. It must show in both branches, because an expired link leaves
the user logged out.

- `signup-confirmed` -> `notice notice-ok`, text `信箱驗證成功，歡迎使用。`
- `error` -> `notice notice-error`, text `驗證連結無效或已過期：{message}`
- A `關閉` button hides it. Hold the shown/hidden state in `useState`.

## Files

You may touch only these:

- `sources/src/context/AuthContext.tsx`
- `sources/src/components/AppShell.tsx`
- `sources/src/services/supabase.ts`
- `sources/src/services/authRedirect.ts` (new)
- `sources/src/App.tsx`

## Verify

From `sources/`:

```
npx vitest run src/services/authRedirect.test.ts src/context/AuthContext.changePassword.test.tsx
npm run build
npx vitest run
```

The first two commands must exit 0. `npx vitest run` must not regress: the count of failures
must not rise above the failures already present in `src/components/Transactions/`.
Not done until `npx vitest run src/services/authRedirect.test.ts src/context/AuthContext.changePassword.test.tsx` exits 0.

## Non-goals

- Do not edit any `*.test.*` file. The tests are the contract.
- Do not change `signUp`, `signIn`, `resetPassword`, `updatePassword` or `signOut` behaviour.
- Do not switch the client to `flowType: 'pkce'`.
- Do not add a router or a `/auth/callback` route.
- Do not touch anything under `src/components/Transactions/` — another task owns those files.

## Revision — 2026-08-31, accepted deviation

The `## UI` contract for Part 1 said "On success show `密碼已變更` and close the modal".
Reviewer raised the open modal as a BLOCKER against that wording. The main session
adjudicated the other way and changed the spec, not the code:

- Closing the modal hides the confirmation the user was told to look for.
- `ChangePasswordModal` now keeps the modal open, clears the three fields, and disables the
  submit button while `done` is true. Without that lock a second submit fails with
  `目前密碼不正確`, because the password it would re-authenticate against has already changed.
- The user dismisses the modal with its own close control, as with every other modal.

Every other reviewer check passed: re-authentication cannot be skipped, a failed re-auth
leaves the session intact (`auth-js` returns before `_saveSession` / `_notifyAllSubscribers`),
`recovery` is untouched, and `initialAuthNotice` is computed before `createClient`.
