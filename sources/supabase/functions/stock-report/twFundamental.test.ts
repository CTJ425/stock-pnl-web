import { describe, it, expect } from 'vitest'
import {
  extractIndustry,
  extractProfit,
  extractRevenue,
  extractValuation,
  bwibbuDatedUrl,
  bwibbuDatedUsable,
  normaliseBwibbuDated,
  buildFundamentalFile,
  mergeProfitQuarters,
  mergeRevenueMonths,
  rocYearQuarter,
  rocDate,
  rocYearMonth,
  type ProfitQuarter,
  type RevenueMonth,
} from './twFundamental.ts'

/**
 * The value of fixture is taken from the actual response to openapi.twse.com.tw on 2026-07-27 (excerpt column 2330).
 * BWIBBU_ALL is the English key, the Republic of China 7-code date; t187ap05_L is the Chinese key, the Republic of China 5-code year and month,
 * And the "Industry Category" is directly given to the Chinese name; the "Industry Category" of t187ap03_L is a two-digit code.
 */
const BWIBBU_ROWS = [
  { Date: '1150724', Code: '2330', Name: '台積電', PEratio: '31.59', DividendYield: '0.94', PBratio: '10.34' },
  // Loss-making stocks: P/E ratio is '-' (measured BWIBBU presentation of loss-making stocks)
  { Date: '1150724', Code: '9999', Name: '虧損股', PEratio: '-', DividendYield: '0.00', PBratio: '0.85' },
]

const REVENUE_ROWS = [
  {
    出表日期: '1150717',
    資料年月: '11506',
    公司代號: '2330',
    公司名稱: '台積電',
    產業別: '半導體業',
    '營業收入-當月營收': '442,679,969',
    '營業收入-上月比較增減(%)': '6.164589232380731',
    '營業收入-去年同月增減(%)': '67.86685548491262',
    '累計營業收入-前期比較增減(%)': '35.613194655616326',
  },
]

/** Taken verbatim from the actual response to openapi.twse.com.tw/v1/opendata/t187ap17_L on 2026-07-28 (Excerpt 2330)*/
const PROFIT_ROWS = [
  {
    出表日期: '1150728',
    年度: '115',
    季別: '1',
    公司代號: '2330',
    公司名稱: '台積電',
    '營業收入(百萬元)': '1134103.44',
    '毛利率(%)(營業毛利)/(營業收入)': '66.25',
    '營業利益率(%)(營業利益)/(營業收入)': '58.10',
    '稅前純益率(%)(稅前純益)/(營業收入)': '60.65',
    '稅後純益率(%)(稅後純益)/(營業收入)': '50.51',
  },
]

const COMPANY_ROWS = [
  { 公司代號: '2330', 公司簡稱: '台積電', 產業別: '24' },
  { 公司代號: '8888', 公司簡稱: '神祕代碼股', 產業別: '99' },
]

describe('twFundamental', () => {
  describe('rocDate / rocYearMonth', () => {
    it('民國 7 碼日期轉西元', () => {
      expect(rocDate('1150724')).toBe('2026-07-24')
    })

    it('民國 5 碼年月轉西元', () => {
      expect(rocYearMonth('11506')).toBe('2026-06')
    })

    it('格式不符回 null', () => {
      expect(rocDate('20260724')).toBeNull()
      expect(rocDate('')).toBeNull()
      expect(rocDate(null)).toBeNull()
      expect(rocYearMonth('2026-06')).toBeNull()
      expect(rocYearMonth(undefined)).toBeNull()
    })
  })

  describe('extractValuation', () => {
    it('取出估值三指標並轉換資料日期', () => {
      expect(extractValuation(BWIBBU_ROWS, '2330')).toEqual({
        peRatio: 31.59,
        dividendYieldPercent: 0.94,
        pbRatio: 10.34,
        dataDate: '2026-07-24',
      })
    })

    it('虧損股的本益比 "-" 應為 null 而非 0', () => {
      const v = extractValuation(BWIBBU_ROWS, '9999')
      expect(v?.peRatio).toBeNull()
      expect(v?.pbRatio).toBe(0.85)
    })

    it('查無代號（上櫃股）回 null', () => {
      expect(extractValuation(BWIBBU_ROWS, '5274')).toBeNull()
      expect(extractValuation(null, '2330')).toBeNull()
    })
  })

  describe('extractRevenue', () => {
    it('取出最新月營收（千分位、百分比字串轉數字）', () => {
      expect(extractRevenue(REVENUE_ROWS, '2330')).toEqual({
        yearMonth: '2026-06',
        revenueThousandTwd: 442679969,
        momPercent: 6.164589232380731,
        yoyPercent: 67.86685548491262,
        cumulativeYoyPercent: 35.613194655616326,
      })
    })

    it('查無代號回 null', () => {
      expect(extractRevenue(REVENUE_ROWS, '5274')).toBeNull()
    })
  })

  describe('extractIndustry', () => {
    it('優先採用月營收檔的中文產業名', () => {
      expect(extractIndustry(REVENUE_ROWS, COMPANY_ROWS, '2330')).toBe('半導體業')
    })

    it('月營收查無時退公司基本資料的代碼查表', () => {
      const companyOnly = [{ 公司代號: '2330', 產業別: '24' }]
      expect(extractIndustry([], companyOnly, '2330')).toBe('半導體業')
    })

    it('對照表查無的代碼原樣輸出（勝過丟失資訊）', () => {
      expect(extractIndustry([], COMPANY_ROWS, '8888')).toBe('99')
    })

    it('兩份都查無（上櫃股）回 null', () => {
      expect(extractIndustry(REVENUE_ROWS, COMPANY_ROWS, '5274')).toBeNull()
      expect(extractIndustry(null, null, '2330')).toBeNull()
    })
  })

  describe('rocYearQuarter', () => {
    it('民國年 + 季別轉西元年季', () => {
      expect(rocYearQuarter('115', '1')).toBe('2026-Q1')
      expect(rocYearQuarter('114', '4')).toBe('2025-Q4')
      expect(rocYearQuarter('99', '2')).toBe('2010-Q2')
    })

    it('季別只接受 1–4，格式不符回 null', () => {
      expect(rocYearQuarter('115', '0')).toBeNull()
      expect(rocYearQuarter('115', '5')).toBeNull()
      expect(rocYearQuarter('115', '')).toBeNull()
      expect(rocYearQuarter('2026', '1')).toBeNull()
      expect(rocYearQuarter(null, null)).toBeNull()
    })
  })

  describe('extractProfit', () => {
    it('取出四個比率與營收（欄位名帶括號說明，是端點原樣）', () => {
      expect(extractProfit(PROFIT_ROWS, '2330')).toEqual({
        yearQuarter: '2026-Q1',
        revenueMillionTwd: 1134103.44,
        grossMarginPercent: 66.25,
        operatingMarginPercent: 58.1,
        pretaxMarginPercent: 60.65,
        netMarginPercent: 50.51,
        // There is no EPS in the profit analysis table: mark it as not checked yet, wait for it to be supplemented in the quarterly report (0.6.28)
        epsTwd: null,
        epsChecked: false,
      })
    })

    it('查無代號（上櫃 / ETF）回 null', () => {
      expect(extractProfit(PROFIT_ROWS, '5274')).toBeNull()
      expect(extractProfit(null, '2330')).toBeNull()
    })

    it('年季解析失敗回 null，不吐出半殘的一季', () => {
      const bad = [{ ...PROFIT_ROWS[0], 季別: '9' }]
      expect(extractProfit(bad, '2330')).toBeNull()
    })
  })

  describe('mergeProfitQuarters', () => {
    const q = (yearQuarter: string, gross: number): ProfitQuarter => ({
      yearQuarter,
      revenueMillionTwd: 1,
      grossMarginPercent: gross,
      operatingMarginPercent: null,
      pretaxMarginPercent: null,
      netMarginPercent: null,
    })

    it('新季度併入並由舊到新排序', () => {
      const merged = mergeProfitQuarters([q('2025-Q4', 4), q('2025-Q3', 3)], [q('2026-Q1', 1)])
      expect(merged.map((x) => x.yearQuarter)).toEqual(['2025-Q3', '2025-Q4', '2026-Q1'])
    })

    it('同季度以新值覆蓋（財報會更正重編）', () => {
      const merged = mergeProfitQuarters([q('2026-Q1', 60)], [q('2026-Q1', 66.25)])
      expect(merged).toHaveLength(1)
      expect(merged[0].grossMarginPercent).toBe(66.25)
    })

    it('超過 12 季時砍最舊的（0.6.21 由 8 季提高到 12）', () => {
      // 12 consecutive quarters starting from 2023-Q1 → 2023-Q1..2025-Q4
      const prev = Array.from({ length: 12 }, (_, i) =>
        q(`${2023 + Math.floor(i / 4)}-Q${(i % 4) + 1}`, i),
      )
      const merged = mergeProfitQuarters(prev, [q('2026-Q1', 99)])
      expect(merged).toHaveLength(12)
      expect(merged[0].yearQuarter).toBe('2023-Q2')
      expect(merged[11].yearQuarter).toBe('2026-Q1')
    })

    /*
      EPS exists only on the backfill path (the MOPS quarterly report); the nightly t187ap17_L does not carry it.
      A whole-record decision loses it in both directions, hence field-by-field merging where whoever consulted
      the quarterly report wins.
    */
    describe('EPS 逐欄合併（0.6.28）', () => {
      const withEps = (yearQuarter: string, eps: number | null): ProfitQuarter => ({
        ...q(yearQuarter, 50),
        epsTwd: eps,
        epsChecked: true,
      })

      it('回補（fillGapsOnly）把 EPS 補進既有那一季，比率不動', () => {
        const prev = [{ ...q('2026-Q1', 66), epsTwd: null, epsChecked: false }]
        const merged = mergeProfitQuarters(prev, [withEps('2026-Q1', 13.94)], {
          fillGapsOnly: true,
        })
        expect(merged[0].epsTwd).toBe(13.94)
        // The officially calculated ratio is still the existing share and has not been overwritten by the self-calculated version.
        expect(merged[0].grossMarginPercent).toBe(66)
      })

      it('每晚的覆寫不會把補好的 EPS 洗掉', () => {
        const prev = [withEps('2026-Q1', 13.94)]
        // There is no EPS for the night batch (epsChecked: false)
        const nightly = [{ ...q('2026-Q1', 67), epsTwd: null, epsChecked: false }]
        const merged = mergeProfitQuarters(prev, nightly)
        expect(merged[0].grossMarginPercent).toBe(67) // 比率照常更新
        expect(merged[0].epsTwd).toBe(13.94) // EPS 留著
      })

      it('查過但那一列真的沒有 EPS：仍標記已查過，不會被當成缺口重抓', () => {
        const prev = [{ ...q('2026-Q1', 66), epsTwd: null, epsChecked: false }]
        const merged = mergeProfitQuarters(prev, [withEps('2026-Q1', null)], {
          fillGapsOnly: true,
        })
        expect(merged[0].epsTwd).toBeNull()
        expect(merged[0].epsChecked).toBe(true)
      })
    })

    it('fillGapsOnly 不覆蓋既有值', () => {
      const merged = mergeProfitQuarters([q('2026-Q1', 66)], [q('2026-Q1', 1), q('2025-Q4', 55)], {
        fillGapsOnly: true,
      })
      expect(merged.find((x) => x.yearQuarter === '2026-Q1')?.grossMarginPercent).toBe(66)
      expect(merged.map((x) => x.yearQuarter)).toEqual(['2025-Q4', '2026-Q1'])
    })

    it('壞掉的項目（缺 yearQuarter）不會混進結果', () => {
      const bad = { grossMarginPercent: 1 } as unknown as ProfitQuarter
      expect(mergeProfitQuarters([q('2026-Q1', 1)], [bad])).toHaveLength(1)
    })
  })

  describe('buildFundamentalFile', () => {
    const m = (yearMonth: string): RevenueMonth => ({
      yearMonth,
      revenueThousandTwd: 1,
      momPercent: null,
      yoyPercent: null,
      cumulativeYoyPercent: null,
    })
    const base = {
      ticker: '2330',
      name: '台積電',
      dataDate: '2026-07-28',
      asOf: '2026-07-28T02:00:00.000Z',
      valuation: { peRatio: 31.59, dividendYieldPercent: 0.94, pbRatio: 10.34, dataDate: '2026-07-24' },
      latestRevenue: m('2026-06'),
      latestProfit: null,
      industry: '半導體業',
      bwibbuLoaded: true,
    }

    it('回補進度必須帶過去——漏掉等於每個交易日抹掉一次進度', () => {
      const existing = {
        ...base,
        schema: 1,
        revenueUnit: '千元' as const,
        revenueMonths: [m('2025-07'), m('2026-06')],
        revenueBackfilledThrough: '2025-07',
        notes: [],
      }
      const file = buildFundamentalFile({ ...base, existing })
      expect(file.revenueBackfilledThrough).toBe('2025-07')
    })

    it('獲利能力也必須帶過去——整份重建時漏欄位就是無聲的資料遺失', () => {
      const q: ProfitQuarter = {
        yearQuarter: '2026-Q1',
        revenueMillionTwd: 1134103.44,
        grossMarginPercent: 66.25,
        operatingMarginPercent: 58.1,
        pretaxMarginPercent: 60.65,
        netMarginPercent: 50.51,
      }
      const existing = {
        ...base,
        schema: 2,
        revenueUnit: '千元' as const,
        revenueMonths: [m('2026-06')],
        revenueBackfilledThrough: '2025-07',
        profitUnit: '%' as const,
        profitQuarters: [q],
        notes: [],
      }
      // When no profit ability is captured in this round (latestProfit: null), the existing season cannot be erased.
      const file = buildFundamentalFile({ ...base, existing })
      expect(file.profitQuarters).toEqual([q])
      expect(file.profitUnit).toBe('%')
      expect(file.schema).toBe(2)
    })

    it('有既有月營收或既有季度時，不再寫「查無公司基本面資料」', () => {
      const withQuarters = {
        ...base,
        schema: 2,
        revenueUnit: '千元' as const,
        revenueMonths: [],
        profitQuarters: [
          {
            yearQuarter: '2026-Q1',
            revenueMillionTwd: 1,
            grossMarginPercent: 1,
            operatingMarginPercent: null,
            pretaxMarginPercent: null,
            netMarginPercent: null,
          },
        ],
        notes: [],
      }
      const file = buildFundamentalFile({
        ...base,
        existing: withQuarters,
        valuation: null,
        latestRevenue: null,
        latestProfit: null,
        industry: null,
      })
      expect(file.notes.join()).not.toContain('查無公司基本面資料')
    })

    it('沒有既有檔時進度為 null（尚未回補過）', () => {
      expect(buildFundamentalFile({ ...base, existing: null }).revenueBackfilledThrough).toBeNull()
    })

    it('既有月份會被保留並併入最新月份', () => {
      const existing = {
        ...base,
        schema: 1,
        revenueUnit: '千元' as const,
        revenueMonths: [m('2026-04'), m('2026-05')],
        revenueBackfilledThrough: '2026-04',
        notes: [],
      }
      const file = buildFundamentalFile({ ...base, existing })
      expect(file.revenueMonths.map((x) => x.yearMonth)).toEqual(['2026-04', '2026-05', '2026-06'])
    })

    it('上市股一切正常時不寫任何註記', () => {
      expect(buildFundamentalFile({ ...base, existing: null }).notes).toEqual([])
    })

    it('三者皆無且從未有過營收 → 查無基本面（ETF）', () => {
      const file = buildFundamentalFile({
        ...base,
        existing: null,
        valuation: null,
        latestRevenue: null,
        industry: null,
      })
      expect(file.notes).toHaveLength(1)
      expect(file.notes[0]).toContain('查無公司基本面資料')
    })

    it('上櫃股回補後有營收但無估值 → 改寫「估值只涵蓋上市」', () => {
      const existing = {
        ...base,
        schema: 1,
        revenueUnit: '千元' as const,
        revenueMonths: [m('2026-05'), m('2026-06')],
        revenueBackfilledThrough: '2025-07',
        notes: [],
      }
      const file = buildFundamentalFile({
        ...base,
        existing,
        valuation: null,
        latestRevenue: null,
        industry: null,
      })
      expect(file.notes).toEqual(['無估值資料：本益比等三項只涵蓋上市（TWSE）個股'])
    })

    it('估值大檔這輪沒載到時不寫註記——那是我們的問題，說「只涵蓋上市」是假話', () => {
      const file = buildFundamentalFile({ ...base, existing: null, valuation: null, bwibbuLoaded: false })
      expect(file.notes).toEqual([])
    })
  })

  describe('mergeRevenueMonths', () => {
    const m = (yearMonth: string, revenue: number): RevenueMonth => ({
      yearMonth,
      revenueThousandTwd: revenue,
      momPercent: null,
      yoyPercent: null,
      cumulativeYoyPercent: null,
    })

    it('新月份併入並由舊到新排序', () => {
      const merged = mergeRevenueMonths([m('2026-05', 5), m('2026-04', 4)], [m('2026-06', 6)])
      expect(merged.map((x) => x.yearMonth)).toEqual(['2026-04', '2026-05', '2026-06'])
    })

    it('同月份以新值覆蓋（月營收有時會更正重發）', () => {
      const merged = mergeRevenueMonths([m('2026-06', 1)], [m('2026-06', 2)])
      expect(merged).toHaveLength(1)
      expect(merged[0].revenueThousandTwd).toBe(2)
    })

    it('超過 12 個月時砍最舊的', () => {
      const prev = Array.from({ length: 12 }, (_, i) =>
        m(`2025-${String(i + 1).padStart(2, '0')}`, i),
      )
      const merged = mergeRevenueMonths(prev, [m('2026-01', 99)])
      expect(merged).toHaveLength(12)
      expect(merged[0].yearMonth).toBe('2025-02')
      expect(merged[11].yearMonth).toBe('2026-01')
    })

    it('prev 為空或 null 時只含最新一筆；incoming 為空時保留 prev', () => {
      expect(mergeRevenueMonths(null, [m('2026-06', 6)])).toHaveLength(1)
      expect(mergeRevenueMonths([m('2026-05', 5)], []).map((x) => x.yearMonth)).toEqual(['2026-05'])
      expect(mergeRevenueMonths([m('2026-05', 5)], null).map((x) => x.yearMonth)).toEqual([
        '2026-05',
      ])
    })

    it('一次併入多個月份（歷史回補一次補好幾個月）', () => {
      const merged = mergeRevenueMonths(
        [m('2026-06', 6)],
        [m('2026-03', 3), m('2026-05', 5), m('2026-04', 4)],
      )
      expect(merged.map((x) => x.yearMonth)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06'])
    })

    it('fillGapsOnly：回補只填缺口，不覆蓋既有值', () => {
      // 2026-06 The existing value 6 is the corrected number captured by t187ap05_L,
      // The old value of 999 that MOPS climbed to cannot be overwritten; 2026-05 is a gap that needs to be filled.
      const merged = mergeRevenueMonths([m('2026-06', 6)], [m('2026-06', 999), m('2026-05', 5)], {
        fillGapsOnly: true,
      })
      expect(merged.map((x) => x.yearMonth)).toEqual(['2026-05', '2026-06'])
      expect(merged.find((x) => x.yearMonth === '2026-06')?.revenueThousandTwd).toBe(6)
    })

    it('壞掉的項目（缺 yearMonth）不會混進結果', () => {
      const bad = { revenueThousandTwd: 1 } as unknown as RevenueMonth
      expect(mergeRevenueMonths([m('2026-05', 5)], [bad]).map((x) => x.yearMonth)).toEqual([
        '2026-05',
      ])
    })
  })
})

// 0.7.11 / BUG-024: 估值改用帶日期的端點，欄位一律以表頭文字定位。
describe('BWIBBU 帶日期端點', () => {
  const REAL = {
    stat: 'OK',
    date: '20260811',
    fields: ['證券代號', '證券名稱', '收盤價', '殖利率(%)', '股利年度', '本益比', '股價淨值比', '財報年/季'],
    data: [
      ['1101', '台泥', '24.65', '3.25', 114, '-', '0.79', '115/1'],
      ['2330', '台積電', '1100.00', '1.20', 114, '25.10', '7.50', '115/1'],
    ],
  }

  /*
    BUG-028：發布前的回應會被快取一整天。

    TWSE 在估值出表前對這個端點回的是 **HTTP 200** 加上 `stat:'很抱歉，沒有符合條件的資料!'`，
    不是錯誤碼。`readLatest` 只在非 2xx 時放棄，所以那份「沒有資料」被寫進當天的 `BWIBBU_D` 快取，
    之後每一輪都讀到它 —— `freshValuationDay` 恆為 null，`valuationCurrent` 恆為 true，
    當天所有 fundamental/*.json 全部被跳過。2026-08-17 的 PROD 就是這樣：47 個檔案裡 40 個停在 08-10。

    這個判準就是快取的守門員，與 `loadT86` 用 `t86Ok` 擋住同一類回應是同一件事。
  */
  it('尚未發布的回應不可入快取——TWSE 用 200 回「沒有符合條件的資料」', () => {
    expect(bwibbuDatedUsable({ stat: '很抱歉，沒有符合條件的資料!' }, '20260818')).toBe(false)
    expect(bwibbuDatedUsable(null, '20260818')).toBe(false)
    expect(bwibbuDatedUsable({ stat: 'OK', fields: [], data: [] }, '20260818')).toBe(false)
    expect(bwibbuDatedUsable({}, '20260818')).toBe(false)
  })

  it('真的有出表才可入快取', () => {
    expect(bwibbuDatedUsable(REAL, '20260811')).toBe(true)
  })

  it('可入快取 ⟺ normaliseBwibbuDated 抽得出列，兩者不得各自為政', () => {
    for (const [resp, ymd] of [
      [REAL, '20260811'],
      [{ stat: '很抱歉，沒有符合條件的資料!' }, '20260818'],
      [{ stat: 'OK', fields: [], data: [] }, '20260818'],
      [null, '20260818'],
    ] as const) {
      expect(bwibbuDatedUsable(resp, ymd)).toBe(normaliseBwibbuDated(resp, ymd) !== null)
    }
  })

  it('轉成與 BWIBBU_ALL 相同的形狀，Date 填請求日的民國碼', () => {
    const rows = normaliseBwibbuDated(REAL, '20260811')!
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      Date: '1150811',
      Code: '1101',
      Name: '台泥',
      PEratio: '-',
      DividendYield: '3.25',
      PBratio: '0.79',
    })
    // 下游沿用原本的萃取器，不必改
    expect(extractValuation(rows, '2330')).toEqual({
      peRatio: 25.1,
      dividendYieldPercent: 1.2,
      pbRatio: 7.5,
      dataDate: '2026-08-11',
    })
    // 虧損股本益比 '-' → null，不是 0
    expect(extractValuation(rows, '1101')?.peRatio).toBeNull()
  })

  it('欄序被上游換掉也要拿對值——這正是不用索引的理由', () => {
    const swapped = {
      stat: 'OK',
      fields: ['證券代號', '股價淨值比', '本益比', '殖利率(%)', '證券名稱'],
      data: [['2330', '7.50', '25.10', '1.20', '台積電']],
    }
    expect(extractValuation(normaliseBwibbuDated(swapped, '20260811'), '2330')).toEqual({
      peRatio: 25.1,
      dividendYieldPercent: 1.2,
      pbRatio: 7.5,
      dataDate: '2026-08-11',
    })
  })

  it('沒有資料的日子回 null，不會寫進半份對不上的估值', () => {
    expect(normaliseBwibbuDated({ stat: '很抱歉，沒有符合條件的資料!' }, '20260811')).toBeNull()
    expect(normaliseBwibbuDated({ stat: 'OK', fields: [], data: [] }, '20260811')).toBeNull()
    expect(normaliseBwibbuDated(null, '20260811')).toBeNull()
    // 少了必要欄位就整份不採用
    expect(
      normaliseBwibbuDated({ stat: 'OK', fields: ['證券代號', '證券名稱'], data: [['2330', '台積電']] }, '20260811'),
    ).toBeNull()
  })

  it('bwibbuDatedUrl 只接受 8 碼日期', () => {
    expect(bwibbuDatedUrl('20260811')).toContain('date=20260811')
    expect(bwibbuDatedUrl('2026-08-11')).toBeNull()
  })
})
