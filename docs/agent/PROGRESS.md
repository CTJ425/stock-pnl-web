# Progress Log (PROGRESS.md)

- Agent: Claude (main session)
- Action: 0.9.27-dev.1 — per-transaction fee_rate persistence, plus main-session review fixes
- Status: **✅ RECORDED**
- Timestamp: 2026-09-01 20:19:41 Asia/Taipei

---

## 📅 Log: 2026-09-01 20:19:41 Asia/Taipei (0.9.27-dev.1 — per-transaction fee_rate persistence + review fixes)

- **Status**: ✅ **COMPLETED** — commit `46985f6` on `dev`
- **Version**: `0.9.26` → **`0.9.27-dev.1`** (`version.ts`, `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md` synchronized)
- **Work**:
  1. **Schema (`schema.sql`, `verify.sql`)**: Added `transactions.fee_rate NUMERIC` with `CHECK (fee_rate IS NULL OR (fee_rate >= 0 AND fee_rate < 1))`. Added `('transactions','fee_rate')` to `verify_setup()`.
  2. **Data layer (`models.ts`, `dataProvider.ts`)**: Added `fee_rate?: number | null` to `Transaction`. `TX_COLUMNS` now carries `fee_rate`. The legacy-schema degrade strips **only the column the error names**, via `missingTxColumn()` + `withTxColumnDegrade()`, bounded at 3 attempts and gated on 42703/PGRST204 at every step.
  3. **Rate inference (`fees.ts`)**: Added `COMMON_FEE_RATES` and `inferFeeRate`, which recovers the historical rate from `(fee_tax - tax) / (price * qty)` for rows with `fee_rate` NULL. Takes the workspace minimum fees as a required argument; caps the inferred ratio at the statutory `DEFAULT_FEE_RATE`.
  4. **Form parity (`TransactionForm.tsx`)**: Edit mode uses `initial.fee_rate` when present, otherwise `inferFeeRate`, instead of overwriting with the workspace default. Passes both workspace minimum fees to `inferFeeRate`.
- **Main-session review of the first implementation** (spec `docs/agent/specs/139-fee-rate-review-fixes.md`) found two money defects, both fixed before commit:
  - **Degrade dropped `tx_nature` as well.** `withoutNewColumns` stripped both new columns for any missing-column error. On a database with `tx_nature` but without `fee_rate` — the PROD state — every insert and update would have written `tx_nature = NULL`, silently breaking the day-trade tax split in `splitFeeTax`. Regression against 0.9.26.
  - **`inferFeeRate` returned an inflated rate.** The minimum-fee clamp test compared against the literals 20/1 while the only caller never passed the parameter, and the ratio cap was 0.05 — 35x the statutory rate. Measured: odd minimum fee 5, gross 1,000, `fee_tax` 5 inferred 0.005; editing the quantity then computed a fee of 500 against a correct 142.
- **`route:reviewer` caught a third defect in the fix itself**: the builder had added an unspecified second minimum-fee check that discarded a recoverable rate whenever an **unclamped** fee coincided with a minimum fee (`calculateFee` clamps only when `minFee > fee`). Measured: gross 100,000, `fee_tax` 15, minimum fee 15, real rate `0.00015` forced to `0.001425`, 9.5x too high. The check was removed — a clamp always inflates `fee / gross`, so the ratio cap covers that case by construction. The spec's Test Charter row that demanded this behaviour was wrong and has been corrected in place.
- **DEV schema applied and verified**: the `fee_rate` DDL had never been run against the real DEV database. Applied to cloud project `zyebvayngwrqzoaicbwd` via `supabase db query --linked`, then `NOTIFY pgrst, 'reload schema'`. `SELECT * FROM verify_setup()` returned **10/10 PASS**, `assert_setup_ok()` returned `ok`. PROD (`hrilemueiqyaoiwnkeuu`) is still pending — see BUG-044-P.

### Verification
- `npm run build` — exit 0
- `npx vitest run` — 94 files / **1476** tests, exit 0 (exit code checked, not the summary line)
- `SELECT * FROM verify_setup()` on DEV `zyebvayngwrqzoaicbwd` — 10/10 PASS; `assert_setup_ok()` — `ok`
- `node scripts/verify-fee-rate-e2e.cjs` — exit 0 (Chromium, **every `**/rest/v1/**` call stubbed; no database involved**)

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


