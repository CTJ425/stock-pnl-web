// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// 以 mock 取代網路層：這裡驗的是版面與分頁切換，不是抓取邏輯
const { fetchStoredReport, generateReport } = vi.hoisted(() => ({
  fetchStoredReport: vi.fn(),
  generateReport: vi.fn(),
}))
vi.mock('../../services/reportProxy', () => ({
  isReportConfigured: true,
  fetchStoredReport,
  generateReport,
}))

import { StockDetailPage } from './StockDetailPage'
import type { ChipDay, ChipLeg, ReportData } from '../../services/reportProxy'

const leg = (buy: number, sell: number): ChipLeg => ({ buy, sell, net: buy - sell })

function day(date: string, net: number, marginToday: number): ChipDay {
  return {
    date,
    institutional: {
      foreign: leg(net + 1000, 1000),
      foreignDealer: leg(0, 0),
      trust: leg(500, 500),
      dealer: leg(200, 100),
      total: leg(net + 1700, 1600),
    },
    margin: {
      marginBuy: 855, marginSell: 662, marginRedeem: 88,
      marginPrev: marginToday - 105, marginToday, marginChange: 105, marginLimit: 6483092,
      shortBuy: 4, shortSell: 5, shortRedeem: 0,
      shortPrev: 98, shortToday: 99, shortChange: 1, shortLimit: 6483092,
      offset: 3, source: 'rwd',
    },
  }
}

const history = [day('2026-07-22', 3000, 31823), day('2026-07-23', 5000, 31928)]

const report: ReportData = {
  schema: 2,
  ticker: '2330',
  name: '台積電',
  market: 'TPE',
  dataDate: '2026-07-23',
  generatedAt: '2026-07-23T12:30:00.000Z',
  holding: null,
  institutional: history[1].institutional,
  margin: history[1].margin,
  borrow: { availableVolume: 100267 },
  history,
  streaks: { foreign: 2, foreignDealer: 0, trust: 0, dealer: 2, total: 2, margin: 2, short: 1 },
  notes: [],
}

const holding = { qty: 3000, avgCost: 100.5, price: 120, unrealized: 58500, roi: 0.194 }

describe('StockDetailPage', () => {
  beforeEach(() => {
    cleanup()
    fetchStoredReport.mockReset()
    generateReport.mockReset()
    fetchStoredReport.mockResolvedValue(report)
  })

  it('Storage 命中時直接顯示籌碼分頁，不呼叫即點即產', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} onBack={() => {}} />)
    expect(await screen.findByText('三大法人買賣超')).toBeTruthy()
    expect(generateReport).not.toHaveBeenCalled()
  })

  it('報告表頭在擷取範圍內，含代號、資料日期與更新時間（PDF 才認得出是哪份報告）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} onBack={() => {}} />,
    )
    await screen.findByText('三大法人買賣超')
    const head = container.querySelector('.detail-body .rpt-head')
    expect(head).toBeTruthy()
    expect(head!.textContent).toContain('2330 台積電｜盤後籌碼')
    expect(head!.textContent).toContain('資料日期 2026-07-23（最近交易日盤後）')
    // generatedAt = 2026-07-23T12:30:00Z，顯示為觀看者時區的 YYYY-MM-DD HH:mm
    const expected = new Date('2026-07-23T12:30:00.000Z')
    const p = (n: number) => String(n).padStart(2, '0')
    expect(head!.textContent).toContain(
      `報告更新時間 ${expected.getFullYear()}-${p(expected.getMonth() + 1)}-${p(expected.getDate())} ${p(expected.getHours())}:${p(expected.getMinutes())}`,
    )
  })

  it('資料日期不在頁首重複（那是籌碼報告的屬性，非整頁的）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} onBack={() => {}} />,
    )
    await screen.findByText('三大法人買賣超')
    expect(container.querySelector('.detail-head')!.textContent).not.toContain('資料日期')
  })

  it('三大法人表格顯示買進 / 賣出 / 買賣超與連買連賣', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} onBack={() => {}} />)
    await screen.findByText('三大法人買賣超')
    // 圖表軸標籤也會出現相同數字，故限定在三大法人表格內查
    const instTable = within(screen.getAllByRole('table')[0])
    const foreignRow = within(instTable.getByText('外資（不含自營）').closest('tr')!)
    // 外資 leg：買 6,000 / 賣 1,000 / 買賣超 +5,000 / 約當 +5 張 / 連 2 買
    expect(foreignRow.getByText('6,000')).toBeTruthy()
    expect(foreignRow.getByText('1,000')).toBeTruthy()
    expect(foreignRow.getByText('+5,000')).toBeTruthy()
    expect(foreignRow.getByText('+5')).toBeTruthy()
    expect(foreignRow.getByText('連 2 買')).toBeTruthy()
    // 融資融券的「連增連減」
    expect(screen.getByText('連 2 增')).toBeTruthy()
  })

  it('畫出走勢圖（inline SVG，非圖表函式庫）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} onBack={() => {}} />,
    )
    await screen.findByText('三大法人買賣超')
    // 買賣超長條圖 + 融資 / 融券兩張折線圖
    expect(container.querySelectorAll('svg.chart-svg').length).toBe(3)
    expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0)
  })

  it('可切換法人，重畫買賣超長條圖', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} onBack={() => {}} />,
    )
    await screen.findByText('三大法人買賣超')
    const before = container.querySelectorAll('svg.chart-svg')[0]?.innerHTML
    await user.click(screen.getByRole('button', { name: '投信' }))
    const after = container.querySelectorAll('svg.chart-svg')[0]?.innerHTML
    expect(after).not.toBe(before)
  })

  it('分頁籤切換：技術面為佔位、我的持股由前端資料渲染', async () => {
    const user = userEvent.setup()
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} onBack={() => {}} />)
    await screen.findByText('三大法人買賣超')

    await user.click(screen.getByRole('button', { name: '技術面' }))
    expect(screen.getByText(/日線、週線、季線還在開發中/)).toBeTruthy()
    expect(screen.queryByText('三大法人買賣超')).toBeNull()

    await user.click(screen.getByRole('button', { name: '我的持股' }))
    expect(screen.getByText('持股概況')).toBeTruthy()
    expect(screen.getByText('3,000')).toBeTruthy() // 持有股數
    expect(screen.getByText('+NT$58,500')).toBeTruthy() // 未實現淨損益
  })

  it('「下載 PDF」只在籌碼分頁出現（其他分頁沒有報告可擷取）', async () => {
    const user = userEvent.setup()
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} onBack={() => {}} />)
    await screen.findByText('三大法人買賣超')
    expect(screen.getByRole('button', { name: /下載 PDF/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '我的持股' }))
    expect(screen.queryByRole('button', { name: /下載 PDF/ })).toBeNull()
  })

  it('Storage 未命中時走即點即產 fallback', async () => {
    fetchStoredReport.mockResolvedValue(null)
    generateReport.mockResolvedValue(report)
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} onBack={() => {}} />)
    await screen.findByText('三大法人買賣超')
    expect(generateReport).toHaveBeenCalledWith({
      market: 'TPE',
      ticker: '2330',
      name: '台積電',
      holding,
    })
  })

  it('兩條路徑都失敗時顯示錯誤訊息', async () => {
    fetchStoredReport.mockResolvedValue(null)
    generateReport.mockRejectedValue(new Error('伺服器回傳的報告格式不符，請稍後再試'))
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('格式不符'))
  })

  it('history 只有 2 天時，圖表標題與資料同步（不假裝有 7 天）', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} onBack={() => {}} />)
    expect(await screen.findByText('近 2 日買賣超')).toBeTruthy()
    expect(screen.getByText('近 2 日餘額走勢')).toBeTruthy()
  })
})
