import { describe, expect, it } from 'vitest'
import {
  SECTOR_FLOW_DAYS_CAP,
  appendSectorFlowDay,
  buildSectorFlowDay,
  classify,
  miIndexUrl,
  parseIndustryMap,
  parseMiIndexPrices,
  parseTpexInstitutional,
  parseTpexQuotes,
  parseTwseInstitutional,
  rocCompactDate,
  sectorFlowFingerprint,
  type InstNet,
  type PriceRow,
  type SectorFlowDay,
  type SectorFlowInput,
} from './twSectorFlow.ts'

// ---- parsers ----

describe('rocCompactDate', () => {
  it('turns a compact ROC date into ISO', () => {
    expect(rocCompactDate('1151002')).toBe('2026-10-02')
    expect(rocCompactDate('991231')).toBe('2010-12-31')
  })
  it('rejects anything else', () => {
    expect(rocCompactDate('2026-10-02')).toBeNull()
    expect(rocCompactDate(undefined)).toBeNull()
  })
})

describe('miIndexUrl', () => {
  it('asks for every stock except warrants on one day', () => {
    expect(miIndexUrl('20261002')).toBe(
      'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=20261002&type=ALLBUT0999&response=json',
    )
    expect(miIndexUrl('2026-10-02')).toBeNull()
  })
})

describe('parseMiIndexPrices', () => {
  const resp = (fields: string[], data: string[][], title = '115年10月02日 每日收盤行情(全部(不含權證、牛熊證、可展延牛熊證))') => ({
    stat: 'OK',
    date: '20261002',
    tables: [
      { title: '價格指數(臺灣證券交易所)', fields: ['指數'], data: [['x']] },
      { title, fields, data },
    ],
  })
  const FIELDS = ['證券代號', '證券名稱', '成交股數', '成交筆數', '成交金額', '開盤價', '最高價', '最低價', '收盤價']

  it('reads shares, amount and close by header text', () => {
    const out = parseMiIndexPrices(
      resp(FIELDS, [
        ['2330', '台積電', '10,000', '50', '1,000,000', '99', '101', '98', '100.5'],
        ['1101', '台泥', '0', '0', '0', '--', '--', '--', '--'],
      ]),
    )
    expect(out?.date).toBe('2026-10-02')
    expect(out?.prices.get('2330')).toEqual({ name: '台積電', shares: 10000, valueTwd: 1000000, close: 100.5 })
    // No trades: kept (it still belongs to its sector's turnover), close is unknown, not 0.
    expect(out?.prices.get('1101')).toEqual({ name: '台泥', shares: 0, valueTwd: 0, close: null })
  })

  it('still finds a column when the order changes', () => {
    const shuffled = ['證券名稱', '證券代號', '收盤價', '成交金額', '成交股數']
    const out = parseMiIndexPrices(resp(shuffled, [['台積電', '2330', '100', '1,000,000', '10,000']]))
    expect(out?.prices.get('2330')).toEqual({ name: '台積電', shares: 10000, valueTwd: 1000000, close: 100 })
  })

  it('returns null when a needed column is gone, the table is missing, or it is not a trading day', () => {
    expect(parseMiIndexPrices(resp(['證券代號', '證券名稱'], [['2330', 'x']]))).toBeNull()
    expect(parseMiIndexPrices(resp(FIELDS, [['2330', 'a', '1', '1', '1', '1', '1', '1', '1']], '別的表'))).toBeNull()
    expect(parseMiIndexPrices({ stat: '很抱歉，沒有符合條件的資料!' })).toBeNull()
    expect(parseMiIndexPrices(null)).toBeNull()
  })
})

describe('parseTwseInstitutional', () => {
  const FIELDS = [
    '證券代號',
    '證券名稱',
    '外陸資買賣超股數(不含外資自營商)',
    '外資自營商買賣超股數',
    '投信買賣超股數',
    '自營商買賣超股數',
    '三大法人買賣超股數',
  ]
  it('sums foreign + foreign dealer and keeps trust and dealer apart', () => {
    const out = parseTwseInstitutional({
      fields: FIELDS,
      data: [['2330  ', '台積電', '1,000', '200', '-300', '50', '950']],
    })
    expect(out?.get('2330')).toEqual({ foreign: 1200, trust: -300, dealer: 50 })
  })
  it('matches headers through stray and full-width spaces', () => {
    const spaced = FIELDS.map((f) => `${f}　 `)
    expect(parseTwseInstitutional({ fields: spaced, data: [['2330', 'x', '1', '0', '0', '0', '1']] })?.size).toBe(1)
  })
  it('returns null when a part is missing, never a partial sum', () => {
    expect(parseTwseInstitutional({ fields: FIELDS.filter((f) => f !== '投信買賣超股數'), data: [['2330']] })).toBeNull()
    expect(parseTwseInstitutional({ stat: 'x' })).toBeNull()
  })
})

describe('parseTpexInstitutional', () => {
  const row = (code: string, over: Record<string, string> = {}) => ({
    Date: '1151002',
    SecuritiesCompanyCode: code,
    CompanyName: 'x',
    // The real file has a leading space on one key and two spellings of the dealer keys.
    'Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference': '1,000',
    'Foreign Dealers-TotalSell': '0',
    'ForeignDealers-Difference': '200',
    'SecuritiesInvestmentTrustCompanies-Difference': '-300',
    'Dealers-Difference': '50',
    TotalDifference: '950',
    ...over,
  })
  it('reads the net shares of the four groups and the data day', () => {
    const out = parseTpexInstitutional([row('6488')])
    expect(out?.date).toBe('2026-10-02')
    expect(out?.net.get('6488')).toEqual({ foreign: 1200, trust: -300, dealer: 50 })
  })
  it('returns null for an empty or reshaped file', () => {
    expect(parseTpexInstitutional([])).toBeNull()
    expect(parseTpexInstitutional([{ SecuritiesCompanyCode: '6488' }])).toBeNull()
    expect(parseTpexInstitutional('nope')).toBeNull()
  })
})

describe('parseTpexQuotes', () => {
  it('reads amount, shares and close', () => {
    const out = parseTpexQuotes([
      { Date: '1151002', SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Close: '500', TradingShares: '1,000', TransactionAmount: '500,000' },
      { Date: '1151002', SecuritiesCompanyCode: '1240', CompanyName: '茂生農經', Close: '---', TradingShares: '0', TransactionAmount: '0' },
    ])
    expect(out?.date).toBe('2026-10-02')
    expect(out?.prices.get('6488')).toEqual({ name: '環球晶', shares: 1000, valueTwd: 500000, close: 500 })
    expect(out?.prices.get('1240')?.close).toBeNull()
  })
})

describe('parseIndustryMap', () => {
  it('maps ticker to industry from either list shape', () => {
    const listed = parseIndustryMap([{ 公司代號: '2330 ', 產業別: '24' }], '公司代號', '產業別')
    const otc = parseIndustryMap(
      [{ SecuritiesCompanyCode: '6488', SecuritiesIndustryCode: '24' }],
      'SecuritiesCompanyCode',
      'SecuritiesIndustryCode',
    )
    expect(listed.get('2330')).toBe('24')
    expect(otc.get('6488')).toBe('24')
    expect(parseIndustryMap('nope', 'a', 'b').size).toBe(0)
  })
})

// ---- aggregation ----

const px = (name: string, shares: number, valueTwd: number): PriceRow => ({ name, shares, valueTwd, close: null })
const inst = (foreign: number, trust: number, dealer: number): InstNet => ({ foreign, trust, dealer })

/**
 * Hand-worked day. VWAP = 成交金額 ÷ 成交股數:
 *   2330 (foundry) 100  → foreign +300, dealer −100        = +30,000 −10,000 = +20,000
 *   2454 (design)  500  → foreign −10,  trust +4           = −5,000 + 2,000  = −3,000
 *   3711 (osat)    200  → foreign +50                      = +10,000
 *   2308 (28)      300  → trust +10                        = +3,000
 *   0050 (ETF)     150  → foreign −20                      = −3,000
 *   9999 (no list)  50  → dealer +1                        = +50
 *   8888 (TPEx, 24, not in the segment list → other) 100   → foreign +100 = +10,000
 */
function dayInput(over: Partial<SectorFlowInput> = {}): SectorFlowInput {
  return {
    date: '2026-10-02',
    listedPrices: new Map([
      ['2330', px('台積電', 10000, 1_000_000)],
      ['2454', px('聯發科', 1000, 500_000)],
      ['3711', px('日月光投控', 2000, 400_000)],
      ['2308', px('台達電', 1000, 300_000)],
      ['0050', px('元大台灣50', 5000, 750_000)],
      ['9999', px('未分類', 100, 5_000)],
    ]),
    listedInst: new Map([
      ['2330', inst(300, 0, -100)],
      ['2454', inst(-10, 4, 0)],
      ['3711', inst(50, 0, 0)],
      ['2308', inst(0, 10, 0)],
      ['0050', inst(-20, 0, 0)],
      ['9999', inst(0, 0, 1)],
    ]),
    otc: {
      prices: new Map([['8888', px('某設備商', 1000, 100_000)]]),
      inst: new Map([['8888', inst(100, 0, 0)]]),
    },
    industry: new Map([
      ['2330', '24'],
      ['2454', '24'],
      ['3711', '24'],
      ['2308', '28'],
      ['8888', '24'],
    ]),
    officialListedTotalTwd: 27_000,
    ...over,
  }
}

const row = (day: SectorFlowDay, code: string) => day.rows.find((r) => r.code === code)!

describe('classify', () => {
  const industry = new Map([['2308', '28'], ['2330', '24']])
  it('uses the industry list, and splits only semiconductors', () => {
    expect(classify('2308', industry)).toEqual({ sector: '28', child: null })
    expect(classify('2330', industry)).toEqual({ sector: '24', child: '24:foundry' })
  })
  it('puts an unlisted 0-prefixed code in ETF and anything else in NA', () => {
    expect(classify('0050', industry)).toEqual({ sector: 'ETF', child: null })
    expect(classify('9999', industry)).toEqual({ sector: 'NA', child: null })
  })
  it('puts a semiconductor ticker missing from the segment list in "other"', () => {
    expect(classify('8888', new Map([['8888', '24']])).child).toBe('24:other')
  })
})

describe('buildSectorFlowDay', () => {
  const day = buildSectorFlowDay(dayInput())

  it('values net shares at the day VWAP and sums by sector', () => {
    expect(row(day, '28')).toMatchObject({ foreignTwd: 0, trustTwd: 3000, dealerTwd: 0, totalTwd: 3000, stocks: 1 })
    expect(row(day, 'ETF')).toMatchObject({ totalTwd: -3000 })
    expect(row(day, 'NA')).toMatchObject({ dealerTwd: 50, totalTwd: 50 })
  })

  it('splits 半導體 into children that add up to the parent on every field', () => {
    const parent = row(day, '24')
    expect(parent).toMatchObject({ foreignTwd: 45000, trustTwd: 2000, dealerTwd: -10000, totalTwd: 37000, stocks: 4 })
    expect(row(day, '24:foundry').totalTwd).toBe(20000)
    expect(row(day, '24:design').totalTwd).toBe(-3000)
    expect(row(day, '24:osat').totalTwd).toBe(10000)
    expect(row(day, '24:other').totalTwd).toBe(10000)
    const children = day.rows.filter((r) => r.parent === '24')
    expect(children).toHaveLength(4)
    for (const k of ['foreignTwd', 'trustTwd', 'dealerTwd', 'totalTwd', 'turnoverTwd', 'stocks'] as const) {
      expect(children.reduce((s, c) => s + c[k], 0)).toBe(parent[k])
    }
    expect(row(day, '24:design').parent).toBe('24')
  })

  it('counts all trading in a sector as turnover, not only what institutions touched', () => {
    expect(row(day, '24').turnoverTwd).toBe(2_000_000)
    expect(day.marketTurnoverTwd).toBe(3_055_000)
  })

  it('totals the listed market only against the official figure, and reports it next to it', () => {
    expect(day.estimateListedTotalTwd).toBe(27050)
    expect(day.officialListedTotalTwd).toBe(27000)
  })

  it('keeps the biggest buyers and sellers per sector, ties broken by ticker', () => {
    expect(row(day, '24').topBuy.map((t) => t.ticker)).toEqual(['2330', '3711', '8888'])
    expect(row(day, '24').topSell).toEqual([{ ticker: '2454', name: '聯發科', netTwd: -3000 }])
  })

  it('lists rows by code so the file does not depend on input order', () => {
    const codes = day.rows.map((r) => r.code)
    expect(codes).toEqual([...codes].sort())
  })

  it('covers the listed market alone when TPEx is not on the day yet', () => {
    const listedOnly = buildSectorFlowDay(dayInput({ otc: null }))
    expect(listedOnly.coverage).toEqual({ listed: true, otc: false })
    expect(row(listedOnly, '24').totalTwd).toBe(27000)
    expect(row(listedOnly, '24:other')).toBeUndefined()
    expect(listedOnly.marketTurnoverTwd).toBe(2_955_000)
    expect(day.coverage).toEqual({ listed: true, otc: true })
  })

  it('leaves out, and counts, institutional stocks it cannot price', () => {
    const input = dayInput()
    input.listedInst.set('1234', inst(5, 0, 0))
    input.listedInst.set('1235', inst(0, 0, 0))
    const out = buildSectorFlowDay(input)
    expect(out.unpriced).toBe(1)
    expect(out.estimateListedTotalTwd).toBe(27050)
  })

  it('does not let a stock with no trades produce a number', () => {
    const input = dayInput()
    input.listedPrices.set('2308', px('台達電', 0, 0))
    expect(row(buildSectorFlowDay(input), '28').totalTwd).toBe(0)
  })

  it('gives the same fingerprint however the maps were filled', () => {
    const input = dayInput()
    const reversed = dayInput({
      listedPrices: new Map([...input.listedPrices].reverse()),
      listedInst: new Map([...input.listedInst].reverse()),
    })
    expect(sectorFlowFingerprint(buildSectorFlowDay(reversed))).toBe(sectorFlowFingerprint(day))
  })

  it('changes the fingerprint when a figure changes', () => {
    const input = dayInput()
    input.listedInst.set('2308', inst(0, 11, 0))
    expect(sectorFlowFingerprint(buildSectorFlowDay(input))).not.toBe(sectorFlowFingerprint(day))
  })
})

describe('appendSectorFlowDay', () => {
  const make = (date: string): SectorFlowDay => ({ ...buildSectorFlowDay(dayInput()), date })

  it('starts a file, keeps days oldest to newest, and replaces a re-run of the same day', () => {
    const a = appendSectorFlowDay(null, make('2026-10-01'), 't1')
    const b = appendSectorFlowDay(a, make('2026-10-02'), 't2')
    const c = appendSectorFlowDay(b, make('2026-10-02'), 't3')
    expect(c.days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02'])
    expect(c.asOf).toBe('t3')
    expect(c.schema).toBe(1)
  })

  it('keeps only the newest top-stock lists', () => {
    const a = appendSectorFlowDay(null, make('2026-10-01'), 't1')
    const b = appendSectorFlowDay(a, make('2026-10-02'), 't2')
    expect(b.days[0].rows.every((r) => r.topBuy.length === 0 && r.topSell.length === 0)).toBe(true)
    expect(b.days[1].rows.some((r) => r.topBuy.length > 0)).toBe(true)
  })

  it('caps the file at the newest SECTOR_FLOW_DAYS_CAP days', () => {
    let file = appendSectorFlowDay(null, make('2026-09-01'), 't')
    for (let i = 2; i <= SECTOR_FLOW_DAYS_CAP + 5; i++) {
      file = appendSectorFlowDay(file, make(`2026-09-${String(i).padStart(2, '0')}`), 't')
    }
    expect(file.days).toHaveLength(SECTOR_FLOW_DAYS_CAP)
    expect(file.days[file.days.length - 1].date).toBe(`2026-09-${String(SECTOR_FLOW_DAYS_CAP + 5).padStart(2, '0')}`)
  })

  it('stores the fingerprint of the day it was given', () => {
    const d = make('2026-10-02')
    expect(appendSectorFlowDay(null, d, 't').fingerprint).toBe(sectorFlowFingerprint(d))
  })
})

describe('top stocks per sector', () => {
  it('keeps the five biggest buyers and sellers, biggest first', async () => {
    const { TOP_PER_SECTOR } = await import('./twSectorFlow.ts')
    expect(TOP_PER_SECTOR).toBe(5)
    const prices = new Map<string, PriceRow>()
    const instMap = new Map<string, InstNet>()
    const industry = new Map<string, string>()
    for (let i = 1; i <= 7; i++) {
      const t = `70${i}0`
      prices.set(t, px(`買${i}`, 1000, 100_000)) // VWAP 100
      instMap.set(t, inst(i * 10, 0, 0))
      industry.set(t, '28')
    }
    const out = buildSectorFlowDay(dayInput({ listedPrices: prices, listedInst: instMap, otc: null, industry }))
    const r = row(out, '28')
    expect(r.topBuy.map((t) => t.name)).toEqual(['買7', '買6', '買5', '買4', '買3'])
    expect(r.topBuy[0].netTwd).toBe(70 * 100)
    expect(r.topSell).toEqual([])
  })

  it('also ranks by each group alone, so a group view names that group\'s stocks', () => {
    const d = buildSectorFlowDay(dayInput())
    // 2330: 外資 +300 sh, 自營商 −100 sh at VWAP 100; 2454 (design): 外資 −10 sh, 投信 +4 sh at VWAP 500.
    const semi = row(d, '24').groupTops!
    expect(semi.foreign.buy.map((t) => t.ticker)).toEqual(['2330', '3711', '8888'])
    expect(semi.foreign.buy[0]).toEqual({ ticker: '2330', name: '台積電', netTwd: 30_000 })
    expect(semi.foreign.sell).toEqual([{ ticker: '2454', name: '聯發科', netTwd: -5_000 }])
    expect(semi.trust.buy).toEqual([{ ticker: '2454', name: '聯發科', netTwd: 2_000 }])
    expect(semi.trust.sell).toEqual([])
    expect(semi.dealer.sell).toEqual([{ ticker: '2330', name: '台積電', netTwd: -10_000 }])
    expect(semi.dealer.buy).toEqual([])
  })

  it('gives a semiconductor part its own lists, and a group list can disagree with the total', () => {
    const d = buildSectorFlowDay(dayInput())
    const design = row(d, '24:design')
    expect(design.groupTops!.foreign.sell.map((t) => t.ticker)).toEqual(['2454'])
    // 2454 is a net seller overall (−3,000) yet 投信 bought it: the lists answer different questions.
    expect(design.topSell.map((t) => t.ticker)).toEqual(['2454'])
    expect(design.groupTops!.trust.buy.map((t) => t.ticker)).toEqual(['2454'])
  })

  it('drops every list from older days when a day is appended', () => {
    const a = appendSectorFlowDay(null, { ...buildSectorFlowDay(dayInput()), date: '2026-10-01' }, 't1')
    const b = appendSectorFlowDay(a, { ...buildSectorFlowDay(dayInput()), date: '2026-10-02' }, 't2')
    for (const r of b.days[0].rows) {
      expect(r.topBuy).toEqual([])
      expect(r.groupTops).toBeUndefined()
    }
    expect(b.days[1].rows.some((r) => r.groupTops !== undefined)).toBe(true)
  })

  it('keeps the fingerprint stable however the stocks were ordered', () => {
    const input = dayInput()
    const reversed = dayInput({
      listedPrices: new Map([...input.listedPrices].reverse()),
      listedInst: new Map([...input.listedInst].reverse()),
    })
    expect(sectorFlowFingerprint(buildSectorFlowDay(reversed))).toBe(sectorFlowFingerprint(buildSectorFlowDay(input)))
  })
})
