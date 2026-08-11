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

**Agent-written docs: English** (except , UI copy, `README.md`). Conversation with the user: Traditional Chinese.

## Start of session

Read (on demand, keep context small):

1. `docs/agent/PROGRESS.md` — top only  
2. `docs/agent/TASK.md`  
3. `docs/agent/BUG_FIX.md`  

Then inspect code you will touch. Do not assume chat has full state.

## Work style

- Prefer simple, surgical changes; no speculative features.
- After work: code done, `cd sources && npm test` green, update `TASK.md` / `PROGRESS.md` (and bugs if needed). Significant records: `YYYY-MM-DD HH:mm:ss Asia/Taipei`.
- Skills (load when relevant): `testing`, `verify`, `versioning`, `supabase-ops`, `ship`.

## Versioning

No `v` prefix. Sync:

- `sources/src/version.ts` → `APP_VERSION`
- `sources/package.json` (+ lock)
- `README.md` badge
- `docs/agent/CHANGELOG.md`

`main` = `x.x.x`; `dev` unfinished = `x.x.x-dev.N`. After release, `dev` and `main` same version (`git push origin main:dev`). Next work = next patch `-dev.1`. Details: **`versioning`** skill.

## Branches & envs

| Env | Branch | Supabase |
| ---- | ---- | ---- |
| PROD | `main` | cloud `kxnxadaghidwumqsqneu` |
| DEV | `dev` | self-hosted `https://korq9tvdz0jd7yblr72p.ivan.lab` (compose under `/root/container/supabase/stock-pnl-web-dev`) |

- **Always commit to `dev` first**; merge `main` only after DEV verify. `main` push deploys Pages.
- Do **not** deploy / change Supabase unless the user asks. PROD Edge only on `main` + explicit OK.
- DEV Edge: **volume copy** into `volumes/functions/` + recreate functions container — not cloud `functions deploy`.
- Read-only queries OK. Ops pitfalls: **`supabase-ops`** skill. `stock-report` needs `--no-verify-jwt` on cloud.
