import { beforeEach, describe, expect, it } from 'vitest'
import {
  INDUSTRY_MAP_MAX_AGE_MS,
  INDUSTRY_MAP_PATH,
  SECTOR_FLOW_PATH,
  syncSectorFlow,
  type SectorFlowSyncDeps,
} from './sectorFlowSync.ts'
import {
  INDUSTRY_LISTED_URL,
  INDUSTRY_OTC_URL,
  TPEX_INSTITUTIONAL_URL,
  TPEX_QUOTES_URL,
  miIndexUrl,
  type SectorFlowFile,
} from './twSectorFlow.ts'
import { bfi82uDayUrl } from './twMarket.ts'

const YMD = '20261002'
const NOW = new Date('2026-10-02T10:00:00Z')

const T86 = {
  stat: 'OK',
  fields: ['證券代號', '證券名稱', '外陸資買賣超股數(不含外資自營商)', '外資自營商買賣超股數', '投信買賣超股數', '自營商買賣超股數', '三大法人買賣超股數'],
  data: [['2330', '台積電', '300', '0', '0', '-100', '200']],
}

const miIndex = (date = YMD) => ({
  stat: 'OK',
  date,
  tables: [
    {
      title: '每日收盤行情(全部(不含權證、牛熊證、可展延牛熊證))',
      fields: ['證券代號', '證券名稱', '成交股數', '成交金額', '收盤價'],
      data: [['2330', '台積電', '10,000', '1,000,000', '100']],
    },
  ],
})

const BFI = {
  stat: 'OK',
  date: YMD,
  fields: ['單位名稱', '買進金額', '賣出金額', '買賣差額'],
  data: [['合計', '30,000', '10,000', '20,000']],
}

const tpexInst = (date = '1151002') => [
  {
    Date: date,
    SecuritiesCompanyCode: '6488',
    'Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference': '100',
    'ForeignDealers-Difference': '0',
    'SecuritiesInvestmentTrustCompanies-Difference': '0',
    'Dealers-Difference': '0',
  },
]
const tpexQuotes = (date = '1151002') => [
  { Date: date, SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Close: '500', TradingShares: '1,000', TransactionAmount: '500,000' },
]

function listedIndustry(n: number) {
  return Array.from({ length: n }, (_, i) => ({ 公司代號: i === 0 ? '2330' : `L${i}`, 產業別: '24' }))
}
function otcIndustry(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    SecuritiesCompanyCode: i === 0 ? '6488' : `O${i}`,
    SecuritiesIndustryCode: '24',
  }))
}

interface World {
  urls: Record<string, unknown>
  t86: unknown
  storage: Map<string, unknown>
  uploads: string[]
  failUpload: boolean
  throwOn: string | null
}

let world: World

function deps(): SectorFlowSyncDeps {
  return {
    fetchJson: async (url) => {
      if (world.throwOn && url.includes(world.throwOn)) throw new Error('boom')
      return world.urls[url] ?? null
    },
    loadT86: async () => world.t86,
    download: async <T,>(path: string) => (world.storage.get(path) as T | undefined) ?? null,
    upload: async (path, payload) => {
      if (world.failUpload) return false
      world.uploads.push(path)
      world.storage.set(path, JSON.parse(JSON.stringify(payload)))
      return true
    },
    now: () => NOW,
  }
}

beforeEach(() => {
  world = {
    urls: {
      [miIndexUrl(YMD)!]: miIndex(),
      [bfi82uDayUrl(YMD)!]: BFI,
      [TPEX_INSTITUTIONAL_URL]: tpexInst(),
      [TPEX_QUOTES_URL]: tpexQuotes(),
      [INDUSTRY_LISTED_URL]: listedIndustry(600),
      [INDUSTRY_OTC_URL]: otcIndustry(400),
    },
    t86: T86,
    storage: new Map(),
    uploads: [],
    failUpload: false,
    throwOn: null,
  }
})

const written = () => world.storage.get(SECTOR_FLOW_PATH) as SectorFlowFile | undefined

describe('syncSectorFlow', () => {
  it('builds the day from both markets and writes the file and the industry list', async () => {
    const r = await syncSectorFlow(YMD, deps())
    expect(r).toEqual({ synced: true, date: '2026-10-02', otc: true, reason: null })
    const day = written()!.days[0]
    expect(day.date).toBe('2026-10-02')
    expect(day.coverage).toEqual({ listed: true, otc: true })
    expect(day.officialListedTotalTwd).toBe(20000)
    // 2330: foreign +300, dealer −100 at VWAP 100; 6488: foreign +100 at VWAP 500.
    expect(day.rows.find((x) => x.code === '24')?.totalTwd).toBe(20000 + 50000)
    expect(world.uploads).toContain(INDUSTRY_MAP_PATH)
  })

  it('does not rewrite an unchanged day', async () => {
    await syncSectorFlow(YMD, deps())
    world.uploads.length = 0
    const r = await syncSectorFlow(YMD, deps())
    expect(r).toMatchObject({ synced: false, reason: 'unchanged', date: '2026-10-02' })
    expect(world.uploads).toEqual([])
  })

  it('rewrites the day when the exchange revises T86', async () => {
    await syncSectorFlow(YMD, deps())
    world.t86 = { ...T86, data: [['2330', '台積電', '301', '0', '0', '-100', '201']] }
    const r = await syncSectorFlow(YMD, deps())
    expect(r.synced).toBe(true)
    expect(written()!.days).toHaveLength(1)
  })

  it('leaves TPEx out when it is still showing another day', async () => {
    world.urls[TPEX_INSTITUTIONAL_URL] = tpexInst('1151001')
    const r = await syncSectorFlow(YMD, deps())
    expect(r.otc).toBe(false)
    const day = written()!.days[0]
    expect(day.coverage.otc).toBe(false)
    expect(day.rows.find((x) => x.code === '24')?.totalTwd).toBe(20000)
  })

  it('leaves TPEx out when only one of its two files has caught up', async () => {
    world.urls[TPEX_QUOTES_URL] = tpexQuotes('1151001')
    expect((await syncSectorFlow(YMD, deps())).otc).toBe(false)
  })

  it('reports no-t86 / bad-t86 / no-prices and writes nothing', async () => {
    world.t86 = null
    expect((await syncSectorFlow(YMD, deps())).reason).toBe('no-t86')
    world.t86 = { fields: ['證券代號'], data: [['2330']] }
    expect((await syncSectorFlow(YMD, deps())).reason).toBe('bad-t86')
    world.t86 = T86
    world.urls[miIndexUrl(YMD)!] = miIndex('20261001')
    expect((await syncSectorFlow(YMD, deps())).reason).toBe('no-prices')
    // The industry list may be cached on the way (it does not depend on the day); the day itself is not.
    expect(world.uploads).not.toContain(SECTOR_FLOW_PATH)
  })

  it('does not publish from a partial industry list', async () => {
    world.urls[INDUSTRY_OTC_URL] = otcIndustry(5)
    const r = await syncSectorFlow(YMD, deps())
    expect(r.reason).toBe('no-industry')
    expect(world.uploads).toEqual([])
  })

  it('uses a stored complete list over a new partial one', async () => {
    const stored = Object.fromEntries([...listedIndustry(600), ...otcIndustry(400)].map((r) => {
      const rec = r as Record<string, string>
      return [rec['公司代號'] ?? rec['SecuritiesCompanyCode'], '24']
    }))
    world.storage.set(INDUSTRY_MAP_PATH, {
      schema: 1,
      asOf: new Date(NOW.getTime() - INDUSTRY_MAP_MAX_AGE_MS - 1000).toISOString(),
      industry: stored,
    })
    world.urls[INDUSTRY_LISTED_URL] = listedIndustry(3)
    const r = await syncSectorFlow(YMD, deps())
    expect(r.synced).toBe(true)
    expect(world.uploads).not.toContain(INDUSTRY_MAP_PATH)
  })

  it('does not refetch a fresh stored list', async () => {
    await syncSectorFlow(YMD, deps())
    world.uploads.length = 0
    world.urls[INDUSTRY_LISTED_URL] = null
    world.t86 = { ...T86, data: [['2330', '台積電', '305', '0', '0', '-100', '205']] }
    const r = await syncSectorFlow(YMD, deps())
    expect(r.synced).toBe(true)
    expect(world.uploads).toEqual([SECTOR_FLOW_PATH])
  })

  it('reports upload-failed and error instead of throwing', async () => {
    world.failUpload = true
    expect((await syncSectorFlow(YMD, deps())).reason).toBe('upload-failed')
    world.failUpload = false
    world.throwOn = 'MI_INDEX'
    expect(await syncSectorFlow(YMD, deps())).toEqual({ synced: false, date: null, otc: false, reason: 'error' })
  })

  it('replaces a stored file that is not ours instead of appending to it', async () => {
    world.storage.set(SECTOR_FLOW_PATH, { days: 'garbage', fingerprint: 'x' })
    const r = await syncSectorFlow(YMD, deps())
    expect(r.synced).toBe(true)
    expect(written()!.days).toHaveLength(1)
  })
})
