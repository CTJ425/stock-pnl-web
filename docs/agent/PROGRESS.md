# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Task 189 on DEV (0.10.21-dev.1)** — 月退 cost carries the list-price buy fee; sell-fee basis is its own setting.
- Status: 🔄 `dev` only; DEV DDL + Edge applied; PROD = 0.10.20, untouched. Awaiting the user's DEV test.
- Timestamp: 2026-10-02 16:30:00 Asia/Taipei

---
## 📅 Log: 2026-10-02 16:30:00 Asia/Taipei (Task 189, 0.10.21-dev.1 on DEV)
- **Report**: 玉山 009828 App −610 vs dashboard −515; user asked how 月退 should work and to keep 元大 right.
- **Root cause**: the 牌告 figure swapped only the sell fee; a 月退 app's cost holds the list buy fee settlement took (152 vs recorded 57). 元大 (日退, posted-rate sell) was only matching because its workspace was set 月退.
- **Fix (A2, user's choice)**: `sell_fee_basis` column split off `fee_rebate`; 月退 lifts the 券商 cost by `monthlyRebateCostUplift`. Details and broker sources: TASK.md Task 189.
- **Verified**: vitest 2,817 pass / 7 skipped; build, lint, `typecheck:edge` exit 0; two Playwright scripts PASS on the local vite (mocked backend) incl. 390px; DEV DDL applied with identity guard, `verify_setup()` 10/10; DEV Edge `stock-report` v40 from `8bd36d9`, ezbr → b5f9b528….
- **Left**: user test on DEV; Ron的投資組合 must be switched to 日退 + 牌告 when this reaches PROD; PROD only on explicit OK.
---
## 📅 Log: 2026-10-02 14:20:00 Asia/Taipei (0.10.20 — BUG-108)
- **Report (PROD)**: 玉山證卷 had 「一直以來 不打折」 plus a later discount; the user pressed 刪除 without saving and the period was gone; 「折扣怎麼退給你」 then showed disabled.
- **Root cause**: `removeSegment` / `saveBase` called `setWorkspaceFeeRateHistory` / `setWorkspaceFeeRate` on click, contradicting the panel copy. The disabled rebate group is a consequence (rate now list price → nothing to refund); `fee_rebate` is still `monthly` on PROD.
- **PROD read-only check**: `fee_rate` 0.001425, `fee_rate_history` `[]`; 116 TW trades, `fee_rate` NULL, every buy's fee ≈ 0.1425% (月退 records list price), so the deleted period's start date cannot be inferred. Trades untouched. The user re-enters it; nothing was written to PROD by the agent.
- **Fix**: draft (`history` / `savedHistory`, `baseDraft`) written by `submit`; status line when the list changed; the select follows the draft's rate for today until touched, so 儲存 does not re-add the deleted period from today. 4 new / updated tests fail on 0.10.19. Local-mode run: delete → 取消 → reload keeps the period.
