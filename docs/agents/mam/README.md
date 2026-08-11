> **SUPERSEDED 2026-08-11.** Adopted, in a different shape: the workflow now lives in
> `.claude/skills/route/SKILL.md` and is enforced by hooks rather than by prose.
> Only `AGENTS_MD_PROPOSAL.md` (Codex portability) remains an open idea.

# Token-Efficient Agent Design

These are proposed files only. They do not replace the current project rules until
their content is intentionally merged into the relevant instruction files.

The design keeps the existing separation of responsibilities, but changes the cost
model:

- The main session uses the strongest model only for decisions that need judgement:
  contracts, trade-offs, test strategy, and conflict adjudication.
- Cheap models gather facts, write tests from an approved test charter, run mechanical
  checks, review scope, and maintain records.
- A capable mid-cost model implements bounded production changes.

`WORKFLOW.md` is provider-neutral and should be the single source of truth. The
`CLAUDE_MD_PROPOSAL.md` and `AGENTS_MD_PROPOSAL.md` files are intentionally thin
provider wrappers. Keeping workflow rules outside either tool makes the same process
portable to Claude Code and Codex.

## Suggested model mapping

| Responsibility | Claude Code default | Codex equivalent | Reason |
| --- | --- | --- | --- |
| Scout, optional test author, scribe | Haiku | low-cost / fast model | Work is bounded, factual, and template-driven. |
| Builder, reviewer | Sonnet | balanced coding model | Code edits and review both need reliable reasoning. |
| Main session: planner and adjudicator | Opus | highest-reasoning model | Retains user context and makes costly decisions without another agent handoff. |

Model names are examples, not workflow rules. Select the cheapest model that has
demonstrated reliable performance for the responsibility in this repository.
