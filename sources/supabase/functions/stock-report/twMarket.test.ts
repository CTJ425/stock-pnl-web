import { describe, it, expect } from 'vitest'
import {
  bfi82uDayUrl,
  fmtqikMonthUrl,
  mergeMarketDays,
  parseBfi82u,
  parseFmtqik,
  planInstitutionalBackfill,
  parseTaiexHist,
  planMarketMonths,
  rocSlashDate,
  taiexHistMonthUrl,
  type MarketDay,
} from './twMarket'

/** Taken verbatim from actual response to rwd/zh/afterTrading/FMTQIK on 2026-08-04 (truncated to two columns)*/
const FMTQIK = {
  stat: 'OK',
  title: '115年08月市場成交資訊',
  fields: ['日期', '成交股數', '成交金額', '成交筆數', '發行量加權股價指數', '漲跌點數'],
  data: [
    ['115/08/03', '11,427,047,935', '885,506,043,091', '4,191,882', '43,386.41', '266.66'],
    ['115/08/04', '11,340,636,777', '1,087,045,875,836', '4,751,347', '43,360.66', '-25.75'],
  ],
}

/** Taken verbatim from actual response to rwd/zh/TAIEX/MI_5MINS_HIST on 2026-08-04 (truncated to two columns)*/
const TAIEX_HIST = {
  stat: 'OK',
  title: '115年08月 發行量加權股價指數歷史資料',
  fields: ['日期', '開盤指數', '最高指數', '最低指數', '收盤指數'],
  data: [
    ['115/08/03', '42,780.42', '43,784.19', '42,780.42', '43,386.41'],
    ['115/08/04', '43,092.49', '43,912.77', '42,895.81', '43,360.66'],
  ],
}

/** Taken verbatim from actual response to rwd/zh/fund/BFI82U on 2026-08-04*/
const BFI82U = {
  stat: 'OK',
  date: '20260803',
  fields: ['單位名稱', '買進金額', '賣出金額', '買賣差額'],
  data: [
    ['自營商(自行買賣)', '7,219,775,568', '13,046,561,508', '-5,826,785,940'],
    ['自營商(避險)', '31,213,457,962', '46,040,044,364', '-14,826,586,402'],
    ['投信', '35,468,123,234', '12,143,442,661', '23,324,680,573'],
    ['外資及陸資(不含外資自營商)', '351,436,807,764', '370,627,723,398', '-19,190,915,634'],
    ['外資自營商', '0', '0', '0'],
    ['合計', '425,338,164,528', '441,857,771,931', '-16,519,607,403'],
  ],
}

describe('rocSlashDate', () => {
  it('民國轉西元', () => {
    expect(rocSlashDate('115/08/03')).toBe('2026-08-03')
    expect(rocSlashDate('99/12/31')).toBe('2010-12-31')
  })

  it('格式不符回 null，不猜', () => {
    expect(rocSlashDate('2026-08-03')).toBeNull()
    expect(rocSlashDate('')).toBeNull()
    expect(rocSlashDate(null)).toBeNull()
  })
})

describe('網址', () => {
  it('成交量值一次一個月、法人金額一次一天', () => {
    expect(fmtqikMonthUrl('202608')).toContain('date=20260801')
    expect(bfi82uDayUrl('20260803')).toContain('dayDate=20260803')
    // type=month returns the total of the whole month instead of day by day, so it is always day
    expect(bfi82uDayUrl('20260803')).toContain('type=day')
  })

  it('格式不符回 null——不要去打一個必然失敗的請求', () => {
    expect(fmtqikMonthUrl('2026-08')).toBeNull()
    expect(bfi82uDayUrl('20260')).toBeNull()
  })
})

describe('parseFmtqik', () => {
  it('取出每日量值與指數，日期轉西元', () => {
    const days = parseFmtqik(FMTQIK)
    expect(days).toHaveLength(2)
    expect(days[0]).toEqual({
      date: '2026-08-03',
      tradeVolumeShares: 11427047935,
      tradeValueTwd: 885506043091,
      transactions: 4191882,
      taiex: 43386.41,
      changePoints: 266.66,
      // The open high and low is not in this one, and is supplemented by MI_5MINS_HIST.
      taiexOpen: null,
      taiexHigh: null,
      taiexLow: null,
      institutional: null,
    })
    // Negative price points should be left with a negative sign.
    expect(days[1].changePoints).toBe(-25.75)
  })

  it('stat 不是 OK 或結構壞掉時回空陣列，不拋錯', () => {
    expect(parseFmtqik({ stat: '很抱歉，沒有符合條件的資料!' })).toEqual([])
    expect(parseFmtqik(null)).toEqual([])
    expect(parseFmtqik({ stat: 'OK', fields: ['日期'], data: 'x' })).toEqual([])
  })
})

describe('parseBfi82u', () => {
  it('以單位名稱對應，不靠列順序', () => {
    const got = parseBfi82u(BFI82U)!
    expect(got.foreignTwd).toBe(-19190915634)
    expect(got.trustTwd).toBe(23324680573)
    expect(got.dealerSelfTwd).toBe(-5826785940)
    expect(got.dealerHedgeTwd).toBe(-14826586402)
    expect(got.foreignDealerTwd).toBe(0)
    // The total is the official value, do not add it yourself
    expect(got.totalTwd).toBe(-16519607403)
  })

  it('買進與賣出金額各自成組（0.6.32），差額仍取官方值不自行相減', () => {
    const got = parseBfi82u(BFI82U)!
    expect(got.buy!.foreignTwd).toBe(351436807764)
    expect(got.sell!.foreignTwd).toBe(370627723398)
    expect(got.buy!.trustTwd).toBe(35468123234)
    expect(got.buy!.totalTwd).toBe(425338164528)
    expect(got.sell!.totalTwd).toBe(441857771931)
    // Buy − Sell is indeed equal to the official difference, but the top number is given by the endpoint, not calculated here.
    expect(got.buy!.totalTwd! - got.sell!.totalTwd!).toBe(got.totalTwd)
  })

  it('端點少了買進 / 賣出欄時仍解得出差額，buy / sell 給 null', () => {
    const netOnly = {
      stat: 'OK',
      fields: ['單位名稱', '買賣差額'],
      data: [['合計', '-16,519,607,403'], ['投信', '23,324,680,573']],
    }
    const got = parseBfi82u(netOnly)!
    expect(got.totalTwd).toBe(-16519607403)
    expect(got.trustTwd).toBe(23324680573)
    // An empty shell with all six columns filled with nulls will make the replenishment judgment think that it has been filled, so the entire group will be null.
    expect(got.buy).toBeNull()
    expect(got.sell).toBeNull()
  })

  it('列順序顛倒也照樣對得上', () => {
    const shuffled = { ...BFI82U, data: [...BFI82U.data].reverse() }
    expect(parseBfi82u(shuffled)!.trustTwd).toBe(23324680573)
  })

  it('非交易日 / 結構壞掉回 null', () => {
    expect(parseBfi82u({ stat: '很抱歉，沒有符合條件的資料!' })).toBeNull()
    expect(parseBfi82u({ stat: 'OK', fields: ['單位名稱', '買賣差額'], data: [] })).toBeNull()
    expect(parseBfi82u(null)).toBeNull()
  })
})

describe('parseTaiexHist（大盤日 K 的開高低）', () => {
  it('取開高低，收盤不取——那一欄由 FMTQIK 負責', () => {
    const m = parseTaiexHist(TAIEX_HIST)
    expect(m.get('2026-08-03')).toEqual({ open: 42780.42, high: 43784.19, low: 42780.42 })
    // If two teams each write in the same column once, one day they will be inconsistent and it will be impossible to tell which one wrote it.
    expect(Object.keys(m.get('2026-08-04')!)).toEqual(['open', 'high', 'low'])
  })

  it('網址一次一個月；格式不符回 null', () => {
    expect(taiexHistMonthUrl('202608')).toContain('date=20260801')
    expect(taiexHistMonthUrl('2026-08')).toBeNull()
  })

  it('結構壞掉回空 Map 而不是拋錯', () => {
    expect(parseTaiexHist({ stat: '很抱歉，沒有符合條件的資料!' }).size).toBe(0)
    expect(parseTaiexHist(null).size).toBe(0)
  })
})

describe('mergeMarketDays', () => {
  const day = (date: string, value: number): MarketDay => ({
    date,
    tradeVolumeShares: 1,
    tradeValueTwd: value,
    transactions: 1,
    taiex: 1,
    changePoints: 1,
    taiexOpen: null,
    taiexHigh: null,
    taiexLow: null,
    institutional: null,
  })
  const side = (n: number) => ({
    foreignTwd: n,
    foreignDealerTwd: 0,
    trustTwd: n * 2,
    dealerSelfTwd: n * 3,
    dealerHedgeTwd: n * 4,
    totalTwd: n * 10,
  })
  const inst = { ...side(1), buy: null, sell: null }

  it('依日期去重、由舊到新', () => {
    const merged = mergeMarketDays([day('2026-08-04', 2)], [day('2026-08-03', 1)])
    expect(merged.map((d) => d.date)).toEqual(['2026-08-03', '2026-08-04'])
  })

  it('整月重抓不會把補好的法人金額洗掉', () => {
    // The trading volume is re-captured every night for the entire month, and that share will never include legal persons - if the entire transaction is overwritten, the replenishment results will be cleared every day.
    const prev = [{ ...day('2026-08-03', 1), institutional: inst }]
    const merged = mergeMarketDays(prev, [day('2026-08-03', 999)])
    expect(merged[0].tradeValueTwd).toBe(999) // 量值照常更新
    expect(merged[0].institutional).toEqual(inst) // 法人留著
  })

  it('整月重抓不會把已有的開高低洗掉（0.6.30）', () => {
    // Opening high and low comes from another endpoint. When that one fails, incoming will be null - the existing value cannot be overwritten.
    const prev = [{ ...day('2026-08-03', 1), taiexOpen: 42780.42, taiexHigh: 43784.19, taiexLow: 42780.42 }]
    const merged = mergeMarketDays(prev, [day('2026-08-03', 999)])
    expect(merged[0].taiexOpen).toBe(42780.42)
    expect(merged[0].tradeValueTwd).toBe(999)
  })

  it('重抓沒吐買進 / 賣出時留用已補好的那份（0.6.32）', () => {
    // Otherwise, it will become an infinite cycle of "replenishing, then being washed away, washing away, then being replenished"
    const filled = { ...side(1), buy: side(2), sell: side(3) }
    const prev = [{ ...day('2026-08-03', 1), institutional: filled }]
    const merged = mergeMarketDays(prev, [
      { ...day('2026-08-03', 999), institutional: { ...side(9), buy: null, sell: null } },
    ])
    expect(merged[0].institutional!.totalTwd).toBe(90) // 差額用新的
    expect(merged[0].institutional!.buy).toEqual(side(2)) // 買賣金額留舊的
    expect(merged[0].institutional!.sell).toEqual(side(3))
  })

  it('超過上限時砍最舊的', () => {
    const many = Array.from({ length: 5 }, (_, i) => day(`2026-08-0${i + 1}`, i))
    const merged = mergeMarketDays(many, [], 3)
    expect(merged.map((d) => d.date)).toEqual(['2026-08-03', '2026-08-04', '2026-08-05'])
  })
})

describe('planInstitutionalBackfill', () => {
  const side = () => ({
    foreignTwd: 1,
    foreignDealerTwd: 1,
    trustTwd: 1,
    dealerSelfTwd: 1,
    dealerHedgeTwd: 1,
    totalTwd: 1,
  })
  /** hasBuy=false represents the old data supplemented before 0.6.32: there is a difference and no buying/selling*/
  const day = (date: string, hasInst: boolean, hasBuy = true): MarketDay => ({
    date,
    tradeVolumeShares: null,
    tradeValueTwd: null,
    transactions: null,
    taiex: null,
    changePoints: null,
    taiexOpen: null,
    taiexHigh: null,
    taiexLow: null,
    institutional: hasInst
      ? { ...side(), buy: hasBuy ? side() : null, sell: hasBuy ? side() : null }
      : null,
  })

  it('只挑還沒補到的日子，由新到舊，且受預算限制', () => {
    const days = [
      day('2026-08-01', true),
      day('2026-08-02', false),
      day('2026-08-03', false),
      day('2026-08-04', false),
    ]
    expect(planInstitutionalBackfill(days, 2)).toEqual(['20260804', '20260803'])
  })

  it('只有差額、沒有買進金額的舊資料也算缺，會被排進回補（0.6.32）', () => {
    // Otherwise, the 120 days made up before 0.6.32 will never be able to generate buy/sell
    const days = [day('2026-08-01', true, false), day('2026-08-02', true, true)]
    expect(planInstitutionalBackfill(days, 5)).toEqual(['20260801'])
  })

  it('補滿或預算為 0 時回空陣列，呼叫端據此完全不發請求', () => {
    expect(planInstitutionalBackfill([day('2026-08-01', true)], 5)).toEqual([])
    expect(planInstitutionalBackfill([day('2026-08-01', false)], 0)).toEqual([])
    expect(planInstitutionalBackfill(null, 5)).toEqual([])
  })
})

describe('planMarketMonths', () => {
  const full = (date: string): MarketDay =>
    ({ date, taiexOpen: 1, taiexHigh: 1, taiexLow: 1 }) as MarketDay

  it('檔案已有夠多天、且開高低都齊時只抓本月', () => {
    const many = Array.from({ length: 20 }, (_, i) => full(`2026-07-${String(i + 1).padStart(2, '0')}`))
    expect(planMarketMonths(new Date('2026-08-04T13:00:00Z'), many)).toEqual(['202608'])
  })

  it('舊資料連欄位都沒有（undefined）也算缺口', () => {
    // The days written before 0.6.30 are read back as undefined, not null; using === null will miss all the old data.
    const legacy = [
      ...Array.from({ length: 20 }, (_, i) => full(`2026-07-${String(i + 1).padStart(2, '0')}`)),
      { date: '2026-06-30' } as MarketDay,
    ]
    expect(planMarketMonths(new Date('2026-08-04T13:00:00Z'), legacy)).toEqual(['202608', '202606'])
  })

  it('缺開高低的月份要重抓（0.6.30 新增欄位，舊資料整批沒有）', () => {
    // Without this, the K-lines will always only be the ones from this month - the old months will not be touched again.
    const many = [
      ...Array.from({ length: 20 }, (_, i) => full(`2026-07-${String(i + 1).padStart(2, '0')}`)),
      { date: '2026-06-30', taiexOpen: null } as MarketDay,
    ]
    expect(planMarketMonths(new Date('2026-08-04T13:00:00Z'), many)).toEqual(['202608', '202606'])
  })

  it('缺口很多時仍受月數上限保護，由新到舊補', () => {
    // The number of days must be enough, otherwise you will take the "file is still empty" branch and grab an extra one from the previous month.
    const gaps = [
      ...Array.from({ length: 20 }, (_, i) => full(`2026-07-${String(i + 1).padStart(2, '0')}`)),
      ...['2026-03-02', '2026-04-02', '2026-05-02', '2026-06-02'].map(
        (date) => ({ date, taiexOpen: null }) as MarketDay,
      ),
    ]
    expect(planMarketMonths(new Date('2026-08-04T13:00:00Z'), gaps, 3)).toEqual([
      '202608',
      '202606',
      '202605',
    ])
  })

  it('第一次跑時連上個月一起抓，畫面一開始就有長度', () => {
    // From newest to oldest: the gap left when the budget is used up is the oldest month (the same as other consistent practices of backfilling)
    expect(planMarketMonths(new Date('2026-08-04T13:00:00Z'), [])).toEqual(['202608', '202607'])
  })

  it('用台北時間判斷月份（UTC 的月初凌晨會落在上個月）', () => {
    // UTC 2026-07-31 17:00 = Taipei 2026-08-01 01:00 → This month is August
    expect(planMarketMonths(new Date('2026-07-31T17:00:00Z'), [])).toEqual(['202608', '202607'])
  })
})
