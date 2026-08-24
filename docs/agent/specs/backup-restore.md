# Spec — one-click restore from a backup (admin console)

Status: ready for builder
Follows `docs/agent/specs/backup-admin-console.md` (0.9.11). Restore was a non-goal there; this
spec closes it.

## Goal

An admin picks a backup file in the console, sees a preview of exactly what would change, confirms,
and the missing rows are written back. Nothing is ever deleted or overwritten.

## Safety rules — these are the point of the feature

1. **Restore is additive only.** A row whose key already exists is left untouched. No DELETE, no
   UPDATE, no upsert-with-overwrite. A user who edited a transaction after the backup keeps their
   edit.
2. **The file's account must match the path.** `<uuid>/<date>.json` -> the document's `user_id`
   must equal that uuid, and **every row in every table** must carry that same `user_id`. Any
   mismatch aborts before a single write. This is what stops a tampered file from writing into
   another account.
3. **Preview and apply are separate calls.** The UI must never write on the first click.
4. **Parents before children.** `workspaces` -> `transactions` -> `user_settings`. `transactions`
   has a composite FK `(workspace_id, user_id)` onto `workspaces`, so the reverse order fails.
5. Admin only, same `assertAdmin` gate as the rest of the console.

## Contract

### Edge — new action `admin-backup-restore`
- Gate: `assertAdmin(req)` first, exactly like `admin-backups`.
- Body: `{ path: string, apply?: boolean }`.
- `isValidBackupPath(path)` must pass -> else 400 `{ error: '備份路徑格式不正確' }`.
- Download the object with the service-role client, `JSON.parse` it, then
  `parseBackupDocument(raw, <uuid from the path>)`. On failure -> 400 with that error message.
- Compute, per table, which rows are missing (key field: `id` for `workspaces` and `transactions`,
  `user_id` for `user_settings`).
- `apply !== true` -> return the preview only, writing nothing.
- `apply === true` -> insert the missing rows, parents first, using
  `upsert(rows, { onConflict: <key>, ignoreDuplicates: true })` so a row that appeared between
  preview and apply is still not overwritten.
- Response, both modes:
  `{ ok: true, applied: boolean, backupDate, tables: { workspaces: {inFile, present, missing}, transactions: {...}, user_settings: {...} } }`
  where after an apply `missing` reports how many were actually written.
- Storage read failure -> 404 `{ error: '找不到備份檔' }`.

### New pure functions in `sources/supabase/functions/stock-report/backupAdmin.ts`

```ts
export type BackupRow = Record<string, unknown>

export interface BackupDocument {
  version: number
  user_id: string
  backup_date: string
  exported_at: string
  tables: { workspaces: BackupRow[]; transactions: BackupRow[]; user_settings: BackupRow[] }
}

/** Validates shape, version and — critically — that every row belongs to `expectedUserId`. */
export function parseBackupDocument(
  raw: unknown,
  expectedUserId: string,
): { ok: true; doc: BackupDocument } | { ok: false; error: string }

/** Rows from the file whose key is not already present. Order is preserved. */
export function rowsToInsert(
  fileRows: BackupRow[],
  existingKeys: string[],
  keyField: string,
): BackupRow[]
```

Error messages `parseBackupDocument` returns (Traditional Chinese, shown to the admin):
- not an object / missing `tables` -> `'備份檔格式無法辨識'`
- `version` is not 1 -> `'備份檔版本不支援'`
- a table is missing or not an array -> `'備份檔缺少資料表：<name>'`
- document `user_id` differs from the path -> `'備份檔的帳號與路徑不符'`
- any row's `user_id` differs -> `'備份檔內有不屬於該帳號的資料列'`

### Service — `sources/src/services/adminBackups.ts`

```ts
export interface RestoreTableStat { inFile: number; present: number; missing: number }
export interface RestoreResult {
  applied: boolean
  backupDate: string
  tables: { workspaces: RestoreTableStat; transactions: RestoreTableStat; user_settings: RestoreTableStat }
}
export function previewBackupRestore(path: string): Promise<RestoreResult | { error: string }>
export function applyBackupRestore(path: string): Promise<RestoreResult | { error: string }>
```
Same house shape as `requestBackupUrl`: `supabase.functions.invoke('stock-report', { body: { action: 'admin-backup-restore', path, apply }, timeout: 20_000 })`, defensive parsing, `httpErrorMessage` for non-2xx, never throws.

### UI — `sources/src/components/Admin/BackupsSection.tsx`

Next to each file's `下載` button add `還原`.
- Clicking `還原` calls `previewBackupRestore` and opens an inline confirm block under that row
  showing, per table, `檔案 N 筆 / 已存在 M 筆 / 將新增 K 筆`, plus the sentence
  **「還原只會補回缺少的資料，不會覆蓋或刪除現有資料。」**
- The confirm block has `確認還原` and `取消`. Only `確認還原` calls `applyBackupRestore`.
- After applying, show the written counts and refresh the list.
- Errors render in the existing `notice notice-warn` block.
- If every table's `missing` is 0, say `目前資料完整，沒有需要補回的項目` and **disable** `確認還原`.
- Add no new CSS.

## Files

- `sources/supabase/functions/stock-report/backupAdmin.ts`
- `sources/supabase/functions/stock-report/index.ts` (one action branch + one handler + imports)
- `sources/src/services/adminBackups.ts`
- `sources/src/components/Admin/BackupsSection.tsx`

Tests are already written and are **not** yours to edit:
- `sources/supabase/functions/stock-report/backupAdmin.test.ts`
- `sources/src/services/adminBackups.test.ts`
- `sources/src/components/Admin/BackupsSection.test.tsx`

## Verify

From `sources/`:
```
npx vitest run supabase/functions/stock-report/backupAdmin.test.ts src/services/adminBackups.test.ts src/components/Admin/BackupsSection.test.tsx
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.edge.json
npm test
```

## Non-goals

- No deploy.
- No "full rollback to that day" mode — that would delete later rows and is deliberately excluded.
- No audit table for restores (noted as a follow-up, not built here).
- No cross-account restore, ever.
- No schema change.
