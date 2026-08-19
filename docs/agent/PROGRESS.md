# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.7.25 release recording — computeLedger() stock name overwrite fix
- Status: **✅ RECORDED**
- Timestamp: 2026-08-19 09:39:50 Asia/Taipei

---

## 📅 Log: 2026-08-19 09:39:50 Asia/Taipei (0.7.25 release: Fix computeLedger() stock name overwrite)

- **Release**: Version 0.7.25 official release, finalized.
- **Fix**: `computeLedger()` now guards name assignments to prevent placeholder values (ticker-only) from overwriting known Chinese names.
- **Changes**:
  - `sources/src/utils/pnlEngine.ts` — Two guards added: `if (tx.name && tx.name !== tx.ticker)` before updating `ledger.positions[key].name` (line ~212) and `ledger.yearly[year].tickers[key].name` (line ~236).
  - Initialization logic preserved: `name: tx.name || tx.ticker` ensures all transactions have a name; if all trades carry only ticker, name remains ticker as expected.
  - Real case: 0050 bought as "元大台灣50"; a subsequent trade with only ticker "0050" no longer overwrites the Chinese name.
- **Testing**: New describe block "股票名稱：代號佔位名不得覆蓋已知名稱" with 3 test cases: (1) placeholder-only transaction does not overwrite existing Chinese name (0050 case), (2) placeholder followed by real name gets upgraded (upgrade path), (3) all-ticker scenario maintains ticker as name. All three failed before fix, pass after.
- **Verification**: `npx vitest run src/utils/pnlEngine.test.ts` — 17 passed, 0 failed. `npx vitest run` (full suite) — 68 files, 1008 tests passed, 0 failed. `npx tsc --noEmit` — 0 errors. `npx oxlint src` — 0 errors (no new violations). `npm run build` — built ok.
- **Review**: Lane 2, reviewer dispatched. Verdict: PASS with one RISK — upgrade path had no test coverage. RISK closed before commit by adding test case (2); nothing outstanding.

---

## 📅 Log: 2026-08-19 09:35:10 Asia/Taipei (0.7.24 release: ForeignTopSection quantity display uniform as lots)

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
