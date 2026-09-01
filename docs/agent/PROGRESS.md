# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Session 2026-09-01 recorded (0.9.25 release, task 137 §C completion, cron repair, dispatch rules)
- Status: **✅ RECORDED**
- Timestamp: 2026-09-01 13:37:25 Asia/Taipei

---

## 📅 Log: 2026-09-01 (recurrence prevention + route plugin 0.9.1)

- **Status**: ✅ **COMPLETED**
- **Version**: stock-pnl-web stays at `0.9.25` (no app code changed); `route` plugin `0.9.0` → `0.9.1`.

### 1. The cron defect can no longer ship silently
- Root cause of the recurrence: the check existed only as a comment in `schema.sql` §6d asking a human to run a query. See OPS-001.
- `schema.sql` §6e is now a hard gate — applying the script with a surviving placeholder aborts instead of creating broken jobs.
- New `sources/supabase/verify.sql`: `verify_setup()` returns a 10-row report, `assert_setup_ok()` raises unless everything passes. Proven to have teeth by planting a placeholder job on DEV and watching all three detection paths fire.
- Two checks still need a human eye and say so in the report: `cron target host` (uniformity is checkable, correctness is not) and `cron http (recent)` (401 vs 200 is the only proof the secret matches the Edge Function).

### 2. Dispatch rules moved to the plugin's own repository
- The session's earlier fixes went into `stock-pnl-web/.claude/agents/`, which are the **bare-name** agents. The agents actually dispatched are `route:*`, which come from the `route` plugin. `/root/dev/Model-Routing` is that plugin's source, and its copies are byte-identical to the installed ones.
- General rules moved upstream and released as `route` 0.9.1: scribe composes no prose a human will read and takes at most two tracking files per dispatch; Step 4 says reviewer has no Bash so briefs must paste builder's VERIFY/TESTS/LINT lines; Step 2 gains four pre-dispatch checks; Step 5 says the main session reads the diff itself where a wrong answer is silent.
- Project-specific rules stay in `stock-pnl-web/CLAUDE.md`: the `npm run build` verify command, the `cp -i` alias, and the local-vs-scoped reviewer tool difference.
- Correction worth keeping: `route:reviewer`'s own definition already said "you do not run commands". The five wasted findings were caused by briefs that contradicted it, not by the agent.

### Verification
- stock-pnl-web: `npx vitest run` 93 files / 1450 tests exit 0; `npm run build` exit 0
- Model-Routing: `python3 -m pytest -q` 212 passed
- DEV database: `SELECT assert_setup_ok()` returns `ok`

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
