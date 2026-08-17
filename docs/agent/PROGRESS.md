# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task 111 — Retune T86 probe active window to 16:00–17:00 and release version 0.7.18
- Status: **✅ Implemented and verified; all 66 test files / 963 tests pass; build & typecheck clean; DEV/main ready to merge**
- Timestamp: 2026-08-17 16:55:00 Asia/Taipei

---

## 📅 Log: 2026-08-17 16:55:00 Asia/Taipei (Task 111: Retune T86 probe active window to 16:00–17:00, sync UI & docs, release 0.7.18)

1. **T86 Probe Window Optimization (`sourceProbePlan.ts`)**:
   - Narrowed `DAILY_WINDOWS.t86` from `15:30 – 17:30` to **`16:00 – 17:00`** (every 5 mins, 3 hits to retire).
   - Removed 15:30–16:00 probe attempts where TWSE T86 data is never available, eliminating 6 daily no-op probes.
2. **Admin UI & Documentation Sync**:
   - Updated `ProbeWarRoom.tsx` card window label to `16:00–17:00`.
   - Updated `MechanismGuide.tsx` description table to `16:00 – 17:00`.
   - Updated `schema.sql` commentary.
3. **Testing & Version Release (0.7.18)**:
   - Updated unit tests in `sourceProbePlan.test.ts`.
   - Full Vitest suite: 66 test files / 963 tests passed 100%.
   - Build (`tsc -b && vite build`) and Edge typecheck (`tsc -p tsconfig.edge.json`) 0 errors.
   - Synchronized `version.ts`, `package.json`, `package-lock.json`, `README.md`, and `CHANGELOG.md` to `0.7.18`.

## 📅 Log: 2026-08-14 18:00:00 Asia/Taipei (Task 110 Follow-up: Fix Probe War Room premature retirement condition & full verification)

1. **Retirement Gate Correction (`ProbeWarRoom.tsx`)**:
   - Fixed `isRetired` logic in `ProbeWarRoom.tsx` so daily sources (e.g. `T86`, `BFI82U`, `BWIBBU`, `MARGIN`, `BORROW`) strictly require `hitCount >= target` (3 hits) to retire, rather than prematurely marking retired on tick 1 or 2 when the tick note matches `資料已到位`.
   - Unit tests added in `ProbeWarRoom.test.tsx` asserting 1/3 and 2/3 hits show `🟢 探測中` without `已退休`, and 3/3 hits show `✅ 已退休`.
2. **Testing & Verification**:
   - Full Vitest suite: 66 test files / 963 tests passed 100%.
   - Build (`tsc -b && vite build`) and Edge typecheck (`tsc -p tsconfig.edge.json`) 0 errors.
   - `oxlint` 0 errors.
   - Synced `package-lock.json` version to `0.7.17`.
