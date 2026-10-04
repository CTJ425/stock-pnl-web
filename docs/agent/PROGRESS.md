# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.26 released** — weekday-holiday guard (`TW_HOLIDAYS`) + TW market calendar; 國際指數 badges 未開盤 / 已收盤 / 休市.
- Status: ✅ `main` = `dev` (`6fb3cf6`); `stock-price` DEV v27 / PROD v17, both `811480ed6d70…`. Only Task 191 item 5 (check on 2026-10-09) is left.
- Timestamp: 2026-10-04 11:22:25 Asia/Taipei

---
## 📅 Log: 2026-10-04 11:22:25 Asia/Taipei (0.10.26 release — Task 191)
- **Ask**: footnote placement for 總經 (user chose bottom of 國際指數, dev.3); badges 休市 vs 已收盤 for every region (dev.4); 未開盤 before the open (dev.5); then merge to `main` (user OK).
- **Done**: `sessionHours.ts` `SessionState` = preopen / open / break / closed / holiday, `SESSION_LABELS` shared by `GlobalIndices` and `IndexDetail`; holiday = local weekend or `ClosedDates` (TW from `TW_HOLIDAYS`). JP/KR/US have no holiday calendar — their holidays read as trading days.
- **Verified**: vitest 2,869 pass / 7 skipped; build; `typecheck:edge`; lint clean. PROD `stock-price` deployed from clean `6fb3cf6` (Edge code identical to DEV's `373e76f`): v16 → v17, ezbr `b085cd6e…` → `811480ed6d70…` (= DEV). Live PROD call (Sunday): 0050 112.8 / 2603 240 / 2303 161.5 = Friday closes via Yahoo. Release 0.10.26 created by CI, body correct. Pages production bundle carries `stmt-closed`, `台股：`, `未開盤`.
- **Left**: Task 191 item 5 — on 2026-10-09 check `price_cache` for `trade_date = 20261009` rows and the dashboard note.
## 📅 Log: 2026-10-04 10:45:41 Asia/Taipei (Task 191 — TW holiday calendar, 0.10.26-dev.1/dev.2)
- **Ask**: close BUG-110's weekday-holiday gap; show the calendar in admin (/impeccable), then to every user, compact.
- **Done**: `quoteWindow.ts` `TW_HOLIDAYS` (TWSE 2026 list, trading-day markers 01-02/02-11/02-23 excluded) + `TW_HOLIDAY_YEARS`; `twIsWeekend*` → `twIsClosedDay`/`twIsClosedDate` in `stock-price` and `priceProxy.ts`. Shared `components/MarketCalendar/` (lookups, `MonthGrid`, `TwCalendarLine`, `styles/market-calendar.css`). Admin 資料更新 → 開休市日 tab; dashboard quote-time note 「今天/明天休市（名稱）」 linking `#/macro/calendar` (TW holders only); 總經 → 國際指數 台灣 line + disclosure; `MacroPage` closed-day now `twIsClosedDay` (was MA-01's `market/daily.json` guess).
- **Verified**: vitest 2,864 pass / 7 skipped; build; `typecheck:edge`; lint; impeccable detector clean; local harness screenshots 1280/390 light+dark, no overflow. DEV `stock-price` v27 from clean `373e76f`, ezbr `b085cd6e…` → `811480ed6d70…`; live Sunday call returns Friday closes. Dev preview `dev.stock-pnl-web.pages.dev` serves `b24d47d` (content check: `stmt-closed`, `tw-calendar`).
- **Left**: user review on dev preview; release to PROD (merge + PROD `stock-price` deploy); live holiday behaviour only provable on 10-09. `b24d47d` touched no Edge code, so DEV `stock-price` (v27) is current.
