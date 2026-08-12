# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 90 — Re-base the routing loop on measured cost instead of token count
- Status: **✅ Cost-based routing economics implemented; all three guards in place; tests passed 36/36; runtime verification pending for Read guard in live session**
- Timestamp: 2026-08-12 14:02:05 Asia/Taipei

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

## 📅 Log: 2026-08-12 13:40:45 Asia/Taipei (Task 89: Redirect built-in discovery agents to `scout`, fix routing telemetry tracking)

Implemented routing policy to block main session from spawning expensive built-in discovery agents
(`Explore` and `general-purpose`), routing them to `scout` instead. Measured motivation: since routing
was installed (commit 74bdf1c, 2026-08-11 21:01), main session wrote 96% of all output tokens; built-in
agents spent 112k tokens on scout's job (8 `Explore` runs + 1 `general-purpose` run), while `scout` spent
only 5.9k across 2 real runs.

**Files changed:**
- `.claude/hooks/routing_guard.py` — new second job on PreToolUse for `Agent|Task` tool names; returns
  `ask` when subagent_type is `Explore` or `general-purpose` with reason pointing at `scout`. Respects
  existing `ROUTING_GUARD=off` escape hatch. Docstring updated.
- `.claude/settings.json` — PreToolUse matcher widened from `Write|Edit|NotebookEdit` to
  `Write|Edit|NotebookEdit|Agent|Task`.
- `.claude/hooks/test_hooks.sh` — added `dispatch()` helper plus 6 new test cases covering
  Explore/general-purpose asked, scout/builder allowed, architect also policed, `ROUTING_GUARD=off`
  releases.
- `CLAUDE.md` — scout row in Task routing table now names dispatching Explore/general-purpose as
  main-session anti-pattern.
- `.claude/skills/route/SKILL.md` — Step 1 gained paragraph on why not to use built-in discovery agents,
  citing 112k vs 5.9k token difference.
- `.gitignore` conflict fixed: `.claude/routing/dispatch.jsonl` and one `state/*.json` were already
  ignored in `.gitignore` but still tracked in git; both untracked with `git rm --cached` (files remain
  on disk).

**Verification:** `bash .claude/hooks/test_hooks.sh` → 27 passed, 0 failed (was 21 before the 6 new cases).

**Known caveat:** Settings.json matcher widening only takes effect in sessions started after the change;
the guard is unverified in live runtime and should be confirmed in the next session.

---

