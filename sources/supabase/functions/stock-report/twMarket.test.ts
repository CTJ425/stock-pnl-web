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

/** 逐字取自 2026-08-04 對 rwd/zh/afterTrading/FMTQIK 的實際回應（截短為兩列） */
const FMTQIK = {
  stat: 'OK',
  title: '115年08月市場成交資訊',
  fields: ['日期', '成交股數', '成交金額', '成交筆數', '發行量加權股價指數', '漲跌點數'],
  data: [
    ['115/08/03', '11,427,047,935', '885,506,043,091', '4,191,882', '43,386.41', '266.66'],
    ['115/08/04', '11,340,636,777', '1,087,045,875,836', '4,751,347', '43,360.66', '-25.75'],
  ],
}

/** 逐字取自 2026-08-04 對 rwd/zh/TAIEX/MI_5MINS_HIST 的實際回應（截短為兩列） */
const TAIEX_HIST = {
  stat: 'OK',
  title: '115年08月 發行量加權股價指數歷史資料',
  fields: ['日期', '開盤指數', '最高指數', '最低指數', '收盤指數'],
  data: [
    ['115/08/03', '42,780.42', '43,784.19', '42,780.42', '43,386.41'],
    ['115/08/04', '43,092.49', '43,912.77', '42,895.81', '43,360.66'],
  ],
}

/** 逐字取自 2026-08-04 對 rwd/zh/fund/BFI82U 的實際回應 */
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
    // type=month 回的是整月合計而不是逐日，所以一律 day
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
      // 開高低不在這一支，另由 MI_5MINS_HIST 補
      taiexOpen: null,
      taiexHigh: null,
      taiexLow: null,
      institutional: null,
    })
    // 負的漲跌點數要留著負號
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
    // 合計取官方值，不自己加總
    expect(got.totalTwd).toBe(-16519607403)
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
    // 同一個欄位讓兩支各寫一次，總有一天會不一致而且看不出是哪一支寫的
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
  const inst = {
    foreignTwd: 1,
    foreignDealerTwd: 0,
    trustTwd: 2,
    dealerSelfTwd: 3,
    dealerHedgeTwd: 4,
    totalTwd: 10,
  }

  it('依日期去重、由舊到新', () => {
    const merged = mergeMarketDays([day('2026-08-04', 2)], [day('2026-08-03', 1)])
    expect(merged.map((d) => d.date)).toEqual(['2026-08-03', '2026-08-04'])
  })

  it('整月重抓不會把補好的法人金額洗掉', () => {
    // 成交量值每晚整月重抓，那一份永遠不帶法人 —— 整筆覆寫的話會天天清掉回補成果
    const prev = [{ ...day('2026-08-03', 1), institutional: inst }]
    const merged = mergeMarketDays(prev, [day('2026-08-03', 999)])
    expect(merged[0].tradeValueTwd).toBe(999) // 量值照常更新
    expect(merged[0].institutional).toEqual(inst) // 法人留著
  })

  it('整月重抓不會把已有的開高低洗掉（0.6.30）', () => {
    // 開高低來自另一支端點，那一支失敗時 incoming 會是 null —— 不可覆寫既有值
    const prev = [{ ...day('2026-08-03', 1), taiexOpen: 42780.42, taiexHigh: 43784.19, taiexLow: 42780.42 }]
    const merged = mergeMarketDays(prev, [day('2026-08-03', 999)])
    expect(merged[0].taiexOpen).toBe(42780.42)
    expect(merged[0].tradeValueTwd).toBe(999)
  })

  it('超過上限時砍最舊的', () => {
    const many = Array.from({ length: 5 }, (_, i) => day(`2026-08-0${i + 1}`, i))
    const merged = mergeMarketDays(many, [], 3)
    expect(merged.map((d) => d.date)).toEqual(['2026-08-03', '2026-08-04', '2026-08-05'])
  })
})

describe('planInstitutionalBackfill', () => {
  const day = (date: string, hasInst: boolean): MarketDay => ({
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
      ? {
          foreignTwd: 1,
          foreignDealerTwd: 1,
          trustTwd: 1,
          dealerSelfTwd: 1,
          dealerHedgeTwd: 1,
          totalTwd: 1,
        }
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
    // 0.6.30 之前寫下的日子讀回來是 undefined 不是 null；用 === null 會漏掉全部舊資料
    const legacy = [
      ...Array.from({ length: 20 }, (_, i) => full(`2026-07-${String(i + 1).padStart(2, '0')}`)),
      { date: '2026-06-30' } as MarketDay,
    ]
    expect(planMarketMonths(new Date('2026-08-04T13:00:00Z'), legacy)).toEqual(['202608', '202606'])
  })

  it('缺開高低的月份要重抓（0.6.30 新增欄位，舊資料整批沒有）', () => {
    // 沒有這條，K 線會永遠只有這個月的那幾根 —— 舊月份不會再被碰到
    const many = [
      ...Array.from({ length: 20 }, (_, i) => full(`2026-07-${String(i + 1).padStart(2, '0')}`)),
      { date: '2026-06-30', taiexOpen: null } as MarketDay,
    ]
    expect(planMarketMonths(new Date('2026-08-04T13:00:00Z'), many)).toEqual(['202608', '202606'])
  })

  it('缺口很多時仍受月數上限保護，由新到舊補', () => {
    // 天數要夠多，否則會走「檔案還空著」的分支而多抓一個上個月
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
    // 由新到舊：預算用完時留下的缺口是最舊的那個月（同其他回補的一貫作法）
    expect(planMarketMonths(new Date('2026-08-04T13:00:00Z'), [])).toEqual(['202608', '202607'])
  })

  it('用台北時間判斷月份（UTC 的月初凌晨會落在上個月）', () => {
    // UTC 2026-07-31 17:00 = 台北 2026-08-01 01:00 → 本月是 8 月
    expect(planMarketMonths(new Date('2026-07-31T17:00:00Z'), [])).toEqual(['202608', '202607'])
  })
})
