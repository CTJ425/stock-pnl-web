# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.7.24 release recording — ForeignTopSection quantity display uniform as lots
- Status: **✅ RECORDED**
- Timestamp: 2026-08-19 ? Asia/Taipei

---

## 📅 Log: 2026-08-19 ? Asia/Taipei (0.7.24 release: ForeignTopSection quantity display uniform as lots)

- **Release**: Version 0.7.24 official release to `dev`, scheduled merge to `main`.
- **Feature**: 外資買賣超 TOP 50 (總體經濟 > 台股) now displays all quantity columns (買賣超 / 買進 / 賣出) uniformly in 張 (lots = 1,000 shares), with no user toggle.
- **Changes**:
  - Removed `Unit` type, `unit` state, and `inst-metric-seg` button group (張 / 股) from `ForeignTopSection.tsx`.
  - Removed `fmtShares()` helper (no other callers).
  - Renamed column header to 買賣超(張).
  - All quantities now formatted with `fmtLots()` (value / 1000, one decimal place).
  - Updated file's top doc comment to clarify quantities are always in 張.
- **Testing**: Old test case "單位切換" replaced by: "數量一律以張顯示，沒有張股切換" (asserts 1,234.0 and 3,000.0 render, raw 1,234,000 does not, neither 張 nor 股 buttons exist) and "買賣超欄位標題標示單位為張".
- **Verification**: `npx vitest run src/components/Macro/ForeignTopSection.test.tsx` — 7 passed, 0 failed. `npx vitest run` (full suite) — 68 files, 1007 tests passed, 0 failed. `npx tsc --noEmit` — 0 errors. `npx oxlint src` — 0 errors (only pre-existing react/only-export-components warnings).
- **Review**: Not dispatched. Recorded honestly: display-layer only, no money/auth/schema/API/deploy behavior. Honest gate was failing-then-passing test plus full suite pass.

---

## 📅 Log: 2026-08-18 22:12:03 Asia/Taipei (0.7.23 release: ForeignTopSection data update timestamp stamp)

- **Release**: Version 0.7.23 official release to `main` on 2026-08-18, going straight to production.
- **Feature**: 外資買賣超 TOP 50 section (總體經濟 > 台股) now shows data update time in its header, one line added to `ForeignTopSection.tsx`.
- **Design**:
  - Reuses `source-tag section-stamp` convention and `fmtUpdatedAt` helper already used by `TwMarketSection.tsx` and `MacroPage.tsx`, ensuring consistent wording, placement, and time format across sibling sections.
  - No new CSS, no new formatter.
  - Value is `ForeignTopData.asOf`, already exposed by `foreignTopProxy.ts`.
  - Stamp hidden when snapshot is empty (no "資料更新於 —" in empty state).
- **Testing**: 2 new test cases in `ForeignTopSection.test.tsx` (one asserting stamp and `section-stamp` class, one asserting absence in empty state). Stamp test failed before change, passes after. Time format match by pattern, not fixed instant, per `fmtUpdatedAt` viewer-timezone rendering.
- **Verification**: `npx vitest run src/components/Macro/ForeignTopSection.test.tsx` — 6 passed, 0 failed; `npx tsc --noEmit` — 0 errors; `npx oxlint src` — 0 errors.
- **Review**: Not dispatched. Recorded honestly: presentation-only change with passing test (failed before, passes after), touching no money, auth, persistence, API contract, background job, or control flow.

