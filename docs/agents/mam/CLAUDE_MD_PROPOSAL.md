# Proposed `CLAUDE.md` Replacement Sections

Keep existing repository, memory, versioning, and environment sections. Replace the
current task-routing section with the following text, then update the individual
agent files to match the role boundaries in `docs/agents/mam/WORKFLOW.md`.

```md
## Default delivery workflow

`docs/agents/mam/WORKFLOW.md` is the source of truth for task classification, role
authority, handoffs, escalation, and verification.

- Default to Lane 1. Use Lane 2 for unknown-cause bugs, cross-module work, financial
  calculations, auth, schema, external APIs, background jobs, deployment, or other
  elevated-risk changes.
- Lane 0 is allowed only when every condition in `WORKFLOW.md` is met. If a tracked
  task uses Lane 0, record the reason in `docs/agent/PROGRESS.md`.
- The main session is the premium Planner and adjudicator. It owns contract decisions,
  test strategy, scope conflicts, and review adjudication; do not start an Architect
  agent by default.
- Scout owns discovery. Later roles consume its compact handoff and read only files
  required for their bounded responsibility.
- In Lane 1, Builder adds the tests named by the approved charter. Use an independent
  Test author only in Lane 2 when test independence materially reduces risk.
- Sonnet Reviewer is mandatory after Builder work and checks scope, test integrity,
  command results, and correctness against the contract.
- A task is complete only after its required checks pass, its required review passes,
  and its durable records are updated from verified facts.

## Model allocation

Use the cheapest reliable model for each role:

| Role | Tier |
| --- | --- |
| Scout, optional Test author, Scribe | Low-cost |
| Builder, Reviewer | Mid-cost |
| Main session: Planner and adjudicator | Premium |

Model configuration belongs in agent frontmatter and the model mapping file; do not
duplicate model names here.
```

## Required agent-file changes before adoption

1. Make the main session the Planner and adjudicator. Keep `architect` only as an
   optional fallback when the main session cannot use the premium model.
2. Add a low-cost `test-author` only for Lane 2. It may edit only test files named in
   an approved charter and must stop on ambiguity.
3. Keep one Sonnet `reviewer`; it owns both scope/test-integrity checks and correctness
   review. Do not use Haiku for review verdicts.
4. Ask Scout only for a new task or unclear scope. The main-session Planner may inspect
   exact files needed to settle an ambiguity in the Scout handoff.
5. Let Builder add chartered tests in Lane 1. Retain scope restrictions and reserve
   independent test writing for Lane 2.
