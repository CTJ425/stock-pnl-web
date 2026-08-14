# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task 110 — Deploy Probe War Room Cards in Admin Status Page replacing legacy failure alert banner (0.7.17)
- Status: **✅ Implemented and verified; all 66 test files / 962 tests pass; build & typecheck clean**
- Timestamp: 2026-08-14 16:48:00 Asia/Taipei

---

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

## 📅 Log: 2026-08-14 15:45:00 Asia/Taipei (Task 109: Retune probe cycles: bwibbu 17:00–18:30 and bfi82u dual window with 15:40 condition removed)

Optimized probe cycle timings and schedules across TWSE sources:
1. **Valuation Probe (`bwibbu`) Window Narrowing**:
   - Window updated from `15:00 – 22:00` to `17:00 – 18:30` (5-min interval, 3 hits to retire).
   - Analysis of historical probe ticks proved TWSE consistently publishes `BWIBBU_d` between 17:15–17:20, eliminating ~24 daily no-op probes between 15:00–17:00.
2. **Total Market Institutional Probe (`bfi82u`) Dual Window & 15:40 Gate Removal**:
   - Expanded to dual-window schedule: `15:00 – 16:30` (afternoon initial release) and `19:30 – 20:15` (evening comprehensive accounts & block trade settlement).
   - Removed the `< 15:40` gating condition in `sourceLanded` and `isMarketSessionReady`, allowing afternoon data to mark landed immediately on 3 hits.
   - Updated `syncMarket` to re-fetch today's `BFI82U` during the evening window (`>= 19:30`) to merge final settlement numbers.
   - Updated `readDoneSourcesToday` to filter landed counts by active window so each window independently requires 3 landed ticks to retire.
3. **Admin UI & Documentation**:
   - Updated `MechanismGuide.tsx`, `AdminStatusPage.tsx`, `timeline.ts`, and `schema.sql` comments.
4. **Testing & Verification**:
   - Updated unit tests in `sourceProbePlan.test.ts`, `twMarket.test.ts`, `probeRound.test.ts`, and `timeline.test.ts`.
   - All 65 test files / 959 tests passed 100%. `typecheck:edge`, `build`, and `oxlint` clean. Version: `0.7.17`.
