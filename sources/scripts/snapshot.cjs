/**
 * Operator script (Spec 160 Phase A-2): produce one self-contained snapshot package
 * (schema, data, cron expectations, storage objects) for the linked Supabase project and
 * copy it to up to two destinations. See docs/agent/specs/160-snapshot-restore.md §8.
 *
 * Usage:
 *   node scripts/snapshot.cjs --help
 *   node scripts/snapshot.cjs [--ref=<ref>] [--out=<dir>] [--to=local,storage]
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   Storage listing/download, and the "storage" destination.
 *   SNAPSHOT_PASSPHRASE                        Encrypts data-auth.sql with gpg when set.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { AUTH_EXCLUDE_TABLES, CACHE_TABLES, snapshotDirName, buildManifest, cronRowsToPlan } = require('./lib/snapshotPlan.cjs')

// `supabase db query --linked` recognizes cwd, not "the linked project you think" (supabase-ops
// skill). Every supabase invocation below runs with this fixed cwd so it never inherits a stale
// link from wherever the caller happened to be.
const SOURCES_DIR = path.resolve(__dirname, '..')
const BACKUPS_BUCKET = 'backups'
const VALID_DESTINATIONS = ['local', 'storage']

// Never select cron.job.command — it carries x-cron-secret (spec §4).
const CRON_QUERY =
  "SELECT jobname, schedule, (regexp_match(command, 'functions/v1/([a-z-]+)'))[1] AS action FROM cron.job ORDER BY jobid;"

const USAGE = `Usage: node scripts/snapshot.cjs [options]

Produce one self-contained snapshot package (schema, data, cron expectations, storage
objects) for the linked Supabase project and copy it to up to two destinations.

Options:
  --ref=<ref>    Expected project ref; the run refuses to continue if it disagrees with
                 sources/supabase/.temp/project-ref
  --out=<dir>    Output directory for the package (default: ../.snapshots relative to sources/)
  --to=<list>    Comma-separated destinations: local,storage (default: local)
  --with-cache   Include regenerable cache/log tables in data-public.sql (default: excluded)
  --help         Show this help and exit

Env:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   Storage listing/download, and the "storage" destination
  SNAPSHOT_PASSPHRASE                        Encrypts data-auth.sql with gpg when set
`

function parseArgs(argv) {
  const args = { help: false, ref: null, out: null, to: ['local'], withCache: false }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg.startsWith('--ref=')) args.ref = arg.slice('--ref='.length)
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length)
    else if (arg === '--with-cache') args.withCache = true
    else if (arg.startsWith('--to=')) {
      args.to = arg.slice('--to='.length).split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return args
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

function runSupabase(args) {
  execFileSync('supabase', args, { cwd: SOURCES_DIR, stdio: 'inherit' })
}

function dumpSchema(dir) {
  console.log('Dumping schema (public)...')
  runSupabase(['db', 'dump', '--linked', '--schema', 'public', '-f', path.join(dir, 'schema.sql')])
}

// `supabase db dump --schema public` never emits cron.schedule (cron lives in the `cron`
// schema — spec §3b), so the pg_dump schema.sql alone cannot rebuild the 7 jobs. setup.sql is
// the repo's own idempotent environment builder, which owns the cron section and its guard.
function copySetupSql(dir) {
  console.log('Copying setup.sql (sources/supabase/schema.sql)...')
  const src = path.join(SOURCES_DIR, 'supabase', 'schema.sql')
  fs.copyFileSync(src, path.join(dir, 'setup.sql'))
}

function dumpDataPublic(dir, withCache) {
  if (withCache) {
    console.log('Dumping data (public)... [cache tables INCLUDED, --with-cache]')
    runSupabase(['db', 'dump', '--linked', '--data-only', '--schema', 'public', '-f', path.join(dir, 'data-public.sql')])
  } else {
    console.log('Dumping data (public)... [cache tables EXCLUDED]')
    console.log(`  skipping: ${CACHE_TABLES.join(', ')}`)
    const excludeArgs = CACHE_TABLES.flatMap((table) => ['-x', table])
    runSupabase([
      'db', 'dump', '--linked', '--data-only', '--schema', 'public',
      ...excludeArgs,
      '-f', path.join(dir, 'data-public.sql'),
    ])
  }
}

function dumpDataAuth(dir) {
  console.log('Dumping data (auth)...')
  const excludeArgs = AUTH_EXCLUDE_TABLES.flatMap((table) => ['-x', table])
  runSupabase([
    'db', 'dump', '--linked', '--data-only', '--schema', 'auth',
    ...excludeArgs,
    '-f', path.join(dir, 'data-auth.sql'),
  ])
}

function dumpCron(dir) {
  console.log('Querying cron.job...')
  const stdout = execFileSync('supabase', ['db', 'query', '--linked', '--output', 'json', CRON_QUERY], {
    cwd: SOURCES_DIR,
  })
  // `supabase db query -o json` wraps the result: { boundary, rows: [...], warning }.
  // It is not a bare array — verified against the CLI 2.111.0 on 2026-09-14.
  const parsed = JSON.parse(stdout.toString('utf8'))
  const rows = Array.isArray(parsed) ? parsed : parsed.rows
  if (!Array.isArray(rows)) {
    throw new Error(`cron.job query returned no rows array (keys: ${Object.keys(parsed).join(', ')})`)
  }
  const plan = cronRowsToPlan(rows)
  fs.writeFileSync(path.join(dir, 'cron.json'), JSON.stringify(plan, null, 2))
  return plan
}

// Storage list API returns one level at a time; a sub-folder entry has `id === null` (same
// convention as scripts/backup-download.cjs).
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

async function downloadObject(baseUrl, key, bucket, objectPath, destDir) {
  const res = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  })
  if (!res.ok) throw new Error(`storage download failed (${res.status}) for "${bucket}/${objectPath}"`)
  const buf = Buffer.from(await res.arrayBuffer())
  const outPath = path.join(destDir, objectPath)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, buf)
}

async function dumpStorage(dir) {
  const url = requireEnv('SUPABASE_URL')
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const baseUrl = url.replace(/\/$/, '')
  const storageDir = path.join(dir, 'storage')
  fs.mkdirSync(storageDir, { recursive: true })

  console.log('Listing storage buckets...')
  const res = await fetch(`${baseUrl}/storage/v1/bucket`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  })
  if (!res.ok) throw new Error(`storage bucket list failed (${res.status})`)
  const buckets = await res.json()

  // Keyed by bucket name so a caller can tell which record belongs to which storage/<bucket>/
  // directory without a redundant "name" field inside each entry.
  const bucketsManifest = {}
  for (const bucket of buckets) {
    const objects = await listObjects(baseUrl, key, bucket.name)
    console.log(`Bucket "${bucket.name}": ${objects.length} object(s)`)
    for (const objectPath of objects) {
      await downloadObject(baseUrl, key, bucket.name, objectPath, path.join(storageDir, bucket.name))
    }
    bucketsManifest[bucket.name] = { id: bucket.id, public: bucket.public }
  }
  fs.writeFileSync(path.join(storageDir, 'buckets.json'), JSON.stringify(bucketsManifest, null, 2))
}

function maybeEncryptAuthDump(dir) {
  const authFile = path.join(dir, 'data-auth.sql')
  const passphrase = process.env.SNAPSHOT_PASSPHRASE
  if (!passphrase) {
    console.warn('=====================================================================')
    console.warn('WARNING: SNAPSHOT_PASSPHRASE is not set.')
    console.warn('data-auth.sql is being stored UNENCRYPTED. This file holds every')
    console.warn('password hash in the project. Treat it accordingly.')
    console.warn('=====================================================================')
    return false
  }
  console.log('Encrypting data-auth.sql...')
  execFileSync(
    'gpg',
    ['--batch', '--yes', '--passphrase-fd', '0', '--symmetric', '--cipher-algo', 'AES256', '-o', `${authFile}.gpg`, authFile],
    { input: passphrase },
  )
  fs.unlinkSync(authFile)
  return true
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

// Walks the whole package and hashes every file except manifest.json, which is written last
// and must never hash itself (spec §8).
function hashPackage(dir) {
  const files = []
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      const rel = path.relative(dir, full).split(path.sep).join('/')
      if (entry.isDirectory()) {
        walk(full)
      } else if (rel !== 'manifest.json') {
        files.push({ path: rel, bytes: fs.statSync(full).size, sha256: sha256File(full) })
      }
    }
  }
  walk(dir)
  return files
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
  if (!res.ok) throw new Error(`storage upload failed (${res.status}) for "${objectPath}"`)
}

async function copyToStorage(dir, dirName, packagePaths) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return { status: 'failed', detail: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set' }
  }
  const baseUrl = url.replace(/\/$/, '')
  for (const relPath of packagePaths) {
    await uploadToStorage(baseUrl, key, BACKUPS_BUCKET, `snapshots/${dirName}/${relPath}`, path.join(dir, relPath))
  }
  return { status: 'ok', detail: `${BACKUPS_BUCKET}/snapshots/${dirName}/` }
}

async function copyToDestinations(to, dir, dirName, packagePaths) {
  const results = {}
  for (const dest of to) {
    if (dest === 'local') {
      results.local = { status: 'ok', detail: dir }
    } else if (dest === 'storage') {
      results.storage = await copyToStorage(dir, dirName, packagePaths)
    } else {
      results[dest] = { status: 'failed', detail: `unknown destination "${dest}"` }
    }
  }
  return results
}

function printSummary(files, destResults) {
  console.log('\nPackage contents:')
  for (const file of files) {
    console.log(`  ${file.path}  (${file.bytes} bytes)`)
  }
  console.log('\nDestinations:')
  for (const [dest, result] of Object.entries(destResults)) {
    console.log(`  ${dest}: ${result.status}${result.detail ? ` (${result.detail})` : ''}`)
  }
}

async function run(args) {
  const ref = readProjectRef()
  console.log(`Target ref: ${ref}`)
  if (args.ref && args.ref !== ref) {
    console.error(`--ref=${args.ref} does not match linked project ref "${ref}".`)
    process.exit(1)
  }
  for (const dest of args.to) {
    if (!VALID_DESTINATIONS.includes(dest)) {
      console.error(`Unknown destination "${dest}". Accepted values: ${VALID_DESTINATIONS.join(', ')}.`)
      process.exit(1)
    }
  }

  const outBase = args.out ? path.resolve(args.out) : path.resolve(SOURCES_DIR, '..', '.snapshots')
  const ymd = new Date().toISOString().slice(0, 10)
  const dirName = snapshotDirName(ref, ymd)
  const dir = path.join(outBase, dirName)
  fs.mkdirSync(dir, { recursive: true })
  console.log(`Package directory: ${dir}`)

  dumpSchema(dir)
  copySetupSql(dir)
  dumpDataPublic(dir, args.withCache)
  dumpDataAuth(dir)
  dumpCron(dir)
  await dumpStorage(dir)

  const encrypted = maybeEncryptAuthDump(dir)

  const files = hashPackage(dir)
  const manifest = buildManifest({ ref, createdAt: new Date().toISOString(), encrypted, files })
  // buildManifest's contract (spec §5) is fixed to {version, ref, createdAt, encrypted, files};
  // cacheExcluded is added here rather than widening that shared, unit-tested signature.
  manifest.cacheExcluded = !args.withCache
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const packagePaths = [...files.map((f) => f.path), 'manifest.json']
  const destResults = await copyToDestinations(args.to, dir, dirName, packagePaths)

  printSummary(files, destResults)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    process.exit(0)
    return
  }
  return run(args)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
