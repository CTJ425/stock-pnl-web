# Active Bug Fixes & Accepted Risks (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-09-30 17:40:00 Asia/Taipei

---

## 🐛 Open Issues

> **Accepted risks and won't-fix decisions moved out on 2026-09-30** → `ACCEPTED_RISKS.md`.
> They were 13 KB of this file and nothing ever acted on them, so they cost tokens at every
> session start and returned nothing. `grep` that file before you "discover" one of them again.
> Fixed bugs are in `FIXED_BUG.md`. Only things that still need doing belong here.

### BUG-084 — Stale per-workspace 最低手續費 in localStorage still drives estimates, with no UI to see or change it
- **Where**: `sources/src/utils/settings.ts` (`getMinFee`), `sources/src/utils/holdingRows.ts:80-81,119-121`
- **Root Cause Analysis**:
  1. From `046abd9` (2026-07-18) until `39a20e2` (0.9.24-dev.1, 2026-08-31) the transaction form persisted the typed 最低手續費 into `localStorage` (`stock-pnl-web/min-fee-whole|odd/<workspaceId>`) on every change.
  2. `39a20e2` removed that write-back, but nothing clears the old keys and `getMinFee` still reads them first. No UI shows or edits a workspace minimum fee (the AppShell fee dialog only handles the rate).
  3. A browser that typed a minimum fee in that window keeps using it for unrealized P&L and break-even on small positions and odd lots; another device, and the server-side Discord holdings card (Task 165 Phase 2), use the defaults 20 / 1.
- **Impact**: at most the gap between the stale and the default minimum fee per row, only where the estimated sell fee equals the minimum.
- **Status**: OPEN — found 2026-09-17 while checking docs/agent/specs/discord-holdings.md; accepted for Task 165 Phase 2 pending a user decision (clear the legacy keys, or persist minimum fees to `workspaces`).

---

### BUG-079 — 保本賣出價 and 淨收 read the same fee rate differently
- **Where**: `sources/src/utils/holdingRows.ts`, `sources/src/utils/fees.ts`, `sources/src/utils/pnlEngine.ts`
- **Root Cause Analysis**:
  1. `estimateUnrealized` (`pnlEngine.ts:861-865`) calculates unrealized P&L (and therefore `netMktVal = cost + unrealized`) using the fee rate recorded on individual lots (`lot.feeRate` from `holding.openLots`, which defaults to historical statutory rate ~0.001425 or inferred discount).
  2. In contrast, `breakEvenPrice` (`fees.ts:184-194`) receives the current workspace-level `feeRate` and does not consult `openLots`. It computes candidate breakeven via `cost / (qty * (1 - feeRate - taxRate))` and checks `isBreakEven(p)` using `feeRate`.
  3. When a user mistakenly enters `0.6` as a workspace fee rate (intended as 6 折 / 60% of statutory fee, see Task 159 D2), `breakEvenPrice` interprets it as a literal 60% fee rate (denominator `1 - 0.6 - 0.003 = 0.397`), making breakeven price ~2.52× cost basis. Meanwhile, `estimateUnrealized` for existing positions continues evaluating against `lot.feeRate` (~0.000855 or 0.001425), deducting only ~0.39% for fees+tax.
- **Status**: OPEN (Root cause identified; UI input formatting addressed in Task 159 D2, calculation alignment tracked for future remediation)
