---
name: clean-docs
description: Audit the three session-start hot files of stock-pnl-web (docs/agent/PROGRESS.md, TASK.md, BUG_FIX.md) against a byte budget, propose an archive plan, roll the overflow into the archive files, and prove no history was lost. The main session does every step. Use when the user asks to clean the handoff docs or says "clean-docs".
---

# clean-docs — shrink the session-start hot files

## Which variant to use

This variant runs every step in the main session. It needs no subagent, so it works in any
agent runtime.

In Claude Code, prefer **`clean-docs-cc`**. That variant sends the bulky read to
`route:scout` and the edits to `route:scribe`, which keeps the hot file content out of the
main context.

The two variants share one budget, one workflow and one lossless test. Only the executor
differs. Keep them in step when you change either file.

## What this skill owns

This skill owns the **size gate**: when to clean, how to measure, what to propose, how to
roll, and how to prove that no history was lost.

This skill does **not** own content rules. The caps in entry terms, the archive
destinations, the entry shapes, and the sub-item completion test live in the
**`bookkeeping`** skill. Load `bookkeeping` before step 4. Do not restate its rules here and
do not invent new ones.

## Scope

- In scope: `docs/agent/PROGRESS.md`, `docs/agent/TASK.md`, `docs/agent/BUG_FIX.md`.
  Only these three files load at session start, so only these three have a size cost.
- Archive targets: `PROGRESS_ARCHIVE.md`, `TASK_ARCHIVE.md`, `FIXED_BUG.md`. Archives have
  no cap. Nothing reads an archive at session start.
- Never touched: `PLAN.md`, `SPEC.md`, `specs/*`, `CHANGELOG.md`, `sources/`, `dist/`.

## The budget

| Hot file | Cap |
| ---- | ---: |
| `PROGRESS.md` | 4096 bytes |
| `TASK.md` | 8192 bytes |
| `BUG_FIX.md` | 8192 bytes |
| Total | 20480 bytes (healthy: 16384) |

Bytes are the gate. Token counts are estimates. To estimate tokens, divide bytes by 3 for
the Chinese-majority text in these files, and call the result an estimate.

CAUTION: Do not use `ls -lh`. It rounds 5240 bytes to `5.2K` and cannot decide a
20480 byte limit.

## Step 1 — measure

```bash
wc -c docs/agent/PROGRESS.md docs/agent/TASK.md docs/agent/BUG_FIX.md
```

If the total is at or below 20480 and no file is above its own cap, **stop**. Report the
numbers and "no action needed". Do not clean a file that is inside budget.

## Step 2 — build the archive plan

CAUTION: Do not read a whole hot file yet. A full read costs context on every later turn of
the session. Read headings first, then read only the entries you plan to move.

```bash
cd /root/dev/stock-pnl-web
grep -n '^## 📅 Log:' docs/agent/PROGRESS.md
grep -n '^### Task\|^- \*\*Status\*\*:' docs/agent/TASK.md
grep -n '^### ' docs/agent/BUG_FIX.md
git log -1 --format=%s   # the released version, to date the BUG_FIX entries against
```

From the headings, build the move list:

1. `PROGRESS.md` — every `## 📅 Log:` entry after the newest two.
2. `TASK.md` — every entry whose Status holds `✅`. For each surviving entry, the sub-items
   that start with `~~` **and** carry no `⏳` anywhere in their lines.
3. `BUG_FIX.md` — every entry that is fixed, obsolete, or a repeat of another entry. Keep
   open issues and accepted risks.

Read the full text of a block only when you are about to move that block.

## Step 3 — propose, then wait

Show the user, in Traditional Chinese:

1. Current bytes per file, against the cap.
2. The exact blocks to move out, by heading, per file.
3. The estimated byte total after the move.
4. One direct question: 是否執行清理？

Then stop. Do not edit a file before the user answers.

## Step 4 — roll the files

Load the `bookkeeping` skill first. Follow its entry shapes exactly.

For each of the three pairs:

1. Prepend the moved blocks to the archive file, newest first, under the archive's existing
   top heading. Never append to the bottom.
2. Delete the same blocks from the hot file.
3. In a surviving `TASK.md` entry, collapse the completed sub-items to one line after
   `- **Timestamp**`, and **never renumber the survivors**. Other documents cite them by
   number.
4. Update the `## 📍 Where the project stands` block in `TASK.md` if it names an old
   version.

Move every block. Delete nothing.

## Step 5 — prove no loss, then commit

Run the lossless test. Do not assume the result.

```bash
cd /root/dev/stock-pnl-web
wc -c docs/agent/PROGRESS.md docs/agent/TASK.md docs/agent/BUG_FIX.md
wc -c docs/agent/PROGRESS_ARCHIVE.md docs/agent/TASK_ARCHIVE.md docs/agent/FIXED_BUG.md
```

```
removed = hot_bytes_before - hot_bytes_after
added   = archive_bytes_after - archive_bytes_before
```

The test passes if `added >= removed - 512`. The 512 byte tolerance covers dropped blank
lines and merged headings. If the test fails, run `git checkout -- docs/agent/`, report the
two numbers, and do not commit.

If the test passes:

1. Run `git branch --show-current` and confirm `dev`. A parallel agent can have changed the
   branch since session start.
2. Stage `docs/agent/` only.
3. Commit, then push. Example subject:
   `docs: archive TASK.md and BUG_FIX.md history to cut session-start tokens`

## Step 6 — report

Lead with the conclusion. Then give a before/after byte table per file with the percent
reduction, the lossless test numbers, and the commit SHA.

## Traps

- A struck-through sub-item can still hold open work. The test is `~~` **and** no `⏳`. A
  test on the strikethrough alone deletes live work.
- Archives are newest-first. Append breaks the order that every other document assumes.
- This repo is public. A `BUG_FIX.md` block can hold Edge output or `cron.job` command text.
  Move the block unchanged, and never re-paste command text into a commit message, an
  Issue, or a Release body.
- Do not run this skill out of habit at session start. The end-of-task bookkeeping already
  rolls the files. Run it when step 1 shows a file above its cap.
