/**
 * Operator script (Spec 160 Phase A-2): rebuild a Supabase project from a snapshot package
 * produced by snapshot.cjs. See docs/agent/specs/160-snapshot-restore.md §8.
 *
 * Runs steps 2, 3, 4, 5, 7, 8 and 10 of the recovery runbook. Steps 1, 6 and 9 are human.
 *
 * Usage:
 *   node scripts/restore.cjs --help
 *   node scripts/restore.cjs --package=<dir> --ref=<ref> --cron-secret=<s> [--dry-run]
 *
 * Env:
 *   SNAPSHOT_PASSPHRASE                       Required when manifest.encrypted is true.
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   Storage bucket creation/upload.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { verifyManifest, substituteCronPlaceholders } = require('./lib/snapshotPlan.cjs')

// `supabase db query --linked` recognizes cwd, not "the linked project you think" (supabase-ops
// skill). Every supabase invocation below runs with this fixed cwd so it never inherits a stale
// link from wherever the caller happened to be.
const SOURCES_DIR = path.resolve(__dirname, '..')

// Never select cron.job.command here either — it carries x-cron-secret (spec §4).
const CRON_QUERY = 'SELECT jobname, schedule FROM cron.job ORDER BY jobid;'

const USAGE = `Usage: node scripts/restore.cjs --package=<dir> --ref=<ref> --cron-secret=<s> [options]

Rebuild a Supabase project from a snapshot package produced by snapshot.cjs.

Applies, in order: setup.sql (the package's copy of sources/supabase/schema.sql, with the
cron placeholders substituted), data-auth.sql, then data-public.sql. The package's own
schema.sql (a pg_dump of the source project) is NOT applied — it is a drift record only.

Options:
  --package=<dir>     Snapshot package directory (required)
  --ref=<ref>          Target project ref; must match sources/supabase/.temp/project-ref (required)
  --cron-secret=<s>    CRON_SECRET substituted into setup.sql (required)
  --dry-run            Do every check and print every step; write nothing
  --help               Show this help and exit

Env:
  SNAPSHOT_PASSPHRASE                       Required to decrypt data-auth.sql.gpg when manifest.encrypted is true
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   Storage bucket creation/upload
`

function parseArgs(argv) {
  const args = { help: false, package: null, ref: null, cronSecret: null, dryRun: false }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg.startsWith('--package=')) args.package = arg.slice('--package='.length)
    else if (arg.startsWith('--ref=')) args.ref = arg.slice('--ref='.length)
    else if (arg.startsWith('--cron-secret=')) args.cronSecret = arg.slice('--cron-secret='.length)
    else if (arg === '--dry-run') args.dryRun = true
  }
  return args
}

function validateArgs(args) {
  const missing = []
  if (!args.package) missing.push('--package')
  if (!args.ref) missing.push('--ref')
  if (!args.cronSecret) missing.push('--cron-secret')
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

function readManifest(packageDir) {
  const manifestPath = path.join(packageDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    console.error(`Cannot read manifest: ${manifestPath} does not exist.`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

// Step 1 (spec §8 / order of operations). Refuses to write anything if the package fails
// its hashes.
function verifyPackage(packageDir) {
  console.log('[1/6] Verifying package manifest...')
  const manifest = readManifest(packageDir)
  const actual = hashPackageFiles(packageDir)
  const result = verifyManifest(manifest, actual)
  if (!result.ok) {
    console.error('Manifest verification FAILED. Nothing was written.')
    if (result.missing.length > 0) console.error(`  missing: ${result.missing.join(', ')}`)
    if (result.mismatched.length > 0) console.error(`  mismatched: ${result.mismatched.join(', ')}`)
    if (result.extra.length > 0) console.error(`  extra: ${result.extra.join(', ')}`)
    process.exit(1)
  }
  console.log(`  OK: ${Object.keys(actual).length} file(s) match the manifest.`)
  return manifest
}

// Step 2. Decryption is a read-only check against the package (it never touches the target
// project), so it always runs, dry-run or not. The caller deletes the temp file when done —
// it holds every password hash in the project.
function decryptAuthDump(packageDir, manifest) {
  console.log('[2/6] Preparing data-auth.sql...')
  if (!manifest.encrypted) {
    console.log('  Package is not encrypted.')
    return { sql: fs.readFileSync(path.join(packageDir, 'data-auth.sql'), 'utf8'), tempPath: null }
  }
  const passphrase = requireEnv('SNAPSHOT_PASSPHRASE')
  const encPath = path.join(packageDir, 'data-auth.sql.gpg')
  const tempPath = path.join(os.tmpdir(), `restore-data-auth-${process.pid}-${Date.now()}.sql`)
  console.log(`  Decrypting ${encPath} -> ${tempPath}`)
  execFileSync('gpg', ['--batch', '--yes', '--passphrase-fd', '0', '--decrypt', '-o', tempPath, encPath], {
    input: passphrase,
  })
  return { sql: fs.readFileSync(tempPath, 'utf8'), tempPath }
}

// Step 3. Reads setup.sql (the repo's own idempotent environment builder, which owns the
// cron section — spec §3b), not the package's pg_dump schema.sql. Throws (via
// substituteCronPlaceholders) rather than emit a live placeholder — let it propagate, do not
// catch it here.
function buildSetupSql(packageDir, args) {
  console.log('[3/6] Substituting cron placeholders in setup.sql...')
  const rawSetup = fs.readFileSync(path.join(packageDir, 'setup.sql'), 'utf8')
  const { sql: setupSql, urls, secrets } = substituteCronPlaceholders(rawSetup, {
    ref: args.ref,
    cronSecret: args.cronSecret,
  })
  console.log(`  OK: ${urls} URL(s) and ${secrets} secret header(s) substituted.`)
  return setupSql
}

// Step 4. Auth before public: public rows carry user_id foreign keys onto auth.users.
// The package's schema.sql (a pg_dump of the source project's public schema) is NOT applied
// here — it is a drift record only; setup.sql is the maintained builder that actually runs.
function applySchemaAndData(packageDir, setupSql, authSql, dryRun, appliedSteps) {
  console.log('[4/6] Applying schema and data...')
  if (dryRun) {
    console.log('  [dry-run] would apply setup.sql')
    console.log('  [dry-run] would apply data-auth.sql')
    console.log('  [dry-run] would apply data-public.sql')
    return
  }

  console.log('  Applying setup.sql...')
  execFileSync('supabase', ['db', 'query', '--linked', setupSql], { cwd: SOURCES_DIR, stdio: 'inherit' })
  appliedSteps.push('setup.sql')

  console.log('  Applying data-auth.sql...')
  execFileSync('supabase', ['db', 'query', '--linked', authSql], { cwd: SOURCES_DIR, stdio: 'inherit' })
  appliedSteps.push('data-auth.sql')

  console.log('  Applying data-public.sql...')
  const publicSql = fs.readFileSync(path.join(packageDir, 'data-public.sql'), 'utf8')
  execFileSync('supabase', ['db', 'query', '--linked', publicSql], { cwd: SOURCES_DIR, stdio: 'inherit' })
  appliedSteps.push('data-public.sql')
}

function readBucketsManifest(packageDir) {
  const bucketsPath = path.join(packageDir, 'storage', 'buckets.json')
  if (!fs.existsSync(bucketsPath)) return {}
  return JSON.parse(fs.readFileSync(bucketsPath, 'utf8'))
}

function listFilesRecursive(dir) {
  const files = []
  if (!fs.existsSync(dir)) return files
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else files.push(full)
    }
  }
  walk(dir)
  return files
}

async function createBucket(baseUrl, key, name, isPublic) {
  const res = await fetch(`${baseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ id: name, name, public: !!isPublic }),
  })
  if (res.ok) return
  const text = await res.text()
  if (/already exists/i.test(text)) return
  throw new Error(`storage bucket create failed (${res.status}) for "${name}": ${text}`)
}

async function uploadToStorage(baseUrl, key, bucket, objectPath, filePath) {
  const res = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: fs.readFileSync(filePath),
  })
  if (!res.ok) throw new Error(`storage upload failed (${res.status}) for "${bucket}/${objectPath}"`)
}

// Step 5.
async function restoreStorage(packageDir, dryRun, appliedSteps) {
  console.log('[5/6] Restoring storage...')
  const storageDir = path.join(packageDir, 'storage')
  const buckets = readBucketsManifest(packageDir)
  const bucketNames = Object.keys(buckets)
  if (bucketNames.length === 0) {
    console.log('  No storage/buckets.json found; skipping storage restore.')
    return
  }

  if (dryRun) {
    for (const name of bucketNames) {
      const files = listFilesRecursive(path.join(storageDir, name))
      console.log(`  [dry-run] would create bucket "${name}" (public: ${!!buckets[name].public}) and upload ${files.length} object(s)`)
    }
    return
  }

  const url = requireEnv('SUPABASE_URL')
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const baseUrl = url.replace(/\/$/, '')

  for (const name of bucketNames) {
    console.log(`  Creating bucket "${name}" (public: ${!!buckets[name].public})...`)
    await createBucket(baseUrl, key, name, buckets[name].public)

    const bucketDir = path.join(storageDir, name)
    const files = listFilesRecursive(bucketDir)
    console.log(`  Uploading ${files.length} object(s) to "${name}"...`)
    for (const filePath of files) {
      const objectPath = path.relative(bucketDir, filePath).split(path.sep).join('/')
      await uploadToStorage(baseUrl, key, name, objectPath, filePath)
    }
    appliedSteps.push(`storage/${name}`)
  }
}

// Step 6. Report only — never fails the run.
async function verifyCron(packageDir) {
  console.log('[6/6] Verifying cron jobs...')
  const cronPath = path.join(packageDir, 'cron.json')
  if (!fs.existsSync(cronPath)) {
    console.log('  No cron.json found; skipping cron verification.')
    return
  }
  const expected = JSON.parse(fs.readFileSync(cronPath, 'utf8'))

  const stdout = execFileSync('supabase', ['db', 'query', '--linked', '--output', 'json', CRON_QUERY], {
    cwd: SOURCES_DIR,
  })
  // `supabase db query -o json` wraps the result: { boundary, rows: [...], warning }.
  // It is not a bare array — verified against the CLI 2.111.0 on 2026-09-14.
  const parsed = JSON.parse(stdout.toString('utf8'))
  const rows = Array.isArray(parsed) ? parsed : parsed.rows
  if (!Array.isArray(rows)) {
    console.warn(`  cron.job query returned no rows array (keys: ${Object.keys(parsed).join(', ')}); skipping verification.`)
    return
  }
  const actualByName = new Map(rows.map((row) => [row.jobname, row.schedule]))

  const problems = []
  for (const job of expected.jobs) {
    const actualSchedule = actualByName.get(job.jobname)
    if (actualSchedule === undefined) {
      problems.push(`  MISSING: "${job.jobname}" (expected schedule "${job.schedule}")`)
    } else if (actualSchedule !== job.schedule) {
      problems.push(`  SCHEDULE MISMATCH: "${job.jobname}" expected "${job.schedule}", found "${actualSchedule}"`)
    }
  }

  if (problems.length === 0) {
    console.log(`  OK: all ${expected.jobs.length} expected cron job(s) present with matching schedules.`)
  } else {
    console.warn(`  cron verification found ${problems.length} issue(s) (report only, not fatal):`)
    for (const line of problems) console.warn(line)
  }
}

function printSummary(appliedSteps, dryRun) {
  console.log('\nSummary:')
  if (dryRun) {
    console.log('  Dry run: no writes were made.')
    return
  }
  if (appliedSteps.length === 0) {
    console.log('  Nothing was applied.')
    return
  }
  for (const step of appliedSteps) {
    console.log(`  applied: ${step}`)
  }
}

async function run(args) {
  const packageDir = path.resolve(args.package)
  const appliedSteps = []
  let tempAuthPath = null

  const linkedRef = readProjectRef()
  console.log(`Target ref (linked): ${linkedRef}`)
  if (args.ref !== linkedRef) {
    console.error(`--ref=${args.ref} does not match linked project ref "${linkedRef}". Refusing to continue.`)
    process.exit(1)
  }

  try {
    const manifest = verifyPackage(packageDir)

    const auth = decryptAuthDump(packageDir, manifest)
    tempAuthPath = auth.tempPath

    const setupSql = buildSetupSql(packageDir, args)

    try {
      applySchemaAndData(packageDir, setupSql, auth.sql, args.dryRun, appliedSteps)
    } catch (err) {
      console.error(
        `\nFAILED while applying SQL. Already applied: ${appliedSteps.length > 0 ? appliedSteps.join(', ') : '(none)'}`,
      )
      throw err
    }

    try {
      await restoreStorage(packageDir, args.dryRun, appliedSteps)
    } catch (err) {
      console.error(
        `\nFAILED while restoring storage. Already applied: ${appliedSteps.length > 0 ? appliedSteps.join(', ') : '(none)'}`,
      )
      throw err
    }

    await verifyCron(packageDir)

    printSummary(appliedSteps, args.dryRun)
  } finally {
    // Holds every password hash in the project; never leave it behind.
    if (tempAuthPath && fs.existsSync(tempAuthPath)) {
      fs.unlinkSync(tempAuthPath)
    }
  }
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
