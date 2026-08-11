# Proposed `AGENTS.md` Wrapper for Codex

Use this as a repository-root `AGENTS.md` when adopting the same workflow in Codex.
It deliberately points to the provider-neutral workflow instead of copying it.

```md
# Agent Instructions

## Workflow

Follow `docs/agents/mam/WORKFLOW.md` for task lanes, role authority, handoffs,
escalation, and verification. It is the source of truth.

- Default to Lane 1; use Lane 2 when its risk criteria apply.
- Lane 0 requires every documented condition and a stated verification command.
- The main session is the Planner and adjudicator. Scout discovers, the optional
  Lane-2 Test author writes chartered tests, Builder implements, Reviewer verifies,
  and Scribe records facts.
- Use the highest-reasoning model for the main session; use a low-cost model for Scout,
  optional Test author, and Scribe; use a balanced coding model for Builder and
  Reviewer.
- Do not pass broad chat history to a subagent. Pass the compact handoff format from
  `WORKFLOW.md` and exact file paths.

## Repository rules

<Keep this project's layout, test, versioning, and deployment rules here.>
```

## Codex mapping notes

- Implement model selection in the orchestrator or delegation configuration, not in
  `AGENTS.md`; model availability varies by account and can change.
- If separate subagents are unavailable, preserve the workflow with explicit phase
  boundaries in one session: scout notes, planner spec, test changes, implementation,
  then independent review pass.
- Codex-specific skills may replace Claude slash commands, but they must not change
  the role authority or completion criteria defined in `WORKFLOW.md`.
