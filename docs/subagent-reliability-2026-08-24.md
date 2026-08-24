# Subagent hook and timeout behaviour — session retrospective, 2026-08-24

Supplementary note, not part of `docs/agent/` memory. It records what the routing subagents actually
did during the 0.9.11 / 0.9.12 session (backup feature, admin console, restore), specifically the
hook messages and the stalls. Everything here was observed in one session; treat sample sizes
accordingly.

## Scoreboard

19 dispatches: 18 completed, 1 killed by the main session.

| # | Role | Task | Wall | Tools | Tokens | Outcome |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | scout | map backup code | 59s | 26 | 42.5k | ok |
| 2 | builder | backup fn phase 1 | 2m52s | 30 | 43.5k | ok |
| 3 | reviewer | backup fn phase 1 | 1m02s | 12 | 28.8k | PASS + RISK |
| 4 | builder | 3 review fixes | 35s | 11 | 19.9k | ok |
| 5 | scribe | record phase 1 | 3m08s | 21 | 45.2k | ok |
| 6 | scribe | record DEV deploy | 2m57s | 20 | 52.2k | ok |
| 7 | scout | map admin UI | 53s | 16 | 32.4k | ok |
| 8 | builder | admin console | 9m51s | 65 | 84.9k | **final report truncated** |
| 9 | reviewer | admin console | 1m19s | 22 | 37.5k | PASS + RISK |
| 10 | builder | RISK-001 | 1m04s | 15 | 27.6k | ok |
| 11 | reviewer | RISK-001 + signed URL | 1m35s | 17 | 35.8k | **FAIL — false positive** |
| 12 | builder | signed-URL origin | 45s | 13 | 24.8k | ok |
| 13 | scribe | record 0.9.11 | **≥34m** | — | — | **killed, zero writes** |
| 14 | scribe | record 0.9.11 (retry) | 3m20s | 22 | 49.4k | ok |
| 15 | scribe | close task 131 | 1m29s | 12 | 28.0k | ok |
| 16 | builder | restore feature | 5m13s | 34 | 61.6k | ok |
| 17 | reviewer | restore feature | 1m48s | 16 | 41.3k | PASS + RISK |
| 18 | builder | partial-failure message | **86m24s** | 13 | 30.3k | ok, but see below |
| 19 | scribe | record 0.9.12 | 3m02s | 26 | 47.1k | ok |

Totals across the 18 completed dispatches: **128 minutes** of subagent wall time, **733k** subagent
tokens. Median dispatch: **1.7 minutes**.

## Finding 1 — two dispatches consumed most of the wall time

Dispatch 18 ran **86 minutes** for 13 tool calls and 30k tokens. Dispatch 12 did structurally
identical work — a small, well-specified edit to two files — in **45 seconds** with the same 13 tool
calls. Same role, same shape of task, **116× the wall time**.

Dispatch 18 alone is **51× the median** and **67% of all subagent wall time** in the session. Add
the killed dispatch 13 and the two anomalies account for roughly **74%** of it.

The work itself was correct: dispatch 18 returned a clean report, its tests passed, and independent
re-verification in the main session agreed. Nothing in its output explains the wall time, and its
tool count rules out "it did a lot of work slowly". This reads as a stall in the agent runtime, not
as an expensive task.

**What this costs.** Wall time is not billed, but it blocks the pipeline: the main session cannot
adjudicate, deploy, or commit until the dispatch returns. During dispatch 13 the harness itself
noticed, emitting a goal check-in that said evaluation had been deferred 34 minutes because
background work was still running.

**Practical rule.** A dispatch whose wall time passes roughly 10× the median for its role is not
"nearly done" — check it. Progress is measurable without reading the subagent transcript (which is a
JSONL file large enough to overflow the caller's context): `git status` and file mtimes show whether
it has written anything. Dispatch 13 had written **nothing** after 34 minutes.

## Finding 2 — the routing PostToolUse hook fires at dispatch, not at completion

The `route` plugin's `PostToolUse:Agent` hook emits:

> `[routing]` `builder` just returned. Before moving on, apply the Step 4 review policy…

That text arrived attached to the **launch** result — the same tool result that says
`Async agent launched successfully` — and did so for 6 of the 7 `route:builder` dispatches. Since
these agents run in the background, the `Agent` tool call returns at launch, so `PostToolUse` fires
there. The builder has not returned; it has barely started.

The reminder is still useful, but its wording invites the wrong move: applying the Step 4 review
policy at that instant means dispatching a reviewer against files that do not exist yet. The correct
reading is "you have just dispatched a builder; plan for review", and review must wait for the
completion notification.

The hook did not fire for `scout`, `reviewer`, or `scribe` dispatches.

## Finding 3 — a killed agent still reports its last thought, and that is the diagnostic

`TaskStop` on dispatch 13 produced a normal task-notification with `status: killed` and a `result`
field containing the agent's final words:

> Now I'll record the release following the size-discipline rolling rules. Let me work in the
> correct order: destination files first, then source files.
> **Step 1: Prepend oldest PROGRESS.md entry to PROGRESS_ARCHIVE.md**

Thirty-four minutes in, still announcing step 1 of four. That single line is what identified this as
a stall rather than slow progress, and it costs nothing to obtain — unlike the `.output` transcript,
which must not be read.

The retry succeeded in 3m20s. Its prompt was roughly 40% shorter, with the same four edits stated as
a numbered list instead of prose. One session is not evidence that prompt length caused the stall,
but shortening the brief is free and the retry is the only data point available.

## Finding 4 — builders report the caller's dirty working tree as a blocker

Dispatches 10, 12, 16 and 18 each ended with a `BLOCKERS:` section listing files the main session had
modified — version bumps, other builders' output, test files written before dispatch. Example:

> `git status` shows `README.md`, `package.json`, `package-lock.json`, and `src/version.ts` already
> modified before I started. None of these are in my `Files` list; I left them untouched.

The behaviour is correct — the agent stayed in scope and said so — but it makes every report end with
an alarming heading that has to be read and dismissed. When dispatching into a tree that already has
unrelated changes, say so in the brief so the agent classifies it as context rather than as a blocker.

## Finding 5 — a reviewer without the process rule returns a false FAIL

Dispatch 11 returned **FAIL** with two BLOCKERs, both of the form "test file modified but not in the
builder's `Files` list". Both test files were written by the **main session before dispatch**, which
is this project's documented Lane 2 flow; the builders never touched them. The reviewer applied
"test files changed outside scope ⇒ automatic FAIL" without knowing who wrote them.

Its substantive analysis in the same response was thorough and found no defect, so the verdict was
adjudicated to PASS. Later reviewer dispatches carried one sentence stating that the main session
owns the tests, and the false positive did not recur.

**Rule.** A reviewer inherits no memory of the dispatch protocol. If the process allows a file to
change outside the builder's scope, the reviewer has to be told, or it will correctly apply a rule it
should not be applying.

## Finding 6 — a completed agent can still return an unusable report

Dispatch 8 finished with `status: completed` after 9m51s and 65 tool calls, but its final report was:

> Line 641 confirms it. Let's inspect context.

Not a completion report — a thought cut off mid-investigation. The work had in fact landed: the files
existed and the tests were nearly all green. But the report could not be trusted or parsed, so the
main session re-derived the state itself with `git status` and a test run, and found two genuinely
failing tests the report would have had to mention.

**Rule.** `status: completed` describes the process, not the answer. A report that does not contain
the agreed fields — files, test counts, verify line — has not reported, and the caller has to verify
directly. That verification is cheap and should arguably be unconditional.

## What to change

1. Treat wall time as a monitored signal. Past ~10× the role's median, check for written files rather
   than waiting.
2. Read the routing hook's "just returned" as "just dispatched". Review only after the completion
   notification.
3. Keep scribe briefs short and enumerated. The one long prose brief is the one that stalled.
4. Tell a builder when the working tree is already dirty for unrelated reasons.
5. Tell a reviewer which files the main session owns.
6. Verify a builder's claims independently regardless of its reported status; a green report and a
   green suite are not the same thing.
