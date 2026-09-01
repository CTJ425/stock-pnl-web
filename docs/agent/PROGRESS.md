# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: TransactionForm improvements (nature defaults to SPOT, sell holdings dropdown quick pick)
- Status: **✅ RECORDED**
- Timestamp: 2026-09-01 15:06:00 Asia/Taipei

---

## 📅 Log: 2026-09-01 15:06:00 Asia/Taipei (0.9.26-dev.1 — TransactionForm SPOT default & sell holdings auto-complete)

- **Status**: ✅ **COMPLETED**
- **Version**: `0.9.25` → **`0.9.26-dev.1`** (`version.ts`, `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md` synchronized)
- **Work**:
  1. **Transaction Nature Optimization**: Removed "未指定" option in `TransactionForm.tsx` for TPE market; defaulted `nature` to `SPOT` (現股). Reset to `SPOT` after successful submission.
  2. **Holdings Auto-complete on Sell**: When `txType === 'SELL'` and `(market !== 'TPE' || nature === 'SPOT')`, clicking/focusing either `tx-ticker` or `tx-name` displays an active holdings dropdown list for the workspace, showing ticker, name, and current available shares. Clicking an item populates both fields and recalculates tax rate.
  3. **Non-SPOT Sell Flexibility**: When nature is not `SPOT` (e.g. `DAY_TRADE` or `MARGIN`), holdings dropdown is suppressed and standard stock search / direct entry is maintained.
  4. **Tests**: Added `sources/src/components/Transactions/TransactionForm.features.test.tsx`. Full test suite: 94 files / 1452 tests 100% passed; `npx tsc --noEmit` and `npm run build` exit 0.

### Verification
- `npx vitest run` — 94 files / 1452 tests, exit 0
- `npx tsc --noEmit` — exit 0
- `npm run build` — exit 0

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

