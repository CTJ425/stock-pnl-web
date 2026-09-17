/**
 * Task 165 Phase 2 §2.1 — writes the Edge copy of the ledger engine from the web sources,
 * via the pure renderer in `scripts/lib/edgeEngine.cjs`. D6 forbids editing the web sources
 * themselves; this script only ever reads them.
 *
 * Usage:
 *   node scripts/sync-edge-engine.cjs           Render and write both target files.
 *   node scripts/sync-edge-engine.cjs --check   Write nothing; exit 1 if any target is stale.
 */
const fs = require('fs')
const path = require('path')
const { EDGE_ENGINE_FILES, renderEdgeFile } = require('./lib/edgeEngine.cjs')

const SOURCES_DIR = path.resolve(__dirname, '..')
const checkOnly = process.argv.includes('--check')

let stale = false

// Render every target before writing any, so a renderer error leaves _shared/engine untouched.
const outputs = EDGE_ENGINE_FILES.map(({ source, target }) => ({
  target,
  targetPath: path.join(SOURCES_DIR, target),
  rendered: renderEdgeFile(source, fs.readFileSync(path.join(SOURCES_DIR, source), 'utf8')),
}))

for (const { target, targetPath, rendered } of outputs) {
  if (checkOnly) {
    const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null
    if (current !== rendered) {
      console.log(`stale: ${target}`)
      stale = true
    }
    continue
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, rendered)
}

if (checkOnly && stale) {
  process.exit(1)
}
