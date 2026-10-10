# Task 194 — show password, keep sign-in 7 days, sector money flow

Requested 2026-10-04. Decisions taken with the user: per-browser 7-day cap (iOS and Windows both used);
sector flow = institutional net buy NT$ by industry + turnover share, web only (Discord later);
DEV Supabase work authorised, PROD not.

## 1. Show password (0.10.30-dev.1, `fba5b8d`)
`PasswordField` (lucide Eye/EyeOff, `aria-pressed`, one toggle per field) in `AuthPage`, `RecoveryPasswordModal`,
`ChangePasswordModal` (6 fields).

## 2. Keep signed in 7 days (0.10.30-dev.1, `fba5b8d`)
`services/authPersistence.ts` is the supabase-js `auth.storage`. Meta key `stock-pnl-web/auth-persist`
(localStorage): a timestamp = remembered until then (session in localStorage), `'session'` = sessionStorage,
absent = default remember and the 7 days start on first read/write (covers sessions that predate this and
email-link sessions). `AuthContext` checks the cap every 60 s and on `visibilitychange` and calls
`signOut({ scope: 'local' })`; `SIGNED_OUT` clears the choice. Whoever reads the session first past the deadline purges it and clears the marker, so `expireRemembered()` also notifies `onRememberExpired` listeners and `AuthContext` signs out from that (BUG-119, 0.10.37-dev.1). The cap is **browser-side only**: the refresh
token stays valid on the server (a server timebox is a Pro-plan setting; not checked on DEV/PROD).
Not remembered = per tab: a new tab asks for the password again.

## 3. Sector money flow (0.10.30-dev.2, `0e86921`)
- Data: T86 (listed, net shares), TPEx `tpex_3insti_daily_trading` (OTC, latest day only), TWSE MI_INDEX
  (price/volume/amount per stock), TPEx `tpex_mainboard_quotes`, industry from `t187ap03_L` /
  `mopsfin_t187ap03_O`, official total from BFI82U.
- Amount = net shares x day VWAP (amount / shares). 2026-10-02 reconciliation: sum over all listed = 103.2 億
  vs BFI82U 104.17 億 (-0.9%); closing price gave 114.7 億 (+10%), so VWAP.
- 半導體 (24) split into IC 設計 / 晶圓製造 / 封裝測試 / 其他 from the TPEx value-chain site, **generated and
  committed** (`scripts/gen-semiconductor-segments.cjs` -> `semiconductorSegments.ts`); no runtime scraping.
  Precedence foundry > osat > design. Children add up to the parent (tested).
- Edge: `twSectorFlow.ts` (pure), `sectorFlowSync.ts` (injected I/O), wired after `syncForeignTop` in the chips
  phase and as action `sync-sector-flow` (gate `cron`, optional `date`). File `market/sector_flow.json`, 20 days,
  top stocks on the newest day only. Industry list cached in `market/industry_map.json` (7 days; a partial list is
  never published). TPEx on another day than the listed data is left out and flagged (`coverage.otc`).
- Web: `SectorFlowSection` mounted in `TwMarketSection` above `ForeignTopSection`; `sectorFlowView.ts` holds the maths.
- No DDL, no new cron job. Edge deploy is the only thing that makes it live.
