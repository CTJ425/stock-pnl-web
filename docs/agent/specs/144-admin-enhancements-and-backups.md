# Spec 144: Admin Enhancements & Multi-Target Backups

Status: 📝 SPECIFIED / HANDOVER READY  
Date: 2026-09-04 Asia/Taipei  
Reference: User Request 2026-09-04  

---

## 1. Overview & Scope

This specification documents four related system enhancements requested for `stock-pnl-web`:
1. **Uniform Account Icon**: Replace dynamic email initials in the header avatar with a clean, consistent user icon.
2. **Admin Cron & Probe Execution Logs**: Provide a dedicated log viewer in the Admin Console for debugging cron failures and probe anomalies.
3. **Supabase Cloud Limit & Usage Monitor**: Surface database size, storage usage, and cloud plan limits within the Admin Console.
4. **Multi-Target Backup System**: Expand existing backups to support Cloudflare R2 (S3-compatible) offsite redundancy and local machine download/export.

---

## 2. Feature Details & Technical Designs

### Feature 1: Uniform Account Icon (Replace Initials)

#### Problem
Currently in `sources/src/components/AppShell.tsx` (lines 405–424), when logged in with a Supabase account, the header button renders two uppercase letters derived from the email prefix (`email.slice(0, 2).toUpperCase() || 'ME'`). The user requested removing the dynamic initials in favor of a uniform, standard account icon across all authenticated users.

#### Technical Plan
- **Component**: `sources/src/components/AppShell.tsx`
  - In `UserMenu`:
    - Import `User` (or `CircleUserRound`) from `lucide-react`.
    - Replace `{initials}` with `<User size={15} strokeWidth={2.2} />`.
    - Keep local mode distinct (`isLocal ? <HardDrive size={12} /> 本機模式 : ...`).
- **Styling**: `sources/src/index.css`
  - Ensure `.hmenu-avatar` centers SVG icons properly (`display: inline-flex; align-items: center; justify-content: center;`).
- **Tests**:
  - Update `AppShell.test.tsx` and any tests asserting `initials` text content in header buttons.

---

### Feature 2: Admin Cron & Probe Execution Logs

#### Problem
- Current Admin status page (`AdminStatusPage.tsx`) shows aggregate hit/miss summary bars for probes and high-level cron status (`lastRun`, `lastStatus`, `runsToday`, `failsToday`), but lacks actual execution logs, error traces, and status messages.
- When a cron job fails (`status != 'succeeded'`) or a probe encounters an HTTP 429/500/parsing error, administrators must currently inspect Supabase Cloud dashboards or run raw SQL queries to diagnose the root cause.

#### Architecture & Data Sources
1. **Cron Runs (`cron.job_run_details`)**:
   - Fields: `runid`, `jobid`, `status`, `return_message`, `start_time`, `end_time`.
   - Security gate: NEVER expose the raw `command` column (contains `x-cron-secret` and tokens). Only return `jobname`, `status`, `start_time`, `end_time`, and sanitized `return_message`.
2. **Probe Anomalies (`source_probe_tick`)**:
   - Fields: `taipei_ymd`, `taipei_time`, `source`, `hit`, `ok`, `rows`, `note`, `duration_ms`, `probed_at`.
   - Filter capability: query rows where `ok = false` or `note IS NOT NULL` to surface network failures, payload shifts, or unexpected shapes.
3. **Batch & Manual Runs (`batch_run_log`, `admin_run_log`)**:
   - Surface recent batch execution durations, skip reasons (`skip_reason`), and manual run errors (`error_message`).

#### Backend Implementation Plan
- **Database Function (RPC)**:
  - Create `public.admin_get_recent_logs(limit_count INT DEFAULT 50)` in `schema.sql`.
  - `SECURITY DEFINER`, granted only to `service_role`.
  - Returns unified JSON with recent cron execution runs and probe error events.
- **Edge Function**:
  - In `sources/supabase/functions/stock-report/index.ts`, add action `admin-logs` protected by `assertAdmin(req)`.
- **Frontend UI (`components/Admin/`)**:
  - Add a "日誌中心 / 執行日誌" panel or an expandable log viewer inside `AdminStatusPage.tsx`.
  - Provide filter tabs: [All, Cron Failures, Probe Errors, Batch Runs].
  - Format logs with timestamp, status tag (`succeeded` / `failed`), duration, and expandable details modal for error messages and payloads.

---

### Feature 3: Supabase Cloud Resource & Limit Usage Dashboard

#### Problem
Administrators currently have no visibility into how close the project is to Supabase Free/Pro tier resource thresholds (such as 500 MB Postgres limit or 1 GB Storage limit) without logging into the official Supabase Cloud console.

#### Architecture & Metrics Collection
1. **PostgreSQL Database Storage Metrics**:
   - Database total size: `pg_database_size(current_database())`.
   - Top 5 largest tables & indexes:
     ```sql
     SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size, pg_total_relation_size(c.oid) AS bytes
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 5;
     ```
2. **Supabase Storage Bucket Metrics**:
   - Query `storage.objects` to compute total size and count for `reports` and `backups` buckets:
     ```sql
     SELECT bucket_id, count(*) AS file_count, coalesce(sum((metadata->>'size')::bigint), 0) AS total_bytes
     FROM storage.objects GROUP BY bucket_id;
     ```
3. **Active Users & Records**:
   - Total auth users: `SELECT count(*) FROM auth.users`.
   - Total transactions: `SELECT count(*) FROM public.transactions`.
4. **Usage Limits & Gauges**:
   - Compare database size against configured plan quota (default Free Tier: 500 MB; Pro Tier: 8 GB).
   - Compare Storage size against quota (default Free Tier: 1 GB).
   - Display color-coded progress bars (Normal < 70%, Warning >= 70%, Danger >= 85%).
5. **(Optional) Management API Integration**:
   - If `SUPABASE_MANAGEMENT_TOKEN` is provided in environment variables, query `api.supabase.com/v1/projects/{ref}/analytics/endpoints/usage.api-counts` for monthly API requests and Edge Function invocations.
   - If token is absent, gracefully display database and storage metrics without requiring the management token.

---

### Feature 4: Multi-Target Backups (Cloudflare R2 S3 + Local Download)

#### Problem & Opportunity
- Current backup solution (`sources/supabase/functions/backup-transactions/`):
  - Dumps `workspaces`, `transactions`, and `user_settings` into JSON per user every night at 02:00.
  - Uploads to the private Supabase Storage bucket `backups`.
  - Retention: keeps 7 newest days.
- If the Supabase project is suspended, unavailable, or purged, backups stored inside the same Supabase project's Storage will become inaccessible.
- User wants:
  1. Offsite cloud backup to Cloudflare R2 (S3-compatible, zero egress fees).
  2. Local export/backup capability to save data to a local drive.

#### Decisions (2026-09-14 09:56:14 Asia/Taipei, user-approved)

| Question | Decision | Consequence |
| :--- | :--- | :--- |
| R2 retention | **7 days, same as Supabase Storage** | R2 protects against loss of the Supabase project, not against late discovery of a bad write. Reuse `prunablePaths(names, KEEP_DAYS)` unchanged. |
| Upload client | **Hand-written SigV4 REST** | No `@aws-sdk/client-s3`. The Edge bundle and the cold start stay unchanged. The signature becomes unit-testable. |
| Scope | **R2 and local download together** | Phase 4 delivers both sub-items in one pass. |
| Failure semantics | **Partial, never fatal** | The Supabase copy is the primary target. An R2 error must not turn a good run red. |

#### Technical Design: Cloudflare R2 Offsite Backup

- **Why Cloudflare R2**: S3-compatible (`PutObject`, `ListObjectsV2`, `DeleteObject`), and zero egress charge.
- **Why offsite matters here**: today the backup and the data live in the same Supabase project.
  Both cloud projects were recreated on 2026-08-31 and every older ref now returns
  `404 Resource has been removed`. The current design survives a bad delete. It does not
  survive loss of the project.

**New file: `sources/supabase/functions/backup-transactions/r2.ts`** — no dependency. Use Web
Crypto (`crypto.subtle`) for SHA-256 and HMAC-SHA256. This is the exact surface the tests import:

```ts
export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export interface SignedRequest {
  url: string
  headers: Record<string, string>   // authorization, x-amz-content-sha256, x-amz-date
}

export interface R2SyncResult {
  status: 'ok' | 'skipped' | 'failed'
  error: string | null
  pruned: number
}

export interface R2Deps {
  fetch?: typeof fetch
  now?: () => Date
}

/** Returns null if any one of the four variables is absent OR an empty string. */
export function readR2Config(getEnv: (name: string) => string | undefined): R2Config | null

/** AWS SigV4, service `s3`, region `auto`. Signed headers: host;x-amz-content-sha256;x-amz-date. */
export function signR2Request(input: {
  method: 'PUT' | 'GET' | 'DELETE'
  config: R2Config
  key?: string
  query?: Array<[string, string]>
  body?: Uint8Array
  now: Date
}): Promise<SignedRequest>

/** ListObjectsV2 XML -> keys plus the continuation token (null when the listing is complete). */
export function parseListKeys(xml: string): { keys: string[]; nextToken: string | null }

export function syncToR2(
  config: R2Config | null,
  input: { userId: string; backupDate: string; body: Uint8Array; keepDays: number },
  deps?: R2Deps,
): Promise<R2SyncResult>
```

**Signing rules that the vectors pin** (a mismatch changes the signature):

- Host is `<accountId>.r2.cloudflarestorage.com`; path style, so the canonical URI starts `/<bucket>`.
- A key appends `/<key>`; no key leaves the canonical URI as `/<bucket>` with no trailing slash.
- Percent-encode the path with `/` and `~` unreserved; percent-encode query keys and values with
  only `~` unreserved, then sort the pairs.
- Canonical headers are the three signed headers, lower-case, each ending in `\n`.
- `x-amz-content-sha256` is the hex SHA-256 of the body, and of the empty string for GET and DELETE.

**`syncToR2` behaviour** — the five cases the tests fix:

| Case | Result |
| :--- | :--- |
| `config` is `null` | `{ status: 'skipped', error: null, pruned: 0 }`, and **zero** fetch calls |
| Upload and prune succeed | `{ status: 'ok', error: null, pruned: <count> }` |
| Upload rejected | `{ status: 'failed', error: 'R2 PUT 403 <key>', pruned: 0 }` — never throws |
| Only the prune fails | `{ status: 'ok', error: 'R2 GET 500 <prefix>', pruned: 0 }` — the offsite copy already landed |
| `fetch` throws | `{ status: 'failed', error: <describeError(err)>, pruned: 0 }` |

Non-ok HTTP responses throw internally with the message `R2 <METHOD> <status> <key or prefix>`.

Prune reuses the existing pure function: list with prefix `${userId}/`, strip that prefix to get
object names, call `prunablePaths(names, keepDays)`, then delete `${userId}/${name}` for each
returned name. Do not write a second retention rule.

**Integration in `index.ts`** (inside `backupAccount`, after the Storage upload succeeds):

1. Call `syncToR2(readR2Config((n) => Deno.env.get(n)), { userId, backupDate, body, keepDays: KEEP_DAYS })`.
2. Set `row.r2_status = result.status` and `row.r2_error = result.error`.
3. Add `r2_status: 'ok' | 'skipped' | 'failed'` and `r2_error: string | null` to the
   `BackupLogRow` interface at `index.ts:58`.

Leave the existing Supabase Storage upload, prune, and `status` / `error` fields unchanged. R2 must
never change the value of `row.status`.

**Make the R2 status visible — the producer is useless without the consumer**

Writing `r2_status` and `r2_error` is only half the job. `stock-report/index.ts:3867` selects
`user_id, run_date, status, error, transaction_count` from `backup_run_log` and nothing else, so
an R2 failure is recorded and never seen. An operator would believe two copies exist while only one
does, which is worse than having no offsite copy at all. Therefore:

1. `sources/supabase/functions/stock-report/index.ts:3867` — add `r2_status, r2_error` to the select,
   and add `r2Status` and `r2Error` to the `lastRunByUser` entry built at lines 3878-3886.
2. `sources/src/services/adminBackups.ts` — add `r2Status: string | null` and `r2Error: string | null`
   to `BackupRunInfo`.
3. `sources/src/components/Admin/BackupsSection.tsx` — show the R2 state per account next to the
   existing last-run status. `skipped` must read as "not configured", not as a failure.

CAUTION — deploy order for `stock-report` is stricter than for `backup-transactions`. A PostgREST
select that names a column the table does not have **fails the whole request**, so deploying this
`stock-report` change before the DDL lands takes the admin backups page down completely. Apply the
DDL first on each environment, then deploy.

**Schema change (must land before the Edge deploy)**

```sql
ALTER TABLE backup_run_log ADD COLUMN IF NOT EXISTS r2_status text;
ALTER TABLE backup_run_log ADD COLUMN IF NOT EXISTS r2_error  text;
```

CAUTION: an Edge insert that carries a column the table does not have makes **every** row of
that insert fail silently. Apply the DDL on DEV, verify, then deploy. Repeat for PROD.

**Secrets** — four Edge secrets, DEV first, then PROD:
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.
Set them with `supabase secrets set`. The bucket must be private. Never write a value into
git, a log, an Issue, or a spec. Write placeholders only.

#### Technical Design: Local Machine Backup & Download

CORRECTION 2026-09-14: an earlier draft of this section named `UserSettingsModal.tsx`. **That
component does not exist.** The account menu lives in `AppShell.tsx:450-541`. A `downloadBlob(blob,
filename)` helper already exists at `src/services/reportPdf.ts:76`. Reuse it. Do not write a second one.

**1. Admin bulk export — `src/components/Admin/BackupsSection.tsx`**

- Add one button above the account list, labelled `下載所有帳號最新備份`.
- For each account that has at least one file, take the newest file by `date`, call
  ``requestBackupUrl(`${userId}/${file.name}`)``, then `fetch` that URL and parse the JSON.
- Assemble one object:
  `{ generatedAt: <ISO string>, accounts: [{ userId, email, backupDate, payload }] }`.
- Hand it to ``downloadBlob(blob, `stock-pnl-backups-${YYYY-MM-DD}.json`)``. Add no zip dependency.
- An account with **no files is skipped, and is not an error**.
- A per-account failure does not stop the run: collect the failed emails, show them in the existing
  `err` area, and still download the accounts that succeeded.
- Disable the button while the export runs, so a double click cannot start two runs.

**2. User self-service export — new `src/services/selfExport.ts`**

```ts
export interface SelfExport {
  exportedAt: string
  workspaces: unknown[]
  transactions: unknown[]
  user_settings: unknown[]
}

/** Reads through the signed-in client, so RLS limits every row to the caller. */
export function buildSelfExport(): Promise<SelfExport | { error: string }>
```

- Import `supabase` from `./supabase`. It can be `null` — return `{ error: 'Supabase 未設定' }`.
- `workspaces` and `user_settings` use a plain `.select('*')`.
- `transactions` pages with `.select('*').order('id', { ascending: true }).range(from, to)` at 1000
  rows per page, and stops when a page returns fewer than 1000 rows. PostgREST caps a single
  response at 1000 and reports no error when it truncates, so an unpaged select silently loses rows.
- Any query error returns `{ error: <message> }`. Never throw.
- **Never use the service role key.** That key must not appear in client code.
- In `AppShell.tsx`, add one `role="menuitem"` button labelled `匯出我的紀錄` next to `變更密碼`.
  On click it calls `buildSelfExport()` and, on success, ``downloadBlob(blob,
  `stock-pnl-backup-${YYYY-MM-DD}.json`)``.

**3. Operator script — new `sources/scripts/backup-download.cjs`**

- Read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the environment. Exit 1 with a clear
  message when either one is absent.
- List the `backups` bucket and write every object under the `--dest` directory.
- Register `"backup:download": "node scripts/backup-download.cjs"` in `sources/package.json`.
- CAUTION: this script holds the service role key. It never runs in a browser, and its output
  directory must never be committed.

#### Tests for Phase 4

| Test | File | Proves |
| :--- | :--- | :--- |
| SigV4 vector | `r2.test.ts` | A fixed key, fixed date, and fixed payload produce the expected `Authorization` header. This is the only proof available without a live bucket. |
| Config gate | `r2.test.ts` | `readR2Config` returns `null` when one variable is absent. |
| Prune reuse | `backupPlan.test.ts` | `prunablePaths` returns the same set for an R2 key list. |
| Partial failure | `backupPlan.test.ts` | An R2 error produces `r2_status = 'failed'` and keeps the run result green. |
| Bulk export | `BackupsSection.test.tsx` | The button assembles one file from many accounts. |

Verify command: `npm test`, then `npm run typecheck:edge`, then `npm run build`.

---

## 3. Implementation Plan & Work Phases

| Phase | Tasks | Target Files |
| :--- | :--- | :--- |
| **Phase 1** | Uniform Account Icon | `AppShell.tsx`, `index.css`, `AppShell.test.tsx` |
| **Phase 2** | Admin Execution Logs (Cron & Probes) | `schema.sql`, `stock-report/index.ts`, `adminStatus.ts`, `AdminStatusPage.tsx` |
| **Phase 3** | Supabase Cloud Usage & Quota Monitor | `schema.sql` (RPC), `stock-report/index.ts`, `adminStatus.ts`, `AdminConsolePage.tsx` |
| **Phase 4** | Multi-Target Backup (R2 & Local Download) | `backup-transactions/index.ts`, `BackupsSection.tsx`, `UserSettingsModal.tsx`, `scripts/` |

---

## 4. Verification & Testing Strategy
1. **Unit & Integration Tests**:
   - Ensure vitest suite (`npm test`) passes with 100% success.
   - Mock S3 / R2 upload calls in `backupPlan.test.ts`.
   - Test `admin_recent_logs` and `admin_usage_metrics` RPC responses.
2. **Typecheck & Build**:
   - `npm run typecheck:edge`
   - `npm run build` (`tsc -b && vite build`)
3. **Security Audit**:
   - Ensure `cron.job.command` secret tokens are never emitted by any log RPC.
   - Ensure R2 credentials are read only from backend Edge Function environment variables and never exposed to the client.
