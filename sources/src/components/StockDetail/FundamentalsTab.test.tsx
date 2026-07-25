// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { FundamentalsTab } from './FundamentalsTab'
import type { Fundamentals } from '../../services/reportProxy'

// 2330 實測值（見 twFundamentals.test.ts 的 fixture）
const valuation = {
  peRatio: 31.59,
  dividendYield: 0.94,
  pbRatio: 10.34,
  closePrice: 2350,
  ttmEps: 74.39,
  date: '2026-07-24',
}

const q1 = { year: 2026, quarter: 1, eps: 22.08, revenue: 1_134_103_440, netIncome: 572_479_752 }
const q4 = { year: 2025, quarter: 4, eps: 18.5, revenue: 980_000_000, netIncome: 470_000_000 }

const oneQuarter: Fundamentals = { valuation, quarters: [q1], isEtf: false }
const twoQuarters: Fundamentals = { valuation, quarters: [q4, q1], isEtf: false }

describe('FundamentalsTab', () => {
  beforeEach(() => cleanup())

  it('顯示估值指標，殖利率不被重複乘 100', () => {
    render(<FundamentalsTab fundamentals={oneQuarter} ticker="2330" />)
    expect(screen.getByText('31.59 倍')).toBeTruthy() // 本益比
    expect(screen.getByText('0.94%')).toBeTruthy() // 殖利率（來源即 0.94）
    expect(screen.getByText('10.34 倍')).toBeTruthy() // 股價淨值比
    expect(screen.getByText('74.39 元')).toBeTruthy() // 反推年化 EPS
    expect(screen.getByText(/資料日期 2026-07-24/)).toBeTruthy()
  })

  it('年化 EPS 標明是推算值，避免被當成財報原始數字', () => {
    render(<FundamentalsTab fundamentals={oneQuarter} ticker="2330" />)
    expect(screen.getByText(/年化 EPS（推算）/)).toBeTruthy()
    expect(screen.getByText(/不是財報原始數字/)).toBeTruthy()
  })

  it('顯示最新一季 EPS、營收與淨利（千元換算為億元）', () => {
    const { container } = render(<FundamentalsTab fundamentals={oneQuarter} ticker="2330" />)
    expect(screen.getByText(/最新一季（2026 Q1）/)).toBeTruthy()
    const cards = container.querySelectorAll('.rpt-card')
    const texts = [...cards].map((c) => c.textContent)
    expect(texts.some((t) => t?.includes('22.08 元'))).toBe(true)
    expect(texts.some((t) => t?.includes('11,341.0 億元'))).toBe(true)
    expect(texts.some((t) => t?.includes('5,724.8 億元'))).toBe(true)
  })

  it('只有一季時不畫走勢圖，並說明會逐季累積', () => {
    const { container } = render(<FundamentalsTab fundamentals={oneQuarter} ticker="2330" />)
    expect(container.querySelectorAll('svg.chart-svg').length).toBe(0)
    expect(screen.getByText(/之後每季公布時會自動累積/)).toBeTruthy()
  })

  it('兩季以上才畫 EPS 走勢圖，表格由新到舊', () => {
    const { container } = render(<FundamentalsTab fundamentals={twoQuarters} ticker="2330" />)
    expect(container.querySelectorAll('svg.chart-svg').length).toBe(1)
    const rows = container.querySelectorAll('.data-table tbody tr')
    expect(rows[0].textContent).toContain('2026 Q1') // 最新在最上面
    expect(rows[1].textContent).toContain('2025 Q4')
  })

  it('ETF 用專屬文案說明「沒有 EPS」，而非籠統的查無', () => {
    render(
      <FundamentalsTab
        fundamentals={{ valuation: null, quarters: [], isEtf: true }}
        ticker="0050"
      />,
    )
    expect(screen.getByText(/0050 是 ETF，沒有 EPS/)).toBeTruthy()
    expect(screen.getByText(/價值來自它持有的那一籃子股票/)).toBeTruthy()
    // 不該出現籠統的「查無」——ETF 不是查不到，是本質上不適用
    expect(screen.queryByText(/查無此股的財報資料/)).toBeNull()
    expect(screen.getByText(/ETF 沒有本益比/)).toBeTruthy()
    expect(screen.queryByText(/查無此股的本益比等估值資料/)).toBeNull()
  })

  it('上櫃 / 查無（fundamentals 為 null）說明只涵蓋上市', () => {
    render(<FundamentalsTab fundamentals={null} ticker="6488" />)
    expect(screen.getByText(/查無 6488 的基本面資料/)).toBeTruthy()
    expect(screen.getByText(/只涵蓋上市公司/)).toBeTruthy()
  })

  it('舊格式報告（fundamentals 為 undefined）說明下次盤後更新後才有', () => {
    render(<FundamentalsTab fundamentals={undefined} ticker="2330" />)
    expect(screen.getByText(/這份報告是舊格式/)).toBeTruthy()
    expect(screen.getByText(/下一次盤後更新後就會出現/)).toBeTruthy()
  })

  it('虧損季別以綠色（跌）呈現並保留負號', () => {
    const loss = { year: 2026, quarter: 1, eps: -1.5, revenue: 100_000, netIncome: -50_000 }
    const { container } = render(
      <FundamentalsTab fundamentals={{ valuation, quarters: [loss], isEtf: false }} ticker="2609" />,
    )
    const row = container.querySelector('.data-table tbody tr')!
    expect(within(row as HTMLElement).getByText('-1.50 元').className).toContain('pnl-down')
  })
})
