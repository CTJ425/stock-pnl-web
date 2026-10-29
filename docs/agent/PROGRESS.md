# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Task 201 Google sign-in** — 0.10.41-dev.1 pushed to `dev` (DEV only).
- Status: 🔄 `main` = 0.10.40; `dev` = 0.10.41-dev.1; no Supabase / Edge change (provider and Redirect URLs set by the user).
- Timestamp: 2026-10-29 11:50:36 Asia/Taipei

---

## 📅 Log: 2026-10-29 11:50:36 Asia/Taipei (Task 201 Google sign-in, 0.10.41-dev.1)
- **Ask**: 「現在幫我把程式碼的部分都進行調整，且改寫完與驗證完之後 再透過 /herdr 請另一個session做一次code reviwe與資安調查，我只要看到DEV改完之後的結果」. User had already created the Google OAuth client and enabled the provider + Redirect URLs on DEV and PROD.
- **Done**: `AuthContext.signInWithGoogle` (implicit flow kept: email links depend on it), `AuthUser.hasPassword` from `app_metadata.providers`; login/sign-up Google button + 或 divider (Google branding colours per theme); 變更密碼 hidden for Google-only accounts; redirect errors read from query and hash, stripped from the URL before auth-js reads it, stale 保持登入 choice dropped when no session exists; single `AuthRedirectBanner` above both App branches.
- **Review** (session 2 = `agy` in herdr pane `w1:pW`, read-only): 4 RISK + 2 NIT. Fixed: stale URL error / banner remount / leftover choice (1), `hasPassword` after setting a password (2, partial — see TASK 201 item 3), busy stuck on bfcache back + no try/catch (3), Google sign-up inheriting an unchecked remember (NIT 5). Open: PROD Redirect URLs (RISK 4, user), UserMenu test (NIT 6).
- **Verified**: `npm test` 3,242 / 7 skipped; build; oxlint. Playwright against DEV Supabase (local vite): button → `accounts.google.com`, redirect_uri = DEV callback, scope `email profile`; persistence choice written before leaving; `?error=access_denied…` shows the banner once, URL cleaned, choice cleared, no banner after reload; desktop + 390 px light/dark no overflow / page errors.
- **Not verified**: a completed Google login (needs the user's Google account); the deployed `dev.stock-pnl-web.pages.dev` build.

## 📅 Log: 2026-10-14 11:42:09 Asia/Taipei (release 0.10.40)
- **Ask**: 「幫我直接合併到main去，合併前一樣再確認有無異狀」 (PROD Supabase authorized earlier, after DEV verification).
- **Pre-merge checks**: `npm test` 3,226 / 7 skipped, build, `typecheck:edge`, oxlint. CI for the `dev` head `b28e8ae` had been **cancelled** (the PR-merge run superseded the push run; the PR run on the same commit passed) → re-ran it: success. DEV redeploy from the clean tree kept hash `83c63180826c…` (DEV = `dev`). DEV `app_log` last 6 h: only the 3 warnings from before the release-2 fixes, no errors. DEV live sync: HTTP 200, all five unchanged.
- **Release**: CHANGELOG corrected before the push (two dev bullets were out of date: 「目前串接元大與中國信託」 and 「不持有股票的 ETF…先略過」 — contradicted by the futures view); `5834599 release: 0.10.40`, `main` fast-forwarded from `346c17b`, `dev` = `main`. CI + Sync GitHub Releases green; Release 0.10.40 body is the final entry.
- **PROD Edge**: only `stock-report` (plus `_shared/etfIssuer.ts`, `etfShape.ts`, used by it alone) changed; deployed from the clean tree: v8, `83c63180826c…`, identical to DEV; `verify_jwt=false`. First PROD sync: 0050 unchanged, 00919 / 0056 / 00685L written, **009828 skippedForBudget** (last in order, CTBC worst case 21 s); second run wrote it (3.2 s). PROD files: 009828 30 stocks, 0056 50, 00919 40, 00685L futures-only. Follow-up: TASK 200 item 5.
- **Pages**: live `AnalysisPage-a2GYBz_Y.js` contains 「期貨曝險」 and 「市場分布」.
- **Not verified**: the first scheduled 18:00 run on PROD; the tab logged in.
