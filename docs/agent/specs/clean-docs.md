# Spec: clean-docs skill

- **Status**: ✅ SPECIFIED
- **Date**: 2026-09-07
- **Implements**: two variants of one workflow
  - `.claude/skills/clean-docs-cc/SKILL.md` — Claude Code only; delegates
  - `.claude/skills/clean-docs/SKILL.md` — generic; the main session runs every step
  - `.gemini/skills/clean-docs/SKILL.md` — byte-identical mirror of the generic variant

## Problem

Three files load at every session start: `docs/agent/PROGRESS.md`, `TASK.md` and
`BUG_FIX.md`. Without a periodic roll, they collect closed tasks, deferred decisions, old
fix notes and repeated warnings. The three files reached 45.3 KB once. Cost in this project
is context replay, so every extra KB is billed again on every later turn of the session.

## Decision

Add a `clean-docs` skill that owns the **size gate only**:
measure, propose, roll, prove no loss, report.

### Two variants, one workflow

| Variant | Runtime | Audit (step 2) | Edits (step 4) |
| ---- | ---- | ---- | ---- |
| `clean-docs-cc` | Claude Code with the `route` plugin | `route:scout` | `route:scribe` |
| `clean-docs` | any agent runtime | main session, heading `grep` first | main session |

The budget, the 6-step workflow, the lossless test and the traps are identical. Only the
executor differs. A change to one file needs the same change in the other.

`clean-docs-cc` exists because cost in this project is context replay: `guard.readKB` is 0,
and hot file content read into the main session is billed again on every later turn.
`clean-docs` exists because `route:scout` and `route:scribe` do not exist outside Claude
Code, and a failed dispatch must not block the clean-up.

The skill does not own content rules. Caps in entry terms, archive destinations, entry
shapes and the sub-item completion test stay in the `bookkeeping` skill, which is the
single source of truth. `clean-docs` points to `bookkeeping`; it does not copy it.

### Budget

| Hot file | Cap |
| ---- | ---: |
| `PROGRESS.md` | 4096 bytes |
| `TASK.md` | 8192 bytes |
| `BUG_FIX.md` | 8192 bytes |
| Total | 20480 bytes (healthy: 16384) |

Bytes are the gate, measured with `wc -c`. `ls -lh` rounds and cannot decide the limit.
Token figures are estimates only.

## Constraints

1. **No script.** The skill is a prompt SOP. It adds no file to maintain.
2. **In `clean-docs-cc`, the main session does not edit tracking files.** The CLAUDE.md
   role table gives `docs/agent/` bookkeeping to `scribe`. Step 4 dispatches `route:scribe`
   with a verbatim brief, because a subagent does not load skills.
3. **The audit stays small.** `clean-docs-cc` dispatches `route:scout`, which returns
   headings and byte sizes only. `clean-docs` greps headings first and reads a block only
   before it moves that block.
4. **User confirmation is a hard gate.** Step 3 stops and asks before any edit.
5. **Lossless history.** Step 5 tests `archive_added >= hot_removed - 512` before the
   commit. A failed test triggers `git checkout -- docs/agent/` and no commit.
6. **Mirror parity.** The two `clean-docs` copies stay byte-identical. `clean-docs-cc`
   has no mirror, because it depends on Claude Code subagents.

## Rejected

- Restating the `bookkeeping` caps and entry shapes inside `clean-docs`. Two copies drift,
  and the drift is silent.
- Letting `scribe` commit. The lossless test must run before the commit, not after.
- One skill with a runtime branch inside it. The delegated path and the inline path differ
  in three of six steps, so one file would need a condition in every step.
