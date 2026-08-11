# CLAUDE.md

Agent rules for **stock-pnl-web** (stock P&L + after-hours TW reports). Keep this file short; details live in skills and `docs/`.

## Layout

- App root: **`sources/`** — all `npm` / vitest / playwright from here.
- Repo root: `CLAUDE.md`, `README.md`, `docs/`, `.claude/`.
- Feature code near the feature; `utils`/`lib` only for truly shared code. No template-only dirs.

## Memory (`docs/agent/`)

Persist important state here so the next agent does not need chat history.

| File | Use |
| ---- | ---- |
| `PROGRESS.md` | Latest status (**read top only**); older → `PROGRESS_ARCHIVE.md` |
| `TASK.md` | Active tasks; done → `TASK_ARCHIVE.md` |
| `BUG_FIX.md` / `FIXED_BUG.md` | Open / fixed bugs |
| `PLAN.md` / `SPEC.md` | Architecture / requirements (on demand) |
| `CHANGELOG.md` | Version history  |
| `specs/<id>.md` | Per-task specs if present |

Also: `docs/UnitTests/` (testing SoT), `docs/architecture/`.

**Agent-written docs are English** (see global rule 1).

## Start of session

Read (on demand, keep context small):

1. `docs/agent/PROGRESS.md` — top only  
2. `docs/agent/TASK.md`  
3. `docs/agent/BUG_FIX.md`  

Then inspect code you will touch. Do not assume chat has full state.

## Work style

- After work: update `TASK.md` / `PROGRESS.md` (and bugs if needed). Significant records: `YYYY-MM-DD HH:mm:ss Asia/Taipei`.
- Skills (load when relevant): `testing`, `verify`, `versioning`, `supabase-ops`, `ship`.

## Task routing

Grade a task on three axes — depth of inference required, cost of being wrong, and room for subjective judgement — then hand it to the matching role. Model and effort per role live in `.claude/agents/*.md` frontmatter (mirrored in `.claude/mad/models.json`); do not restate them here.

| Grade | Role | Fits |
| ---- | ---- | ---- |
| High | `architect` | Multi-step reasoning, argued trade-offs, complex planning, high-risk changes |
| Medium | `builder` / `reviewer` | Clear direction but still needs organising — implement from a spec, review against a spec |
| Low, high-volume | `scout` / `scribe` | Rule-driven, repetitive, has a right answer — codebase mapping, log compression, doc bookkeeping |

- Grading is a judgement call, not a gate. Each role's `description` states its preconditions (e.g. `builder` needs a spec path); respect them.
- A subagent starts cold and cannot see the conversation. If briefing it plus its re-reads cost more than doing the work inline, do it inline regardless of grade.
- Full feature work already runs this loop end-to-end: **`/mad:orchestrate`**.
- This routes **delegation only**. The main session's model comes from `/model`, not from this file.

## Versioning

No `v` prefix. `main` = `x.x.x`; `dev` unfinished = `x.x.x-dev.N`.

Which files to sync and how to pick the next number: **`versioning`** skill.

## Branches & envs

| Env | Branch | Supabase |
| ---- | ---- | ---- |
| PROD | `main` | cloud `kxnxadaghidwumqsqneu` |
| DEV | `dev` | self-hosted `https://korq9tvdz0jd7yblr72p.ivan.lab` (compose under `/root/container/supabase/stock-pnl-web-dev`) |

- **Always commit to `dev` first**; merge `main` only after DEV verify. `main` push deploys Pages.
- Do **not** deploy / change Supabase unless the user asks. PROD Edge only on `main` + explicit OK.
- DEV Edge: **volume copy** into `volumes/functions/` + recreate functions container — not cloud `functions deploy`.
- Read-only queries OK. Ops pitfalls (incl. `stock-report` `--no-verify-jwt` on cloud): **`supabase-ops`** skill.
