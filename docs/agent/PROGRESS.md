# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.10.9 released and **Edge `stock-report` deployed on DEV and PROD** — BUG-087 closed: the 券商 / 牌告 figure withholds the halved 現股當沖 tax on a lot bought today, matching the broker app; the app's own net figure and break-even stay at 0.3%.
- Status: ✅ `main` = 0.10.9, `dev` ahead by docs only; no DDL. DEV `stock-report` v34, PROD v22, both ezbr `31cac8de13efd3ff…`, `verify_jwt` false.
- Timestamp: 2026-09-30 17:20:00 Asia/Taipei

---
## 📅 Log: 2026-09-30 18:05:00 Asia/Taipei (Task 180 — stock-report deployed, DEV + PROD)
- User authorised both environments. DEV deployed from `dev` `dd3f83d`, PROD from a clean `main` `4a6c171` (= 0.10.9), both `--no-verify-jwt`. DEV v33 → **v34**, PROD v21 → **v22**; ezbr `98a86b7a…` → **`31cac8de13efd3ff…` on both** — expected, since `dev` is only `main` plus docs, and an identical bundle in both environments is itself evidence. `verify_jwt` stayed `false`, so the pg_cron caller will not start getting 401s.
- Audited rather than inferred, per `supabase-ops`: `functions download` from **PROD** into a scratch dir, then every file diffed against `main`'s tree — all identical except `supabase/.temp/linked-project.json`, which is CLI state, not function code. The rule is visibly in the deployed bundle: `DAY_TRADE_TAX_SUNSET` at `_shared/engine/pnlEngine.ts:229`, `lotSellTaxRate` at `:248`, and `holdingsCard.ts:344` `today?: string` reaching `:369`'s posted-rate `estimateUnrealized` call. A bumped version number alone would have proved only that *something* uploaded.
- Smoke: `POST {}` → `400 Unknown action` on both hosts — the expected reply for an unrouted body, so the function boots. `cron http (recent)` deliberately not checked: `CRON_SECRET` was untouched, so there is no new 401 to look for.

---

## 📅 Log: 2026-09-30 17:20:00 Asia/Taipei (Task 175 / BUG-087 當沖稅率對齊, 0.10.9)
- BUG-087 closed, and the answer is that **the engine was never wrong**. The broker withholds the halved 現股當沖 tax (0.15%, ETF 0.05%) on a lot bought **today** and returns to 0.3% overnight. Confirmed 2026-09-30: with the lot no longer same-day the broker showed −587 / −1.8% at price 32.2 — bit-for-bit the engine's own output. Full record: `FIXED_BUG.md` BUG-087, `CHANGELOG.md` 0.10.9.
- The boundary is the **calendar day, not the 13:30 close** — the 2026-09-29 E.SUN screenshot was taken at 14:46, after the close, and was still halved. A "switch back after the close" rule (the user's first idea) would have diverged from the app for 13:30–24:00 on the buy day.
- Shipped the **narrow** version: only the 券商 / 牌告 caliber halves. `unrealized` and `breakEven` stay at 0.3%, because the halving is conditional on actually day-trading and on eligibility this app cannot see (處置股 / 警示股 / 全額交割股, 當沖同意書), and break-even asks what covers cost if you *don't* sell today.
- `dayTradeDate` is **passed in, never read from the clock** — an engine calling `new Date()` makes the 78-tag historical recompute that cleared this repo impossible to repeat. Labels (`brokerDayTradeTax`) use the same predicate as the figure. Edge gets the run's Taipei **calendar** date, not `ymd` (the market day, which points back at Friday on a weekend).
- Verify: vitest 2,586 passed / 7 skipped (+18); build, `typecheck:edge`, lint exit 0. Task 178's cutover was committed alongside, so 0.10.9 is the first release cut with the global `ship` / `versioning` skills reading `.claude/release.config.json`.
- **Open**: whether the broker halves per lot *within one ticker* is unverified — the 2303-vs-6560 evidence is cross-ticker (Task 181). Edge was deployed straight after; see the entry above.
- Same session, after the release: `BUG_FIX.md` split three ways — 19 accepted / won't-fix entries plus the token-rotation checklist moved to the new **`ACCEPTED_RISKS.md`** (not read at session start), BUG-088 to `FIXED_BUG.md`. 19,564 → 3,135 bytes.

---
