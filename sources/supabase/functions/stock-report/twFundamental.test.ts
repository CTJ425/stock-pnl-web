import { describe, it, expect } from 'vitest'
import {
  extractIndustry,
  extractRevenue,
  extractValuation,
  buildFundamentalFile,
  mergeRevenueMonths,
  rocDate,
  rocYearMonth,
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
