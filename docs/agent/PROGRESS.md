# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Release 0.9.26 & documentation synchronization across codebase
- Status: **✅ RECORDED**
- Timestamp: 2026-09-01 16:30:00 Asia/Taipei

---

## 📅 Log: 2026-09-01 16:30:00 Asia/Taipei (0.9.26 — Release 0.9.26 & Comprehensive Documentation Sync)

- **Status**: ✅ **COMPLETED**
- **Version**: `0.9.26-dev.3` → **`0.9.26`** (`version.ts`, `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md` synchronized)
- **Work**:
  1. **Documentation and Reference Cleanup**:
     - Synchronized PROD Supabase project ref in `GEMINI.md` and `docs/CLAUDE-tw.md` to `hrilemueiqyaoiwnkeuu`, adding DEV cloud ref `zyebvayngwrqzoaicbwd`.
     - Updated `README.md`, `TASK.md`, and `MechanismGuide.tsx` from 5 cron jobs to 6 cron jobs, adding `backup-daily` (daily transaction backup at 02:00 Asia/Taipei).
     - Updated `SPEC.md` tech stack from React 18 / TailwindCSS to React 19 / Vanilla CSS design system.
     - Updated `TASK.md` "Where the project stands" to current version `0.9.26` and 94 test files / 1457 tests.
  2. **Release Finalization (0.9.26)**:
     - Consolidated pre-release logs into official `0.9.26` entry in `CHANGELOG.md`.
     - Stripped `-dev.3` across all version manifests to finalize release.
  3. **Verification**:
     - `npx vitest run` — 94 files / 1457 tests 100% passed.
     - `npm run typecheck:edge`, `npx tsc --noEmit`, and `npm run build` exit 0.

### Verification
- `npx vitest run` — 94 files / 1457 tests, exit 0
- `npm run typecheck:edge` — exit 0
- `npx tsc --noEmit` — exit 0
- `npm run build` — exit 0

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


