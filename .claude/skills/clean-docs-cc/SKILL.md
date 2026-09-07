---
name: clean-docs-cc
description: Claude Code variant of clean-docs. Audit the three session-start hot files of stock-pnl-web (docs/agent/PROGRESS.md, TASK.md, BUG_FIX.md) against a byte budget, then delegate the audit to route:scout and the edits to route:scribe. Use in Claude Code when the user asks to clean the handoff docs or says "clean-docs-cc". Use the plain `clean-docs` skill where the route subagents do not exist.
---

# clean-docs-cc — shrink the session-start hot files (Claude Code)

## Which variant to use

This variant delegates. It needs the `route` plugin subagents `route:scout` and
`route:scribe`. If a dispatch fails because a subagent does not exist, stop and use the
plain **`clean-docs`** skill, which runs every step in the main session.

The two variants share one budget, one workflow and one lossless test. Only the executor
differs. Keep them in step when you change either file.

## What this skill owns

This skill owns the **size gate**: when to clean, how to measure, what to propose, who
executes, and how to prove that no history was lost.

This skill does **not** own content rules. The caps in entry terms, the archive
destinations, the entry shapes, and the sub-item completion test live in the
**`bookkeeping`** skill. Load `bookkeeping` in step 4. Do not restate its rules here and
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
cd /root/dev/stock-pnl-web && wc -c docs/agent/PROGRESS.md docs/agent/TASK.md docs/agent/BUG_FIX.md
```

If the total is at or below 20480 and no file is above its own cap, **stop**. Report the
numbers and "no action needed". Do not clean a file that is inside budget.

## Step 2 — build the archive plan

CAUTION: Do not read the three files in this session. `guard.readKB` is 0 in
`.claude/route.config.json`, so an unbounded Read asks first, and the content is billed
again on every later turn of the session.

Dispatch `route:scout` with this brief:

```
Read docs/agent/PROGRESS.md, docs/agent/TASK.md and docs/agent/BUG_FIX.md. Report only:
1. PROGRESS.md — the heading text of every "## Log:" entry, in file order, with the byte
   size of each entry.
2. TASK.md — for each "### Task NN" entry: title, Status value, and open or closed. For
   each open entry, list the sub-item numbers that start with "~~" AND carry no hourglass
   emoji anywhere in their lines.
3. BUG_FIX.md — for each entry: ID, one-line symptom, and state (open / fixed / accepted
   risk). Mark each entry whose fix version is older than the newest version heading in
   docs/agent/CHANGELOG.md.
4. Any block that repeats another block in the same file.
Report headings and names only. Do not quote command text, tokens, keys or URLs.
Do not edit any file.
```

## Step 3 — propose, then wait

Show the user, in Traditional Chinese:

1. Current bytes per file, against the cap.
2. The exact blocks to move out, by heading, per file.
3. The estimated byte total after the move.
4. One direct question: 是否執行清理？

Then stop. Do not edit a file before the user answers.

## Step 4 — execute

Do not hand-edit the tracking files in this session. The CLAUDE.md role table gives
`docs/agent/` bookkeeping to `scribe`.

1. Load the `bookkeeping` skill.
2. Dispatch `route:scribe`. A subagent does not load skills, so paste into the brief:
   - the exact file paths;
   - the approved heading list to move, per file;
   - the destination per file, **prepend, newest first**;
   - the sub-item collapse rule and the "never renumber the survivors" rule, verbatim
     from `bookkeeping`;
   - this constraint: move every block into an archive file; delete nothing;
   - the Verify line: `wc -c` over all six files.
3. Ask `scribe` for a conventional commit message. Do not let `scribe` commit.

## Step 5 — prove no loss, then commit

Run the lossless test. Do not assume the result.

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
3. Commit with the `scribe` message, then push.

## Step 6 — report

Lead with the conclusion. Then give a before/after byte table per file with the percent
reduction, the lossless test numbers, and the commit SHA.

## Traps

- A struck-through sub-item can still hold open work. The test is `~~` **and** no hourglass
  emoji. A test on the strikethrough alone deletes live work.
- Archives are newest-first. Append breaks the order that every other document assumes.
- This repo is public. A `BUG_FIX.md` block can hold Edge output or `cron.job` command text.
  Move the block unchanged, and never re-paste command text into a commit message, an
  Issue, or a Release body.
- Do not run this skill out of habit at session start. Every `scribe` dispatch already rolls
  the files. Run it when step 1 shows a file above its cap.
