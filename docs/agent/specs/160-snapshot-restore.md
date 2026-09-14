# Spec 160 — Full-project snapshot and restore

**Status**: Phase A specified. Lane 2 (schema, auth, cron, Edge, destructive cloud verification).
**Created**: 2026-09-14 Asia/Taipei

## 1. Problem

`backup-transactions` writes one JSON per account into the `backups` bucket. That file covers
three `public` tables for one user. It does not cover:

- `auth.users` / `auth.identities` — accounts and password hashes
- the `public` schema structure
- `storage` objects (`reports`, `backups`)
- which cron jobs must exist

The `backups` bucket also lives inside the Supabase project it backs up. If the project is
deleted, that copy goes with it. Only an offsite copy (Cloudflare R2) and a local copy survive.

## 2. Goal

Two operator scripts:

- `snapshot.cjs` — produce one self-contained snapshot package, and copy it to its destinations
  (local, Supabase Storage).
- `restore.cjs` — take a snapshot package and rebuild a Supabase project from it.

Phase A (this spec) delivers the **pure planning core** plus the two I/O shells.
Phase B (separate spec) is the destructive DEV drill.

## 3. Key decision — cron is not regenerated, it is substituted

`sources/supabase/schema.sql` already contains all 7 `cron.schedule(...)` calls
(lines 696, 714, 743, 825, 874, 1104, 1200) with placeholders:

| Placeholder | Occurrences |
| ---- | ----: |
| `<PROJECT_REF>` | 11 |
| `<CRON_SECRET>` | 14 |
| `<ANON_KEY>` | 1 |

On 2026-08-31 both cloud projects were recreated from this file with the placeholders **never
substituted**. Every cron job then posted to a literal `<PROJECT_REF>` host.

Therefore restore does not build cron SQL from a template of its own. It substitutes the
placeholders in `schema.sql` and **fails loudly if any placeholder survives**. The historical
failure becomes a test, not a comment.

`cron.json` in the package is an **expectation list** used to verify the result, not an input
used to generate it.

## 4. Snapshot package layout

```
.snapshots/snapshot-<ref>-<YYYY-MM-DD>/
  manifest.json
  schema.sql             # supabase db dump --linked --schema public
  data-public.sql        # --data-only --schema public
  data-auth.sql[.gpg]    # --data-only --schema auth, minus ephemeral tables
  cron.json              # jobname + schedule + action slug — never command text
  storage/<bucket>/<path>
```

`.snapshots/` must be added to the repo `.gitignore`. `data-auth.sql` holds every password
hash in the project; this repo is public and push protection does not recognise a bcrypt hash.

### `manifest.json`

```json
{
  "version": 1,
  "ref": "zyebvayngwrqzoaicbwd",
  "createdAt": "2026-09-14T06:00:00.000Z",
  "encrypted": false,
  "files": [{ "path": "schema.sql", "bytes": 39969, "sha256": "..." }]
}
```

`manifest.json` never lists itself. `files` is sorted by `path`.

### `cron.json`

```json
{
  "version": 1,
  "jobs": [{ "jobname": "backup-daily", "schedule": "0 18 * * *", "action": "backup-transactions" }]
}
```

`action` comes from a narrow `regexp_match` on the URL slug. The query must never select
`cron.job.command` — it carries `x-cron-secret`. A job with no HTTP call records
`"action": null` and is restored by `schema.sql`.

### auth dump exclusions

Ephemeral tables carry no recovery value and are excluded:

```
auth.audit_log_entries  auth.sessions  auth.refresh_tokens
auth.flow_state  auth.one_time_tokens  auth.saml_relay_states
```

Verified 2026-09-14: repeated `-x` flags append correctly to the generated `pg_dump` command.

## 5. Phase A contract — `sources/scripts/lib/snapshotPlan.cjs`

Pure CommonJS. No `require` of anything outside `node:crypto`. No network, no filesystem.
This matches `sources/scripts/backup-download.cjs`, which is CommonJS with raw `fetch`.

| Export | Signature | Contract |
| ---- | ---- | ---- |
| `PROD_REF` | `string` | `'hrilemueiqyaoiwnkeuu'` |
| `DEV_REF` | `string` | `'zyebvayngwrqzoaicbwd'` |
| `snapshotDirName` | `(ref, ymd) => string` | `snapshot-<ref>-<ymd>` |
| `parseSnapshotDirName` | `(name) => {ref, ymd} \| null` | Inverse of the above; `null` on any other shape |
| `buildManifest` | `({ref, createdAt, encrypted, files}) => object` | `files` sorted by `path`; `version: 1` |
| `verifyManifest` | `(manifest, actual) => {ok, missing, mismatched, extra}` | `actual` is `{path: sha256}` |
| `assertDestructiveTargetAllowed` | `(ref) => void` | Throws unless `ref === DEV_REF` |
| `cronRowsToPlan` | `(rows) => object` | Drops every key except `jobname`, `schedule`, `action` |
| `substituteCronPlaceholders` | `(sql, {ref, cronSecret}) => {sql, urls, secrets}` | Narrow replace — see §3a. Throws on a blank option or on zero substitutions |
| `AUTH_EXCLUDE_TABLES` | `string[]` | The six tables in §4 |

### Non-goals for Phase A

- No R2 signing in this module. `snapshot.cjs` shells out or reuses the Edge `r2.ts` approach.
- No encryption logic in this module. `snapshot.cjs` shells out to `gpg`.
- No changes to `backup-transactions`, `stock-report`, or any `sources/src/` file.

## 6. Test charter — `sources/scripts/lib/snapshotPlan.test.mjs`

Vitest default `include` covers `**/*.{test,spec}.?(c|m)[jt]s?(x)` and `sources/vite.config.ts`
sets no override, so a `.test.mjs` under `scripts/` is collected.

| # | Case | Expected outcome |
| --- | ---- | ---- |
| S1 | `assertDestructiveTargetAllowed(PROD_REF)` | Throws; message names the ref |
| S2 | `assertDestructiveTargetAllowed('some-other-ref')` | Throws |
| S3 | `assertDestructiveTargetAllowed(DEV_REF)` | Does not throw |
| S4 | `snapshotDirName` → `parseSnapshotDirName` | Round-trips |
| S5 | `parseSnapshotDirName('backups')` | Returns `null` |
| S6 | `buildManifest` with unsorted `files` | `files` comes back sorted by `path`; `version === 1` |
| S7 | `verifyManifest` with identical hashes | `ok === true`, all three arrays empty |
| S8 | `verifyManifest` with one changed hash | `ok === false`, `mismatched` names that path |
| S9 | `verifyManifest` with one absent file | `ok === false`, `missing` names that path |
| S10 | `cronRowsToPlan` given a row that also carries `command` | Serialized output contains neither `command` nor the secret substring |
| S11 | `substitutePlaceholders` on real `schema.sql` text | Contains the new ref; contains no `<PROJECT_REF>`, `<CRON_SECRET>`, `<ANON_KEY>` |
| S12 | `substitutePlaceholders` when `cronSecret` is absent | **Throws** — never emits a surviving placeholder |

Verify command, from `sources/`:

```
npm test -- scripts/lib/snapshotPlan.test.mjs
```

Then `npm run build` must stay exit 0.

## 7. Phase A files

```
sources/scripts/lib/snapshotPlan.cjs        (new — builder writes)
sources/scripts/lib/snapshotPlan.test.mjs   (new — main session writes, before dispatch)
```

Nothing else. `.gitignore` and the two I/O shells land in Phase A-2.

---

## 8. Phase A-2 — the I/O shells

### Files

```
sources/scripts/snapshot.cjs     (new)
sources/scripts/restore.cjs      (new)
sources/scripts/wipe-dev.cjs     (new — drill only, DEV ref hard-gated)
.gitignore                       (done 2026-09-14: .snapshots/ and *.sql.gpg)
sources/package.json             (add snapshot / restore / wipe:dev script entries)
```

### `snapshot.cjs`

1. Resolve the target ref from `sources/supabase/.temp/project-ref`. Print it and refuse to
   continue if `--ref` disagrees.
2. `supabase db dump --linked --schema public -f schema.sql`
3. `supabase db dump --linked --data-only --schema public -f data-public.sql`
4. `supabase db dump --linked --data-only --schema auth` plus one `-x` per entry of
   `AUTH_EXCLUDE_TABLES` → `data-auth.sql`
5. cron: query `jobname`, `schedule`, and the action slug via
   `(regexp_match(command, 'functions/v1/([a-z-]+)'))[1]`. **Never select `command`.**
   Feed the rows through `cronRowsToPlan` → `cron.json`.
6. Storage: list every bucket, download every object to `storage/<bucket>/<path>`.
7. When `SNAPSHOT_PASSPHRASE` is set, `gpg --batch --symmetric` over `data-auth.sql`, then
   delete the plaintext. When it is absent, keep plaintext and print a loud warning.
8. Hash every file, `buildManifest`, write `manifest.json`.
9. Copy the package to the destinations named by `--to=local,storage` (default `local`).

**`manifest.json` is excluded from its own `files` list and from the hash set passed to
`verifyManifest`.** `verifyManifest` returns `ok:false` on any extra path, so a caller that
hashes the whole directory without excluding `manifest.json` will always report a corrupt
package.

### `restore.cjs`

Runs steps 2, 3, 4, 5, 7, 8 and 10 of the recovery runbook. Steps 1, 6 and 9 are human.

1. `verifyManifest` first. Refuse to write anything if the package fails its hashes.
2. `substitutePlaceholders(schema.sql, {ref, cronSecret, anonKey})` — throws rather than
   emit a live placeholder.
3. Apply in this order: `schema.sql` → `data-auth.sql` → `data-public.sql` → storage uploads.
   `public` rows carry `user_id` foreign keys onto `auth.users`; auth must land first.
4. Verify against `cron.json`: every `jobname` present with the recorded `schedule`.

### `wipe-dev.cjs` — drill only

`assertDestructiveTargetAllowed(ref)` is the first call in the file. It is the only guard that
stops this script from running against PROD.

Order: `public` schema → auth rows → storage objects. cron and Edge deployments stay.

### Drill limitation — state it in PROGRESS.md

Wiping and restoring the **same** project does not test GoTrue schema drift, which is the
largest real risk in a true disaster. The drill proves the scripts' mechanics only. A
new-project restore remains untested until a throwaway project is available.

---

## 3a. Correction (2026-09-14) — substitution must be narrow, not blanket

A blanket replace of every placeholder breaks `schema.sql`. The same placeholder text serves
two different jobs in that file:

| Form | Count | Action |
| ---- | ----: | ---- |
| `https://<PROJECT_REF>.supabase.co` | 6 | **substitute** — inside `cron.schedule` command bodies |
| `'x-cron-secret', '<CRON_SECRET>'` | 6 | **substitute** |
| `<PROJECT_REF>` in comments (lines 369, 503, 1213) | 3 | keep |
| `LIKE '%<PROJECT_REF>%'` (line 1230) | 1 | **keep — this is a search pattern, not a value** |
| the exception message (line 1235) | 1 | keep |
| `<ANON_KEY>` (line 422, a comment) | 1 | keep — never a substitution target |

Line 1230 is the guard that raises when a cron job still carries an unsubstituted placeholder.
It runs `SELECT count(*) FROM cron.job WHERE command LIKE '%<PROJECT_REF>%'` against the live
table. Substituting that literal turns it into "count the jobs that contain the new ref" — 6 —
and the guard aborts the entire restore. Blanket substitution is therefore self-defeating.

`substituteCronPlaceholders` replaces only the two exact forms above, and throws if it made
zero substitutions — a silent no-op would leave the caller believing cron was rebuilt.

## 3b. Correction (2026-09-14) — the package needs `setup.sql`

`supabase db dump --schema public` does **not** emit any `cron.schedule` call (cron lives in the
`cron` schema), so the package's `schema.sql` cannot rebuild the 7 jobs. Verified: 0 occurrences.

The package therefore also carries `setup.sql`, a copy of the repo's `sources/supabase/schema.sql`
— the maintained, idempotent environment builder that owns the cron section and its own guard.

Restore applies `setup.sql` (after narrow substitution), then the data files. The pg_dump
`schema.sql` stays in the package as the structural record for drift comparison, unapplied.

---

## 9. Scope change (2026-09-14) — Cloudflare R2 is out

The user removed R2 from this task. Recorded so the next agent does not re-add it.

**Removed**: the `r2` destination, its SigV4 signing, and every `R2_*` variable in
`sources/scripts/snapshot.cjs`.

**Deliberately left alone** — removing these would be a larger change than was asked for, and
each is currently inert:

| Thing | Why it stays |
| ---- | ---- |
| `sources/supabase/functions/backup-transactions/r2.ts` | Shipped in 0.9.49, never deployed. `readR2Config()` returns `null` with no `R2_*` secrets set, so the nightly job records `r2_status: 'skipped'`. |
| The `r2_status` / `r2_error` reads in `stock-report/index.ts` | Already shipped in the same release. |
| `backup_run_log.r2_status` / `.r2_error` on DEV | Added 2026-09-14. **Do not drop them.** `stock-report/index.ts:3867` names both columns in its `SELECT`; PostgREST fails the whole request on an unknown column, so dropping them would take the admin backups page down the moment that function is deployed. |

**Consequence for recovery**: the snapshot package now has no copy outside the Supabase
account. `local` is the only destination in the blast-radius diagram that survives the project
being deleted. That is a real reduction in coverage, not a neutral simplification.
