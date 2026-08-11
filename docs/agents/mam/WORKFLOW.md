> **SUPERSEDED 2026-08-11 — NOT IN EFFECT.** The live workflow is the `route` skill
> (`.claude/skills/route/SKILL.md`), enforced by `.claude/hooks/routing_guard.py`.
> Kept for the lane rationale only; do not follow the role table or handoff formats
> below, they disagree with `.claude/agents/*.md`.

# Token-Efficient Default Workflow

## Goal

Preserve independent planning, implementation, verification, and record keeping
while keeping premium-model calls rare and small.

## Cost policy

1. The main session is the premium Planner. A normal task starts no separate premium
   planning agent.
2. No role performs a second broad codebase scan. The Scout owns discovery; later
   roles receive its handoff and read only exact files needed for their work.
3. Start with the cheapest role that can produce a deterministic output. Escalate
   only on explicit triggers below.
4. Do not spend planner tokens on documentation-only, typo-only, or one-file
   mechanical edits with an obvious verification command.
5. Do not add a semantic review merely because a review role exists. Run it when the
   risk policy requires it.

## Roles and authority

| Role | Default cost tier | May do | Must not do |
| --- | --- | --- | --- |
| Scout | low | Map files, symbols, callers, tests, and commands; compress logs | Recommend a design or edit files |
| Main session / Planner | premium | Set contract, scope, risks, test charter, and acceptance criteria; adjudicate blockers | Implement delegated production code or broadly rediscover the codebase |
| Test author | low | Turn an approved test charter into focused failing tests | Change production code or reinterpret the contract |
| Builder | mid | Implement the approved spec, add Lane 1 tests, and run named checks | Widen scope or redesign |
| Reviewer | mid | Check scope, test integrity, command results, and correctness against the contract | Edit code or replace the Planner's decisions |
| Scribe | low | Record facts from verified handoffs | Infer status, causes, or missing results |
| Main agent | any | Classify, delegate, enforce authorization, and communicate with the user | Bypass workflow boundaries without recording why |

The Planner owns the test *charter*. The Test author is optional and used only in
Lane 2 when test independence materially reduces risk; otherwise the Builder writes
the tests named by the charter.

## Task lanes

### Lane 0: inline work

Use only when all conditions are true:

- The requested behaviour is unambiguous.
- The change is documentation-only, copy-only, formatting-only, or a small isolated
  mechanical edit.
- It changes no auth, schema, financial calculation, external API, deployment, or
  user-data behaviour.
- The main agent can name the verification command before editing.

Path: `main agent -> targeted verification -> scribe when a durable record is needed`.

Record the reason for using Lane 0 in `PROGRESS.md` if a task record exists.

### Lane 1: bounded implementation (default)

Use for a clear fix or feature confined to known modules.

1. Ask Scout for a map only when the affected area is not already known.
2. The main session produces a compact spec and test charter.
3. Builder implements only the approved scope and adds the chartered tests.
4. Reviewer runs the mandatory gate.
5. Scribe records verified facts.

### Lane 2: elevated-risk change

Use for an unknown-cause bug, cross-module behaviour, financial calculation, auth,
schema migration, external service, concurrent state, deployment, or a change with a
high cost of failure.

Path: `Scout -> Main-session Planner -> optional Test author -> Builder -> Reviewer
-> Main-session adjudication -> Scribe`.

Main-session adjudication occurs only when Reviewer reports a blocker, the Test author
cannot encode the charter, or Builder reports a spec conflict. A PASS does not need a
second planning pass.

## Escalation triggers

Escalate to the Planner only for one of these events:

- The Scout finds multiple plausible owners or an unresolved boundary.
- The requirements conflict with existing behaviour or durable project decisions.
- A test cannot express the requested contract without choosing a design.
- The Builder needs a file outside the approved scope.
- A Reviewer blocker is real but the correct resolution is unclear.
- The same task has failed one implementation round. On the second failure, stop and
  revise or split the spec; do not start a third blind implementation round.

Escalate from mechanical to semantic review when the changed area includes money,
positions, fees, prices, auth/RLS, persistence, schema, API contracts, background
jobs, concurrency, or user-visible calculation results.

## Compact handoffs

Every handoff must be self-contained and avoid pasted source code unless an exact
signature, value, or error message is required.

### Scout handoff (maximum 25 lines)

```text
TASK: <id>
ENTRY: <path:line>
TOUCHES: <path:line — role in behaviour>
TESTS: <path — existing coverage and named gap>
COMMANDS: <exact targeted command>; <full gate if needed>
CONSTRAINTS: <existing invariant, compatibility, or environment constraint>
UNKNOWN: <empty, or a concrete unresolved fact>
```

### Planner spec (maximum 60 lines excluding a test table)

```markdown
# <id>: <title>

## Contract
- Precise inputs, outputs, error behaviour, and unchanged behaviour.

## Scope
- `path` — create | modify, with a one-line purpose.

## Non-goals
- Explicitly forbidden changes.

## Test charter
| Case | Expected outcome | Layer / file |
| --- | --- | --- |

## Acceptance
- [ ] Targeted command: `<command>`
- [ ] Required full gate: `<command or not required>`
```

### Builder handoff

```text
TASK: <id>
STATUS: DONE | BLOCKED
FILES: <actual production files changed>
TESTS: <pass/fail counts and exact commands>
BLOCKER: <empty or one factual paragraph>
```

### Reviewer handoff

```text
TASK: <id>
VERDICT: PASS | FAIL
FINDINGS:
- [BLOCKER] path:line — factual violation
- [RISK] path:line — stated failure condition
```

## Mandatory verification

The Builder runs the targeted tests. The Sonnet Reviewer independently checks:

- the actual changed-file list against the approved scope;
- whether any test was changed outside the test charter;
- that the named commands and results are present;
- the acceptance checklist.

For frontend, Edge, or deployment work, select the relevant existing verification
skill. Production deployment still requires explicit user authorization.

## Provider portability

This document does not depend on slash commands or a specific agent tool. Claude Code
may map the roles to `.claude/agents/*.md`; Codex may map them to its available agents
and place the thin wrapper in `AGENTS.md`. In both tools, make the main session the
Planner and pass compact handoffs to delegated agents rather than full conversation
history.
