# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.17 released** — new 買入 no longer lists 當沖 (the sell labels today's buy legs), the 證交稅率 quick-pick no longer clips 「股票當沖 0.15%」, and a 4-digit watchlist price no longer spills out of its card.
- Status: ✅ Gates green (vitest 2,797 pass / 7 skipped, build / `typecheck:edge` exit 0). `main` = `dev` = `b28a32a`; Release 0.10.17 published by CI with the final body; all four check runs success; live bundle verified by content (`0.10.17`, the new hint, `.field-row>.fit`, wrapping `.watchlist-card-body`; no `0.10.16`). Frontend-only: no Edge or DDL to deploy.
- Timestamp: 2026-10-02 11:35:00 Asia/Taipei

---
## 📅 Log: 2026-10-02 11:35:00 Asia/Taipei (0.10.17 — 當沖 option on buys, two layout overflows)
- **User asked** whether 當沖 still needs to be in 交易性質 now that the sell form detects it, plus two layout bugs from screenshots. The user chose the recommended shape and asked to ship straight through to `main`.
- **當沖 on buys**: hidden for new 買入 (`TransactionForm.tsx` 交易性質 select), with the hint 「當沖會在記賣出時自動判斷」. Reason: the answer only exists at the sell, and saving a 當沖 sell already labels today's buy legs (`buyLegs`, submit path). Kept for sells (older-position case is the user's call; also the way back from a wrong auto-label) and for an edited row already saved as 當沖. Switching a new trade SELL(當沖) → BUY resets it to SPOT via `applyDayTrade(false)`, so the `taxRateManual` guard is respected.
- **Tax quick-pick clipped**: the select had a fixed 122px (`.narrow-lg`, only user). Replaced by `.field-row > .fit` (`flex: 0 0 auto; width: auto`) — 166px at 375px wide, 160px on desktop.
- **Watchlist card overflow (3037 欣興 NT$1,265.00 +4.12%)**: `.watchlist-card-body` could not wrap inside a 136px-min card. Now `flex-wrap: wrap`. Reproduced in Playwright with the real CSS: old CSS overflows the 欣興 card only, new CSS neither card.
- **Tests**: features test 1 now asserts BUY → 現股/融資/融券 + hint, SELL → four options, SELL(當沖) → BUY resets to SPOT; new 1b asserts an edited 當沖 buy keeps the option.
- **Version**: `0.10.17-dev.1` (`df9a111`) then release `0.10.17` (`b28a32a`), fast-forwarded to `main`.
---
## 📅 Log: 2026-10-02 10:00:00 Asia/Taipei (0.10.15 review → BUG-095/096/097 fixed, 0.10.16-dev.1)
- **0.10.15 never reached the website.** The Cloudflare Pages check run on `8b67800` says `Deploy failed` (01:24:51 UTC, a minute after the push); the docs commit `d134e30` deployed fine, so the failure is specific to that build. Verified by fetching every chunk of `stock-pnl-web.pages.dev`: only `0.10.14`, none of Task 187's strings. The log needs a Cloudflare login. The previous entry's 「still building」 was wrong, and its timestamps are UTC labelled Asia/Taipei (commits were 01:2x UTC = 09:2x Taipei).
- **Review of `89a33fe..HEAD`** (high effort, findings reproduced with throw-away App tests that were deleted afterwards). Three were fixed:
  - **BUG-095**: editing a saved ordinary sell flipped it to 當沖 and changed its fee 734 → 485 (the edit-mode ledger already includes the sell). Detection now runs for new trades only.
  - **BUG-096**: `applyDayTrade` cleared `taxRateManual`, re-introducing BUG-094 (typed 0.002 → 0.0015). Removed; one rule with the drop-down.
  - **BUG-097**: ETF 當沖 notices said 減半 while the rate is 0.1% (§2-2 covers 股票 only); the fee dialog still said 「ETF 0.05%」. Copy now follows `dayTradeTaxRate`; grep sweep listed in `FIXED_BUG.md`.
- **Tests**: three new App-level tests in `TransactionForm.fee.test.tsx`; each fails against the 0.10.15 form and passes now. Full suite 2,796 pass / 7 skipped; `npm run build` and lint exit 0.
- **Version**: `0.10.16-dev.1` in `package.json` + lockfile, `version.ts`, `README.md`; CHANGELOG entry in zh-TW.
- **Left open**: BUG-098 (restore ignores `seq`) is the sharpest; BUG-100..103 in `BUG_FIX.md`.
- **BUG-099, user's decision (2026-10-02)**: no hidden trade-time field. Manual entry already orders by submit order (`seq`, then `created_at` = `NOW()` per row), which is what the user wants; only CSV import is exposed, and its fix (detect newest-first files and reverse or warn) is deferred — do not start it unasked.
- **Released as 0.10.16** (`f282405`, 11:13): Release body by CI, Cloudflare Pages success, live bundle verified by content.
