// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TechnicalTab } from './TechnicalTab'
import type { DailySeries } from '../../services/dailyProxy'

afterEach(cleanup)

function makeDailySeries(count = 60): DailySeries {
  const rows: DailySeries['rows'] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
    const close = 100 + i * 2
    const volume = (1000 + i * 50) * 1000 // shares
    rows.push([d, close - 1, close + 2, close - 2, close, volume])
  }
  return {
    ticker: '2330',
    asOf: '2026-08-07T09:00:00.000Z',
    lastDate: rows[rows.length - 1][0],
    rows,
  }
}

describe('TechnicalTab', () => {
  it('成交量表格採用 inst-matrix 樣式，包含 5 欄表頭與表尾 4 張走勢圖', () => {
    const series = makeDailySeries(60)
    render(<TechnicalTab ticker="2330" status="ready" series={series} />)

    const table = screen.getByRole('table', { name: '每日成交量矩陣' })
    expect(table.className).toContain('inst-matrix')

    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(headers).toEqual(['日期', '成交量', '量比', '收盤價', '漲跌幅'])

    // Body rows
    const rows = table.querySelectorAll('tbody tr')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].querySelectorAll('td.num')).toHaveLength(4)

    // Footer
    const tfoot = table.querySelector('tfoot')
    expect(tfoot).toBeTruthy()
    expect(tfoot?.querySelectorAll('.mac-spark')).toHaveLength(4)
    expect(table.textContent).toContain('日增量')
    expect(table.textContent).toContain('日上漲')
  })

  it('支援展開顯示全部交易日與收合', async () => {
    const user = userEvent.setup()
    const series = makeDailySeries(40)
    render(<TechnicalTab ticker="2330" status="ready" series={series} />)

    const table = screen.getByRole('table', { name: '每日成交量矩陣' })
    // Initially collapsed to 20 rows
    expect(table.querySelectorAll('tbody tr')).toHaveLength(20)

    const toggleBtn = screen.getByRole('button', { name: /顯示全部/ })
    await user.click(toggleBtn)

    // Expanded to all 40 rows
    expect(table.querySelectorAll('tbody tr')).toHaveLength(40)

    await user.click(screen.getByRole('button', { name: /只顯示近 20 日/ }))
    expect(table.querySelectorAll('tbody tr')).toHaveLength(20)
  })
})
