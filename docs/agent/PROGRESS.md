# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.26-dev.3 on `dev`** (總經 開休市 now a footnote under 國際指數) — weekday-holiday guard (`TW_HOLIDAYS`) + TW market calendar for admin and users.
- Status: ⏳ awaiting user review on the dev preview; PROD release (main + PROD `stock-price`) not done — target before 2026-10-09.
- Timestamp: 2026-10-04 10:45:41 Asia/Taipei

---
## 📅 Log: 2026-10-04 10:45:41 Asia/Taipei (Task 191 — TW holiday calendar, 0.10.26-dev.1/dev.2)
- **Ask**: close BUG-110's weekday-holiday gap; show the calendar in admin (/impeccable), then to every user, compact.
- **Done**: `quoteWindow.ts` `TW_HOLIDAYS` (TWSE 2026 list, trading-day markers 01-02/02-11/02-23 excluded) + `TW_HOLIDAY_YEARS`; `twIsWeekend*` → `twIsClosedDay`/`twIsClosedDate` in `stock-price` and `priceProxy.ts`. Shared `components/MarketCalendar/` (lookups, `MonthGrid`, `TwCalendarLine`, `styles/market-calendar.css`). Admin 資料更新 → 開休市日 tab; dashboard quote-time note 「今天/明天休市（名稱）」 linking `#/macro/calendar` (TW holders only); 總經 → 國際指數 台灣 line + disclosure; `MacroPage` closed-day now `twIsClosedDay` (was MA-01's `market/daily.json` guess).
- **Verified**: vitest 2,864 pass / 7 skipped; build; `typecheck:edge`; lint; impeccable detector clean; local harness screenshots 1280/390 light+dark, no overflow. DEV `stock-price` v27 from clean `373e76f`, ezbr `b085cd6e…` → `811480ed6d70…`; live Sunday call returns Friday closes. Dev preview `dev.stock-pnl-web.pages.dev` serves `b24d47d` (content check: `stmt-closed`, `tw-calendar`).
- **Left**: user review on dev preview; release to PROD (merge + PROD `stock-price` deploy); live holiday behaviour only provable on 10-09. `b24d47d` touched no Edge code, so DEV `stock-price` (v27) is current.
## 📅 Log: 2026-10-04 09:29:09 Asia/Taipei (BUG-110 — weekend MIS test-session prices, 0.10.25-dev.1)
- **Ask**: PROD 現價 on Sunday 10/04 showed most TW tickers near limit-up.
- **Root cause**: MIS served TWSE test-session matches (`d=20261004`, `t=09:0x`, `z` = limit-up `u`); `quoteWindow.ts` treated weekend 08:25–13:30 as a session since 0.6.36 (`dfd5a34`), so `stock-price` fetched MIS and cached them site-wide. No recent commit caused it — the trigger was external.
- **Done**: PROD `price_cache` 13 weekend-dated rows deleted (identity-guarded). `quoteWindow.ts`: weekends never poll, locks run to the next weekday 08:25; `stock-price` skips MIS on Sat/Sun (Yahoo still has Friday's close, checked live) and ignores weekend-dated cache rows; `priceProxy.ts` never treats a weekend-dated quote as fresh or as a stale fallback.
- **Verified**: `npm test` 2,844 pass / 7 skipped; build; `typecheck:edge`; lint. 8 new/changed tests fail on the old code.
- **Released** (user OK): `7a63001` on `main`; `stock-price` DEV v26 / PROD v16, both `b085cd6e4186…`; live PROD call returns Friday closes, weekend cache rows 0; Pages serves 0.10.25; Release body correct.
- **Left**: weekday-holiday test sessions are not covered (needs a calendar); weekend Yahoo fills store `industry = null` (BUG-085 limit). Both in `FIXED_BUG.md` BUG-110.
---
