# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: **Release 0.10.42** — Frontend modernization (`modern-web-guidance`): theme FOUC prevention, modal `inert` + scroll containment, `HeaderMenu` arrow-key navigation, form autofill/a11y hints, and ES2023 array/error APIs.
- Status: ✅ `main` = `dev` = 0.10.42; no Edge / DDL change.
- Timestamp: 2026-11-17 12:55:00 Asia/Taipei

---

## 📅 Log: 2026-11-17 12:55:00 Asia/Taipei (release 0.10.42, modern-web-guidance frontend review & modernization)
- **Ask**: 「請使用 modern-web-guidance 幫我review此專案的HTML或是前端等相關功能有沒有可以改善的部分?」 → 「都依照你的建議進行調整，且自己進行過smoke、E2E驗證後沒問題，就直接幫我commit & push 到 main」.
- **Done**:
  - **Dark/Light theme & FOUC** (`dark-mode`, `dark-mode-toggle`): `<meta name="color-scheme" content="light dark" />` + inline synchronous theme bootstrap script in `sources/index.html`; `color-scheme` CSS rules on `:root` (`tokens.css`); `@supports not (scrollbar-color: auto)` guard around legacy `::-webkit-scrollbar` (`chrome.css`); cross-tab `storage` event listener in `UserMenu.tsx`; `applyTheme` sets `light dark` when `pref === 'system'`.
  - **Typography & Layout** (`visually-stable-font-fallbacks`, `accessibility`): `font-size-adjust: from-font` on `body`; `clip-path: inset(50%)` on `.sr-only`; `.skip-link` in `AppShell.tsx` targeting `<h1 id="main-content" tabIndex={-1}>` without mutating `window.location.hash`; `.stmt-pct { display: inline-block }` in `dashboard.css` preventing 390px horizontal overflow when `.stmt-fig-hero` wraps.
  - **Modal & Menu** (`dialog`, `prevent-page-scroll-under-modal-dialog`, `menu`): `Modal.tsx` sets `inert` on `#root` while open, checks `e.defaultPrevented` on `Escape`, and `.modal-overlay` sets `overscroll-behavior: contain`; `HeaderMenu.tsx` implements `ArrowDown`/`ArrowUp`/`Home`/`End` keyboard navigation across `[role^="menuitem"]` items and stops `Escape` propagation; `.hmenu-sep` adds `role="separator"`.
  - **Forms & Search** (`forms`, `autofill-sign-in-form`, `autofill-sign-up-form`): `AuthPage.tsx` and `PasswordField.tsx` add `name`, `spellCheck={false}`, `autoCapitalize="none"`, `autoCorrect="off"`, `aria-describedby` links, and explicit `type="button"` on mode switchers; `TransactionForm.tsx` adds `role="listbox"` / `role="option"` on suggestion dropdowns and `aria-describedby` on fee/tax hints; search wrappers in `TransactionsPage.tsx`, `YearlyPage.tsx`, and `AddWatchModal.tsx` add `role="search"` and disable spellcheck/autocorrect.
  - **ES2023 JS APIs** (`js/copying-array-methods`, `js/error-cause`): replaced shallow-copy `.sort()` / `.reverse()` / `.reverse().find()` with `.toSorted()`, `.toReversed()`, and `.findLast()` across 9 frontend components + `sync-github-releases.cjs` (keeping `timeline.ts` `MapIterator` spread), and added `{ cause: err }` to `appLog.ts` and `reportsBucket.ts`.
- **Verified**: `npm test` 3,246 passed / 7 skipped (including new tests in `Modal.test.tsx` and `AppShell.a11y.test.tsx`), `npm run build`, `npm run typecheck:edge`, `legacy-scan`, and Playwright Chromium E2E across `AuthPage` and native mode at 1280px and 390px (light/dark, zero console/page errors, zero overflow).

## 📅 Log: 2026-10-29 13:41:16 Asia/Taipei (release 0.10.41)
- **Ask**: 「一樣在做最後檢查，也使用 /herdr 讓隔壁session檢查 如果沒問題就直接合併到main」.
- **DEV fix by the user**: Google login on DEV first landed on `localhost` — DEV `site_url` was `http://localhost:5173/` and `uri_allow_list` lacked `https://dev.stock-pnl-web.pages.dev/**` (read via Management API). User added it; Google login on the DEV site then worked (DEV `auth.users`: the account with providers `['google']`).
- **Final review** (session 2, `agy`, read-only): `VERDICT: MERGE OK`; all four fixes verified; one NIT = TASK 201 item 3.
- **Gates**: `npm test` 3,242 / 7 skipped, build, `typecheck:edge`. CI on `main` green, Sync GitHub Releases green.
- **Release**: `9b1eeef release: 0.10.41` (CHANGELOG heading finalized before the push), `main` fast-forwarded from `5834599`, `dev` = `main`. Release 0.10.41 body = the CHANGELOG entry.
- **PROD**: live `index-CLEIkI6h.js` contains 「使用 Google 帳戶」; Playwright click on PROD → `accounts.google.com` with redirect_uri = PROD `/auth/v1/callback`.
- **Not verified**: a completed Google login on PROD (needs the user's account).
