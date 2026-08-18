---
name: route
description: Run a task through the model-routing loop — classify it into a lane, dispatch scout/builder/reviewer/scribe at their own model tiers, and verify. Use when starting a feature, fixing a bug, working through docs/agent/TASK.md or BUG_FIX.md, or when the user says "route this", "run the next task", or asks why everything is running on Opus.
---

# Routing loop

You are the Boss. The main session holds the plan and spends as few of its own tokens
as possible doing it. Everything verbose happens in a subagent and comes back small.

**Dispatch names are scoped.** The `subagent_type` values are `route:scout`, `route:builder`,
`route:reviewer` and `route:scribe` — supplied by the route plugin. The bare role names used
throughout this document name the *role*, not the value you pass to the Agent tool.

Delegation here is **pre-authorized** — dispatching these agents is the requested
behaviour, not something to ask permission for each time.

## Step 0 — classify the lane

Answer three questions about the task: how much inference does it need, what does being
wrong cost, and how much subjective judgement is involved.

| Lane | Use when | Path |
| --- | --- | --- |
| **0 — inline** | The content is **already in context** and the edit is surgical — a typo, a version bump, a one-line fix. Touches no money/auth/schema/API/deploy behaviour, and you can name the verification command *before* editing | main session -> verify -> `scribe` if a record is owed |
| **1 — bounded** (default) | A clear fix or feature inside known modules | `scout` (if the area is unmapped) -> spec -> `builder` -> `reviewer` -> `scribe` |
| **2 — elevated risk** | Unknown-cause bug, cross-module change, P&L/holdings/fee/price maths, auth or RLS, schema migration, Edge function, external API, cron/background job, or anything deployed | `scout` -> spec + failing tests -> `builder` -> `reviewer` -> adjudicate -> `scribe` |

### The economics, measured

**Cost is not token count.** Across this project's first 30 sessions, replaying context
(cache read) was **69.6% of spend** and output only **16%**. "Delegate the writing to a
cheap model" therefore optimizes the small half. What costs money is context footprint
multiplied by turn count.

| Action | Cost | ≈ main turns |
| --- | ---: | ---: |
| One main-session turn (at the measured 185k avg context) | $0.131 | 1 |
| `builder` dispatch | $0.096 | 0.7 |
| `scout` dispatch | $0.121 | 0.9 |
| `scribe` dispatch | $0.270 | 2 |
| `Explore` dispatch (inherits Opus — don't) | $1.879 | 14 |

A dispatch also costs the two main turns that issue it and read its answer (+$0.26).
**Break-even: `scout` pays for itself once it saves 2 main turns, `scribe` once it saves
4.** That bar is lower than it sounds — one bookkeeping round or one file-mapping
question already clears it.

The compounding term is the one to fear: a large file read into the main context is
re-billed on **every remaining turn of the session**. 100k tokens of archive adds
~$0.05/turn indefinitely — ~$10 over a 200-turn session — and dilutes attention while it
does. A PreToolUse guard asks before any unbounded main-session read over 32KB; take the
`scout` or the `offset`/`limit` it offers rather than confirming past it.

**Route by context footprint, not by task size.** Bulk content goes to a subagent even
when the task is trivial; a surgical edit on content already in context stays inline even
when the task looks big.

State the lane in one line before you act. If you pick Lane 0 for a tracked task,
record why in `docs/agent/PROGRESS.md`.

## Step 1 — scout (haiku)

Only when the affected area is not already mapped. Ask a specific question — never
"look at the report pipeline", always "where is the BWIBBU valuation date chosen, who
calls it, which tests cover it". You get back ~40 lines. This is the single largest
token saving in the system.

If you have made a dozen Read/Grep calls yourself, you are doing scout's work at 5x the
price; a hook will tell you so.

Do not reach for the built-in `Explore` or `general-purpose` instead. They inherit the
caller's model, so they do scout's job at Opus prices — the first 9 routed sessions spent
112k output tokens there against 5.9k on scout. A PreToolUse guard now asks before
letting one through; confirm only when you need a tool scout lacks.

## Step 2 — the builder's input, sized by lane

The main session owns this. Specs, failing tests, and adjudication do not get delegated —
they are the reason this session runs on the expensive model.

**Lane 1 — a brief, in the dispatch prompt. No file.** A spec file for a bounded fix is
overhead that does not pay for itself, and requiring one is why `docs/agent/specs/` held
exactly one file for the routing system's first day. Five headings, inline:

```
Task: <id> — <one line>
Contract: <inputs / outputs / error cases; what must NOT change>
Files: sources/src/...   <- exhaustive; you may touch nothing else
Verify: npm test -- <file>   (from sources/) — not done until this passes
Non-goals: <what not to do>
```

**Lane 2 — a spec file plus failing tests.** Write `docs/agent/specs/<task-id>.md` with
the same five sections expanded, add a `## Test charter` table (`| Case | Expected
outcome | Layer / file |`), and write the failing tests **before** dispatching. Pass
builder the spec path and the test path only.

Either way the `Files` list is what makes builder's scope enforceable — a PreToolUse
guard already blocks builder from tests, specs, and records, but only this list bounds
which production files it may touch.

## Step 3 — build (sonnet)

Dispatch `builder` with **only** its Step 2 input: the Lane 1 brief, or the Lane 2 spec
path plus test path. Never paste a spec file's contents — builder reads the file. Do not
add advice or context; anything extra you say competes with the spec.

Independent tasks go out as parallel `builder` calls in one turn, not sequential rounds.

## Step 4 — review (sonnet)

**The gate for ordinary work is the test passing**, not a second opinion — it is
verifiable, costs nothing extra, and builder is required to report the command and its
output. Take that as the pass and go to step 6.

**Dispatch `reviewer` when the change touches money, positions, fees, prices, auth/RLS,
persistence, schema, API contracts, background jobs, or a user-visible calculation** —
there a green test only proves the test agreed with the bug. Pass it the brief or spec
path and builder's reported file list; it returns `PASS`/`FAIL` and findings, never
fixes. At ~$0.1–0.3 a run it is cheap insurance exactly where being wrong is expensive.

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

It reports **cost** per component, per model, and per role — main thread and sidechain —
from the transcripts Claude Code already writes, plus the main session's average context
and per-turn cost. Read the per-role split, not the token columns: one model and zero
sidechain traffic means nothing was routed, whatever the plan said. That report is the
only proof that counts.
