# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.10.9 released: BUG-087 closed — the 券商 / 牌告 figure now withholds the halved 現股當沖 tax on a lot bought today, matching the broker app; the app's own net figure and break-even stay at 0.3%. Task 178's cutover committed in this repo.
- Status: ✅ `main` = `dev` = 0.10.9; no DDL. **Edge `stock-report` not deployed** — `sources/supabase/` changed, so DEV and PROD both need it before the Discord card follows the new rule.
- Timestamp: 2026-09-30 17:20:00 Asia/Taipei

---
## 📅 Log: 2026-09-30 17:20:00 Asia/Taipei (Task 175 / BUG-087 當沖稅率對齊, 0.10.9)
- BUG-087 closed, and the answer is that **the engine was never wrong**. The broker withholds the halved 現股當沖 tax (0.15%, ETF 0.05%) on a lot bought **today** and returns to 0.3% overnight. Confirmed 2026-09-30: with the lot no longer same-day the broker showed −587 / −1.8% at price 32.2 — bit-for-bit the engine's own output. Full record: `FIXED_BUG.md` BUG-087, `CHANGELOG.md` 0.10.9.
- The boundary is the **calendar day, not the 13:30 close** — the 2026-09-29 E.SUN screenshot was taken at 14:46, after the close, and was still halved. A "switch back after the close" rule (the user's first idea) would have diverged from the app for 13:30–24:00 on the buy day.
- Shipped the **narrow** version: only the 券商 / 牌告 caliber halves. `unrealized` and `breakEven` stay at 0.3%, because the halving is conditional on actually day-trading and on eligibility this app cannot see (處置股 / 警示股 / 全額交割股, 當沖同意書), and break-even asks what covers cost if you *don't* sell today. A bonus: `breakEvenPrice` was never touched, so its closed-form-seed hazard (`fees.ts:256`) never had to be solved.
- `estimateUnrealized`'s new `dayTradeDate` is **passed in, never read from the clock** — an engine that calls `new Date()` makes the 78-tag historical recompute that cleared this repo impossible to repeat. Labels (`brokerDayTradeTax`) come from the same predicate as the figure, so they cannot claim a halving the arithmetic did not apply. Edge gets the run's Taipei **calendar** date, not `ymd` (the market day, which points back at Friday on a weekend).
- Verify: vitest 2,586 passed / 7 skipped (+18); build, `typecheck:edge`, lint exit 0. Also committed here: Task 178's cutover in this repo, so 0.10.9 is the first release cut with the global `ship` / `versioning` skills reading `.claude/release.config.json`.
- **Open**: Edge `stock-report` is **not deployed** on DEV or PROD, so the Discord card still uses the old rule. Unverified: whether the broker halves per lot *within one ticker* (the 2303-vs-6560 evidence is cross-ticker).
- Same session, after the release: `BUG_FIX.md` split three ways — 19 accepted / won't-fix entries plus the token-rotation checklist moved to the new **`ACCEPTED_RISKS.md`** (not read at session start), BUG-088 to `FIXED_BUG.md`. 19,564 → 3,135 bytes.

---
