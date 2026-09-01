# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Fix Yahoo intraday in-progress daily bar leakage before market close (BUG-042)
- Status: **✅ RECORDED**
- Timestamp: 2026-09-01 15:45:00 Asia/Taipei

---

## 📅 Log: 2026-09-01 15:45:00 Asia/Taipei (0.9.26-dev.2 — Fix Yahoo intraday daily bar leak in twDaily & self-healing syncDaily, BUG-042)

- **Status**: ✅ **COMPLETED**
- **Version**: `0.9.26-dev.1` → **`0.9.26-dev.2`** (`version.ts`, `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md` synchronized)
- **Work**:
  1. **Intraday Bar Filter in `twDaily.ts`**: Added `isTwMarketClosed()` utility to verify if Taipei market has passed 13:30 close. `extractDaily()` skips today's (or future) in-progress rolling bar when called before market close (< 13:30). Keeps technical daily series and "每日成交量" table pinned to the last fully settled trading day during market hours.
  2. **Self-healing Cache in `syncDaily`**: Added check in `syncDaily` (`stock-report/index.ts`) for premature daily files written before close on `targetDate`. If an existing file was recorded before 13:30 on the target day, it is no longer skipped when `syncDaily` runs post-close, ensuring complete closing bars overwrite any partial morning snapshot.
  3. **Tests**: Added unit test coverage for `isTwMarketClosed` and `extractDaily` intraday filtering vs post-close inclusion in `twDaily.test.ts`. Full test suite: 94 files / 1456 tests 100% passed; `npx tsc --noEmit` and `npm run build` exit 0.

### Verification
- `npx vitest run` — 94 files / 1456 tests, exit 0
- `npx tsc --noEmit` — exit 0
- `npm run build` — exit 0

---

## 📅 Log: 2026-09-01 15:06:00 Asia/Taipei (0.9.26-dev.1 — TransactionForm SPOT default & sell holdings auto-complete)

- **Status**: ✅ **COMPLETED**
- **Version**: `0.9.25` → **`0.9.26-dev.1`** (`version.ts`, `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md` synchronized)
- **Work**:
  1. **Transaction Nature Optimization**: Removed "未指定" option in `TransactionForm.tsx` for TPE market; defaulted `nature` to `SPOT` (現股). Reset to `SPOT` after successful submission.
  2. **Holdings Auto-complete on Sell**: When `txType === 'SELL'` and `(market !== 'TPE' || nature === 'SPOT')`, clicking/focusing either `tx-ticker` or `tx-name` displays an active holdings dropdown list for the workspace, showing ticker, name, and current available shares. Clicking an item populates both fields and recalculates tax rate.
  3. **Non-SPOT Sell Flexibility**: When nature is not `SPOT` (e.g. `DAY_TRADE` or `MARGIN`), holdings dropdown is suppressed and standard stock search / direct entry is maintained.
  4. **Tests**: Added `sources/src/components/Transactions/TransactionForm.features.test.tsx`. Full test suite: 94 files / 1452 tests 100% passed; `npx tsc --noEmit` and `npm run build` exit 0.

### Verification
- `npx vitest run` — 94 files / 1452 tests, exit 0
- `npx tsc --noEmit` — exit 0
- `npm run build` — exit 0

---

