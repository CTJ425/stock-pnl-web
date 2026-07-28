import { describe, it, expect } from 'vitest'
import {
  extractIndustry,
  extractProfit,
  extractRevenue,
  extractValuation,
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
 * fixture 的數值取自 2026-07-27 對 openapi.twse.com.tw 的實際回應（節錄 2330 一列）。
 * BWIBBU_ALL 是英文鍵、民國 7 碼日期；t187ap05_L 是中文鍵、民國 5 碼年月，
 * 且「產業別」直接給中文名稱；t187ap03_L 的「產業別」是兩位數代碼。
 */
const BWIBBU_ROWS = [
  { Date: '1150724', Code: '2330', Name: '台積電', PEratio: '31.59', DividendYield: '0.94', PBratio: '10.34' },
  // 虧損股：本益比為 '-'（實測 BWIBBU 對虧損股的呈現）
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

/** 逐字取自 2026-07-28 對 openapi.twse.com.tw/v1/opendata/t187ap17_L 的實際回應（節錄 2330） */
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

    it('超過 8 季時砍最舊的', () => {
      const prev = Array.from({ length: 8 }, (_, i) =>
        q(`202${Math.floor(i / 4) + 4}-Q${(i % 4) + 1}`, i),
      )
      const merged = mergeProfitQuarters(prev, [q('2026-Q1', 99)])
      expect(merged).toHaveLength(8)
      expect(merged[0].yearQuarter).toBe('2024-Q2')
      expect(merged[7].yearQuarter).toBe('2026-Q1')
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
      // 這輪沒抓到獲利能力（latestProfit: null）時，既有的那一季不可以被抹掉
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
      // 2026-06 既有值 6 是 t187ap05_L 抓到的更正後數字，
      // MOPS 爬到的舊值 999 不可以蓋掉它；2026-05 是缺口，要補進去。
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
