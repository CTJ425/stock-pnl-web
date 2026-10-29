# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Release 0.10.41** — Google sign-in.
- Status: ✅ `main` = `dev` = 0.10.41 `9b1eeef`; Pages serving 0.10.41 on PROD; Release 0.10.41 by CI. No Edge / DDL change.
- Timestamp: 2026-10-29 13:41:16 Asia/Taipei

---

## 📅 Log: 2026-10-29 13:41:16 Asia/Taipei (release 0.10.41)
- **Ask**: 「一樣在做最後檢查，也使用 /herdr 讓隔壁session檢查 如果沒問題就直接合併到main」.
- **DEV fix by the user**: Google login on DEV first landed on `localhost` — DEV `site_url` was `http://localhost:5173/` and `uri_allow_list` lacked `https://dev.stock-pnl-web.pages.dev/**` (read via Management API). User added it; Google login on the DEV site then worked (DEV `auth.users`: the account with providers `['google']`).
- **Final review** (session 2, `agy`, read-only): `VERDICT: MERGE OK`; all four fixes verified; one NIT = TASK 201 item 3.
- **Gates**: `npm test` 3,242 / 7 skipped, build, `typecheck:edge`. CI on `main` green, Sync GitHub Releases green.
- **Release**: `9b1eeef release: 0.10.41` (CHANGELOG heading finalized before the push), `main` fast-forwarded from `5834599`, `dev` = `main`. Release 0.10.41 body = the CHANGELOG entry.
- **PROD**: live `index-CLEIkI6h.js` contains 「使用 Google 帳戶」; Playwright click on PROD → `accounts.google.com` with redirect_uri = PROD `/auth/v1/callback`.
- **Not verified**: a completed Google login on PROD (needs the user's account).

## 📅 Log: 2026-10-29 11:50:36 Asia/Taipei (Task 201 Google sign-in, 0.10.41-dev.1)
- **Ask**: 「現在幫我把程式碼的部分都進行調整，且改寫完與驗證完之後 再透過 /herdr 請另一個session做一次code reviwe與資安調查，我只要看到DEV改完之後的結果」. User had already created the Google OAuth client and enabled the provider + Redirect URLs on DEV and PROD.
- **Done**: `AuthContext.signInWithGoogle` (implicit flow kept: email links depend on it), `AuthUser.hasPassword` from `app_metadata.providers`; login/sign-up Google button + 或 divider (Google branding colours per theme); 變更密碼 hidden for Google-only accounts; redirect errors read from query and hash, stripped from the URL before auth-js reads it, stale 保持登入 choice dropped when no session exists; single `AuthRedirectBanner` above both App branches.
- **Review** (session 2 = `agy` in herdr pane `w1:pW`, read-only): 4 RISK + 2 NIT. Fixed: stale URL error / banner remount / leftover choice (1), `hasPassword` after setting a password (2, partial — see TASK 201 item 3), busy stuck on bfcache back + no try/catch (3), Google sign-up inheriting an unchecked remember (NIT 5). Open: PROD Redirect URLs (RISK 4, user), UserMenu test (NIT 6).
- **Verified**: `npm test` 3,242 / 7 skipped; build; oxlint. Playwright against DEV Supabase (local vite): button → `accounts.google.com`, redirect_uri = DEV callback, scope `email profile`; persistence choice written before leaving; `?error=access_denied…` shows the banner once, URL cleaned, choice cleared, no banner after reload; desktop + 390 px light/dark no overflow / page errors.
- **Not verified**: a completed Google login (needs the user's Google account); the deployed `dev.stock-pnl-web.pages.dev` build.
