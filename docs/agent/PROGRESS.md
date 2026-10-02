# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.20 released** — BUG-108: in the fee settings, 「刪除」 a rate period and the base row's 「改」 now edit a draft that only 儲存 writes (they used to write on click, which cost the user a discount period on PROD).
- Status: ✅ `main` = `dev` = `efc53e4` (+ docs); Release 0.10.20 published by CI, all four check runs success; live site serves 0.10.20 (only version string in the bundle) with the new draft hint. Gates: vitest 2,806 pass / 7 skipped, build / `typecheck:edge` / lint exit 0. Frontend-only.
- Timestamp: 2026-10-02 14:20:00 Asia/Taipei

---
## 📅 Log: 2026-10-02 14:20:00 Asia/Taipei (0.10.20 — BUG-108)
- **Report (PROD)**: 玉山證卷 had 「一直以來 不打折」 plus a later discount; the user pressed 刪除 without saving and the period was gone; 「折扣怎麼退給你」 then showed disabled.
- **Root cause**: `removeSegment` / `saveBase` called `setWorkspaceFeeRateHistory` / `setWorkspaceFeeRate` on click, contradicting the panel copy. The disabled rebate group is a consequence (rate now list price → nothing to refund); `fee_rebate` is still `monthly` on PROD.
- **PROD read-only check**: `fee_rate` 0.001425, `fee_rate_history` `[]`; 116 TW trades, `fee_rate` NULL, every buy's fee ≈ 0.1425% (月退 records list price), so the deleted period's start date cannot be inferred. Trades untouched. The user re-enters it; nothing was written to PROD by the agent.
- **Fix**: draft (`history` / `savedHistory`, `baseDraft`) written by `submit`; status line when the list changed; the select follows the draft's rate for today until touched, so 儲存 does not re-add the deleted period from today. 4 new / updated tests fail on 0.10.19. Local-mode run: delete → 取消 → reload keeps the period.
---
## 📅 Log: 2026-10-02 13:30:00 Asia/Taipei (0.10.19 — BUG-104/105/106)
- **User asked** to fix the three P1 findings and ship straight to `main`.
- **BUG-104**: `summary.fees` is mixed-currency by design (GAS parity, synced to the Edge engine), so the fix lives in `YearlyPage.tsx`: per-currency sums over `ledger.yearly[*].tickers`. No engine change, no deploy.
- **BUG-105**: `oversoldNotice` replays `computeLedger` with the candidate row and asks only on a *new* 超賣 / 超額回補 warning (compared with the saved `ledger.warnings`, so re-saving an already-oversold row does not ask). The dialog uses the position just before the row; the engine's own string reads 「持有僅 0 股」 when a same-day buy is netted first. Three fee tests that sell with no position now answer the dialog.
- **BUG-106**: dividend types switch the unit to 零股 (back to 張 for trades) through `convertUnit`; `dividendSummary` above the submit button.
- **Tests**: 2 (BUG-104) + 2 (BUG-105) + 2 (BUG-106) new tests fail on 0.10.18 and pass now; screenshots of the dialog and the dividend total checked at 1280 / 390 in local mode.
- **User decision**: Ron's 00685L 2026-06-23 buy fee (459, list price) is intentional; discuss later, do not touch (Task 188 item 9).
- **Left open**: BUG-107 (count breakdown, low) and Task 188 (UX / a11y items).
