import { describe, it, expect } from 'vitest'
import {
  MOPS_HOST,
  mopsRevenueUrl,
  nextBackfilledThrough,
  parseMopsRevenue,
  planRevenueBackfill,
  publishedMonths,
} from './twRevenueHistory.ts'

/**
 * fixture is taken verbatim from the actual response to mopsov.twse.com.tw on 2026-07-28 (after big5 decoding):
 *   Listed t21sc03_115_6_0.html - Industry category column, 2330, "Total" column for each industry
 *   On the counter t21sc03_115_6_0.html —— 6488 (including two negative values)
 * The original capital letters `<Td nowrap>`, irregular spaces and ` ` are deliberately retained.
 * Those are the things that the parser needs to handle, and the compiled fixture cannot detect them.
 */
const ROW_2330 =
  '<tr align=right><td align=center>2330</td><td align=left>台積電</td><td nowrap>            442,679,969</td><td nowrap>            416,975,163</td><td nowrap>            263,708,978</td><td nowrap>                  6.16</td><Td nowrap>                 67.86</td><td nowrap>          2,404,483,690</td><td nowrap>          1,773,045,533</td><td nowrap>                 35.61</td><td align=left>因先進製程產品需求增加所致。</td></tr>'

const ROW_6488 =
  '<tr align=right><td align=center>6488</td><td align=left>環球晶</td><td nowrap>              5,624,376</td><td nowrap>              4,842,007</td><td nowrap>              5,717,334</td><td nowrap>                 16.15</td><Td nowrap>                 -1.62</td><td nowrap>             29,199,108</td><td nowrap>             31,602,431</td><td nowrap>                 -7.60</td><td align=center>-</td></tr>'

/** Total column at the end of each industry: the first column is `<th>Total</th>` instead of code name, and must be skipped*/
const ROW_TOTAL =
  '<tr align=right><th class=tt nowrap colspan=2 align=center>合計</th><td nowrap>                 20,799,291</td><td nowrap>                 20,711,765</td><td nowrap>                 17,976,617</td><td nowrap>                  0.42</td><td nowrap>                 15.70</td><td >                114,117,916</td><td >                117,144,222</td><td nowrap>                 -2.58</td><td>&nbsp;</td></tr>'

/** Industry title column (nested table, insufficient cells)*/
const ROW_HEADER =
  '<tr><td><br><table border=0 width=100%><tr><th class=tt align=left >產業別：半導體業</th><th class=tt align=right >單位：千元</th></tr>'

const PAGE = ROW_HEADER + ROW_2330 + ROW_6488 + ROW_TOTAL

describe('mopsRevenueUrl', () => {
  it('民國年換算，且月份不補零（實測 1 月是 115_1 不是 115_01）', () => {
    expect(mopsRevenueUrl('sii', '2026-01')).toBe(`${MOPS_HOST}/nas/t21/sii/t21sc03_115_1_0.html`)
    expect(mopsRevenueUrl('sii', '2026-12')).toBe(`${MOPS_HOST}/nas/t21/sii/t21sc03_115_12_0.html`)
    expect(mopsRevenueUrl('otc', '2025-07')).toBe(`${MOPS_HOST}/nas/t21/otc/t21sc03_114_7_0.html`)
  })

  it('host 是 mopsov 不是 mops（mops 的同路徑已 404）', () => {
    expect(MOPS_HOST).toBe('https://mopsov.twse.com.tw')
  })

  it('年月格式不符回 null，不去抓一個必然 404 的網址', () => {
    expect(mopsRevenueUrl('sii', '2026-6')).toBeNull()
    expect(mopsRevenueUrl('sii', '2026-13')).toBeNull()
    expect(mopsRevenueUrl('sii', '')).toBeNull()
  })
})

describe('parseMopsRevenue', () => {
  it('取出上市個股，欄位對應正確（含大寫 <Td> 那格的年增率）', () => {
    const got = parseMopsRevenue(PAGE, '2026-06', new Set(['2330']))
    expect(got.get('2330')).toEqual({
      yearMonth: '2026-06',
      revenueThousandTwd: 442679969,
      momPercent: 6.16,
      yoyPercent: 67.86,
      cumulativeYoyPercent: 35.61,
    })
  })

  it('負的月增與累計年增照樣解析（上櫃列）', () => {
    const got = parseMopsRevenue(PAGE, '2026-06', new Set(['6488']))
    expect(got.get('6488')).toEqual({
      yearMonth: '2026-06',
      revenueThousandTwd: 5624376,
      momPercent: 16.15,
      yoyPercent: -1.62,
      cumulativeYoyPercent: -7.6,
    })
  })

  it('「合計」列與產業別標題列不會被誤當成個股', () => {
    // The current month's revenue in the total column is 20,799,291; if it is received by mistake, the code will be 'total' or a non-4-digit string
    const got = parseMopsRevenue(PAGE, '2026-06', new Set(['2330', '6488']))
    expect([...got.keys()].sort()).toEqual(['2330', '6488'])
    for (const v of got.values()) expect(v.revenueThousandTwd).not.toBe(20799291)
  })

  it('只解析 wanted 內的代號；空集合回空 Map（不是「全要」）', () => {
    expect(parseMopsRevenue(PAGE, '2026-06', new Set(['9999'])).size).toBe(0)
    expect(parseMopsRevenue(PAGE, '2026-06', new Set()).size).toBe(0)
  })

  it('空字串或壞掉的 HTML 回空 Map，不拋例外', () => {
    expect(parseMopsRevenue('', '2026-06', new Set(['2330'])).size).toBe(0)
    expect(parseMopsRevenue('<html>不是表格</html>', '2026-06', new Set(['2330'])).size).toBe(0)
  })
})

describe('planRevenueBackfill', () => {
  const WANT = ['2026-06', '2026-05', '2026-04', '2026-03']
  const p = (months: string[], through: string | null = null) => ({
    months: new Set(months),
    through,
  })

  it('全部補滿時回空陣列——呼叫端據此短路，一個對外請求都不發', () => {
    const have = new Map([
      ['2330', p(WANT)],
      ['6488', p(WANT)],
    ])
    expect(planRevenueBackfill(have, WANT, 4)).toEqual([])
  })

  it('只要有一檔缺該月份就要抓（大檔是全市場共用的）', () => {
    const have = new Map([
      ['2330', p(WANT)],
      ['6488', p(['2026-06'])],
    ])
    expect(planRevenueBackfill(have, WANT, 4)).toEqual(['2026-05', '2026-04', '2026-03'])
  })

  it('超過單次預算時由新到舊取，剩下的缺口是最舊的那幾個月', () => {
    const have = new Map([['2330', p([])]])
    expect(planRevenueBackfill(have, WANT, 2)).toEqual(['2026-06', '2026-05'])
  })

  it('沒有任何檔案可補時回空陣列（fundamental 檔還沒產生）', () => {
    expect(planRevenueBackfill(new Map(), WANT, 4)).toEqual([])
  })

  it('預算為 0 時不抓', () => {
    const have = new Map([['2330', p([])]])
    expect(planRevenueBackfill(have, WANT, 0)).toEqual([])
  })

  it('through 以上的月份不再重問——找過了就是沒有', () => {
    // The shape of the ETF: Not a single revenue, but 2026-04 All of the above have been found
    const have = new Map([['0050', p([], '2026-04')]])
    expect(planRevenueBackfill(have, WANT, 4)).toEqual(['2026-03'])
  })

  it('ETF 不會把整批回補卡死（0.6.4-dev.1 實測到的死結）', () => {
    // 0050 can never be filled. If "months not in the file" are used as the gap, the same latest 4 months will be returned in each round.
    // 2330 you will never get older information. After advancing through, the gap must actually go in the old direction.
    const have = new Map([
      ['0050', p([], '2026-03')],
      ['2330', p(['2026-06', '2026-05', '2026-04', '2026-03'], '2026-03')],
    ])
    expect(planRevenueBackfill(have, WANT, 4)).toEqual([])

    const older = ['2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01']
    expect(planRevenueBackfill(have, older, 4)).toEqual(['2026-02', '2026-01'])
  })

  it('沒有 through 的舊檔視同全部未嘗試（向後相容）', () => {
    const have = new Map([['2330', p(['2026-06'], null)]])
    expect(planRevenueBackfill(have, WANT, 4)).toEqual(['2026-05', '2026-04', '2026-03'])
  })
})

describe('nextBackfilledThrough', () => {
  it('取舊值與本輪嘗試月份中最舊的那個', () => {
    expect(nextBackfilledThrough(null, ['2026-06', '2026-04', '2026-05'])).toBe('2026-04')
    expect(nextBackfilledThrough('2026-04', ['2026-03', '2026-02'])).toBe('2026-02')
  })

  it('進度只會往舊走，不會被較新的一輪往回推', () => {
    expect(nextBackfilledThrough('2025-07', ['2026-06', '2026-05'])).toBe('2025-07')
  })

  it('本輪什麼都沒嘗試時保留舊值', () => {
    expect(nextBackfilledThrough('2026-03', [])).toBe('2026-03')
    expect(nextBackfilledThrough(null, [])).toBeNull()
  })
})

describe('publishedMonths', () => {
  it('10 日之後，最新的已公布月份是上個月', () => {
    const got = publishedMonths(new Date('2026-07-28T05:00:00Z'), 12)
    expect(got[0]).toBe('2026-06')
    expect(got[11]).toBe('2025-07')
    expect(got).toHaveLength(12)
  })

  it('10 日之前只保證看得到上上個月（月營收次月 10 日前公布）', () => {
    expect(publishedMonths(new Date('2026-07-09T05:00:00Z'), 3)).toEqual([
      '2026-05',
      '2026-04',
      '2026-03',
    ])
  })

  it('跨年往回數不會算錯', () => {
    expect(publishedMonths(new Date('2026-01-15T05:00:00Z'), 3)).toEqual([
      '2025-12',
      '2025-11',
      '2025-10',
    ])
  })

  it('用台北時間判斷，不是 UTC——UTC 7/9 23:00 在台北已是 7/10', () => {
    expect(publishedMonths(new Date('2026-07-09T23:00:00Z'), 1)).toEqual(['2026-06'])
    expect(publishedMonths(new Date('2026-07-09T01:00:00Z'), 1)).toEqual(['2026-05'])
  })
})
