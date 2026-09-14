// Spec 160 §6 — pure planning core for snapshot.cjs / restore.cjs.
//
// The module under test is CommonJS so `snapshot.cjs` can `require` it; this test is ESM so
// vitest collects it under the default include (`**/*.test.?(c|m)[jt]s`).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

import plan from './snapshotPlan.cjs'

const {
  PROD_REF,
  DEV_REF,
  snapshotDirName,
  parseSnapshotDirName,
  buildManifest,
  verifyManifest,
  assertDestructiveTargetAllowed,
  cronRowsToPlan,
  substituteCronPlaceholders,
  AUTH_EXCLUDE_TABLES,
} = plan

const HERE = dirname(fileURLToPath(import.meta.url))
const SCHEMA_SQL = join(HERE, '..', '..', 'supabase', 'schema.sql')

describe('assertDestructiveTargetAllowed (S1–S3)', () => {
  it('S1 — refuses the PROD ref and names it', () => {
    expect(() => assertDestructiveTargetAllowed(PROD_REF)).toThrowError(new RegExp(PROD_REF))
  })

  it('S2 — refuses a ref that is neither DEV nor PROD', () => {
    expect(() => assertDestructiveTargetAllowed('egofadbvftmbwodjneoy')).toThrow()
  })

  it('S3 — allows the DEV ref', () => {
    expect(() => assertDestructiveTargetAllowed(DEV_REF)).not.toThrow()
  })
})

describe('snapshot directory naming (S4–S5)', () => {
  it('S4 — round-trips through parse', () => {
    const name = snapshotDirName(DEV_REF, '2026-09-14')
    expect(name).toBe(`snapshot-${DEV_REF}-2026-09-14`)
    expect(parseSnapshotDirName(name)).toEqual({ ref: DEV_REF, ymd: '2026-09-14' })
  })

  it('S5 — returns null for anything that is not a snapshot directory', () => {
    expect(parseSnapshotDirName('backups')).toBeNull()
    expect(parseSnapshotDirName('snapshot-abc')).toBeNull()
    expect(parseSnapshotDirName(`snapshot-${DEV_REF}-2026-9-14`)).toBeNull()
  })
})

describe('manifest (S6–S9)', () => {
  const files = [
    { path: 'storage/reports/a.json', bytes: 10, sha256: 'cc' },
    { path: 'schema.sql', bytes: 100, sha256: 'aa' },
    { path: 'data-public.sql', bytes: 50, sha256: 'bb' },
  ]

  it('S6 — sorts files by path and stamps version 1', () => {
    const m = buildManifest({
      ref: DEV_REF,
      createdAt: '2026-09-14T06:00:00.000Z',
      encrypted: false,
      files,
    })
    expect(m.version).toBe(1)
    expect(m.ref).toBe(DEV_REF)
    expect(m.files.map((f) => f.path)).toEqual([
      'data-public.sql',
      'schema.sql',
      'storage/reports/a.json',
    ])
  })

  it('S7 — passes when every hash matches', () => {
    const m = buildManifest({ ref: DEV_REF, createdAt: 'x', encrypted: false, files })
    const actual = { 'schema.sql': 'aa', 'data-public.sql': 'bb', 'storage/reports/a.json': 'cc' }
    expect(verifyManifest(m, actual)).toEqual({
      ok: true,
      missing: [],
      mismatched: [],
      extra: [],
    })
  })

  it('S8 — fails and names the path whose hash changed', () => {
    const m = buildManifest({ ref: DEV_REF, createdAt: 'x', encrypted: false, files })
    const actual = { 'schema.sql': 'aa', 'data-public.sql': 'CHANGED', 'storage/reports/a.json': 'cc' }
    const res = verifyManifest(m, actual)
    expect(res.ok).toBe(false)
    expect(res.mismatched).toEqual(['data-public.sql'])
    expect(res.missing).toEqual([])
  })

  it('S9 — fails and names the path that is absent', () => {
    const m = buildManifest({ ref: DEV_REF, createdAt: 'x', encrypted: false, files })
    const actual = { 'schema.sql': 'aa', 'data-public.sql': 'bb' }
    const res = verifyManifest(m, actual)
    expect(res.ok).toBe(false)
    expect(res.missing).toEqual(['storage/reports/a.json'])
    expect(res.mismatched).toEqual([])
  })
})

describe('cronRowsToPlan (S10)', () => {
  it('S10 — drops the command text, so no secret can reach the package', () => {
    const rows = [
      {
        jobid: 6,
        jobname: 'backup-daily',
        schedule: '0 18 * * *',
        action: 'backup-transactions',
        command: "SELECT net.http_post(headers := jsonb_build_object('x-cron-secret','s3cr3t-v4lue'));",
      },
      { jobid: 7, jobname: 'app-log-prune', schedule: '20 3 * * *', action: null, command: 'DELETE FROM app_log;' },
    ]

    const out = cronRowsToPlan(rows)
    const serialized = JSON.stringify(out)

    expect(serialized).not.toContain('s3cr3t-v4lue')
    expect(serialized).not.toContain('command')
    expect(serialized).not.toContain('http_post')
    expect(out.version).toBe(1)
    expect(out.jobs).toEqual([
      { jobname: 'backup-daily', schedule: '0 18 * * *', action: 'backup-transactions' },
      { jobname: 'app-log-prune', schedule: '20 3 * * *', action: null },
    ])
  })
})

describe('substituteCronPlaceholders (S11–S12)', () => {
  // 2026-08-31: both cloud projects were recreated from schema.sql with the placeholders never
  // substituted, so every cron job posted to a literal `<PROJECT_REF>` host.
  //
  // But a blanket replace is just as broken. schema.sql uses the same placeholder text for two
  // different jobs: the cron command bodies (must be substituted) AND the guard block at line
  // 1230, `WHERE command LIKE '%<PROJECT_REF>%'`, which is a SEARCH PATTERN run against the live
  // cron.job table. Substituting that turns it into "count jobs containing the new ref" — 6 —
  // and the guard aborts the whole restore. So substitution must be narrow.
  it('S11 — substitutes only the cron command bodies of the real schema.sql', () => {
    const sql = readFileSync(SCHEMA_SQL, 'utf8')
    const { sql: out } = substituteCronPlaceholders(sql, {
      ref: 'newprojectref00000ab',
      cronSecret: 'new-cron-secret',
    })

    // The 6 cron URLs and 6 secret headers are gone.
    expect(out).toContain('https://newprojectref00000ab.supabase.co')
    expect(out).not.toContain('https://<PROJECT_REF>.supabase.co')
    expect(out).not.toMatch(/'x-cron-secret',\s*'<CRON_SECRET>'/)

    // The guard that detects an unsubstituted run must survive intact, or it aborts the restore.
    expect(out).toContain("LIKE '%<PROJECT_REF>%'")
    expect(out).toContain("LIKE '%''<CRON_SECRET>''%'")

    // `<ANON_KEY>` appears once, in a comment. It is documentation, not a substitution target.
    expect(out).toContain('<ANON_KEY>')
  })

  it('S12 — throws when a required option is absent', () => {
    const sql = "url := 'https://<PROJECT_REF>.supabase.co/functions/v1/stock-report',"
    expect(() => substituteCronPlaceholders(sql, { ref: 'abc' })).toThrow()
    expect(() => substituteCronPlaceholders(sql, { cronSecret: 'abc' })).toThrow()
  })

  it('S12b — throws when the SQL contains no cron placeholder to substitute', () => {
    // A silent no-op here means the caller believes cron was rebuilt when it was not.
    expect(() =>
      substituteCronPlaceholders('SELECT 1;', { ref: 'abc', cronSecret: 'def' }),
    ).toThrow()
  })
})

describe('auth dump exclusions', () => {
  it('excludes exactly the six ephemeral auth tables', () => {
    expect([...AUTH_EXCLUDE_TABLES].sort()).toEqual([
      'auth.audit_log_entries',
      'auth.flow_state',
      'auth.one_time_tokens',
      'auth.refresh_tokens',
      'auth.saml_relay_states',
      'auth.sessions',
    ])
  })
})

// ── Review round 1 findings (2026-09-14) ───────────────────────────────────────────────
// An empty option is worse than a surviving placeholder: substituting '' deletes the marker,
// so the leftover scan sees a clean string and the caller ships `https://.supabase.co`.
describe('substituteCronPlaceholders — empty and blank options (S13–S14)', () => {
  const sql =
    "url := 'https://<PROJECT_REF>.supabase.co/functions/v1/stock-report',\n'x-cron-secret', '<CRON_SECRET>'"

  it('S13 — throws on an empty string option', () => {
    expect(() => substituteCronPlaceholders(sql, { ref: '', cronSecret: 's' })).toThrow()
    expect(() => substituteCronPlaceholders(sql, { ref: 'r', cronSecret: '' })).toThrow()
  })

  it('S14 — throws on a whitespace-only option', () => {
    expect(() => substituteCronPlaceholders(sql, { ref: '   ', cronSecret: 's' })).toThrow()
    expect(() => substituteCronPlaceholders(sql, { ref: 'r', cronSecret: '\t\n' })).toThrow()
  })
})

describe('substituteCronPlaceholders — reports what it did (S15)', () => {
  it('S15 — the real schema.sql yields 6 URL and 6 header substitutions', () => {
    const sql = readFileSync(SCHEMA_SQL, 'utf8')
    const { sql: out, urls, secrets } = substituteCronPlaceholders(sql, {
      ref: 'abc',
      cronSecret: 'def',
    })
    expect(urls).toBe(6)
    expect(secrets).toBe(6)
    expect(out).toContain('https://abc.supabase.co')
  })
})

describe('verifyManifest — manifest.json is not an extra file (S16)', () => {
  it('S16 — a directory hashed whole still verifies', () => {
    const files = [{ path: 'schema.sql', bytes: 1, sha256: 'aa' }]
    const m = buildManifest({ ref: DEV_REF, createdAt: 'x', encrypted: false, files })
    // What a caller actually produces: every file physically in the package, manifest included.
    const actual = { 'schema.sql': 'aa', 'manifest.json': 'whatever' }
    const res = verifyManifest(m, actual)
    expect(res.ok).toBe(true)
    expect(res.extra).toEqual([])
  })

  it('S16b — a genuinely unexpected file is still reported', () => {
    const files = [{ path: 'schema.sql', bytes: 1, sha256: 'aa' }]
    const m = buildManifest({ ref: DEV_REF, createdAt: 'x', encrypted: false, files })
    const res = verifyManifest(m, { 'schema.sql': 'aa', 'stowaway.sql': 'zz' })
    expect(res.ok).toBe(false)
    expect(res.extra).toEqual(['stowaway.sql'])
  })
})

// ── Package size (2026-09-14) ──────────────────────────────────────────────────────────
// The first real DEV snapshot was 32 MB, of which `chip_raw_cache` alone was >20 MB — a
// market-data cache that refills itself from the source APIs. Shipping it offsite every day
// costs R2 storage and transfer for zero recovery value.
describe('CACHE_TABLES (S17–S18)', () => {
  it('S17 — names exactly the regenerable caches and logs, schema-qualified', () => {
    expect([...plan.CACHE_TABLES].sort()).toEqual([
      'public.admin_run_log',
      'public.app_log',
      'public.batch_run_log',
      'public.chip_raw_cache',
      'public.price_cache',
      'public.source_probe_log',
      'public.source_probe_tick',
    ])
  })

  it('S18 — never excludes a table that holds user-owned or configuration data', () => {
    const irreplaceable = [
      'public.workspaces',
      'public.transactions',
      'public.user_settings',
      'public.app_settings',
      'public.tw_watchlist',
      'public.stock_names',
      'public.warm_quota',
      'public.backup_run_log',
    ]
    for (const table of irreplaceable) {
      expect(plan.CACHE_TABLES).not.toContain(table)
    }
  })
})
