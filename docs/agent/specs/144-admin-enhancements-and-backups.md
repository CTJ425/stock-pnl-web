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

#### Technical Design: Cloudflare R2 Offsite Backup
- **Why Cloudflare R2**:
  - Fully compatible with S3 API (`PutObject`, `ListObjectsV2`, `DeleteObject`).
  - Zero egress bandwidth charges, making daily sync extremely cost-effective.
- **Edge Function Integration**:
  - In `backup-transactions/index.ts`:
  - Read optional R2 credentials from environment:
    - `R2_ACCOUNT_ID`: Cloudflare account hash.
    - `R2_ACCESS_KEY_ID`: R2 API token key.
    - `R2_SECRET_ACCESS_KEY`: R2 API token secret.
    - `R2_BUCKET_NAME`: R2 bucket name (e.g. `stock-pnl-backups`).
  - When credentials exist:
    - After saving to Supabase Storage, instantiate an S3 client (using `@aws-sdk/client-s3` or lightweight SigV4 REST call targeted to `https://<account_id>.r2.cloudflarestorage.com/<bucket>/<key>`).
    - Upload `${userId}/${backupDate}.json` to R2.
    - Apply the same 7-day retention prune on R2.
  - If R2 credentials are missing: log "R2 backup skipped (not configured)" and proceed normally.

#### Technical Design: Local Machine Backup & Download
1. **Admin Bulk Export in Web UI (`BackupsSection.tsx`)**:
   - Currently, admins can download one file at a time per account.
   - Add a "下載所有帳號最新備份 (ZIP / Bundle)" button:
     - Downloads all active accounts' latest backup JSONs bundled into a single JSON or zip archive directly in the browser.
2. **User Self-Service Export**:
   - In user workspace settings / menu, add a "匯出我的所有紀錄 (JSON 備份)" button.
   - Directly downloads the user's `workspaces`, `transactions`, and `user_settings` as a timestamped local `.json` file (`stock-pnl-backup-<userId>-<date>.json`).
3. **Automated CLI / Shell Script (`scripts/backup-to-local.ts` / `.sh`)**:
   - Provide a standalone script that administrators can run via cron on a local server/NAS:
     ```bash
     npm run backup:download -- --dest=/var/backups/stock-pnl/
     ```
   - Calls the `backup-transactions` or queries Supabase directly with service role key, downloading backups to the local filesystem.

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
