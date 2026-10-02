# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.18 released** (watchlist card: name / price / change one per line, flat hover) and a full **DEV E2E** run (138 checks) published as a report artifact; four new bugs BUG-104..107 and Task 188.
- Status: ✅ `main` = `dev` = `627e2e6` (+ docs); Release 0.10.18 published by CI, all four check runs success; live bundle on both `stock-pnl-web.pages.dev` and `dev.stock-pnl-web.pages.dev` verified by content. Gates: vitest 2,797 pass / 7 skipped, build / `typecheck:edge` exit 0. Frontend-only.
- Timestamp: 2026-10-02 12:52:00 Asia/Taipei

---
## 📅 Log: 2026-10-02 12:52:00 Asia/Taipei (0.10.18 + DEV E2E report)
- **0.10.18**: shaped with the user via /impeccable — price and change always on their own lines, 其他-group cards keep the industry line under the name, content top-aligned; hover is a band tint (`--cds-layer-accent-01` + `--border-strong`) instead of lift + shadow. `--row-hover` was rejected because at night it equals the card's own `layer-02`. Detector clean; checked in Playwright at 375 / 1280, light and dark.
- **DEV E2E** (user request; account demo01, `dev.stock-pnl-web.pages.dev`, which builds from `dev` and talks to DEV `zyebva…`): Playwright scripts in the session scratchpad, not committed. All writes happened in a throw-away workspace 「E2E測試區」, deleted afterwards with its 11 trades; watchlist back to 0/30; Ivan / Ron / D read only (Ivan 投入成本 NT$1,176,770 unchanged); theme back to 跟隨系統; password unchanged (the wrong-current-password case used the same new password); Discord not saved.
- **Result**: 127 pass / 7 warn / 1 fail / 3 info. Every fee, tax, 當沖, ETF, dividend-withholding and realized-P&L figure matched a hand calculation (fees floor to the dollar, as `fees.test.ts` pins). Defects filed: BUG-104 (年度收益 TWD+USD fee sum), BUG-105 (oversell saves silently), BUG-106 (dividend 配發股數 defaults to 張), BUG-107 (count breakdown). UX / a11y items in Task 188.
- **Report**: https://claude.ai/artifact/GytThoezGWdHSAfQKBQFXg
- **Not tested**: signup submit, reset-password mail, real password change, Discord save/test push, admin (demo01 is not admin), local mode (no entry in the cloud build), real broker CSV, multi-device / session expiry.
---
## 📅 Log: 2026-10-02 11:35:00 Asia/Taipei (0.10.17 — 當沖 option on buys, two layout overflows)
- **User asked** whether 當沖 still needs to be in 交易性質 now that the sell form detects it, plus two layout bugs from screenshots. The user chose the recommended shape and asked to ship straight through to `main`.
- **當沖 on buys**: hidden for new 買入 (`TransactionForm.tsx` 交易性質 select), with the hint 「當沖會在記賣出時自動判斷」. Reason: the answer only exists at the sell, and saving a 當沖 sell already labels today's buy legs (`buyLegs`, submit path). Kept for sells (older-position case is the user's call; also the way back from a wrong auto-label) and for an edited row already saved as 當沖. Switching a new trade SELL(當沖) → BUY resets it to SPOT via `applyDayTrade(false)`, so the `taxRateManual` guard is respected.
- **Tax quick-pick clipped**: the select had a fixed 122px (`.narrow-lg`, only user). Replaced by `.field-row > .fit` (`flex: 0 0 auto; width: auto`) — 166px at 375px wide, 160px on desktop.
- **Watchlist card overflow (3037 欣興 NT$1,265.00 +4.12%)**: `.watchlist-card-body` could not wrap inside a 136px-min card. Now `flex-wrap: wrap`. Reproduced in Playwright with the real CSS: old CSS overflows the 欣興 card only, new CSS neither card.
- **Tests**: features test 1 now asserts BUY → 現股/融資/融券 + hint, SELL → four options, SELL(當沖) → BUY resets to SPOT; new 1b asserts an edited 當沖 buy keeps the option.
- **Version**: `0.10.17-dev.1` (`df9a111`) then release `0.10.17` (`b28a32a`), fast-forwarded to `main`.
