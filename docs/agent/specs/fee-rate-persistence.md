# Spec — persist the workspace fee rate in Supabase

Task id: `fee-rate-persistence`
Lane: 2 (persistence + schema + a fee value that drives money maths)

## Problem

`getFeeRate()` / `setFeeRate()` (`sources/src/utils/settings.ts:60,68`) keep the fee rate only in
`localStorage`. A new browser profile or an incognito window has an empty `localStorage`, so the app
falls back to `DEFAULT_FEE_RATE` (0.001425). The saved rate is lost.

`sources/supabase/schema.sql:133` has an unused `user_settings.default_fee_rate` column. No front-end
code reads or writes it. It is per user, but the UI stores one rate **per workspace**
(`AppShell.tsx:534`), so that column cannot hold the data. The rate belongs on `workspaces`.

## Contract

Add a nullable `workspaces.fee_rate` column. `NULL` means "the user never set a rate here".

`localStorage` stays the read path, because `getFeeRate()` is synchronous and is called during render
by six modules. It becomes a **cache**. Supabase becomes the source of truth.

At workspace bootstrap, reconcile the row and the cache:

| Row `fee_rate` | `localStorage` | Action |
| --- | --- | --- |
| valid, differs from cache | any | `adopt-remote` — write the row value into `localStorage` |
| valid, equal to cache | equal | `none` |
| `NULL` / absent / invalid | valid | `push-local` — write the cache value into the row (one-time migration) |
| `NULL` / absent / invalid | none | `none` — readers use `DEFAULT_FEE_RATE` |

A rate is valid when it is a finite number, `>= 0` and `< 1`. **`0` is valid** — do not treat it as unset.

On save, write both: `localStorage` first, then the row.

### What must NOT change

- The signature and the fallback order of `getFeeRate` / `setFeeRate` / `getMinFee` / `setMinFee`.
- `DEFAULT_FEE_RATE`, `DEFAULT_MIN_FEE_WHOLE`, `DEFAULT_MIN_FEE_ODD`.
- The batch-recalculation prompt in `AppShell.tsx` (`setShowRecalc`).
- Local mode (no Supabase). `LocalProvider` must persist the rate in its own store.
- A Supabase write failure must never block login or throw into the render tree. Swallow it.

## Files

Touch only these:

- `sources/supabase/schema.sql` — add the column, in section 1 next to `workspaces`.
- `sources/src/types/models.ts` — `Workspace` gains `fee_rate?: number | null`.
- `sources/src/utils/settings.ts` — export `getStoredFeeRate(workspaceId?): number | null`.
- `sources/src/utils/feeSync.ts` — **new**, pure.
- `sources/src/services/feeSettings.ts` — **new**.
- `sources/src/services/dataProvider.ts` — `setWorkspaceFeeRate` on the interface and both classes; select `fee_rate`.
- `sources/src/context/WorkspaceContext.tsx` — reconcile at bootstrap; expose `setWorkspaceFeeRate`.
- `sources/src/components/AppShell.tsx` — the fee modal save path writes through.

## API to implement

```ts
// sources/src/utils/feeSync.ts
export type FeeSyncAction =
  | { kind: 'adopt-remote'; rate: number }
  | { kind: 'push-local'; rate: number }
  | { kind: 'none' }

export function isValidFeeRate(v: unknown): v is number
export function planFeeSync(remote: number | null | undefined, local: number | null): FeeSyncAction

// sources/src/utils/settings.ts
/** The stored rate, or null when the user never set one. Unlike getFeeRate, no default. */
export function getStoredFeeRate(workspaceId?: string): number | null

// sources/src/services/feeSettings.ts
export async function syncWorkspaceFees(list: Workspace[], provider: DataProvider): Promise<void>
export async function saveWorkspaceFeeRate(
  provider: DataProvider,
  workspaceId: string,
  rate: number,
): Promise<void>

// sources/src/services/dataProvider.ts — DataProvider
setWorkspaceFeeRate(id: string, rate: number): Promise<void>
```

`syncWorkspaceFees` runs `planFeeSync` per workspace and applies the action. It must not reject.

`WorkspaceContext` calls `await syncWorkspaceFees(list, provider)` **before** `setWorkspaces(list)`, so
the first render that has a workspace id already sees the reconciled cache.

`WorkspaceState` gains `setWorkspaceFeeRate: (id: string, rate: number) => Promise<void>`. It calls
`saveWorkspaceFeeRate` and updates the matching row in the `workspaces` state.

`AppShell.tsx` fee modal: keep the existing validation and `setShowRecalc(changed)` behaviour, and
replace the bare `setFeeRate(rate, current.id)` with the context method.

## Schema statement

```sql
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS fee_rate NUMERIC;
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_fee_rate_range;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_fee_rate_range
    CHECK (fee_rate IS NULL OR (fee_rate >= 0 AND fee_rate < 1));
```

`schema.sql` is re-runnable. Keep the statements idempotent. There is no `migrations/` directory.

## Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| S1 | remote valid, no cache -> `adopt-remote` | `src/utils/feeSync.test.ts` |
| S2 | remote valid, cache differs -> `adopt-remote` with the remote rate | same |
| S3 | remote valid, cache equal -> `none` | same |
| S4 | remote `null`, cache valid -> `push-local` | same |
| S5 | remote `null`, no cache -> `none` | same |
| S6 | remote `undefined`, no cache -> `none` | same |
| S7 | remote out of range, cache valid -> `push-local` | same |
| S8 | remote `0`, no cache -> `adopt-remote` 0 (zero is not "unset") | same |
| F1 | sync adopts a remote rate into the cache, writes nothing back | `src/services/feeSettings.test.ts` |
| F2 | sync pushes a cache-only rate to the provider, cache unchanged | same |
| F3 | sync with neither value calls nothing; reads fall back to the default | same |
| F4 | two workspaces reconcile independently | same |
| F5 | a provider error during push does not reject | same |
| F6 | save writes the cache and the provider; a provider error keeps the cache | same |

## Verify

From `sources/`:

```
npx vitest run src/utils/feeSync.test.ts src/services/feeSettings.test.ts
npx vitest run
npx tsc --noEmit
npm run build
```

Check the exit code, not the summary line.

## Non-goals

- Do not persist the minimum fee. `setMinFee` in `utils/settings.ts` has no caller, so there is no
  value to persist. Leave both min-fee functions alone.
- Do not touch `user_settings.default_fee_rate`. It stays unused.
- Do not make `getFeeRate` async, and do not change its call sites.
- No new UI, no migration script, no deploy.

---

## Revision 2 — deployment safety (2026-08-31)

`schema.sql` is not applied automatically, and this session has no Supabase access token.
A deploy that lands before the SQL runs would make `SupabaseProvider.listWorkspaces` select a
column the database does not have. PostgREST rejects the **whole query** for an unknown column,
so every login would fail with `載入工作區失敗` — worse than the bug being fixed.

### Added contract

`sources/src/services/dataProvider.ts`:

```ts
const WORKSPACE_COLUMNS = 'id, name, created_at, fee_rate'
/** Without fee_rate, for a database that has not run that part of schema.sql. */
const WORKSPACE_COLUMNS_LEGACY = 'id, name, created_at'
```

- `listWorkspaces` runs the `WORKSPACE_COLUMNS` query first. On **any** error it retries once with
  `WORKSPACE_COLUMNS_LEGACY`. Only the retry's error throws `載入工作區失敗：<message>`.
  Match on the error's presence, not on the code `42703` — a self-hosted PostgREST may report the
  same condition differently.
- `createWorkspace` keeps `WORKSPACE_COLUMNS_LEGACY`. Do **not** add a retry there: the insert may
  already have run, so a second attempt can create a duplicate workspace. A new row's `fee_rate` is
  always `NULL`, and `planFeeSync` treats the absent field and `NULL` the same, so nothing is lost.
  This supersedes the reviewer's RISK on `createWorkspace`.
- `setWorkspaceFeeRate` keeps throwing `儲存手續費率失敗：<message>`. Its callers already swallow it.

### Added tests (already written, currently red on D2)

`sources/src/services/dataProvider.workspaces.test.ts`

| Case | Expected outcome |
| --- | --- |
| D1 | one query, asking for `id, name, created_at, fee_rate` |
| D2 | first query errors -> retry with `id, name, created_at`, return those rows |
| D3 | retry also errors -> throw `載入工作區失敗` |
| D4 | `setWorkspaceFeeRate` throws `儲存手續費率失敗` on error |
