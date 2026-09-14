/**
 * Operator script (Spec 160 Phase A-2, §8 "wipe-dev.cjs — drill only"): destroy the DEV
 * Supabase project's public schema, auth.users rows, and storage objects, so restore.cjs can
 * be drilled against a real (but disposable) target.
 *
 * assertDestructiveTargetAllowed(ref) is the first statement of the run and is never caught
 * locally — it is the only guard that stops this script from running against PROD.
 *
 * Order: public schema -> auth rows -> storage objects. cron.job and Edge Function
 * deployments/secrets are left untouched.
 *
 * Usage:
 *   node scripts/wipe-dev.cjs --help
 *   node scripts/wipe-dev.cjs --ref=<ref> --package=<dir> [--yes-destroy-dev] [--dry-run]
 *
 * Without --yes-destroy-dev (or with --dry-run, which always wins), the script prints the
 * blast radius it would destroy and exits 0 without deleting anything.
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   Storage listing/deletion.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { assertDestructiveTargetAllowed, verifyManifest } = require('./lib/snapshotPlan.cjs')

// `supabase db query --linked` recognizes cwd, not "the linked project you think" (supabase-ops
// skill). Every supabase invocation below runs with this fixed cwd so it never inherits a stale
// link from wherever the caller happened to be.
const SOURCES_DIR = path.resolve(__dirname, '..')

// Never select from cron.job here — it is out of scope for this drill (spec §8) and its
// command text carries x-cron-secret.
const TABLE_LIST_QUERY =
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name;"
const AUTH_USER_COUNT_QUERY = 'SELECT count(*) FROM auth.users;'

const USAGE = `Usage: node scripts/wipe-dev.cjs --ref=<ref> --package=<dir> [options]

DESTRUCTIVE. Wipes the DEV Supabase project's public schema tables, auth.users rows
(cascades to auth.identities), and storage objects, in that order. cron.job and Edge
Function deployments/secrets are left untouched.

Refuses to run against any ref other than DEV. Refuses to destroy anything unless
--package points at a snapshot whose manifest verifies against the project ref.

Options:
  --ref=<ref>           Target project ref; must be the DEV ref and must match
                         sources/supabase/.temp/project-ref (required)
  --package=<dir>        Verified snapshot package to be restored afterwards (required)
  --yes-destroy-dev      Required literal flag to actually delete anything
  --dry-run              Same as omitting --yes-destroy-dev, stated explicitly; always wins
                         over --yes-destroy-dev if both are given
  --help                 Show this help and exit

Env:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   Storage listing/deletion
`

function parseArgs(argv) {
  const args = { help: false, ref: null, package: null, yesDestroyDev: false, dryRun: false }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg.startsWith('--ref=')) args.ref = arg.slice('--ref='.length)
    else if (arg.startsWith('--package=')) args.package = arg.slice('--package='.length)
    else if (arg === '--yes-destroy-dev') args.yesDestroyDev = true
    else if (arg === '--dry-run') args.dryRun = true
  }
  return args
}

function validateArgs(args) {
  const missing = []
  if (!args.ref) missing.push('--ref')
  if (!args.package) missing.push('--package')
  if (missing.length > 0) {
    console.error(`Missing required option(s): ${missing.join(', ')}\n`)
    console.error(USAGE)
    process.exit(1)
  }
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name} environment variable.`)
    process.exit(1)
  }
  return value
}

function readProjectRef() {
  const refPath = path.join(SOURCES_DIR, 'supabase', '.temp', 'project-ref')
  if (!fs.existsSync(refPath)) {
    console.error(`Cannot read project ref: ${refPath} does not exist. Run "supabase link" first.`)
    process.exit(1)
  }
  return fs.readFileSync(refPath, 'utf8').trim()
}

function readManifest(packageDir) {
  const manifestPath = path.join(packageDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    console.error(`Cannot read manifest: ${manifestPath} does not exist.`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

// Walks the whole package and hashes every file except manifest.json, matching how
// snapshot.cjs excludes manifest.json from its own hash set (spec §8).
function hashPackageFiles(dir) {
  const actual = {}
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      const rel = path.relative(dir, full).split(path.sep).join('/')
      if (entry.isDirectory()) {
        walk(full)
      } else if (rel !== 'manifest.json') {
        actual[rel] = sha256File(full)
      }
    }
  }
  walk(dir)
  return actual
}

function runSupabaseQuery(sql) {
  execFileSync('supabase', ['db', 'query', '--linked', sql], { cwd: SOURCES_DIR, stdio: 'inherit' })
}

function runSupabaseQueryJson(sql) {
  const stdout = execFileSync('supabase', ['db', 'query', '--linked', '--output', 'json', sql], { cwd: SOURCES_DIR })
  // `supabase db query -o json` wraps the result: { boundary, rows: [...], warning }.
  // It is not a bare array — verified against the CLI 2.111.0 on 2026-09-14.
  const parsed = JSON.parse(stdout.toString('utf8'))
  const rows = Array.isArray(parsed) ? parsed : parsed.rows
  if (!Array.isArray(rows)) {
    throw new Error(`query returned no rows array (keys: ${Object.keys(parsed).join(', ')})`)
  }
  return rows
}

function parseCount(rows) {
  const raw = rows[0] && rows[0].count
  return raw === undefined ? null : Number(raw)
}

function buildDropSql(tableNames) {
  return tableNames.map((name) => `DROP TABLE IF EXISTS "public"."${name}" CASCADE;`).join('\n')
}

// Storage list API returns one level at a time; a sub-folder entry has `id === null` (same
// convention as scripts/backup-download.cjs and scripts/snapshot.cjs).
async function listObjects(baseUrl, key, bucket, prefix = '') {
  const res = await fetch(`${baseUrl}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
  })
  if (!res.ok) throw new Error(`storage list failed (${res.status}) for bucket "${bucket}" prefix "${prefix}"`)
  const items = await res.json()
  let all = []
  for (const item of items) {
    const itemPath = prefix ? `${prefix}/${item.name}` : item.name
    if (item.id === null) {
      all = all.concat(await listObjects(baseUrl, key, bucket, itemPath))
    } else {
      all.push(itemPath)
    }
  }
  return all
}

async function listBuckets(baseUrl, key) {
  const res = await fetch(`${baseUrl}/storage/v1/bucket`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  })
  if (!res.ok) throw new Error(`storage bucket list failed (${res.status})`)
  return res.json()
}

// Read-only. Runs regardless of --yes-destroy-dev so the blast-radius block reflects what a
// real run would touch, and so the destructive branch reuses the exact same object lists.
async function surveyStorage(baseUrl, key) {
  const buckets = await listBuckets(baseUrl, key)
  const perBucket = {}
  let total = 0
  for (const bucket of buckets) {
    const objects = await listObjects(baseUrl, key, bucket.name)
    perBucket[bucket.name] = objects
    total += objects.length
  }
  return { buckets, perBucket, total }
}

async function deleteObjectsBatch(baseUrl, key, bucket, objectPaths) {
  if (objectPaths.length === 0) return
  const res = await fetch(`${baseUrl}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ prefixes: objectPaths }),
  })
  if (!res.ok) throw new Error(`storage batch delete failed (${res.status}) for bucket "${bucket}"`)
}

async function deleteBucket(baseUrl, key, bucket) {
  const res = await fetch(`${baseUrl}/storage/v1/bucket/${bucket}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  })
  if (!res.ok) throw new Error(`storage bucket delete failed (${res.status}) for "${bucket}"`)
}

function printBlastRadius({ ref, tableCount, authUserCount, bucketCount, objectCount }) {
  console.log('')
  console.log('=====================================================================')
  console.log('  DESTRUCTIVE DRILL - BLAST RADIUS')
  console.log(`  Target ref:       ${ref}`)
  console.log(`  public tables:    ${tableCount}`)
  console.log(`  auth.users rows:  ${authUserCount}`)
  console.log(`  storage buckets:  ${bucketCount}`)
  console.log(`  storage objects:  ${objectCount}`)
  console.log('=====================================================================')
  console.log('')
}

async function run(args) {
  // Guard 1 (spec §8, order fixed): the only guard that stops this script from running
  // against PROD. Never wrapped in a local try/catch — let it propagate to the top-level
  // handler, which exits non-zero.
  assertDestructiveTargetAllowed(args.ref)

  // Guard 2: the CLI's own linked project must agree with --ref.
  const linkedRef = readProjectRef()
  console.log(`Linked project ref: ${linkedRef}`)
  if (args.ref !== linkedRef) {
    console.error(`--ref=${args.ref} does not match linked project ref "${linkedRef}". Refusing to continue.`)
    process.exit(1)
  }

  const packageDir = path.resolve(args.package)

  // Guard 3: the restore package must be for this same ref.
  const manifest = readManifest(packageDir)
  if (manifest.ref !== args.ref) {
    console.error(`Package manifest ref "${manifest.ref}" does not match --ref=${args.ref}. Refusing to continue.`)
    process.exit(1)
  }

  // Guard 4: refusing to destroy anything unless a verified restore package exists is the
  // point of this step — never make it skippable by a flag.
  console.log('Verifying package manifest...')
  const actual = hashPackageFiles(packageDir)
  const verification = verifyManifest(manifest, actual)
  if (!verification.ok) {
    console.error('Manifest verification FAILED. Refusing to destroy anything without a verified restore package.')
    if (verification.missing.length > 0) console.error(`  missing: ${verification.missing.join(', ')}`)
    if (verification.mismatched.length > 0) console.error(`  mismatched: ${verification.mismatched.join(', ')}`)
    if (verification.extra.length > 0) console.error(`  extra: ${verification.extra.join(', ')}`)
    process.exit(1)
  }
  console.log(`  OK: ${Object.keys(actual).length} file(s) match the manifest.`)

  // Guard 5: the files restore.cjs actually needs must be present.
  const requiredFiles = ['setup.sql', 'data-auth.sql', 'data-public.sql']
  const missingFiles = requiredFiles.filter((name) => !fs.existsSync(path.join(packageDir, name)))
  if (missingFiles.length > 0) {
    console.error(`Package is missing required file(s): ${missingFiles.join(', ')}. Refusing to continue.`)
    process.exit(1)
  }
  console.log(`  OK: package carries ${requiredFiles.join(', ')}.`)

  // Read-only survey of the blast radius. Runs before any delete, dry-run or not.
  console.log('Surveying blast radius (read-only)...')
  const tableRows = runSupabaseQueryJson(TABLE_LIST_QUERY)
  const tableNames = tableRows.map((row) => row.table_name)

  const authUserCountBefore = parseCount(runSupabaseQueryJson(AUTH_USER_COUNT_QUERY))

  const url = requireEnv('SUPABASE_URL')
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const baseUrl = url.replace(/\/$/, '')
  const storage = await surveyStorage(baseUrl, key)

  printBlastRadius({
    ref: args.ref,
    tableCount: tableNames.length,
    authUserCount: authUserCountBefore,
    bucketCount: storage.buckets.length,
    objectCount: storage.total,
  })

  // --dry-run always wins: it is stated explicitly, but has the same effect as omitting
  // --yes-destroy-dev (spec §8 CLI contract).
  const effectiveDestroy = args.yesDestroyDev && !args.dryRun
  if (!effectiveDestroy) {
    console.log('DRY RUN: no changes were made.')
    console.log('  Pass --yes-destroy-dev (without --dry-run) to actually destroy this project.')
    return
  }

  console.log('--yes-destroy-dev given. Proceeding with the destructive drill.\n')

  console.log('[1/3] Dropping public schema tables...')
  if (tableNames.length === 0) {
    console.log('  No base tables found in schema "public".')
  } else {
    runSupabaseQuery(buildDropSql(tableNames))
    console.log(`  Dropped ${tableNames.length} base table(s).`)
  }

  console.log('[2/3] Deleting auth.users rows (cascades to auth.identities)...')
  runSupabaseQuery('DELETE FROM auth.users;')
  const authUserCountAfter = parseCount(runSupabaseQueryJson(AUTH_USER_COUNT_QUERY))
  console.log(`  auth.users: ${authUserCountBefore} row(s) before, ${authUserCountAfter} row(s) after.`)

  console.log('[3/3] Wiping storage buckets...')
  for (const bucket of storage.buckets) {
    const objects = storage.perBucket[bucket.name] || []
    await deleteObjectsBatch(baseUrl, key, bucket.name, objects)
    await deleteBucket(baseUrl, key, bucket.name)
    console.log(`  Bucket "${bucket.name}": deleted ${objects.length} object(s), bucket removed.`)
  }

  console.log('\nDestructive drill complete.')
  console.log(`Next step: node scripts/restore.cjs --package=${packageDir} --ref=${args.ref} --cron-secret=<...>`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    process.exit(0)
    return
  }
  validateArgs(args)
  return run(args)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
