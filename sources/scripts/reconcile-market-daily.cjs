/**
 * Reconcile market/daily.json institutional data against official TWSE BFI82U.
 *
 * Usage:
 *   node sources/scripts/reconcile-market-daily.cjs --target=dev
 *   node sources/scripts/reconcile-market-daily.cjs --target=prod
 */
const https = require('https')

const PROD_URL = 'https://kxnxadaghidwumqsqneu.supabase.co/storage/v1/object/public/reports/market/daily.json'
const DEV_URL = 'https://korq9tvdz0jd7yblr72p.ivan.lab/storage/v1/object/public/reports/market/daily.json'

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.replace(/,/g, '').trim()
  if (!s || !/^[+-]?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function parseBfi82u(json) {
  const t = json || {}
  if (t.stat !== 'OK' || !Array.isArray(t.data) || !Array.isArray(t.fields)) return null
  const iName = t.fields.indexOf('單位名稱')
  const iNet = t.fields.indexOf('買賣差額')
  if (iName < 0 || iNet < 0) return null
  const iBuy = t.fields.indexOf('買進金額')
  const iSell = t.fields.indexOf('賣出金額')

  const byName = new Map()
  for (const row of t.data) {
    if (!Array.isArray(row)) continue
    const name = String(row[iName] ?? '').trim()
    if (!name) continue
    byName.set(name, {
      net: num(row[iNet]),
      buy: iBuy < 0 ? null : num(row[iBuy]),
      sell: iSell < 0 ? null : num(row[iSell]),
    })
  }
  if (byName.size === 0) return null

  const side = (of) => {
    const pick = (...names) => {
      for (const n of names) {
        const v = byName.get(n)
        if (v !== undefined) return v[of]
      }
      return null
    }
    return {
      foreignTwd: pick('外資及陸資(不含外資自營商)', '外資及陸資'),
      foreignDealerTwd: pick('外資自營商'),
      trustTwd: pick('投信'),
      dealerSelfTwd: pick('自營商(自行買賣)', '自營商'),
      dealerHedgeTwd: pick('自營商(避險)'),
      totalTwd: pick('合計'),
    }
  }

  const buy = side('buy')
  const sell = side('sell')
  return {
    ...side('net'),
    buy: buy.totalTwd === null ? null : buy,
    sell: sell.totalTwd === null ? null : sell,
  }
}

async function fetchJson(url) {
  const agent = new https.Agent({ rejectUnauthorized: false })
  const res = await fetch(url, { agent })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  return await res.json()
}

async function main() {
  const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] || 'dev'
  const fileUrl = target === 'prod' ? PROD_URL : DEV_URL
  console.log(`[Reconcile] Target: ${target}, fetching from ${fileUrl}...`)

  const marketFile = await fetchJson(fileUrl)
  console.log(`[Reconcile] Loaded ${marketFile.days.length} days from ${marketFile.asOf}`)

  let updatedCount = 0
  for (let i = 0; i < marketFile.days.length; i++) {
    const d = marketFile.days[i]
    const ymd = d.date.replace(/-/g, '')
    const bfiUrl = `https://www.twse.com.tw/rwd/zh/fund/BFI82U?dayDate=${ymd}&type=day&response=json`
    
    try {
      const bfiRaw = await fetchJson(bfiUrl)
      const parsed = parseBfi82u(bfiRaw)
      if (!parsed) {
        console.log(`[Skip] ${d.date}: No BFI82U data (weekend/holiday)`)
        continue
      }
      const before = JSON.stringify(d.institutional)
      const after = JSON.stringify(parsed)
      if (before !== after) {
        console.log(`[Update] ${d.date}:`)
        console.log(`  Old: ${before}`)
        console.log(`  New: ${after}`)
        marketFile.days[i].institutional = parsed
        updatedCount++
      } else {
        console.log(`[OK] ${d.date}: Already matches official TWSE`)
      }
    } catch (err) {
      console.error(`[Error] ${d.date}:`, err.message)
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  marketFile.asOf = new Date().toISOString()
  console.log(`[Reconcile] Done. Updated ${updatedCount} days.`)
  
  const outJson = JSON.stringify(marketFile, null, 2)
  const fs = require('fs')
  const path = require('path')
  const outPath = path.join(__dirname, `reconciled-market-${target}.json`)
  fs.writeFileSync(outPath, outJson, 'utf8')
  console.log(`[Reconcile] Saved reconciled file to ${outPath}`)
}

main().catch(console.error)
