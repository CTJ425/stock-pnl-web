# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 91 — Close the three measured gaps in the routing loop, and commit the routing work to dev
- Status: **✅ All three gaps closed; routing_observe.py added to SessionStart; scribe.md guards archive reads; architect role deleted; two commits to dev; not pushed**
- Timestamp: 2026-08-12 14:34:06 Asia/Taipei

---

## 📅 Log: 2026-08-12 14:34:06 Asia/Taipei (Task 91: Close the three measured gaps in the routing loop)

Closed three measured gaps in the routing dispatch system by implementing SessionStart injection,
preventing expensive reads of archive files, and removing an unused role. Committed to `dev` in two
commits: `ea49fca` (cost re-base, Task 89+90 work) and `ab9faf1` (this task). Not pushed. Not merged
to main. No version bump. No deploy.

**Gap 1 — SessionStart workflow**: `routing_observe.py` now runs as a second SessionStart hook
(registered in `.claude/settings.json` alongside the existing code-review-graph hook) and injects
the lane rule, roster, guard descriptions, and live open-item counts from `TASK.md` and `BUG_FIX.md`.
Verified output: 1,139 characters, currently reporting 10 open tasks and 9 BUG_FIX entries.

**Gap 2 — Archive reads**: `.claude/agents/scribe.md` now forbids Reading `PROGRESS_ARCHIVE.md`,
`TASK_ARCHIVE.md`, `FIXED_BUG.md`, and `CHANGELOG.md`, and provides anchored alternatives: Edit on
the `---` header (via heredoc) to prepend, Bash for append, `grep -n` to locate, `sed -n` to inspect.
Measured problem: across 8 scribe runs and 113 tool calls, `TASK_ARCHIVE.md` was read 11 times,
`PROGRESS_ARCHIVE.md` 6 times, with 7% call failure rate. Haiku 4.5 averaged ~35 turns per scribe run
due to archive reads. With `PROGRESS_ARCHIVE.md` at 405KB and Haiku context 200K, forbidden reads
eliminate both the token spike and the failures.

**Gap 3 — architect deletion**: Removed unused role that duplicated main session and never executed
in 30 sessions. References removed from `routing_guard.py` (RULES, REASONS, docstring), `test_hooks.sh`,
`route/SKILL.md` (Step 2 and role description), `CLAUDE.md`, `reviewer.md`, `builder.md`. Roster now
four: scout, builder, reviewer, scribe.

**Other commits**: `docs/plan/github_documentation_strategy.md` untracked (was cited in `CLAUDE.md`
but not tracked in git). `.claude/routing/` telemetry files (`dispatch.jsonl` and `state/*.json`)
untracked to match `.gitignore:43`.

**Verification**: `bash .claude/hooks/test_hooks.sh` → 33 passed, 0 failed (was 36; three architect
write assertions removed). `grep -rn "Architect\b" .claude/ CLAUDE.md` → no matches. `routing_audit.py`
still runs.

**Open items to record**:
1. All three guards and the SessionStart brief remain unverified in live runtime — `.claude/settings.json`
   changes only take effect in sessions started afterwards. Confirm next session by attempting main-session
   Read of `docs/agent/PROGRESS_ARCHIVE.md`.
2. No Lane 1 task has been run end-to-end through brief → builder → test → scribe. `builder` has still
   never done real work.
3. `dev` is ahead of `main` by two commits and unpushed.

**Working tree note**: Two external changes appeared during this session, made outside it and deliberately
excluded from both commits: deletion of four tracked files under `docs/agents/mam/`, and new untracked
`docs/picture/` containing a 4.7MB PNG. Left as-is for user to decide.

---

## 📅 Log: 2026-08-12 14:02:05 Asia/Taipei (Task 90: Re-base the routing loop on measured cost instead of token count)

Rebalanced the routing system from token-denominated optimizations to cost-based dispatch decisions.
Measured data (30 sessions, `routing_audit.py --all`): cache reads are 98.1% of token count and 69.6% of spend,
while output is 0.5% of tokens but 16% of spend — so a token-denominated rule optimizes the cheap half.
The old rule ("under 20 minutes of human work, stay inline") optimized the wrong metric and missed major
break-even crossovers.

New principle recorded in `CLAUDE.md` and `route` skill: dispatch by context footprint, not task size.
Economics table: builder costs $0.096/dispatch, scout $0.121, scribe $0.270, Explore $1.879. A scout
replaces 2 main-session turns (break-even), scribe replaces 4 (far below the old 20-minute threshold).
Main session averaged $0.131/turn over 4,435 turns across all 30 sessions.

**Files changed:**
- `.claude/hooks/routing_guard.py` — added third job on PreToolUse for `Read`: unbounded reads of files
  over 32KB (env `ROUTING_READ_KB`, 0 disables, default 32) get `ask` with reason suggesting `scout` or
  bounded read. Threshold chosen from sources distribution (p90 18KB, max 41KB, only 2 source files and
  all 6 archive files affected). Bounded reads and all subagents pass through.
- `.claude/settings.json` — PreToolUse matcher widened from `Write|Edit|NotebookEdit` to
  `Write|Edit|NotebookEdit|Agent|Task|Read`.
- `.claude/hooks/test_hooks.sh` — new `readcheck()` helper plus 9 cases; suite now 36 assertions (was 27).
- `.claude/hooks/routing_audit.py` — rewritten to report cost, not output tokens. Prices table
  (Opus 5 5/25, Sonnet 5 2/10 intro, Haiku 4.5 1/5 per MTok), cache multipliers (0.1x read, 1.25x write at
  5m, 2x at 1h read from usage.cache_creation.ephemeral_{5m,1h}_input_tokens). Reports cost by component /
  model / role plus main-session average context and per-turn cost. Unpriced models excluded and named.
- `.claude/skills/route/SKILL.md` — Step 0 economics completely replaced with measured cost table and
  break-even thresholds; Lane 0 criterion changed to "content already in context and the edit is surgical".
  Step 2 split by lane: Lane 1 uses five-line inline brief with no spec file, Lane 2 keeps spec + failing
  tests. Step 4: test pass is the gate for ordinary work; reviewer mandatory only on risk list
  (money, positions, fees, prices, auth/RLS, persistence, schema, API contracts, background jobs,
  user-visible calculations).
- `.claude/agents/builder.md` — accepts brief or spec; done = Verify command passes, with command and
  result quoted in report.
- `CLAUDE.md` — stale "5–15k tokens overhead / 3.5x / 20 minutes" bullet replaced with cost break-even
  and context-footprint principle; scout row now also covers unbounded reads over 32KB.

**Verification:** `bash .claude/hooks/test_hooks.sh` → 36 passed, 0 failed. `python3 .claude/hooks/routing_audit.py --all`
reproduces the cost structure (cache_read 67.9%, output 16.2%, matching measured 69.6% / 16%).

**Known caveats to record:**
1. The widened `settings.json` matcher only takes effect in sessions started after the change, so the Read
   guard is unverified in live runtime — confirm in next session by attempting main-session Read of
   `docs/agent/PROGRESS_ARCHIVE.md`.
2. Same caveat still stands for the Agent/Task dispatch guard added in Task 89.
3. No Lane 1 task has yet been run end-to-end through new brief → builder → test → scribe path; builder
   has still never done real work.

---

