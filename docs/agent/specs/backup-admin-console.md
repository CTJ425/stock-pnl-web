# Spec — backup admin console + admin-only download (phase 2)

Status: ready for builder
Task: 130. Phase 1 (`docs/agent/specs/backup-transactions.md`) is already live on DEV.

## Decision reversal recorded here

Task 130 says "New Edge Function with `verify_jwt=true`". **That is not how this codebase does
admin actions and it is not what we are building.** Every existing admin call goes through the
already-deployed `stock-report` function as a `body.action`, gated by `assertAdmin`
(`sources/supabase/functions/stock-report/index.ts:867`), because `stock-report` is deployed
`--no-verify-jwt` and verifies the user JWT itself. See `adminStatus.ts:160` and
`adminUsers.ts:31`. A separate function would add a second PROD deploy target whose
`verify_jwt` setting could drift, for no benefit.

**We add two actions to `stock-report` instead.** Do not create a new Edge Function.

## Contract

### Edge — new action `admin-backups`
- Gate: `assertAdmin(req)` first, exactly like `admin-users` at index.ts:3880.
- Reads, with the service-role client already in that file:
  - `db.auth.admin.listUsers({ page: 1, perPage: 1000 })` for id + email;
  - `db.storage.from('backups').list(userId, { limit: 1000 })` per account;
  - the newest `backup_run_log` row per account.
- Returns 200 `{ ok: true, accounts: AccountBackupSummary[] }` where each entry carries
  `userId, email, fileCount, newestDate, totalBytes, files[], lastRun`.
- `files[]` entries: `{ name, date, size, createdAt }`, newest first.
- `lastRun`: `{ runDate, status, error, transactionCount }` or `null`.
- An account with no objects still appears, with `fileCount: 0`, `newestDate: null`,
  `totalBytes: 0`, `files: []`.

### Edge — new action `admin-backup-url`
- Gate: `assertAdmin(req)` first.
- Body: `{ path: string }`.
- **`isValidBackupPath(path)` must pass before the path reaches Storage.** Reject -> 400
  `{ error: '備份路徑格式不正確' }`. This is the traversal gate; a signed URL is minted for
  whatever path is given, so an unvalidated path is an arbitrary-object read.
- On success: `db.storage.from('backups').createSignedUrl(path, 60)` -> 200
  `{ ok: true, url, expiresIn: 60 }`. Storage error -> 404 `{ error: '找不到備份檔' }`.

### New pure module — `sources/supabase/functions/stock-report/backupAdmin.ts`

```ts
export interface BackupObject { name: string; size: number; createdAt: string | null }
export interface BackupFileEntry { name: string; date: string; size: number; createdAt: string | null }
export interface AccountBackupSummary {
  userId: string
  email: string
  fileCount: number
  newestDate: string | null
  totalBytes: number
  files: BackupFileEntry[]
}

/** `<uuid>/<YYYY-MM-DD>.json` and nothing else. */
export function isValidBackupPath(path: string): boolean

/** Ignores anything that is not a dated backup object; newest first. */
export function summarizeAccountBackups(
  userId: string,
  email: string,
  objects: BackupObject[],
): AccountBackupSummary
```

### New service — `sources/src/services/adminBackups.ts`

Follow `adminUsers.ts` exactly: `if (!supabase) return null`, `supabase.functions.invoke('stock-report',
{ body: { action }, timeout: 20_000 })`, defensive `typeof` parsing of every field, `catch` -> null.
Reuse the `httpErrorMessage` idea from `adminUsers.ts:78` for the download call so the backend's
message reaches the screen.

```ts
export interface BackupFile { name: string; date: string; size: number; createdAt: string | null }
export interface BackupRunInfo { runDate: string; status: string; error: string | null; transactionCount: number }
export interface AccountBackups {
  userId: string; email: string; fileCount: number; newestDate: string | null
  totalBytes: number; files: BackupFile[]; lastRun: BackupRunInfo | null
}
export function fetchAdminBackups(): Promise<AccountBackups[] | null>
export function requestBackupUrl(path: string): Promise<{ url: string } | { error: string }>
```

### New component — `sources/src/components/Admin/BackupsSection.tsx`

Model it on `AccountsSection.tsx` — same `section glass adm-panel` wrapper, `rpt-section-head`
with `head-tight` heading + `source-tag section-stamp` + a `btn btn-sm` refresh, same
loading / null / error copy shape, same `table-scroll` + `data-table`. **Add no new CSS.**

- Heading `備份`. Stamp: `共 N 個帳號・M 份備份`.
- Table columns: `帳號` / `備份份數` / `最新備份` / `總大小` / `最近狀態`.
- A row expands (click the account row, `aria-expanded` on the toggle) to list its files with a
  `下載` button per file.
- `下載` calls `requestBackupUrl(\`${userId}/${file.name}\`)`; on `{ url }` open it with
  `window.open(url, '_blank', 'noopener')`; on `{ error }` show the message in the same
  `notice notice-warn` block `AccountsSection` uses.
- Sizes rendered as KB/MB with one decimal (`formatBytes` local helper).
- Include a visible note that the download link is short-lived and that only administrators can
  reach these files.

### Wiring — `sources/src/components/Admin/AdminConsolePage.tsx`
Add panel id `backups`, label `備份`, icon `Database` from lucide-react, **appended last** in
`PANELS`, and render `<BackupsSection />` for it.

### What must NOT change
- No change to phase 1's `backup-transactions` function or to schema section 12.
- No new RLS policy, no bucket visibility change — the bucket stays private and only
  service_role reads it.
- No self-service download path for ordinary users. Admin only.
- `assertAdmin` itself is untouched.

## Files

- `sources/supabase/functions/stock-report/backupAdmin.ts` (new)
- `sources/supabase/functions/stock-report/index.ts` (add two action branches + two handlers + import)
- `sources/src/services/adminBackups.ts` (new)
- `sources/src/components/Admin/BackupsSection.tsx` (new)
- `sources/src/components/Admin/AdminConsolePage.tsx` (register the panel)

Tests are already written and are **not** yours to edit:
- `sources/supabase/functions/stock-report/backupAdmin.test.ts`
- `sources/src/services/adminBackups.test.ts`
- `sources/src/components/Admin/BackupsSection.test.tsx`
- `sources/src/components/Admin/AdminConsolePage.test.tsx` (already updated for the 6th panel)

## Verify

From `sources/`:

```
npx vitest run supabase/functions/stock-report/backupAdmin.test.ts src/services/adminBackups.test.ts src/components/Admin/BackupsSection.test.tsx src/components/Admin/AdminConsolePage.test.tsx
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.edge.json
```

Then the full suite: `npm test`. Not done until all of it passes.

## Non-goals

- No deploy.
- No restore-from-backup flow.
- No new Edge Function.
- No changes to any other admin panel.
