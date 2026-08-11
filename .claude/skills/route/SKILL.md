---
name: route
description: Run a task through the model-routing loop — classify it into a lane, dispatch scout/architect/builder/reviewer/scribe at their own model tiers, and verify. Use when starting a feature, fixing a bug, working through docs/agent/TASK.md or BUG_FIX.md, or when the user says "route this", "run the next task", or asks why everything is running on Opus.
---

# Routing loop

You are the Boss. The main session holds the plan and spends as few of its own tokens
as possible doing it. Everything verbose happens in a subagent and comes back small.

Delegation here is **pre-authorized** — dispatching these agents is the requested
behaviour, not something to ask permission for each time.

## Step 0 — classify the lane

Answer three questions about the task: how much inference does it need, what does being
wrong cost, and how much subjective judgement is involved.

| Lane | Use when | Path |
| --- | --- | --- |
| **0 — inline** | Unambiguous, one file, mechanical (typo, copy, version bump, doc edit), touches no money/auth/schema/API/deploy behaviour, and you can name the verification command *before* editing | main session -> verify -> `scribe` if a record is owed |
| **1 — bounded** (default) | A clear fix or feature inside known modules | `scout` (if the area is unmapped) -> spec -> `builder` -> `reviewer` -> `scribe` |
| **2 — elevated risk** | Unknown-cause bug, cross-module change, P&L/holdings/fee/price maths, auth or RLS, schema migration, Edge function, external API, cron/background job, or anything deployed | `scout` -> spec + failing tests -> `builder` -> `reviewer` -> adjudicate -> `scribe` |

Two economic limits on Lane 1/2, both measured, both real:

- **Dispatch overhead is 5–15k tokens** per subagent (fresh system prompt, CLAUDE.md,
  tool schemas; no shared prompt cache). If a human would finish the task in under
  ~20 minutes, Lane 0 is cheaper than any dispatch.
- A full loop on a trivial task measured **3.5x the tokens** of doing it inline. Lanes
  are a cost decision, not a ceremony.

State the lane in one line before you act. If you pick Lane 0 for a tracked task,
record why in `docs/agent/PROGRESS.md`.

## Step 1 — scout (haiku)

Only when the affected area is not already mapped. Ask a specific question — never
"look at the report pipeline", always "where is the BWIBBU valuation date chosen, who
calls it, which tests cover it". You get back ~40 lines. This is the single largest
token saving in the system.

If you have made a dozen Read/Grep calls yourself, you are doing scout's work at 5x the
price; a hook will tell you so.

## Step 2 — spec (main session, or `architect`)

Write `docs/agent/specs/<task-id>.md`. The main session is on Opus and owns this. Only
dispatch `architect` when the main session is *not* on the expensive model, or when the
task needs a designed test suite you do not want to write inline.

```markdown
# <task-id>: <title>

## Contract
- Inputs / outputs / error cases, stated precisely. What must NOT change.

## Files
- sources/src/...  (create | modify)   <- exhaustive; builder may touch nothing else

## Test charter
| Case | Expected outcome | Layer / file |

## Acceptance
- [ ] Targeted: `npm test -- <file>` (from `sources/`)
- [ ] Full gate: `<command, or "not required">`

## Non-goals
- What builder must NOT do.
```

The `## Files` list is what makes builder's scope enforceable — a PreToolUse guard
already blocks builder from tests, specs, and records, but only the spec bounds which
production files it may touch.

In Lane 2, write the failing tests before dispatching. In Lane 1, name them in the
charter and let builder write them.

## Step 3 — build (sonnet)

Dispatch `builder` with **only**: the task id, the spec path, the test path. Do not
paste the spec contents — builder reads the file. Do not add advice or context; anything
extra you say competes with the spec.

Independent tasks go out as parallel `builder` calls in one turn, not sequential rounds.

## Step 4 — review (sonnet)

Dispatch `reviewer` with the spec path and builder's reported file list. It returns
`PASS`/`FAIL` and findings, never fixes.

Skip review only in Lane 0. Never skip it when the change touches money, positions,
fees, prices, auth/RLS, persistence, schema, API contracts, background jobs, or a
user-visible calculation.

## Step 5 — adjudicate (main session only)

| Reviewer says | You do |
| --- | --- |
| PASS, no findings | go to step 6 |
| PASS with RISK | record the risk in `docs/agent/BUG_FIX.md`, go to step 6 |
| FAIL, 1st time | write a fix instruction naming file + line + required post-condition; re-dispatch `builder` |
| FAIL, 2nd time | **stop dispatching.** The defect is in the spec ~80% of the time. Fix the spec, restart from step 3 |
| FAIL, 3rd time | stop and ask the user. Do not loop |

Never forward reviewer's raw text to builder. Translate it into an instruction.

## Step 6 — record (haiku)

Dispatch `scribe` with the outcome: task id, files changed, test counts, reviewer
verdict, accepted RISKs, version. Do not update `docs/agent/*.md` yourself — it is
mechanical work at the most expensive rate in the system, and a hook will ask you to
reconsider if you try.

## Escalate to the main session when

- scout finds multiple plausible owners or an unresolved boundary;
- the requirement conflicts with existing behaviour or a durable project decision;
- a test cannot express the contract without choosing a design;
- builder needs a file outside the spec's `## Files`;
- a reviewer blocker is real but the right resolution is unclear.

## Verify the routing actually happened

```bash
python3 .claude/hooks/routing_audit.py          # this session
python3 .claude/hooks/routing_audit.py --all    # every session in this project
```

It reports output tokens per model, split main thread vs sidechain, from the transcripts
Claude Code already writes. One model and zero sidechain traffic means nothing was
routed, whatever the plan said. That report is the only proof that counts.
