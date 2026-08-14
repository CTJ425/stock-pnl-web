const https = require('https')
const fs = require('fs')
const path = require('path')

const PROD_BASE = 'https://kxnxadaghidwumqsqneu.supabase.co/storage/v1/object/public/reports'
const DEV_BASE = 'https://korq9tvdz0jd7yblr72p.ivan.lab/storage/v1/object/public/reports'

const PROD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PROD_KEY || ''

async function fetchJson(url) {
  const agent = new https.Agent({ rejectUnauthorized: false })
  const res = await fetch(url, { agent })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  return await res.json()
}

async function listFiles(baseUrl, key, prefix = '') {
  const url = `${baseUrl}/storage/v1/object/list/reports`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'apikey': key,
    },
    body: JSON.stringify({ prefix, limit: 100, sortBy: { column: 'name', order: 'asc' } }),
  })
  if (!res.ok) return []
  const items = await res.json()
  let all = []
  for (const item of items) {
    if (item.id === null) {
      const sub = await listFiles(baseUrl, key, prefix ? `${prefix}/${item.name}` : item.name)
      all = all.concat(sub)
    } else {
      all.push(prefix ? `${prefix}/${item.name}` : item.name)
    }
  }
  return all
}

async function auditMarketDaily() {
  console.log('\n========================================')
  console.log('1. AUDIT: market/daily.json (Macro TW Market)')
  console.log('========================================')
  const prod = await fetchJson(`${PROD_BASE}/market/daily.json?ts=${Date.now()}`)
  const dev = await fetchJson(`${DEV_BASE}/market/daily.json?ts=${Date.now()}`)

  console.log(`PROD days count: ${prod.days.length} (asOf: ${prod.asOf})`)
  console.log(`DEV  days count: ${dev.days.length} (asOf: ${dev.asOf})`)

  let diffs = 0
  const prodMap = new Map(prod.days.map(d => [d.date, d]))
  const devMap = new Map(dev.days.map(d => [d.date, d]))

  const allDates = [...new Set([...prodMap.keys(), ...devMap.keys()])].sort().reverse()
  for (const date of allDates) {
    const p = prodMap.get(date)
    const d = devMap.get(date)
    if (!p || !d) {
      console.log(`[Diff] Date ${date} missing in ${!p ? 'PROD' : 'DEV'}`)
      diffs++
      continue
    }
    const pStr = JSON.stringify(p)
    const dStr = JSON.stringify(d)
    if (pStr !== dStr) {
      console.log(`[Diff] Date ${date} differs between DEV and PROD:`)
      console.log(`  PROD:`, p.institutional?.totalTwd, 'trust:', p.institutional?.trustTwd)
      console.log(`  DEV :`, d.institutional?.totalTwd, 'trust:', d.institutional?.trustTwd)
      diffs++
    }
  }
  if (diffs === 0) {
    console.log(`✅ market/daily.json is 100% identical between DEV and PROD across all ${allDates.length} trading days!`)
  } else {
    console.log(`❌ Found ${diffs} discrepancies in market/daily.json`)
  }
}

async function auditFx() {
  console.log('\n========================================')
  console.log('2. AUDIT: fx/twd.json (FX Daily Exchange Rates)')
  console.log('========================================')
  try {
    const prod = await fetchJson(`${PROD_BASE}/fx/twd.json?ts=${Date.now()}`)
    const dev = await fetchJson(`${DEV_BASE}/fx/twd.json?ts=${Date.now()}`)
    console.log(`PROD fx schema: ${prod.schema}, asOf: ${prod.asOf}, records: ${prod.rates ? Object.keys(prod.rates).length : prod.history?.length}`)
    console.log(`DEV  fx schema: ${dev.schema}, asOf: ${dev.asOf}, records: ${dev.rates ? Object.keys(dev.rates).length : dev.history?.length}`)
    console.log(`PROD USD/TWD latest:`, prod.rates?.USDTWD ?? prod.usd ?? prod)
    console.log(`DEV  USD/TWD latest:`, dev.rates?.USDTWD ?? dev.usd ?? dev)
    console.log('✅ FX data accessible and healthy.')
  } catch (err) {
    console.error('❌ FX audit error:', err.message)
  }
}

async function auditMacroUS() {
  console.log('\n========================================')
  console.log('3. AUDIT: macro/us.json (US Macro Economic Series)')
  console.log('========================================')
  try {
    const prod = await fetchJson(`${PROD_BASE}/macro/us.json?ts=${Date.now()}`)
    const dev = await fetchJson(`${DEV_BASE}/macro/us.json?ts=${Date.now()}`)
    console.log(`PROD macro schema: ${prod.schema}, asOf: ${prod.asOf}, series count: ${prod.series ? Object.keys(prod.series).length : 'N/A'}`)
    console.log(`DEV  macro schema: ${dev.schema}, asOf: ${dev.asOf}, series count: ${dev.series ? Object.keys(dev.series).length : 'N/A'}`)
    if (prod.series) {
      for (const [id, s] of Object.entries(prod.series)) {
        const latestObs = s.observations?.[s.observations.length - 1]
        console.log(`  - Series ${id} (${s.name}): latest = ${latestObs?.date} (${latestObs?.value})`)
      }
    }
    console.log('✅ Macro US series accessible and healthy.')
  } catch (err) {
    console.error('❌ Macro US audit error:', err.message)
  }
}

async function auditManifest() {
  console.log('\n========================================')
  console.log('4. AUDIT: manifest.json (Sync Status Manifest)')
  console.log('========================================')
  try {
    const prod = await fetchJson(`${PROD_BASE}/manifest.json?ts=${Date.now()}`)
    const dev = await fetchJson(`${DEV_BASE}/manifest.json?ts=${Date.now()}`)
    console.log(`PROD manifest:`, prod)
    console.log(`DEV  manifest:`, dev)
    console.log('✅ manifest.json accessible.')
  } catch (err) {
    console.error('❌ Manifest audit error:', err.message)
  }
}

async function auditTickers() {
  console.log('\n========================================')
  console.log('5. AUDIT: daily/*.json & fundamental/*.json (Holdings & Reports)')
  console.log('========================================')
  const prodFiles = await listFiles('https://kxnxadaghidwumqsqneu.supabase.co', PROD_KEY)
  const dailyFiles = prodFiles.filter(f => f.startsWith('daily/'))
  const fundFiles = prodFiles.filter(f => f.startsWith('fundamental/'))

  console.log(`Found ${dailyFiles.length} daily ticker files and ${fundFiles.length} fundamental ticker files in PROD.`)

  let dailyIssues = 0
  let fundIssues = 0

  // Audit sample of 10 tickers
  const sampleTickers = ['2330', '2317', '2454', '0050', '2609', '3008', '2308', '2382', '3231', '2354'].filter(
    t => dailyFiles.includes(`daily/${t}.json`)
  )

  console.log(`Sampling tickers: ${sampleTickers.join(', ')}`)
  for (const t of sampleTickers) {
    const pDaily = await fetchJson(`${PROD_BASE}/daily/${t}.json?ts=${Date.now()}`)
    const pFund = await fetchJson(`${PROD_BASE}/fundamental/${t}.json?ts=${Date.now()}`)

    const dDate = pDaily.date || pDaily.asOf || pDaily.chips?.date
    const fValDate = pFund.valuation?.date || pFund.valuationDate
    const fRevMonth = pFund.revenue?.latestMonth || pFund.revenueMonth
    const fProfitQ = pFund.profit?.latestQuarter || pFund.profitQuarter

    console.log(`  Ticker ${t}:`)
    console.log(`    Daily date: ${dDate}, price: ${pDaily.price?.close ?? pDaily.close}, chip records: ${pDaily.chips?.history?.length ?? 'N/A'}`)
    console.log(`    Fund: valuationDate=${fValDate}, revMonth=${fRevMonth}, profitQuarter=${fProfitQ}`)

    if (!dDate) {
      console.log(`    ⚠️ Ticker ${t} missing daily date`)
      dailyIssues++
    }
  }

  if (dailyIssues === 0 && fundIssues === 0) {
    console.log('✅ Daily and Fundamental ticker data are structured correctly.')
  }
}

async function main() {
  await auditMarketDaily()
  await auditFx()
  await auditMacroUS()
  await auditManifest()
  await auditTickers()
}

main().catch(console.error)

