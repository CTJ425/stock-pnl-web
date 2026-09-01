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

The main session owns **architecture, specs, failing tests, and adjudication** — that is
what it runs on the expensive model for. The four roles below are delegation targets.

| Role | Owns | Do not do this in the main session |
| ---- | ---- | ---- |
| `scout` | Mapping files/callers/tests, compressing logs and stack traces, reading anything bulky | More than ~a dozen exploratory Read/Grep calls; an unbounded read of a file over 32KB; dispatching the built-in `Explore` / `general-purpose`, which inherit this session's model |
| `builder` | Implementing an existing brief or spec | Editing `sources/` for anything bigger than a one-file mechanical change |
| `reviewer` | Reviewing changed files against a spec | Self-reviewing your own implementation |
| `scribe` | `docs/agent/` bookkeeping, commit messages | Hand-editing `TASK.md` / `PROGRESS.md` / bug files |

- **The loop is the `route` skill.** Load it for any feature, bug, or `TASK.md` item; it
  owns lane classification, dispatch order, handoff formats, and escalation.
- **Cost is context replay, not output.** Measured over 30 sessions: cache read is 69.6%
  of spend, output only 16%. One main-session turn costs ~$0.13 at the measured 185k
  average context, against $0.12 for a `scout` dispatch and $0.27 for a `scribe` one — so
  they break even at 2 and 4 replaced turns respectively. **Route by context footprint,
  not by task size**: bulk content goes to a subagent even when the task is trivial, and a
  surgical edit on content already in context stays inline even when the task looks big.
  A large file read into the main session is re-billed on every later turn of that
  session, which is why the guard asks before unbounded reads over 32KB.
- Role boundaries are enforced by the `route` plugin's guard hook, not by good manners.
  A blocked write means you are out of role: re-route it, do not work around it.
  Escape hatches, for when the guard is wrong: `ROUTING_MAIN=off`, `ROUTING_GUARD=off`.
- Whether routing actually happened is measurable, and the plan does not count as
  evidence: the `/route:audit` skill.
- This routes **delegation only**. The main session's model comes from `/model`, not from
  this file.

### Dispatch discipline — measured on 2026-09-01, all seven cost real rework

- **The Verify line is `npm run build`, never `npx tsc --noEmit`.** The latter does not
  type-check test files here, so three builders reported exit 0 while the build was red.
- **`route:reviewer` has no Bash** (the local `reviewer` in `.claude/agents/` does). Asking
  the scoped one to run a command earns five identical "verification gap" findings and
  nothing else. **Paste the test output you already have into the brief.**
- **Scribe composes nothing a human will read.** It runs on haiku; asked to turn notes into
  prose it produced wrong file attributions, an invented API, and a change that never
  happened — twice. Hand it verbatim text to paste. It keeps the file surgery, which is the
  part that actually replaces main-session turns. Cost check: 1.4k tokens of verbatim Opus
  output is ~$0.03, one sixth of a single main turn; one correction round-trip is five.
- **At most two tracking files per scribe dispatch.** A seven-section brief drove it into
  its 30-turn cap three times, then into a rate limit.
- **Prove the brief before dispatching**: compile the failing test against the proposed
  signature. A test you cannot type is a spec error — that is how `splitFeeTax` shipped
  without the `ticker` it needs and cost three rounds.
- **Validate any classification rule against real data before it enters a spec**, and record
  the counts there. "Same-day buy and sell means 當沖" scored 12 false positives out of 14
  on the two broker exports in `docs/`; catching that before dispatch saved a whole cycle.
  A spec must also state the **negative** case — what the code may not do, and why.
- **For money code the main session reads the diff itself.** Tests and reviewers missed both
  of the silent-money defects here (a non-idempotent INSERT retry that would duplicate
  transactions, and an optional `ticker` that would overtax every ETF threefold). Context
  replay is the cost; for code that computes money it is worth paying, for bookkeeping it is
  not.
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

**Both cloud projects were recreated on 2026-08-31.** The refs this file used to name —
`kxnxadaghidwumqsqneu` and `cahmfrhacyvrrlsaatkm` — are **deleted**; any call against them
returns `404 Resource has been removed`. `sources/.env` may still point at a dead one.

**The recreation was done from setup SQL whose placeholders were never substituted.** Every
`cron.job` on both projects carried the literal `<PROJECT_REF>` in its URL *and* the literal
`<CRON_SECRET>` in its header, so every job failed from creation until 2026-09-01: the URL
error killed it before `net.http_post` queued anything, and once that was fixed the Edge
Function answered 401. After any project recreation, check both:

**Do not check this by eye — run the verifier.** `schema.sql` now ends with a hard gate
that aborts if a placeholder survives, and `sources/supabase/verify.sql` installs the same
check as something you can re-run:

```sql
SELECT * FROM verify_setup();   -- 10 checks: schema, migrations, cron, secret shape, RLS
SELECT assert_setup_ok();       -- raises unless all of them pass
```

A written checklist for this already existed in `schema.sql` §6d and did not prevent three
recurrences. Details and the two checks that still need a human eye: **`supabase-ops`** skill.

- **Always commit to `dev` first**; merge `main` only after DEV verify.
- Do **not** deploy / change Supabase unless the user asks. PROD Edge only on `main` + explicit OK.
- **DEV is cloud, not local docker** (verified 2026-09-01). `sources/.env` points at
  `https://zyebvayngwrqzoaicbwd.supabase.co`; DEV Edge runs there (`functions list` shows 3 ACTIVE).
  DEV DDL goes through `supabase db query --linked` from `sources/`, always with an identity value
  in the same query (`(SELECT count(*) FROM cron.job)` = 6 on DEV). A local docker stack
  (`stock-pnl-web-dev-db-1`) still runs on this host and answers every check plausibly, but the app
  never talks to it — a DDL applied there has no effect on DEV.
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
