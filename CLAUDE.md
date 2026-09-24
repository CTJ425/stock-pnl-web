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
completion test: **`bookkeeping`** skill. Load it before you update `docs/agent/`.

## Start of session

Read (on demand, keep context small):

1. `docs/agent/PROGRESS.md` — top only  
2. `docs/agent/TASK.md`  
3. `docs/agent/BUG_FIX.md`  

Then inspect code you will touch. Do not assume chat has full state.

## Work style

- After work: update `TASK.md` / `PROGRESS.md` (and bugs if needed). Significant records: `YYYY-MM-DD HH:mm:ss Asia/Taipei`.
- Skills (load when relevant): `testing`, `verify`, `versioning`, `supabase-ops`, `ship`.

## Command rules

- **The Verify line is `npm run build`, never `npx tsc --noEmit`.** The latter does not
  type-check test files here, so a build once went red while the check reported exit 0.
- **`cp` is aliased to `cp -i`.** Use `command cp -f`, and never background a command that
  can block on a prompt — one did, for 33 minutes.

## Release workflow

Run in this order; the steps live in the **`ship`** skill, the numbering in **`versioning`**.

1. From `sources/`: `npm test`, `npm run build`, `npm run typecheck:edge` — all green, or stop.
2. Bump to `x.x.x-dev.N` in every synced file; add a zh-TW `CHANGELOG.md` entry.
3. Commit and push **`dev`**. If `sources/supabase/` changed, deploy / apply it on **DEV**
   (`supabase-ops`) and verify there.
4. **Stop and ask the user** before touching `main`.
5. With the OK: finalize the CHANGELOG entry (no "pending" wording — it becomes the public
   Release body), drop `-dev.N`, merge into `main`, push, then `git push origin main:dev`.
6. A `main` push never deploys Edge or DDL: apply them to **PROD** separately, then verify.
7. Update `docs/agent/` (`bookkeeping`).

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
