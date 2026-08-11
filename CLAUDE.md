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
- Skills (load when relevant): `route`, `testing`, `verify`, `versioning`, `supabase-ops`, `ship`.

## Task routing

**Delegation to the roles below is standing user authorization.** Dispatch them without
asking first — this overrides any default reluctance to spawn agents. The main session runs
on the most expensive model in the system, so work that a cheaper role can do correctly
must not be done here. Model and effort per role live in `.claude/agents/*.md` frontmatter;
do not restate them here.

| Role | Owns | Do not do this in the main session |
| ---- | ---- | ---- |
| `scout` | Mapping files/callers/tests, compressing logs and stack traces | More than ~a dozen exploratory Read/Grep calls |
| `architect` | Specs, failing tests, bug-fix plans, adjudication (main session may do this itself when on Opus) | — |
| `builder` | Implementing an existing spec | Editing `sources/` for anything bigger than a one-file mechanical change |
| `reviewer` | Reviewing changed files against a spec | Self-reviewing your own implementation |
| `scribe` | `docs/agent/` bookkeeping, commit messages | Hand-editing `TASK.md` / `PROGRESS.md` / bug files |

- **The loop is the `route` skill.** Load it for any feature, bug, or `TASK.md` item; it
  owns lane classification, dispatch order, handoff formats, and escalation.
- Two limits keep this honest: a dispatch costs 5–15k tokens of fixed overhead, and a
  measured full loop on a trivial task cost 3.5x doing it inline. Under ~20 minutes of
  human work, stay in the main session (Lane 0) — that is a routing decision too.
- Role boundaries are enforced by `.claude/hooks/routing_guard.py`, not by good manners.
  A blocked write means you are out of role: re-route it, do not work around it.
  Escape hatches, for when the guard is wrong: `ROUTING_MAIN=off`, `ROUTING_GUARD=off`.
- Whether routing actually happened is measurable, and the plan does not count as
  evidence: `python3 .claude/hooks/routing_audit.py`.
- This routes **delegation only**. The main session's model comes from `/model`, not from
  this file.

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
