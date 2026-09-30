---
name: clean-docs
description: Archive and shrink the session-start hot files of stock-pnl-web (docs/agent/PROGRESS.md, TASK.md, BUG_FIX.md) against a byte budget — measure, sort every entry to FIXED_BUG.md / ACCEPTED_RISKS.md / TASK_ARCHIVE.md / PROGRESS_ARCHIVE.md, propose the plan, roll it, and prove no history was lost. The main session does every step. Use when the user asks what can be archived, asks to clean or shrink the handoff docs, says 歸檔 or "clean-docs", or when a hot file is over its cap.
---

# clean-docs — shrink the session-start hot files

This skill runs every step in the main session. It needs no subagent, so it works in any
agent runtime.

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
- Archive targets: `PROGRESS_ARCHIVE.md`, `TASK_ARCHIVE.md`, `FIXED_BUG.md`,
  `ACCEPTED_RISKS.md`. Archives have no cap. Nothing reads an archive at session start.
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
cd "$(git rev-parse --show-toplevel)"
grep -n '^## 📅 Log:' docs/agent/PROGRESS.md
grep -n '^### Task\|^- \*\*Status\*\*:' docs/agent/TASK.md
grep -n '^### ' docs/agent/BUG_FIX.md
git log -1 --format=%s   # the released version, to date the BUG_FIX entries against
```

From the headings, build the move list:

1. `PROGRESS.md` — every `## 📅 Log:` entry after the newest two, **and** see
   § The newest entry can be the overflow.
2. `TASK.md` — every entry whose Status holds `✅`. For each surviving entry, the sub-items
   that start with `~~` **and** carry no `⏳` anywhere in their lines.
3. `BUG_FIX.md` — sort every entry into exactly one of three destinations. Read its
   `- **Status**:` line; do not judge by the `BUG-` / `RISK-` prefix, which says nothing about
   state.

| The entry is | Goes to | Test |
| ---- | ---- | ---- |
| Fixed, released, verified | `FIXED_BUG.md` | Nothing left to build. A remaining *user preference* does not keep it open — move it and leave a one-line `TASK.md` item for the person |
| Accepted / won't-fix / monitored | `ACCEPTED_RISKS.md` | Status holds `ACCEPTED`, `已接受`, `不修`, `low severity`, `monitored`, or `OPEN (accepted)` — the decision is already taken |
| Still needs doing | stays in `BUG_FIX.md` | Someone has to write code, and no one has decided not to |

Anything that is not a bug at all — a checklist, a rotation reminder, an operating note —
goes to `ACCEPTED_RISKS.md` under its own `## 📌 Standing operational notes` heading. It is
not a risk, but it is not session-start material either.

Read the full text of a block only when you are about to move that block.

## The newest entry can be the overflow

`PROGRESS.md` has two caps and they disagree. `bookkeeping` caps it at **the newest two log
entries**; this skill caps it at **4096 bytes**. A single verbose entry satisfies the first and
blows the second — one 4689-byte entry did exactly that on 2026-09-30, on its own larger than
the whole budget.

Rolling older entries cannot fix that. Compress the newest entry instead, and it is safe to do
so: by the time this skill runs, the same work is already written up in `FIXED_BUG.md`,
`TASK_ARCHIVE.md` and `CHANGELOG.md`. `PROGRESS.md` only has to carry what the **next session**
needs before it reads anything else:

- the conclusion, in one or two sentences;
- the one or two non-obvious facts a reader would otherwise re-derive (the evidence that
  settled it, the thing that was rejected and why);
- what is still open, named explicitly;
- pointers — `FIXED_BUG.md` BUG-nnn, `CHANGELOG.md` x.y.z — instead of the detail itself.

Target 1500–2000 bytes per entry. Cut the reasoning that led to the answer and keep the answer;
cut file-by-file change lists, which `git show` gives for free.

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
5. When a block moves to `FIXED_BUG.md`, keep its `- **Status**:` line readable in the new
   file: prefix it with `✅ FIXED (<version>)` and say when and why it left `BUG_FIX.md`, then
   keep the original wording after it. A moved block that still says only "Front end released
   in 0.10.5" reads like an open bug in the fixed file.
6. Leave a pointer where the reader will look. A hot file that lost a whole class of entries
   gets one blockquote under its top heading naming the new destination — otherwise the next
   agent "discovers" a risk that was decided a year ago and opens it again.

Move every block. Delete nothing. Rewrite a block's text only where step 5 says to.

Do the edits with a Python script over the whole file, not one `sed` per block: cutting a block
means finding its heading and the *next* heading at the same level, and a regex written per
block silently takes the wrong slice when two headings share a prefix (`RISK-01` and `RISK-010`).

## Step 5 — prove no loss, then commit

Run the lossless test. Do not assume the result, and do not rely on remembering the "before"
numbers — read them from `git`, which cannot misremember:

```bash
cd "$(git rev-parse --show-toplevel)"
python3 - <<'PY'
import subprocess
hot  = ['docs/agent/PROGRESS.md', 'docs/agent/TASK.md', 'docs/agent/BUG_FIX.md']
arch = ['docs/agent/PROGRESS_ARCHIVE.md', 'docs/agent/TASK_ARCHIVE.md',
        'docs/agent/FIXED_BUG.md', 'docs/agent/ACCEPTED_RISKS.md']
def before(f):
    r = subprocess.run(['git', 'show', 'HEAD:' + f], capture_output=True)
    return len(r.stdout) if r.returncode == 0 else 0   # 0 = the file is new in this cleanup
def after(f):
    try:
        return len(open(f, 'rb').read())
    except FileNotFoundError:
        return 0
removed = sum(before(f) for f in hot)  - sum(after(f) for f in hot)
added   = sum(after(f) for f in arch) - sum(before(f) for f in arch)
print(f'removed={removed} added={added}', 'PASS' if added >= removed - 512 else 'FAIL')
PY
```

The test passes if `added >= removed - 512`. The 512 byte tolerance covers dropped blank
lines and merged headings. A *compressed* `PROGRESS.md` entry breaks this test on purpose —
its bytes are cut, not moved — so when step 4 compressed an entry, subtract the bytes you cut
from `removed` before comparing, and say in the report that you did and why the detail is safe
to lose (it is already in `FIXED_BUG.md` / `CHANGELOG.md`).

If the test fails for any other reason, run `git checkout -- docs/agent/`, report the two
numbers, and do not commit.

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
- An accepted risk is **not** a fixed bug. `FIXED_BUG.md` claims the thing was fixed;
  `ACCEPTED_RISKS.md` says it was understood and deliberately left. Filing one as the other
  makes the record lie, in the direction that hides a live risk.
- `ACCEPTED_RISKS.md` is where the accepted risks are *looked up*, not just stored. Give it a
  header that says so and tells a reader to `grep` it before opening a bug, or the next agent
  re-finds RISK-016 and writes RISK-022.
- A `BUG-` prefix does not mean open and a `RISK-` prefix does not mean accepted. Read the
  `- **Status**:` line for every single entry.
- Archives are newest-first. Append breaks the order that every other document assumes.
- This repo is public. A `BUG_FIX.md` block can hold Edge output or `cron.job` command text.
  Move the block unchanged, and never re-paste command text into a commit message, an
  Issue, or a Release body.
- Do not run this skill out of habit at session start. The end-of-task bookkeeping already
  rolls the files. Run it when step 1 shows a file above its cap.
