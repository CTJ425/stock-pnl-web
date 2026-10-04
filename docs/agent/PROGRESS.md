# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.25 released** — BUG-110: weekend MIS test-session prices no longer reach 現價.
- Status: ✅ `main` = `dev`; `stock-price` deployed to DEV and PROD (`b085cd6e4186…`).
- Timestamp: 2026-10-04 09:47:39 Asia/Taipei

---
## 📅 Log: 2026-10-04 09:29:09 Asia/Taipei (BUG-110 — weekend MIS test-session prices, 0.10.25-dev.1)
- **Ask**: PROD 現價 on Sunday 10/04 showed most TW tickers near limit-up.
- **Root cause**: MIS served TWSE test-session matches (`d=20261004`, `t=09:0x`, `z` = limit-up `u`); `quoteWindow.ts` treated weekend 08:25–13:30 as a session since 0.6.36 (`dfd5a34`), so `stock-price` fetched MIS and cached them site-wide. No recent commit caused it — the trigger was external.
- **Done**: PROD `price_cache` 13 weekend-dated rows deleted (identity-guarded). `quoteWindow.ts`: weekends never poll, locks run to the next weekday 08:25; `stock-price` skips MIS on Sat/Sun (Yahoo still has Friday's close, checked live) and ignores weekend-dated cache rows; `priceProxy.ts` never treats a weekend-dated quote as fresh or as a stale fallback.
- **Verified**: `npm test` 2,844 pass / 7 skipped; build; `typecheck:edge`; lint. 8 new/changed tests fail on the old code.
- **Released** (user OK): `7a63001` on `main`; `stock-price` DEV v26 / PROD v16, both `b085cd6e4186…`; live PROD call returns Friday closes, weekend cache rows 0; Pages serves 0.10.25; Release body correct.
- **Left**: weekday-holiday test sessions are not covered (needs a calendar); weekend Yahoo fills store `industry = null` (BUG-085 limit). Both in `FIXED_BUG.md` BUG-110.
---
## 📅 Log: 2026-10-02 18:12:59 Asia/Taipei (0.10.24 — fee onboarding marker + rebate open at 不打折)
- **Release**: `2e68462` feature + `0196c97` E2E mock fix; gates green (vitest 2,837 pass / 7 skipped, build, `typecheck:edge`); frontend only — no DDL, no Edge. User authorized the `main` merge in advance.
- **E2E**: `verify-fee-rate-e2e` (after the mock fix), `verify-monthly-rebate-cost-e2e`, `verify-pnl-rounding-e2e` PASS; local-mode journey 1440 / 390 PASS.
- **Left**: Task 190 item 3; `.stmt-pct` overflow at 390px with a 7-digit hero figure (pre-existing).
