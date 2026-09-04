# GEMINI.md

Agent rules for **stock-pnl-web** (stock P&L + after-hours TW reports). Keep this file short; details live in skills and `docs/`.

## Layout

- App root: **`sources/`** — all `npm` / vitest / playwright from here.
- Repo root: `GEMINI.md`, `CLAUDE.md`, `README.md`, `docs/`, `.gemini/`, `.claude/`.
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

**Agent-written internal docs are English** (see global rule 1). Exceptions: user-facing copy such as `docs/agent/CHANGELOG.md`, `README.md`, and UI strings must be in Traditional Chinese (繁體中文).

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
- Skills (load when relevant from `.gemini/skills/` or `.claude/skills/`): `route`, `testing`, `verify`, `versioning`, `supabase-ops`, `ship`, `bookkeeping`.

## Task routing

**Delegation to the roles below is standing user authorization.** Dispatch them without
asking first — this overrides any default reluctance to spawn agents. The main session runs
on the most expensive model in the system, so work that a cheaper role can do correctly
must not be done here. Model and effort per role live in agent configurations; do not restate them here.

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
- Role boundaries must be respected: delegate bulk research to `scout` (or `DeepInvestigator`), implementation to `builder` (or `DeepCoder`), review to `reviewer`, and documentation to `scribe`.
- **The Verify command is `npm run build`, never `npx tsc --noEmit`.** The latter does not type-check test files in this project, which previously caused builds to break silently.
- **`cp` is aliased to `cp -i` in Linux shells.** Use `command cp -f`, and never background a command that can block on an interactive prompt.
- This routes **delegation only**. The main session's model comes from `/model`, not from
  this file.

## Versioning & Shipping (Mandatory Skills)

**每次版本異動與推送都必須使用 `versioning` 與 `ship` 等相關 skill 來符合規定 (Every version change and push MUST strictly follow the `versioning` and `ship` skills):**

### 1. Versioning (`versioning` skill)
- No `v` prefix. `main` = `x.x.x`; `dev` unfinished work = `x.x.x-dev.N`.
- Any non-release work on `dev` must bump to the next sequential `x.x.x-dev.N`.
- **Strict 5-File Synchronization**: Every version update MUST synchronize all 5 files in the same turn/commit:
  1. `sources/src/version.ts` → `APP_VERSION` (UI badge in lower left corner)
  2. `sources/package.json` → `version`
  3. `sources/package-lock.json` → `version`
  4. `README.md` → version badge line only (`> **目前版本：x.x.x...**`)
  5. `docs/agent/CHANGELOG.md` → version history entry written in Traditional Chinese

### 2. Shipping & Verification (`ship` skill)
- **Always verify before commit/push**:
  1. Full test suite: `npm test` from `sources/`.
  2. Production build check: `npm run build` (`tsc -b && vite build`) from `sources/` (never rely only on `npx tsc --noEmit`).
- **Always commit and push to `dev` first**; verify on DEV Cloud before considering release.
- **Never push or merge to `main` without explicit user request and authorization.**
- Official releases (`x.x.x` on `main`) automatically deploy Pages and trigger GitHub Releases sync.

## Branches & envs

| Env | Branch | Supabase |
| ---- | ---- | ---- |
| PROD | `main` | cloud **`hrilemueiqyaoiwnkeuu`** (project "Stock-Pnl-Web") |
| DEV | `dev` | cloud **`zyebvayngwrqzoaicbwd`** (project "Stock-Pnl-Web-Dev") — what `supabase link` points at |

- **Always commit to `dev` first**; merge `main` only after DEV verify.
- Both PROD and DEV are Supabase Cloud projects (no Docker environment).
- Edge Functions deployment: `supabase functions deploy <name> --project-ref <ref> --no-verify-jwt`.
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
