# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task 110 (Follow-up) — Fix Probe War Room retirement condition gate & verify full test suite (0.7.17)
- Status: **✅ Implemented and verified; all 66 test files / 963 tests pass; build & typecheck clean; DEV/main aligned**
- Timestamp: 2026-08-14 18:00:00 Asia/Taipei

---

## 📅 Log: 2026-08-14 18:00:00 Asia/Taipei (Task 110 Follow-up: Fix Probe War Room premature retirement condition & full verification)

1. **Retirement Gate Correction (`ProbeWarRoom.tsx`)**:
   - Fixed `isRetired` logic in `ProbeWarRoom.tsx` so daily sources (e.g. `T86`, `BFI82U`, `BWIBBU`, `MARGIN`, `BORROW`) strictly require `hitCount >= target` (3 hits) to retire, rather than prematurely marking retired on tick 1 or 2 when the tick note matches `資料已到位`.
   - Unit tests added in `ProbeWarRoom.test.tsx` asserting 1/3 and 2/3 hits show `🟢 探測中` without `已退休`, and 3/3 hits show `✅ 已退休`.
2. **Testing & Verification**:
   - Full Vitest suite: 66 test files / 963 tests passed 100%.
   - Build (`tsc -b && vite build`) and Edge typecheck (`tsc -p tsconfig.edge.json`) 0 errors.
   - `oxlint` 0 errors.
   - Synced `package-lock.json` version to `0.7.17`.

## 📅 Log: 2026-08-14 16:48:00 Asia/Taipei (Task 110: Deploy Probe Hit War Room Cards replacing legacy failure banner)

Replaced the legacy alert banner ("有 X 次探針抓取失敗需要注意") with the new interactive **Probe War Room (盤後探針命中戰情室)**:
1. **Probe War Room Component (`ProbeWarRoom.tsx`)**:
   - Displays real-time status across all 7 sources (`BFI82U`, `T86`, `BWIBBU`, `MARGIN`, `BORROW`, `MOPS_REV`, `MOPS_PROFIT`).
   - Cards display: Source name/code & time window, Retirement Badge (`✅ 已退休收工` / `🟢 探測中` / `⏳ 待機中`), Hit Count Progress (`3 / 3 次到位` with visual progress dots), and Hit Timestamps (`15:05`, `15:10`, `15:15 退休`).
   - Top banner aggregates active summary tags (`已退休 N 源・探測中 N 源・待機中 N 源`), data date, and refresh button.
2. **Testing & Verification**:
   - Created `ProbeWarRoom.test.tsx` testing rendering, hit counting, retirement badges, and hit timestamps.
   - Updated `AdminStatusPage.test.tsx` to assert new War Room cards.
   - Vitest suite: 66 test files / 962 tests passed 100%.
   - Build (`tsc -b && vite build`) passed with zero errors.
