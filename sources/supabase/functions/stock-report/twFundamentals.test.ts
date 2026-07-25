import { describe, it, expect } from 'vitest'
import {
  extractClosePrice,
  extractIncome,
  extractValuation,
  expectedLatestQuarter,
  incomeRowsOk,
  incomeStatementUrl,
  isEtfTicker,
  rocDateToDash,
  rocYearToAd,
} from './twFundamentals.ts'

describe('rocYearToAd', () => {
  it('民國 → 西元（字串與數字皆可）', () => {
    expect(rocYearToAd('115')).toBe(2026)
    expect(rocYearToAd(115)).toBe(2026)
    expect(rocYearToAd('99')).toBe(2010)
  })

  it('缺值或超出合理民國年範圍回 null（防止把西元年再加 1911）', () => {
    expect(rocYearToAd(null)).toBeNull()
    expect(rocYearToAd('')).toBeNull()
    expect(rocYearToAd('2026')).toBeNull()
    expect(rocYearToAd(0)).toBeNull()
  })
})

describe('rocDateToDash', () => {
  it('民國 7 碼 → YYYY-MM-DD', () => {
    expect(rocDateToDash('1150724')).toBe('2026-07-24')
  })

  it('格式不符回 null', () => {
    expect(rocDateToDash('20260724')).toBeNull()
    expect(rocDateToDash('')).toBeNull()
    expect(rocDateToDash(null)).toBeNull()
  })
})

describe('expectedLatestQuarter', () => {
  // 申報期限：Q1 5/15、Q2 8/14、Q3 11/14、年報(Q4) 隔年 3/31
  it('2026-07-25 → 2026 Q1（與端點實際回傳的 115 年第 1 季一致）', () => {
    expect(expectedLatestQuarter(new Date('2026-07-25T12:00:00Z'))).toEqual({ year: 2026, quarter: 1 })
  })

  it('各申報期限的邊界', () => {
    expect(expectedLatestQuarter(new Date('2026-05-14T00:00:00'))).toEqual({ year: 2025, quarter: 4 })
    expect(expectedLatestQuarter(new Date('2026-05-15T00:00:00'))).toEqual({ year: 2026, quarter: 1 })
    expect(expectedLatestQuarter(new Date('2026-08-13T00:00:00'))).toEqual({ year: 2026, quarter: 1 })
    expect(expectedLatestQuarter(new Date('2026-08-14T00:00:00'))).toEqual({ year: 2026, quarter: 2 })
    expect(expectedLatestQuarter(new Date('2026-11-13T00:00:00'))).toEqual({ year: 2026, quarter: 2 })
    expect(expectedLatestQuarter(new Date('2026-11-14T00:00:00'))).toEqual({ year: 2026, quarter: 3 })
    expect(expectedLatestQuarter(new Date('2026-12-31T00:00:00'))).toEqual({ year: 2026, quarter: 3 })
  })

  it('年初尚未到年報期限時，最新一季是前一年 Q3', () => {
    expect(expectedLatestQuarter(new Date('2026-01-05T00:00:00'))).toEqual({ year: 2025, quarter: 3 })
    expect(expectedLatestQuarter(new Date('2026-03-30T00:00:00'))).toEqual({ year: 2025, quarter: 3 })
    expect(expectedLatestQuarter(new Date('2026-03-31T00:00:00'))).toEqual({ year: 2025, quarter: 4 })
  })
})

// 2330 綜合損益表(一般業) 實測列（2026-07-25 抓取，僅保留用到的欄位）
const CI_ROW_2330 = {
  出表日期: '1150725',
  年度: '115',
  季別: '1',
  公司代號: '2330',
  公司名稱: '台積電',
  營業收入: '1134103440.00',
  '基本每股盈餘（元）': '22.08',
  '淨利（淨損）歸屬於母公司業主': '572479752.00',
}

// 金控業表（2891 中信金實測在 _fh，不在 _ci）
const FH_ROW_2891 = {
  年度: '115',
  季別: '1',
  公司代號: '2891',
  公司名稱: '中信金',
  營業收入: '',
  '基本每股盈餘（元）': '1.42',
  '淨利（淨損）歸屬於母公司業主': '28123456.00',
}

describe('extractIncome', () => {
  it('取出西元年、季別、EPS、營收與淨利', () => {
    expect(extractIncome([CI_ROW_2330], '2330')).toEqual({
      year: 2026,
      quarter: 1,
      eps: 22.08,
      revenue: 1134103440,
      netIncome: 572479752,
    })
  })

  it('金控業表的同名欄位一樣取得到（五表欄名一致）', () => {
    const r = extractIncome([FH_ROW_2891], '2891')
    expect(r?.eps).toBe(1.42)
    expect(r?.revenue).toBeNull() // 空字串視為無資料，不冒充 0
  })

  it('查無代號回 null（ETF 與上櫃都不在這些表內）', () => {
    expect(extractIncome([CI_ROW_2330], '0050')).toBeNull()
    expect(extractIncome([CI_ROW_2330], '6488')).toBeNull()
    expect(extractIncome([], '2330')).toBeNull()
  })

  it('年度或季別不合理時回 null', () => {
    expect(extractIncome([{ ...CI_ROW_2330, 季別: '9' }], '2330')).toBeNull()
    expect(extractIncome([{ ...CI_ROW_2330, 年度: '' }], '2330')).toBeNull()
  })

  it('URL 依產業後綴組出', () => {
    expect(incomeStatementUrl('ci')).toContain('t187ap06_L_ci')
    expect(incomeStatementUrl('fh')).toContain('t187ap06_L_fh')
  })
})

describe('incomeRowsOk', () => {
  it('只有含「公司代號」的非空陣列才算可用', () => {
    expect(incomeRowsOk([CI_ROW_2330])).toBe(true)
    expect(incomeRowsOk([])).toBe(false)
    expect(incomeRowsOk([{ foo: 1 }])).toBe(false)
    expect(incomeRowsOk(null)).toBe(false)
    expect(incomeRowsOk('<html>error</html>')).toBe(false)
  })
})

// BWIBBU_ALL 實測列（2026-07-25 抓取）
const BWIBBU_2330 = {
  Date: '1150724',
  Code: '2330',
  Name: '台積電',
  PEratio: '31.59',
  DividendYield: '0.94',
  PBratio: '10.34',
}

describe('extractValuation', () => {
  it('取出本益比 / 殖利率 / 股價淨值比，並由收盤價反推年化 EPS', () => {
    // 實測：收盤 2350.0 ÷ 本益比 31.59 = 74.39
    expect(extractValuation([BWIBBU_2330], '2330', 2350)).toEqual({
      peRatio: 31.59,
      dividendYield: 0.94,
      pbRatio: 10.34,
      closePrice: 2350,
      ttmEps: 74.39,
      date: '2026-07-24',
    })
  })

  it('殖利率是百分比數值，原樣保留不乘 100', () => {
    expect(extractValuation([BWIBBU_2330], '2330', null)?.dividendYield).toBe(0.94)
  })

  it('沒有收盤價或本益比為 0 / 缺值時，ttmEps 為 null 而非 Infinity', () => {
    expect(extractValuation([BWIBBU_2330], '2330', null)?.ttmEps).toBeNull()
    expect(extractValuation([{ ...BWIBBU_2330, PEratio: '0.00' }], '2330', 100)?.ttmEps).toBeNull()
    expect(extractValuation([{ ...BWIBBU_2330, PEratio: '--' }], '2330', 100)?.ttmEps).toBeNull()
  })

  it('ETF 不在此表內，查無回 null', () => {
    expect(extractValuation([BWIBBU_2330], '0050', 101.7)).toBeNull()
  })
})

describe('extractClosePrice', () => {
  it('由 STOCK_DAY_AVG_ALL 取收盤價', () => {
    const rows = [{ Code: '2330', Name: '台積電', ClosingPrice: '2350.0', MonthlyAveragePrice: '2280.5' }]
    expect(extractClosePrice(rows, '2330')).toBe(2350)
    expect(extractClosePrice(rows, '9999')).toBeNull()
  })

  it('缺值不冒充 0', () => {
    expect(extractClosePrice([{ Code: '2330', ClosingPrice: '--' }], '2330')).toBeNull()
  })
})

describe('isEtfTicker', () => {
  it('00 開頭視為 ETF（沿用專案既有的證交稅慣例）', () => {
    expect(isEtfTicker('0050')).toBe(true)
    expect(isEtfTicker('006201')).toBe(true)
    expect(isEtfTicker('2330')).toBe(false)
    expect(isEtfTicker('1802')).toBe(false)
  })
})
