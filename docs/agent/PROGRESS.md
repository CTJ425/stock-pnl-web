# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Session 2026-09-01 recorded (0.9.25 release, task 137 §C completion, cron repair, dispatch rules)
- Status: **✅ RECORDED**
- Timestamp: 2026-09-01 13:37:25 Asia/Taipei

---

## 📅 Log: 2026-09-01 13:37:25 Asia/Taipei (0.9.25 release — task 137 §C, cron repair, dispatch rules)

- **Status**: ✅ **COMPLETED**
- **Version**: `0.9.25-dev.2` → **`0.9.25`** (release; `version.ts`, `package.json`, `package-lock.json`, `README.md` all synced, no `-dev` remaining)
- **Work**: three strands — finished task 137 §C, repaired the Supabase cron on both cloud projects, and wrote the session's dispatch lessons into `CLAUDE.md` and the agent definitions.

### 1. Task 137 §C (code, committed as `0fa591d`)
- `transactions.tx_nature` with a CHECK for NULL / SPOT / DAY_TRADE / MARGIN; `TxNature` and `TX_NATURE_LABEL` in `types/models.ts`; optional `tx_nature` on `Transaction`.
- `SupabaseProvider` degrades on a pre-migration schema, retrying **only** on `42703` / `PGRST204`.
- `splitFeeTax` centralises the fee/tax split; an explicit `DAY_TRADE` label is trusted, everything else keeps the inference ladder.
- CSV gains `交易性質` plus split `手續費` / `證交稅` columns and keeps the legacy combined column.
- Tests 92 files / 1416 → **93 files / 1450**, all passing; `npm run build` exit 0.

### 2. Supabase cron repaired — see OPS-001 in `FIXED_BUG.md`
- Both cloud projects had been recreated on 2026-08-31 from setup SQL with **two** unsubstituted placeholders: `<PROJECT_REF>` in the URL and `<CRON_SECRET>` in the header. All 12 jobs had **never run successfully**.
- Fixed both; verified by re-hashing the cron-side secret against the hash `secrets list` reports (MATCH on both projects) and end to end by `net._http_response` going 401 at 13:30 → **200 at 13:35**.
- PROD ref is now `hrilemueiqyaoiwnkeuu`; the previously documented `kxnxadaghidwumqsqneu` and the ref in `sources/.env` are both deleted (404). `CLAUDE.md` § Branches & envs corrected.
- **Not done**: the two PROD/cloud schema migrations (BUG-041) were blocked by the session's permission classifier. The app degrades cleanly without them.

### 3. Dispatch rules recorded from measured failures
- `CLAUDE.md` gains a "Dispatch discipline" subsection with seven rules, each traced to a real cost this session: the verify command must be `npm run build` (`npx tsc --noEmit` does not type-check test files and produced three false-green builder reports); `route:reviewer` has no Bash so briefs must paste the test output; scribe composes nothing a human will read and takes at most two tracking files per dispatch; the failing test must compile against the proposed signature before dispatch; a classification rule is validated against real data before it enters a spec, and the spec states the negative case; the main session reads the diff itself for money code; `cp` is aliased to `cp -i`.
- `.claude/agents/scribe.md` and `.claude/agents/reviewer.md` updated with the two rules that apply to them directly.
- Cost evidence: this session totalled **$96.68**, of which the main session was **87%** across 408 turns at an average context of 232,082 tokens ($0.205/turn). Cache read was 55.7% of spend, output 15.6%.

### Verification
- `npx vitest run` — 93 files / 1450 tests, exit 0
- `npm run build` — exit 0
- Cron: `cron.job_run_details` `succeeded`, `net._http_response` 200 on both projects

---

## 📅 Log: 2026-09-01 10:17:41 Asia/Taipei (Transaction nature field and fee/tax split CSV)

- **Status**: ✅ **COMPLETED (DEV verified, PROD pending)**
- **Task Completed**: Task 137 §C (Transaction Nature CSV Extension, full completion)
- **Routing**: 1 scout → 4 builders (data layer, calculations, form, CSV) → 2 reviewers → main-session adjudication
- **Bugs/Risks**: New RISK-004 (dropped label on pre-migration database, severity low, accepted).
- **Work Summary**:
  - Schema: `transactions.tx_nature TEXT` with CHECK constraint (NULL / SPOT / DAY_TRADE / MARGIN) added to `sources/supabase/schema.sql`.
  - Provider: Retry on missing-column errors only (`42703` or `PGRST204`); other errors throw immediately (INSERT is not idempotent).
  - Calculations: `splitFeeTax` centralizes fee/tax split; explicit label only adds information (no forced SPOT rate per BUG-036).
  - CSV: Export emits `交易性質` and split `手續費`/`證交稅` columns, keeps legacy column. Import accepts labels/codes, sums split columns, reports unrecognized nature per-row.
  - Form: `交易性質` selector for TPE only; selecting 當沖 sets securities tax rate to 0.0015.
- **Tests**: 93 files / 1450 tests, all passing, exit 0. Two main-session catches before review: provider retry originally on ANY error (would duplicate transactions); `splitFeeTax` had optional `ticker` with fallback (would overtax ETF/TDR/REIT 3×). Both fixed.
- **DEV Deployment**: Schema applied and verified. PROD pending (BUG-041).
- **Reviewer Verdicts**: Calculations PASS with no findings; data layer PASS WITH RISK (dropped-label risk accepted; ledger inference still correct).
- **Files Changed**: `services/dataProvider.ts`, `sources/supabase/schema.sql`, `utils/fees.ts`, `csv.ts`, `TransactionForm.tsx`, plus 7 test files.
- **Edge Deployment**: Not needed.

---
