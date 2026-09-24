/**
 * Rewrites the stock-price Edge Function's TPEx fallback snapshot from the live OpenAPI endpoint.
 * Keeps only the three fields the list parser reads (twList.ts) and stamps today's date, which
 * drives the 90-day staleness warning (EP-05).
 *
 * Usage:
 *   node scripts/refresh-tpex-fallback.cjs            Write supabase/functions/stock-price/tpexFallback.json
 *   node scripts/refresh-tpex-fallback.cjs <path>     Write somewhere else (for a dry run)
 */
const fs = require('fs')
const path = require('path')

const URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'
const DEFAULT_OUT = path.resolve(__dirname, '..', 'supabase/functions/stock-price/tpexFallback.json')

async function main() {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT
  const res = await fetch(URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`TPEx HTTP ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) throw new Error('TPEx returned no rows')

  const rows = data
    .map((r) => ({ Code: r.SecuritiesCompanyCode, Name: r.CompanyName, Close: r.Close }))
    .filter((r) => typeof r.Code === 'string' && r.Code !== '' && typeof r.Name === 'string')
  // A partial response would silently shrink the fallback list; the snapshot has held ~1,000 rows.
  if (rows.length < 500) throw new Error(`only ${rows.length} usable rows — refusing to overwrite`)

  const generatedAt = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const body = `{\n  "generatedAt": "${generatedAt}",\n  "rows": [\n${rows
    .map((r) => `    ${JSON.stringify(r)}`)
    .join(',\n')}\n  ]\n}\n`
  fs.writeFileSync(out, body)
  console.log(`wrote ${rows.length} rows (${generatedAt}) to ${path.relative(process.cwd(), out)}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
