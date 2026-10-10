# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.37 released** — BUG-119: a visible tab that crosses the 保持登入 7 天 cap now signs itself out.
- Status: ✅ `main` = `dev` = `1ed1835` (`84b3866` dev.1, `1ed1835` release); Release 0.10.37 by CI, body checked; Cloudflare Pages serves 0.10.37. Frontend only — no Edge or DDL to apply on PROD.
- Timestamp: 2026-10-10 16:03:36 Asia/Taipei

---

## 📅 Log: 2026-10-10 00:03:40 Asia/Taipei (BUG-119 fix, 0.10.37-dev.1)
- **Ask**: 「幫我修 BUG-119」.
- **Done**: `onRememberExpired()` in `authPersistence.ts`, called (deferred) from `expireRemembered()`; `AuthContext` signs out locally on it. New real-client test `AuthContext.expiry.test.tsx` E1 (failed before the fix, passes after) and `authPersistence.test.ts` P10/P11. Version 0.10.37-dev.1 in `package.json` (+lock), `version.ts`, README; CHANGELOG entry in zh-TW; BUG-119 moved to `FIXED_BUG.md`; spec 194 item 2 updated.
- **Verified**: Playwright re-run (faked Supabase HTTP, cap 20 s ahead): login page at t+50 s, was still signed-in UI at t+150 s before; the other three scenarios unchanged. `npm test` 3,094 pass / 7 skipped, `npm run build`, `typecheck:edge`, oxlint exit 0.
- **Gates (ship)**: first `npm test` run had 1 failure in `SectorFlowPage.test.tsx` (「opens a link to a sector with no tile…」) that passed 3× alone and on a full rerun (3,094 pass) — flaky under full-suite load, not investigated; build, `typecheck:edge` pass.
- **Released**: user asked 「先幫我commit跟push到main」. `release: 0.10.37` fast-forwarded to `main`; `gh release view 0.10.37` body = CHANGELOG section; production `appLog-*.js` carries `0.10.37`.
- **Not done**: Task 194 item 5 on iOS Safari and Windows.
## 📅 Log: 2026-10-09 23:50:00 Asia/Taipei (Task 194 item 5 — does 保持登入 7 天 work?)
- **Ask**: 「確認一下保持登入七天這個功能到底有沒有正常」.
- **Found**: unit tests (18) pass but mock the whole Supabase client. Playwright against the real bundle + supabase-js 2.117.1 with the Supabase HTTP faked (no credentials; script was in the scratchpad, not kept): remember=true → token in localStorage, meta = now + 7.000 days, survives a new browser context, login page after the meta passes + reload; remember=false → sessionStorage only, new tab asks to sign in. **BUG-119**: a visible tab that crosses the cap keeps showing the signed-in UI — auth-js's 30 s refresh tick reads storage first, `expireRemembered()` clears the meta key, so the 60 s check in `AuthContext.tsx:109` never fires. Reload fixes it.
- **Done**: recorded BUG-119 and the Task 194 item 5 result; no code changed.
- **Not verified**: real login on iOS Safari / Windows (item 5); what requests a stale tab sends (expected anon key); tab-restore features (Chrome 「繼續瀏覽上次開啟的網頁」, iOS Safari) keep sessionStorage, so an unchecked login can survive a close and reopen.
