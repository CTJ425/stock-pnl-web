# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Persist on-demand chip reports to Storage & add frontend session in-memory cache
- Status: **✅ RECORDED**
- Timestamp: 2026-09-01 16:15:00 Asia/Taipei

---

## 📅 Log: 2026-09-01 16:15:00 Asia/Taipei (0.9.26-dev.3 — Persist on-demand chip reports to Storage & add frontend session in-memory cache)

- **Status**: ✅ **COMPLETED**
- **Version**: `0.9.26-dev.2` → **`0.9.26-dev.3`** (`version.ts`, `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md` synchronized)
- **Work**:
  1. **Storage Persistence for On-Demand Generation (`stock-report/index.ts`)**: `handleGenerate` now automatically uploads the public shared report (`{series.dataYmd}/{ticker}.json`, `holding: null`) into Supabase Storage upon generation. Non-batch stocks requested on demand will subsequently hit Storage-first, eliminating redundant Edge Function executions on subsequent views during the same trading day.
  2. **Frontend Session In-Memory Cache (`reportProxy.ts`)**: Introduced a lightweight in-memory cache (`reportCache` with 5-minute TTL, `cachedManifest` with 1-minute TTL) and `FetchStoredReportOptions.forceRefresh` parameter. Switching between stock tabs within a session no longer issues duplicate network requests.
  3. **StockDetailPage Cache Invalidation (`StockDetailPage.tsx`)**: Passing `{ forceRefresh: reloadKey > 0 }` to `fetchStoredReport` ensures manual user refresh or visibility restoration reliably gets updated reports without getting blocked by stale memory cache.
  4. **Tests**: Added unit tests in `reportProxy.test.ts` covering memory cache hits, `forceRefresh` bypass, `generateReport` cache population, and `clearReportCache`. Full test suite: 94 files / 1457 tests 100% passed; `npm run typecheck:edge`, `npx tsc --noEmit`, and `npm run build` all exit 0.

### Verification
- `npx vitest run` — 94 files / 1457 tests, exit 0
- `npm run typecheck:edge` — exit 0
- `npx tsc --noEmit` — exit 0
- `npm run build` — exit 0

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

