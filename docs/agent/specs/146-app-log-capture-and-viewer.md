# Spec 146: Application Log Capture & Admin Viewer

Status: 📝 SPECIFIED
Date: 2026-09-06 Asia/Taipei
Reference: User request 2026-09-06 — "add a log section in the admin console to see which problems we hit"
Related: Spec 144 Feature 2 (read-only viewer over existing tables). See § 8.

---

## 1. Problem

The project cannot show what went wrong at run time. Three gaps:

1. **Edge Functions emit no diagnostics.** `sources/supabase/functions/stock-report/index.ts` has no
   `console.log`. It writes only structured success rows to `batch_run_log` and
   `source_probe_tick`. An exception becomes an HTTP status and a response body that nobody keeps.
2. **The web app swallows errors.** Service functions catch, then `return null` or `[]`
   (`sources/src/services/*`). There is no ErrorBoundary. A failure renders an empty state.
3. **The existing log tables record outcomes, not causes.** `batch_run_log`, `source_probe_log`,
   `source_probe_tick` and `admin_run_log` store flags and durations. None stores an error message,
   a stack, or a client-side event.

Result: a user reports "the page is blank" and no record exists.

## 2. Solution

Add one capture table, `public.app_log`, that all three layers write to. Add one admin panel that
reads it through the existing Edge + `assertAdmin` path.

`app_log` is the **capture** layer. Spec 144 Feature 2 stays the **read** layer for cron and probe
tables. Both appear in the same admin panel as separate tabs (§ 8).

---

## 3. Contract

### 3.1 Table `public.app_log`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `bigserial` | primary key |
| `at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `level` | `text` | `NOT NULL`, `CHECK (level IN ('error','warn','info'))` |
| `source` | `text` | `NOT NULL`, `CHECK (source IN ('edge','web','db'))` |
| `action` | `text` | `NOT NULL`, `CHECK (char_length(action) <= 64)` — event name, e.g. `generate-all`, `importCsv` |
| `message` | `text` | `NOT NULL`, `CHECK (char_length(message) <= 500)` |
| `detail` | `jsonb` | `NOT NULL DEFAULT '{}'::jsonb`. Size is capped by the application allowlist and truncation (§ 3.4), not by a CHECK — `pg_column_size` is not immutable and does not belong in one |
| `user_id` | `uuid` | `REFERENCES auth.users(id) ON DELETE SET NULL`, nullable |
| `app_version` | `text` | nullable |
| `request_id` | `text` | nullable — one value links a web event to the edge event it caused |

Indexes: `(at DESC)`; `(level, at DESC)`; `(request_id) WHERE request_id IS NOT NULL`.

RLS: enabled. **Exactly one policy:**

```sql
CREATE POLICY app_log_insert_own ON app_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND source = 'web');
```

No `SELECT` policy exists. Only `service_role` reads. The admin panel therefore reads through the
Edge Function, the same as `fetchAdminStatus`.

Retention: one new pg_cron job `app-log-prune`, daily, pure SQL, no secret in the command:

```sql
DELETE FROM public.app_log WHERE at < now() - interval '30 days';
```

### 3.2 Write API — Edge

New file `sources/supabase/functions/_shared/log.ts`:

```ts
export async function logEvent(
  admin: SupabaseClient,
  e: { level: 'error'|'warn'|'info'; action: string; message: string;
       detail?: Record<string, unknown>; userId?: string | null; requestId?: string | null },
): Promise<void>
```

- It uses the service-role client the caller already holds.
- It sets `source = 'edge'`.
- It **never throws and never rejects**. It wraps its own insert in `try/catch` and discards the
  error. A log failure must not change the caller's result.
- It calls `redactDetail()` (§ 3.4) before the insert.

### 3.3 Write API — web

New file `sources/src/services/appLog.ts`:

```ts
export function logClient(
  level: 'error'|'warn'|'info', action: string, message: string,
  detail?: Record<string, unknown>,
): void
```

- Fire and forget. It returns `void` and never throws.
- It is a no-op when `supabase` is `null`, or when no session exists (RLS would reject the row).
- It sets `source = 'web'`, `user_id` from the session, `app_version` from `APP_VERSION` (`sources/src/version.ts`).
- **Dedupe:** it drops a repeat of the same `action + message` inside **5 minutes**. A render loop
  must not write thousands of rows. The window must stay longer than any poll interval that
  reaches a log site: the app has two 60 s price-poll loops (`useStockPrices.ts`,
  `WatchSection.tsx`), and a 60 s window deduped nothing against them — consecutive polls land
  exactly one window apart, so a sustained outage wrote one row per minute per open tab.
- It calls `redactDetail()` before the insert.

### 3.4 Redaction — `redactDetail()`

An **allowlist of keys**, not a denylist and not a regex over values:

```
ticker, count, status, code, hint, stack, path, duration_ms, ymd, attempt, name
```

- It drops every other key, at every depth, including inside arrays.
- It truncates `stack` to 2000 characters and every other string value to 500.
- It keeps at most **20 elements** of any array. An array is the only place `detail` can grow
  without bound — the allowlist caps the key count and truncation caps each string, but nothing
  caps the element count, and `app_log.detail` has no size CHECK in the database.
- Rationale: a redaction regex already printed the DEV `CRON_SECRET` into a transcript once. A
  denylist fails open; an allowlist fails closed.

### 3.5 Read API

- `public.admin_recent_app_logs(p_limit int DEFAULT 100, p_level text DEFAULT NULL, p_source text
  DEFAULT NULL, p_before timestamptz DEFAULT NULL)` in `sources/supabase/schema.sql`.
  `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL FROM public/anon/authenticated`,
  `GRANT EXECUTE TO service_role`. It returns rows ordered `at DESC`, capped at 500.
- `stock-report` action `app-logs`, gated by the existing `assertAdmin(req)`.
- `fetchAppLogs()` in `sources/src/services/appLog.ts`, following the defensive field-by-field parse
  style of `fetchAdminStatus` (`adminStatus.ts:160`).

### 3.6 What must not change

- The response shape of every existing `stock-report` action.
- The behaviour of any caller when logging fails.
- The `verify_jwt` setting of any Edge Function.
- Any existing table, policy, or cron job.

---

## 4. Files

Phase 1 — capture on the edge, plus the viewer:
- `sources/supabase/schema.sql` — table, policy, indexes, RPC, cron job
- `sources/supabase/functions/_shared/log.ts` — new
- `sources/supabase/functions/stock-report/index.ts` — top-level catch calls `logEvent`; new `app-logs` action
- `sources/supabase/functions/stock-price/index.ts` — top-level catch calls `logEvent`
- `sources/supabase/functions/backup-transactions/index.ts` — top-level catch calls `logEvent`
- `sources/src/services/appLog.ts` — new (`redactDetail`, `logClient`, `fetchAppLogs`, types)
- `sources/src/components/Admin/LogsSection.tsx` — new
- `sources/src/components/Admin/AdminConsolePage.tsx` — one `PANELS` entry, id `logs`
- `sources/src/index.css` (or the file that holds the `adm-*` rules) — panel styles

Phase 2 — capture in the browser:
- `sources/src/components/ErrorBoundary.tsx` — new; the app had none
- `sources/src/main.tsx` — wrap `App`, inside `StrictMode`
- the 14 silent `catch` blocks, mapped 2026-09-06:
  `aiChatStore.ts` (4), `feeSettings.ts` (2), `priceProxy.ts` (4), `reportsBucket.ts` (1),
  `twMarketData.ts` (3). `appLog.ts` is exempt — logging from its own catch is recursion.

Phase 3 — capture on accounting writes:
- `sources/src/services/dataProvider.ts` — `addTransactions`, `updateTransaction`,
  `deleteTransactions`. These three already **throw**; they do not swallow. The change records
  the failure and leaves the throw exactly as it is, because every caller depends on it.

---

## 5. Verify

From `sources/`:

```
npm test -- src/services/appLog.test.ts
npm run build          # the real type gate; npx tsc --noEmit skips test files
npm run typecheck:edge # separate gate; npm run build skips supabase/functions
```

DDL runs against DEV only, through `supabase db query --linked` from `sources/`, wrapped in the
identity guard:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%zyebvayngwrqzoaicbwd%') THEN
    RAISE EXCEPTION 'ABORT: this database is not DEV';
  END IF;
  -- DDL here
END $$;
```

After DDL: `NOTIFY pgrst, 'reload schema';`

---

## 6. Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| `redactDetail` keeps an allowlisted key | `{ ticker: '2330' }` survives | unit / `appLog.test.ts` |
| `redactDetail` drops an unknown key | `{ apikey: 'x' }` becomes `{}` | unit / `appLog.test.ts` |
| `redactDetail` drops a nested unknown key | `{ code: 'x', headers: { authorization: 'y' } }` keeps only `code` | unit / `appLog.test.ts` |
| `redactDetail` truncates a string inside an array | length 500 | unit / `appLog.test.ts` |
| `redactDetail` caps an array at 20 elements | length 20 | unit / `appLog.test.ts` |
| `redactDetail` truncates `stack` | length 2000 | unit / `appLog.test.ts` |
| `redactDetail` truncates a normal string | length 500 | unit / `appLog.test.ts` |
| `logClient` with no supabase client | no throw, no insert | unit / `appLog.test.ts` |
| `logClient` with no session | no insert | unit / `appLog.test.ts` |
| `logClient` when the insert rejects | no throw | unit / `appLog.test.ts` |
| `logClient` repeats inside the dedupe window | second call inserts nothing | unit / `appLog.test.ts` |
| `logClient` repeats after the dedupe window | second call inserts | unit / `appLog.test.ts` |
| ErrorBoundary catches a non-Error throw | fallback shown, message is `'null'`, no second throw | component / `ErrorBoundary.test.tsx` |
| `fetchAppLogs` on a non-ok response | returns `[]`, no throw | unit / `appLog.test.ts` |
| `fetchAppLogs` on a malformed row | drops the row, keeps the valid rows | unit / `appLog.test.ts` |
| ErrorBoundary renders children when nothing throws | children visible, no log | component / `ErrorBoundary.test.tsx` |
| ErrorBoundary catches a render throw | fallback shown instead of a blank page | component / `ErrorBoundary.test.tsx` |
| ErrorBoundary records the throw | `logClient('error','render',…)` with a stack | component / `ErrorBoundary.test.tsx` |
| ErrorBoundary offers a way out | a 重新載入 button exists | component / `ErrorBoundary.test.tsx` |
| every catch in the five service files records | `logClient` present in each block | structural / `catchLogging.test.ts` |
| the scanner still finds all 14 catch blocks | counts match | structural / `catchLogging.test.ts` |
| `appLog.ts` catches stay silent | no `logClient` in its own catch | structural / `catchLogging.test.ts` |
| `addTransactions` fails | logs once, still throws 寫入交易失敗 | unit / `dataProvider.txLogging.test.ts` |
| `updateTransaction` fails | logs once, still throws 更新交易失敗 | unit / `dataProvider.txLogging.test.ts` |
| `deleteTransactions` fails | logs once, still throws 刪除交易失敗 | unit / `dataProvider.txLogging.test.ts` |
| a failed write records the code, not the row | `detail.code` set, no ticker in `detail` | unit / `dataProvider.txLogging.test.ts` |
| a successful write | logs nothing | unit / `dataProvider.txLogging.test.ts` |

---

## 7. Non-goals — the negative cases

The implementation **must not**:

1. Write any header, cookie, `Authorization`, `apikey`, token, or `*_SECRET` value into `detail`.
   The allowlist in § 3.4 is the only permitted filter.
2. Select `cron.job.command`, redacted or otherwise. It carries `x-cron-secret`.
3. Add a `SELECT` policy on `app_log`. Reads go through Edge + `assertAdmin` only.
4. Let a logging failure change, delay, or fail the caller's operation.
5. Call `logClient` or `logEvent` from inside the logger's own error path. No recursion.
6. Log at `info` level on a hot path. `info` is for batch start/end, not per-row work.
7. Touch PROD. DEV DDL only, until the user asks.
8. Change any existing test, spec, or tracking record.

---

## 8. Relationship to Spec 144 Feature 2

Spec 144 Feature 2 specifies `admin_get_recent_logs()` over `cron.job_run_details`,
`source_probe_tick`, `batch_run_log` and `admin_run_log` — data that already exists. Spec 146 adds
the data that does not exist yet.

The two share one admin panel, id `logs`. Spec 146 Phase 1 builds the panel with the `app_log` tab.
Spec 144 Feature 2 later adds the cron and probe tabs to the same component. Do not build a second
panel.

## 9. Known side effect

DEV pg_cron job count goes from **6 to 7** (`app-log-prune`). `CLAUDE.md` and `PROGRESS.md` name 6.
The count was never a valid project identity check; the `EXISTS (... command LIKE '%<ref>%')`
predicate is. Update the count where it appears.
