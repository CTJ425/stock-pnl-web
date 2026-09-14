/**
 * Operator script (task 144-4): pull every object in the `backups` bucket down to a local
 * directory, using the service role key. This never runs in a browser — the key must never
 * reach client code — and its output directory must never be committed.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup-download.cjs --dest=./backups-local
 */
const fs = require('fs')
const path = require('path')

const BUCKET = 'backups'

function readDest() {
  const arg = process.argv.find((a) => a.startsWith('--dest='))
  const raw = arg ? arg.slice('--dest='.length) : './backups-local'
  return path.resolve(raw)
}

// Recursively walks the bucket: the Storage list API returns one level at a time, and a
// sub-folder shows up as an entry whose `id` is null.
async function listFiles(baseUrl, key, prefix = '') {
  const res = await fetch(`${baseUrl}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
    body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
  })
  if (!res.ok) throw new Error(`list failed (${res.status}) for prefix "${prefix}"`)
  const items = await res.json()
  let all = []
  for (const item of items) {
    const itemPath = prefix ? `${prefix}/${item.name}` : item.name
    if (item.id === null) {
      all = all.concat(await listFiles(baseUrl, key, itemPath))
    } else {
      all.push(itemPath)
    }
  }
  return all
}

async function downloadFile(baseUrl, key, objectPath, destDir) {
  const res = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${objectPath}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  })
  if (!res.ok) throw new Error(`download failed (${res.status}) for "${objectPath}"`)
  const buf = Buffer.from(await res.arrayBuffer())
  const outPath = path.join(destDir, objectPath)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, buf)
}

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) {
    console.error('Missing SUPABASE_URL environment variable.')
    process.exit(1)
  }
  if (!key) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.')
    process.exit(1)
  }

  const dest = readDest()
  console.log(`Writing backups to ${dest}`)
  const baseUrl = url.replace(/\/$/, '')
  fs.mkdirSync(dest, { recursive: true })

  const files = await listFiles(baseUrl, key)
  console.log(`Found ${files.length} object(s) in "${BUCKET}".`)
  for (const objectPath of files) {
    await downloadFile(baseUrl, key, objectPath, dest)
    console.log(`Downloaded ${objectPath}`)
  }
  console.log(`Done. Wrote ${files.length} file(s) to ${dest}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
