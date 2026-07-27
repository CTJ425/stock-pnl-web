// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FundamentalTab } from './FundamentalTab'
import type { FundamentalData } from '../../services/fundamentalProxy'

const full: FundamentalData = {
  ticker: '2330',
  asOf: '2026-07-27T09:31:00.000Z',
  dataDate: '2026-07-25',
  industry: '半導體業',
  valuation: { peRatio: 31.59, dividendYieldPercent: 0.94, pbRatio: 10.34, dataDate: '2026-07-24' },
  revenueUnit: '千元',
  revenueMonths: [
    {
      yearMonth: '2026-05',
      revenueThousandTwd: 416975163,
      momPercent: 1.2,
      yoyPercent: 40.1,
      cumulativeYoyPercent: 30,
    },
    {
      yearMonth: '2026-06',
      revenueThousandTwd: 442679969,
      momPercent: 6.16,
      yoyPercent: 67.87,
      cumulativeYoyPercent: 35.61,
    },
  ],
  notes: [],
}

describe('FundamentalTab', () => {
  afterEach(() => cleanup())

  it('顯示估值三指標與資料日期', () => {
    render(<FundamentalTab fundamental={full} loading={false} />)
    expect(screen.getByText('31.59')).toBeTruthy()
    expect(screen.getByText('0.94%')).toBeTruthy()
    expect(screen.getByText('10.34')).toBeTruthy()
    expect(screen.getByText(/資料日 2026-07-24/)).toBeTruthy()
  })

  it('月營收表由新到舊列出並標示千元單位', () => {
    render(<FundamentalTab fundamental={full} loading={false} />)
    expect(screen.getByText('單位：千元')).toBeTruthy()
    const rows = screen.getAllByRole('row')
    // rows[0] 是表頭；第一列資料應是最新月份
    expect(rows[1].textContent).toContain('2026 年 06 月')
    expect(rows[1].textContent).toContain('442,679,969')
    expect(rows[1].textContent).toContain('+67.87%')
    expect(rows[2].textContent).toContain('2026 年 05 月')
  })

  it('缺值以「—」呈現而非 0', () => {
    render(
      <FundamentalTab
        fundamental={{
          ...full,
          valuation: {
            peRatio: null,
            dividendYieldPercent: null,
            pbRatio: 0.85,
            dataDate: '2026-07-24',
          },
          revenueMonths: [],
        }}
        loading={false}
      />,
    )
    // 本益比與殖利率各一個「—」
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('查無月營收資料。')).toBeTruthy()
  })

  it('查無資料時顯示「尚未產生」空狀態', () => {
    render(<FundamentalTab fundamental={null} loading={false} />)
    expect(screen.getByText('基本面資料尚未產生')).toBeTruthy()
  })

  it('載入中顯示讀取提示', () => {
    render(<FundamentalTab fundamental={null} loading={true} />)
    expect(screen.getByText('正在讀取基本面…')).toBeTruthy()
  })

  it('上櫃缺料檔顯示 notes 說明', () => {
    render(
      <FundamentalTab
        fundamental={{
          ...full,
          industry: null,
          valuation: null,
          revenueMonths: [],
          notes: ['此代號查無上市基本面資料（可能為上櫃股票，暫不支援）'],
        }}
        loading={false}
      />,
    )
    expect(screen.getByText(/可能為上櫃股票/)).toBeTruthy()
    expect(screen.getByText('查無估值資料。')).toBeTruthy()
  })
})
