# Spec — daily transaction backup to Supabase Storage (phase 1)

Status: ready for builder
Scope: **phase 1 only** — the backup must run and land daily. The admin UI and the
admin-only download endpoint are phase 2 and are explicitly out of scope here.

## Goal

Every day at Taipei 02:00, one Edge Function writes **one JSON object per auth account**
into a **private** Storage bucket, keeps at most the newest 7 objects per account, and
records the outcome of every account in a log table the admin backend can read later.

## Contract

### Inputs
- HTTP POST from `pg_cron` + `pg_net` with header `x-cron-secret`.
- Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (already injected /
  already set; do not add new env var names).

### Outputs
- Storage object `backups/<user_id>/<YYYY-MM-DD>.json` for every account, content type
  `application/json`, `upsert: true` (re-running on the same day overwrites, never duplicates).
- At most **7** dated objects per account prefix; older ones deleted in the same run.
- One `backup_run_log` row per account per run.
- HTTP 200 with a small JSON summary `{ backup_date, accounts, ok, failed }`.

### Error cases
- Missing/wrong `x-cron-secret` -> 401, nothing else happens.
- One account failing (query error, upload error) must **not** abort the run: catch it,
  write a `backup_run_log` row with `status='error'` and the message, continue to the
  next account. The response reports `failed > 0` but still returns 200.
- Prune failure is logged into the same row's `error` but does not fail the account
  (the backup itself already succeeded).

### What must NOT change
- The `reports` bucket stays public; **backups never go into it**.
- `stock-report` and `stock-price` are untouched.
- No change to RLS on `transactions` / `workspaces` / `user_settings`.
- No new env var names.

## Files

- `sources/supabase/functions/backup-transactions/backupPlan.ts` (new — pure logic)
- `sources/supabase/functions/backup-transactions/index.ts` (new — I/O + wiring)
- `sources/supabase/schema.sql` (append a new `-- 12.` section; do not edit sections 1–11a)

Tests are already written and are **not** yours to edit:
`sources/supabase/functions/backup-transactions/backupPlan.test.ts`

## backupPlan.ts — exact API

```ts
export interface BackupRow { [key: string]: unknown }

export interface BackupTables {
  workspaces: BackupRow[]
  transactions: BackupRow[]
  user_settings: BackupRow[]
}

export interface BackupPayload {
  version: 1
  user_id: string
  backup_date: string   // YYYY-MM-DD, Taipei
  exported_at: string   // ISO 8601
  tables: BackupTables
}

/** YYYY-MM-DD in Taipei. Fixed +8, no DST — same approach as stock-report/report.ts:92. */
export function taipeiYmd(d: Date): string

/** Object path inside the `backups` bucket. */
export function backupObjectPath(userId: string, backupDate: string): string

/** Deterministic payload: rows pass through verbatim, only the order is fixed. */
export function buildBackupPayload(input: {
  userId: string
  backupDate: string
  exportedAt: Date
  tables: BackupTables
}): BackupPayload

/** Object names (not full paths) inside one account prefix -> the ones to delete. */
export function prunablePaths(names: string[], keepDays: number): string[]

export function rowCounts(tables: BackupTables): {
  workspaces: number
  transactions: number
  user_settings: number
}
```

Rules the tests pin down:

- `buildBackupPayload` sorts `transactions` by `tx_date` ascending then `id` ascending,
  `workspaces` by `id` ascending, `user_settings` by `user_id` ascending. Row objects are
  **not** rewritten — every column the query returned is kept as-is (a restore has to be
  able to put the row straight back, `id` and `created_at` included).
- `prunablePaths` only ever considers names matching `^\d{4}-\d{2}-\d{2}\.json$`.
  Anything else is ignored and must never be returned. It keeps the newest `keepDays`
  by date and returns the rest, regardless of input order.

## index.ts — behaviour

1. `assertCronSecret(req)` — copy the shape at `sources/supabase/functions/stock-report/index.ts:848`.
2. service_role client from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
3. Accounts: `db.auth.admin.listUsers({ page: 1, perPage: 1000 })` — same call already used
   at `sources/supabase/functions/stock-report/index.ts:3531`. Add a short comment that
   1000 is the current cap, matching that precedent.
4. Per account, sequentially (no concurrency — this runs at 02:00 and correctness beats speed):
   - select `*` from `workspaces`, `transactions`, `user_settings` where `user_id = <id>`;
   - `buildBackupPayload` -> `JSON.stringify` -> upload to bucket `backups` at
     `backupObjectPath(...)` with `{ contentType: 'application/json', upsert: true }`;
   - `db.storage.from('backups').list(userId)` -> `prunablePaths(names, 7)` -> `remove()`;
   - insert one `backup_run_log` row.
5. Return the summary JSON.

## schema.sql — new section `-- 12.`

Append at the end of the file, following the numbering and comment style of `-- 11a.`
(`sources/supabase/schema.sql:914`) and the RLS style of `admin_run_log`:

- private bucket:
  `INSERT INTO storage.buckets (id, name, public) VALUES ('backups','backups',false)
   ON CONFLICT (id) DO UPDATE SET public = false;`
  with a comment stating why it must stay private (unlike `reports`).
- table `backup_run_log`:
  `id bigserial pk`, `run_date date not null`, `user_id uuid not null`,
  `workspace_count int not null default 0`, `transaction_count int not null default 0`,
  `settings_count int not null default 0`, `bytes int not null default 0`,
  `object_path text`, `pruned int not null default 0`,
  `status text not null` (`'ok'` | `'error'`), `error text`,
  `created_at timestamptz not null default now()`.
  Index on `(run_date desc)`.
- RLS on `backup_run_log`: enable, and a single SELECT policy for admins only —
  `(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`, exactly the predicate already used
  at `sources/supabase/schema.sql:255`. **No INSERT policy** — only service_role writes.
- pg_cron job `backup-daily`, schedule `0 18 * * *` (= Taipei 02:00 daily), calling the
  function URL via `net.http_post` with the `x-cron-secret` header, in the same
  `cron.schedule(...)` form the existing daily jobs use. Keep the `<PROJECT_REF>` /
  `<CRON_SECRET>` placeholders — never write a real value into this file.

## Verify

From `sources/`:

```
npx vitest run supabase/functions/backup-transactions/backupPlan.test.ts
```

Not done until that passes. Also run `npx tsc --noEmit -p tsconfig.json` if the project
has one covering these files; report the exact command and its output either way.

## Non-goals

- No deploy. Do not run `supabase functions deploy`, do not touch DEV/PROD, do not run
  the SQL. The user deploys.
- No admin UI, no download endpoint, no signed URLs (phase 2).
- No `tw_watchlist` in the payload.
- No compression, no encryption, no incremental/diff logic.
- No restore path.
