# CLAUDE.md

Agent rules for **stock-pnl-web** (stock P&L + after-hours TW reports). Keep this file short; details live in skills and `docs/`.

## Layout

- App root: **`sources/`** — all `npm` / vitest / playwright from here.
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

Rolling rules (size caps, archive destinations), entry shapes, and the sub-item
completion test: **`bookkeeping`** skill. Load it before you compose a `scribe` brief.

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

Beyond the planning, specs and adjudication named in the session-start routing note, the
main session also owns **failing tests**. The four roles below are delegation targets.

| Role | Owns | Do not do this in the main session |
| ---- | ---- | ---- |
| `scout` | Mapping files/callers/tests, compressing logs and stack traces, reading anything bulky | More than ~a dozen exploratory Read/Grep calls; an unbounded read of a file over 32KB; dispatching the built-in `Explore` / `general-purpose`, which inherit this session's model |
| `builder` | Implementing an existing brief or spec | Editing `sources/` for anything bigger than a one-file mechanical change |
| `reviewer` | Reviewing changed files against a spec | Self-reviewing your own implementation |
| `scribe` | `docs/agent/` bookkeeping, commit messages | Hand-editing `TASK.md` / `PROGRESS.md` / bug files |

- **The loop is the `route` skill.** Load it for any feature, bug, or `TASK.md` item; it
  owns lane classification, dispatch order, handoff formats, and escalation.
- **Route by context footprint, not by task size**: a surgical edit on content already in
  context stays inline even when the task looks big. A large file read into the main
  session is re-billed on every later turn, which is why the guard asks before unbounded
  reads (`guard.readKB` in `.claude/route.config.json`). Measured economics: **`route`** skill.
- Escape hatches, for when the guard is wrong: `ROUTING_MAIN=off`, `ROUTING_GUARD=off`.
- Whether routing actually happened is measurable, and the plan does not count as
  evidence: the `/route:audit` skill.
- This routes **delegation only**. The main session's model comes from `/model`, not from
  this file.

### Dispatch discipline

Seven measured rules for writing a brief (reviewer tooling, scribe scope, spec proof,
money-code review): the **`route`** skill. Two of them are not dispatch-specific and
apply to any command you run here:

- **The Verify line is `npm run build`, never `npx tsc --noEmit`.** The latter does not
  type-check test files here, so three builders reported exit 0 while the build was red.
- **`cp` is aliased to `cp -i`.** Use `command cp -f`, and never background a command that
  can block on a prompt — one did, for 33 minutes.

## Versioning

No `v` prefix. `main` = `x.x.x`; `dev` unfinished = `x.x.x-dev.N`.

Which files to sync and how to pick the next number: **`versioning`** skill.

## Branches & envs

| Env | Branch | Supabase |
| ---- | ---- | ---- |
| PROD | `main` | cloud **`hrilemueiqyaoiwnkeuu`** (project "Stock-Pnl-Web") |
| DEV | `dev` | cloud **`zyebvayngwrqzoaicbwd`** ("Stock-Pnl-Web-Dev") — what `supabase link` points at |

Any older ref returns `404 Resource has been removed`, and `sources/.env` may still point at
a dead one. Do not check this by eye — run `verify_setup()`. The recreation story, the
verifier, the DEV/PROD identity predicate, and the DDL rules: **`supabase-ops`** skill.

- **Always commit to `dev` first**; merge `main` only after DEV verify.
- Do **not** deploy / change Supabase unless the user asks. PROD Edge only on `main` + explicit OK.
- **DEV is cloud, not local docker.** A local docker stack runs on this host and answers every
  check plausibly, but the app never talks to it. DDL rules: **`supabase-ops`** skill.
- Read-only queries OK. Ops pitfalls (incl. `stock-report` `--no-verify-jwt` on cloud): **`supabase-ops`** skill.

## This repo is public — where raw logs may go

`github.com/CTJ425/stock-pnl-web` is **PUBLIC**, and `secret_scanning_push_protection` is
**enabled** on it: a credential committed to a file gets blocked at `git push`. That gate is the
only thing standing between a pasted log and the world.

- **GitHub Issues / PR comments / Release bodies have no such gate.** They are world-readable the
  instant they are created, indexed within minutes, and their edit history stays visible. Never
  paste raw logs, `cron.job.command` text, or Edge Function output into one — root cause + commit
  SHA + `file:line` only.
- Raw logs belong in `docs/agent/`, where the push gate covers them. Secrets are written as
  placeholders there (`<token_urlsafe(32)>`), never as values — keep it that way.
- Edge logs and `cron.job.command` carry `x-cron-secret` and Supabase keys. When inspecting
  `cron.job`, select structural predicates (`command LIKE '%x-cron-secret%'`) or a narrow
  `regexp_match` for the action/url — **never select the command text, redacted or otherwise**
  (a redaction regex already failed once and printed the DEV `CRON_SECRET` into a transcript).
