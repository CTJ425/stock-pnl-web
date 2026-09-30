# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 176 區間收益 — pick any date window on 年度收益 and see which stocks realized money in it (0.10.7-dev.1)
- Status: 🔄 committed on `dev`; `main` untouched, waiting for the user's OK to release
- Timestamp: 2026-09-30 02:30:00 Asia/Taipei

---

## 📅 Log: 2026-09-30 02:30:00 Asia/Taipei (Task 176 區間收益, 0.10.7-dev.1)
- User asked for a date-range view on 年度收益 ("which stocks, how much did I make"), discussed first as an HTML proposal, then approved: dividends included, 台股／美股 as a toggle, real Taipei "today", presets 近 1 個月 / 近 3 個月 / 近 1 年 / 今年以來 / 去年 / 全部 / 自訂, and **only money already realized** — open positions never counted.
- Why no engine recomputation: `SellDetail` (`pnlEngine.ts:84`) already carries `date` plus the moving-average cost **as of that sell**, so a leg's realized P&L is final and slicing by date is a filter, not a recalculation. The test that pins this down is 區間 = 整個年度 ⇒ every figure equals that year's row in the yearly table.
- Engine change (the only one needed): `DividendLeg` + `YearTickerDetail.dividendLegs`, pushed where `yt.dividends += net` already ran. `dividends` (the number) is untouched, so Dashboard / Discord card / yearly table are unaffected. `npm run sync:edge-engine` re-rendered the Edge copy (`_shared/engine/pnlEngine.ts`) — `edgeEngine.test.mjs` compares the two and failed until it was run.
- New files: `YearlyReport/rangeRows.ts` (all the arithmetic: presets → window, per-ticker aggregation merged across years, totals, oversold rule), `RangeSection.tsx` (UI), `pnlMath.ts` + `cells.tsx` (moved verbatim out of `YearlyPage.tsx` so both tables share the DA-07 oversold rule and one way of printing money), `src/utils/taipeiDate.ts` (`taipeiDateKey` extracted from its two copies in `MacroPage.tsx` / `Fx/fxConvert.ts`, plus `addMonthsKey`, which clamps 03-31 −1 month to 02-28 instead of rolling into March).
- `YearlyPage.test.tsx` 搜尋 case had to be scoped to the yearly table (`columnheader /^年度/` → `closest('table')`): 區間收益 prints the same ticker above it and the search box does not reach into that section.
- Verify: vitest 150 files / 2,556 tests, 2,549 passed, 7 skipped (24 new across `rangeRows.test.ts` + `RangeSection.test.tsx`); `npm run build`, `typecheck:edge`, `lint` exit 0. Numbers re-derived by hand against the browser: 2330 realized +600,397 on cost 500,713 = +119.91%, 2303 −30,919 = −17.15%, totals +569,478 realized / +6,000 dividend / +575,478. Screenshots 1440 light+dark and 390 light, horizontal overflow 0 px, no console errors. Fixed from those shots: flex `min-width: 0` (the table pushed the phone page 14 px wide), phone KPI figure size (two figures collided), date label+field pairs glued, 股利 KPI switched to `fmtMoney` (no `+` sign), `.yr-head` instead of `.section-title` so the note wraps.
- No Supabase change: no DDL, no Edge deploy needed (the Edge engine copy changed but the Discord card does not read `dividendLegs`; redeploy only if a future card uses it).

---

## 📅 Log: 2026-09-29 17:42:14 Asia/Taipei (BUG-088 follow-up: Discord card fee settings, 0.10.6-dev.1)
- User reported: after changing 分批買進時的預扣算法 or 現折／月退, the dashboard changed but the Discord push did not. Confirmed: `loadHoldingsWorkspaces` selected only `id, fee_rate`, so the card ignored `fee_rebate` / `fee_rounding` (BUG-088 had listed the Edge card as "not applied").
- Fix (b339777): select both columns; `buildLedgers` derives `rounding` and `basis` (Edge copy of `pnlBasis`); each workspace leg passes `rounding` to `estimateUnrealized` and takes the 牌告 figure as its main unrealized under 月退, then legs are summed (user chose per-workspace-then-sum for merged keys). Break-even unchanged: its synthetic single lot makes lot vs position identical.
- Verify: new `holdingsCard.test.ts` cases incl. independent oracle Ron 2303 月退+整筆 −17,995 / 月退+每批 −17,993; vitest 2,526 passed, 7 skipped; build, typecheck:edge, lint exit 0. DEV deploy from clean b339777: v32 → v33, sha `58e94285…` → `98a86b7a…`, verify_jwt false, POST `{}` → 400. Not verified: an actual Discord post on DEV (would send to a real webhook) — user can check via 管理 → Discord 預覽.
- Release (2026-09-29 17:52:30): user said merge straight to PROD. 70cd957 `chore(release): 0.10.6`, ff `main`, `git push origin main:dev`; CI + Sync GitHub Releases green, `gh release view 0.10.6` exists. PROD `stock-report` deployed from clean `main` 70cd957 with `--no-verify-jwt`: v20 → v21, sha `58e94285…` → `98a86b7a…` (= DEV v33), verify_jwt false, POST `{}` → 400. No DDL. Still unverified: a real Discord post.

---
