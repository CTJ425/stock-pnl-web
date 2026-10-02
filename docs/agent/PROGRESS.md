# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.19 released** — the three P1 findings of the DEV E2E fixed: BUG-104 (年度收益 fee line split by currency), BUG-105 (oversell asks before saving), BUG-106 (dividend 配發股數 counts in 股, total shown above submit).
- Status: ✅ `main` = `dev` = `5199ff0` (+ docs); Release 0.10.19 published by CI, all four check runs success; both sites serve 0.10.19, verified by content over every lazy chunk (new strings present, 「台美股合計）」 absent). Gates: vitest 2,804 pass / 7 skipped, build / `typecheck:edge` / lint exit 0. Frontend-only: engine and Edge untouched.
- Timestamp: 2026-10-02 13:30:00 Asia/Taipei

---
## 📅 Log: 2026-10-02 13:30:00 Asia/Taipei (0.10.19 — BUG-104/105/106)
- **User asked** to fix the three P1 findings and ship straight to `main`.
- **BUG-104**: `summary.fees` is mixed-currency by design (GAS parity, synced to the Edge engine), so the fix lives in `YearlyPage.tsx`: per-currency sums over `ledger.yearly[*].tickers`. No engine change, no deploy.
- **BUG-105**: `oversoldNotice` replays `computeLedger` with the candidate row and asks only on a *new* 超賣 / 超額回補 warning (compared with the saved `ledger.warnings`, so re-saving an already-oversold row does not ask). The dialog uses the position just before the row; the engine's own string reads 「持有僅 0 股」 when a same-day buy is netted first. Three fee tests that sell with no position now answer the dialog.
- **BUG-106**: dividend types switch the unit to 零股 (back to 張 for trades) through `convertUnit`; `dividendSummary` above the submit button.
- **Tests**: 2 (BUG-104) + 2 (BUG-105) + 2 (BUG-106) new tests fail on 0.10.18 and pass now; screenshots of the dialog and the dividend total checked at 1280 / 390 in local mode.
- **User decision**: Ron's 00685L 2026-06-23 buy fee (459, list price) is intentional; discuss later, do not touch (Task 188 item 9).
- **Left open**: BUG-107 (count breakdown, low) and Task 188 (UX / a11y items).
---
## 📅 Log: 2026-10-02 12:52:00 Asia/Taipei (0.10.18 + DEV E2E report)
- **0.10.18**: shaped with the user via /impeccable — price and change always on their own lines, 其他-group cards keep the industry line under the name, content top-aligned; hover is a band tint (`--cds-layer-accent-01` + `--border-strong`) instead of lift + shadow. `--row-hover` was rejected because at night it equals the card's own `layer-02`. Detector clean; checked in Playwright at 375 / 1280, light and dark.
- **DEV E2E** (user request; account demo01, `dev.stock-pnl-web.pages.dev`, which builds from `dev` and talks to DEV `zyebva…`): Playwright scripts in the session scratchpad, not committed. All writes happened in a throw-away workspace 「E2E測試區」, deleted afterwards with its 11 trades; watchlist back to 0/30; Ivan / Ron / D read only (Ivan 投入成本 NT$1,176,770 unchanged); theme back to 跟隨系統; password unchanged (the wrong-current-password case used the same new password); Discord not saved.
- **Result**: 127 pass / 7 warn / 1 fail / 3 info. Every fee, tax, 當沖, ETF, dividend-withholding and realized-P&L figure matched a hand calculation (fees floor to the dollar, as `fees.test.ts` pins). Defects filed: BUG-104 (年度收益 TWD+USD fee sum), BUG-105 (oversell saves silently), BUG-106 (dividend 配發股數 defaults to 張), BUG-107 (count breakdown). UX / a11y items in Task 188.
- **Report**: https://claude.ai/artifact/GytThoezGWdHSAfQKBQFXg
- **Not tested**: signup submit, reset-password mail, real password change, Discord save/test push, admin (demo01 is not admin), local mode (no entry in the cloud build), real broker CSV, multi-device / session expiry.
