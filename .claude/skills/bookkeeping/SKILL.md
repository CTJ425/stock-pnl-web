---
name: bookkeeping
description: Roll and record the docs/agent/ tracking files of stock-pnl-web — PROGRESS.md, TASK.md, BUG_FIX.md. Use at the end of every task, before dispatching scribe, to get the size caps, the archive destinations, the entry shapes, and the sub-item completion test.
---

# docs/agent/ bookkeeping

Load this skill before you compose a `scribe` brief. A subagent does not load this file —
paste the rules it needs into the brief verbatim.

## Where each record goes

| File | Use |
| ---- | ---- |
| `PROGRESS.md` | Latest status (**read top only**); older → `PROGRESS_ARCHIVE.md` |
| `TASK.md` | Active tasks; done → `TASK_ARCHIVE.md` |
| `BUG_FIX.md` / `FIXED_BUG.md` | Open / fixed bugs |
| `PLAN.md` / `SPEC.md` | Architecture / requirements (on demand) |
| `CHANGELOG.md` | Version history |
| `specs/<id>.md` | Per-task specs if present |

### Size discipline — roll, don't hope

The hot files are the ones read at session start, so they are the only ones with a size cost.
There is **no automatic archiver**: rolling happens in the same `scribe` dispatch that records
the work, at the end of every task.

| Hot file | Cap | Overflow goes to |
| ---- | ---- | ---- |
| `PROGRESS.md` | header + **newest 2 log entries** | `PROGRESS_ARCHIVE.md` (prepend, newest-first) |
| `TASK.md` | open entries only; a `✅` entry is moved out, and inside a live entry the `~~struck~~ ✅` sub-items collapse to one `- **Done**: items …` line | `TASK_ARCHIVE.md` |
| `BUG_FIX.md` | open bugs only | `FIXED_BUG.md` |

The archives are large **and that is fine** — nothing reads them at session start, so they cost
nothing until `grep`ped, and `grep`/`git log -S` over local files is the cheapest retrieval this
project has. Moving them to GitHub Issues/Releases was evaluated and **rejected**; do not re-propose
it without reading the measured verdict in `docs/plan/github_documentation_strategy.md`.

### Entry shapes, and the sub-item test that must not be shortened

Match the entries already in each file — they are the specification. The shapes in use:

```markdown
docs/agent/TASK.md — under `## 📋 Active Tasks`
### Task 77: Short imperative title
- **Status**: 🔄 IN PROGRESS | ✅ DONE | 🔁 Recurring
- **Agent**: Claude
- **Timestamp**: 2026-08-07 14:30:00 Asia/Taipei
- **Spec**: docs/agent/specs/task-77.md

docs/agent/FIXED_BUG.md — newest first under `## 🐛 Historical Bug Fixes`
### Bug ID: BUG-023 — One-line symptom
- **Date**: 2026-08-07, fixed in 0.6.44
- **Root Cause**: … / **Fix**: … / **Status**: ✅ FIXED (0.6.44)

docs/agent/PROGRESS.md — newest entry at the top, right after the header block
## 📅 Log: 2026-08-07 14:30:00 Asia/Taipei (Task 77, 0.6.44)
```

Rolling a live `TASK.md` entry's sub-items has two conditions and **both** matter: a sub-item is
complete **iff it starts with `~~` AND carries no `⏳` anywhere in its lines**. This file is full of
items like ``4. ~~Commit (bundled in f03ade5)~~ ✅ · **push `dev`** —— ⏳`` that open struck through
and end with live work; testing the strikethrough alone silently deletes an open action. Completed
ones go to `TASK_ARCHIVE.md` under `### Task NN — completed sub-items (rolled from TASK.md
<timestamp>)`, and the entry keeps one line after its `- **Timestamp**` reading
``- **Done**: items <numbers> — full text in `TASK_ARCHIVE.md`.`` **Never renumber the survivors** —
other documents cite them as "item 7", "item 11".

