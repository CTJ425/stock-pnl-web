// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Replace the network layer with mock: what is tested here is the layout and paging switching, not the crawling logic
const {
  fetchStoredReport, generateReport, fetchDailySeries, fetchFundamental,
  warmStockCore, warmStockHistory,
} = vi.hoisted(() => ({
  fetchStoredReport: vi.fn(),
  generateReport: vi.fn(),
  fetchDailySeries: vi.fn(),
  fetchFundamental: vi.fn(),
  warmStockCore: vi.fn(),
  warmStockHistory: vi.fn(),
}))
vi.mock('../../services/reportProxy', () => ({
  isReportConfigured: true,
  fetchStoredReport,
  generateReport,
}))
vi.mock('../../services/dailyProxy', () => ({ fetchDailySeries }))
vi.mock('../../services/fundamentalProxy', () => ({ fetchFundamental }))
vi.mock('../../services/warmStock', () => ({ warmStockCore, warmStockHistory }))

import { StockDetailPage } from './StockDetailPage'
import type { PriceQuote } from '../../services/priceProxy'
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
  sources: {
    institutional: { date: '2026-07-23', fetchedAt: '2026-07-23T09:40:00.000Z' },
    margin: { date: '2026-07-23', fetchedAt: '2026-07-23T14:10:00.000Z' },
    borrow: { date: '2026-07-24', fetchedAt: '2026-07-23T15:30:00.000Z' },
  },
  notes: [],
}

const holding = { qty: 3000, avgCost: 100.5, price: 120, unrealized: 58500, roi: 0.194 }

/** A Taiwan stock quote after the market close (numbers are taken from 2330 measured responses on 2026-08-05)*/
const quote: PriceQuote = {
  price: 2405,
  prevClose: 2320,
  open: 2385,
  high: 2415,
  low: 2370,
  volume: 31851,
  tradeDate: '20260805',
  tradeTime: '13:30:00',
  trial: false,
  asOf: '2026-08-05T07:30:00.000Z',
  source: 'edge',
  stale: false,
}

/*
 * Starting from 0.6.8, four sections are combined into one page, and the order of "the Nth svg" and "the first .rpt-section" of the whole page is assumed.
 * All of them failed, and it was written in a fragile way of "I can just pass it today, but it will explode tomorrow if I add a paragraph."
 * Always change to block id positioning (#sec-chips / #sec-fundamental / #sec-technical / #sec-holding).
 */
const sec = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`#sec-${id}`)!
const charts = (c: HTMLElement, id: string) => sec(c, id).querySelectorAll('svg.chart-svg')

describe('StockDetailPage', () => {
  beforeEach(() => {
    cleanup()
    fetchStoredReport.mockReset()
    generateReport.mockReset()
    fetchDailySeries.mockReset()
    fetchFundamental.mockReset()
    warmStockCore.mockReset()
    warmStockHistory.mockReset()
    fetchStoredReport.mockResolvedValue(report)
    // Default is no daily line / no fundamentals (the batch has not been run yet); overwrite the required cases by yourself
    fetchDailySeries.mockResolvedValue(null)
    fetchFundamental.mockResolvedValue(null)
    // Default core seals complete (e.g. ETF) so history is not entered and no re-read runs.
    warmStockCore.mockResolvedValue({
      ok: true,
      dailySynced: 0,
      fundamentalSynced: 0,
      fundamentalComplete: true,
      backfilled: 0,
      phase: 'core',
    })
    warmStockHistory.mockResolvedValue({
      ok: true,
      dailySynced: 0,
      fundamentalSynced: 0,
      fundamentalComplete: true,
      backfilled: 0,
      phase: 'history',
    })
  })

  it('Storage 命中時直接顯示籌碼分頁，不呼叫即點即產', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    expect(await screen.findByText('三大法人買賣超')).toBeTruthy()
    expect(generateReport).not.toHaveBeenCalled()
  })

  it('報告表頭在擷取範圍內，含代號、資料日期與更新時間（PDF 才認得出是哪份報告）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    const head = container.querySelector('.detail-card .rpt-head')
    expect(head).toBeTruthy()
    expect(head!.textContent).toContain('2330 台積電｜盤後籌碼')
    expect(head!.textContent).toContain('資料日期 2026-07-23（最近交易日盤後）')
    // generatedAt = 2026-07-23T12:30:00Z, displayed as YYYY-MM-DD HH:mm in the viewer's time zone
    const expected = new Date('2026-07-23T12:30:00.000Z')
    const p = (n: number) => String(n).padStart(2, '0')
    expect(head!.textContent).toContain(
      `報告更新時間 ${expected.getFullYear()}-${p(expected.getMonth() + 1)}-${p(expected.getDate())} ${p(expected.getHours())}:${p(expected.getMinutes())}`,
    )
  })

  it('資料日期不在頁首重複（那是籌碼報告的屬性，非整頁的）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    expect(container.querySelector('.detail-head')!.textContent).not.toContain('資料日期')
  })

  it('三大法人為 單一表格：日期在左、法人在上方表頭，走勢與統計下沉至頁尾', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')

    const table = screen.getByRole('table', { name: '三大法人買賣超矩陣' })
    expect([...table.querySelectorAll('thead th')].map((e) => e.textContent)).toEqual([
      '日期',
      '外資（不含自營）',
      '外資自營商',
      '投信',
      '自營商',
      '三大法人合計',
    ])
    // Two daily rows (newest first: 07/23 then 07/22)
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /07\/22/ })).toBeNull()

    const rows = [...table.querySelectorAll('tbody tr')]
    // Row 0 is 07/23, Row 1 is 07/22
    expect(rows[0].querySelector('td')!.textContent).toBe('07/23')
    expect(rows[1].querySelector('td')!.textContent).toBe('07/22')

    // Foreign column is index 1
    expect(rows[0].querySelectorAll('td.num')[0].textContent).toBe('+5')
    expect(rows[1].querySelectorAll('td.num')[0].textContent).toBe('+3')
    expect(rows[0].querySelectorAll('td.num')[0].getAttribute('title')).toBe('2026-07-23 5,000 股')

    // Footer 2 日累計
    const footCells = [...table.querySelectorAll('tfoot td')].map(
      (td) => td.querySelector('div')?.textContent ?? td.textContent,
    )
    expect(footCells[0]).toBe('2 日累計')
    expect(footCells[1]).toBe('+8')
    expect(table.textContent).toContain('連 2 買')
    expect(table.querySelectorAll('tfoot .mac-spark')).toHaveLength(5)

    // The margin matrix has its own vertical table with streak & sparklines
    const marginTable = screen.getByRole('table', { name: '融資融券矩陣' })
    const marginHeaders = [...marginTable.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(marginHeaders).toEqual([
      '日期',
      '融資餘額（張）',
      '融資增減',
      '融券餘額（張）',
      '融券增減',
      '資券互抵',
    ])
    expect(marginTable.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(marginTable.textContent).toContain('連 2 增')
    expect(marginTable.querySelectorAll('tfoot .mac-spark')).toHaveLength(5)
  })

  it('融資融券矩陣：支援口徑切換（增減與餘額 / 買進與賣出 / 償還明細）', async () => {
    const user = userEvent.setup()
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')

    const marginTable = () => screen.getByRole('table', { name: '融資融券矩陣' })

    // Default summary
    expect(marginTable().querySelector('thead')!.textContent).toContain('融資餘額（張）')

    // Switch to trading
    await user.click(screen.getByRole('button', { name: '買進與賣出' }))
    expect(marginTable().querySelector('thead')!.textContent).toContain('融資買進')
    expect(marginTable().querySelector('thead')!.textContent).toContain('融券買進（回補）')

    // Switch to redeem
    await user.click(screen.getByRole('button', { name: '償還明細' }))
    expect(marginTable().querySelector('thead')!.textContent).toContain('融資現償')
    expect(marginTable().querySelector('thead')!.textContent).toContain('融券券償')

    // Switch back to summary
    await user.click(screen.getByRole('button', { name: '增減與餘額' }))
    expect(marginTable().querySelector('thead')!.textContent).toContain('融資餘額（張）')
  })

  it('籌碼矩陣：買進／賣出改用口徑切換，連買連賣一律看買賣超', async () => {
    const user = userEvent.setup()
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')

    const table = () => screen.getByRole('table', { name: '三大法人買賣超矩陣' })
    const foreignValues = () => [
      // 07/22, 07/23, and cumulative in footer
      table().querySelectorAll('tbody tr')[1].querySelectorAll('td.num')[0].textContent,
      table().querySelectorAll('tbody tr')[0].querySelectorAll('td.num')[0].textContent,
      table().querySelectorAll('tfoot td.num')[0].querySelector('div')?.textContent ??
        table().querySelectorAll('tfoot td.num')[0].textContent,
    ]

    expect(foreignValues()).toEqual(['+3', '+5', '+8'])

    // 買進: 4,000 / 6,000 shares → 4 / 6 lots, unsigned (a gross leg is never negative)
    await user.click(screen.getByRole('button', { name: '買進' }))
    expect(foreignValues()).toEqual(['4', '6', '10'])
    expect(table().querySelectorAll('tbody tr')[0].querySelectorAll('td.num')[0].className).not.toContain('pnl-')
    // The streak follows the net, not the displayed leg
    expect(table().textContent).toContain('連 2 買')

    await user.click(screen.getByRole('button', { name: '賣出' }))
    expect(foreignValues()).toEqual(['1', '1', '2'])

    await user.click(screen.getByRole('button', { name: '買賣超' }))
    expect(foreignValues()).toEqual(['+3', '+5', '+8'])
    expect(table().querySelectorAll('tbody tr')[0].querySelectorAll('td.num')[0].className).toContain('pnl-up')
  })

  it('籌碼段只剩融資/融券兩張走勢圖（0.7.7 移除近 N 日買賣超長條圖）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    // The bar chart drew the same numbers the matrix already shows on every 法人 for every day
    expect(screen.queryByText(/日買賣超$/)).toBeNull()
    expect(container.querySelector('.chart-with-legend')).toBeNull()
    expect(charts(container, 'chips').length).toBe(2)
    expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0)
  })

  it('行情置頂，下方以頁籤切換 籌碼 / 基本面 / 技術面', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')

    // 行情永遠在畫面上
    expect(sec(container, 'quote')).toBeTruthy()
    expect(sec(container, 'quote').querySelector('.quote-aside-private')).toBeTruthy()

    // 預設為籌碼分析
    expect(sec(container, 'chips')).toBeTruthy()
    expect(screen.queryByText('基本面資料尚未產生')).toBeNull()

    // 切換至基本面
    await user.click(screen.getByRole('tab', { name: '基本面' }))
    expect(sec(container, 'fundamental')).toBeTruthy()
    expect(screen.queryByText('三大法人買賣超')).toBeNull()

    // 切換至技術面
    await user.click(screen.getByRole('tab', { name: '技術面' }))
    expect(sec(container, 'technical')).toBeTruthy()
    expect(screen.queryByText('基本面資料尚未產生')).toBeNull()
  })

  it('三個分頁籤：分析內容、損益試算、AI 分析', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    const tabs = [...container.querySelectorAll('.subtabs .subtab')].map((el) => el.textContent)
    expect(tabs).toEqual(['分析內容', '損益試算', 'AI 分析'])
  })

  it('行情卡片中包含三大法人買賣超動向 2 日卡片', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超動向')
    const quoteSec = sec(container, 'quote')
    expect(quoteSec.querySelector('.institutional-block')).toBeTruthy()
    expect(quoteSec.textContent).toContain('三大法人買賣超動向')
    expect(quoteSec.textContent).toContain('近 2 交易日')
    const cards = quoteSec.querySelectorAll('.inst-day-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].querySelector('.inst-day-title')!.textContent).toBe('07/23')
    expect(cards[0].querySelector('.inst-day-tag')!.textContent).toBe('最新')
    expect(cards[1].querySelector('.inst-day-title')!.textContent).toBe('07/22')
    expect(cards[1].querySelector('.inst-day-tag')!.textContent).toBe('前日')
  })

  it('技術面畫日 K／均線／布林，指標摘要在行情卡（0.6.51）', async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 80 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 3, 1) + i * 86400000).toISOString().slice(0, 10)
      const close = 100 + i
      return [date, close - 1, close + 1, close - 2, close, 1_000_000 + i] as [
        string,
        number,
        number,
        number,
        number,
        number,
      ]
    })
    fetchDailySeries.mockResolvedValue({
      ticker: '2330',
      asOf: '2026-07-27T09:31:00.000Z',
      lastDate: rows[rows.length - 1][0],
      rows,
    })

    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    await user.click(screen.getByRole('tab', { name: '技術面' }))

    await screen.findByText(/日 K · 均線 · 布林通道/)
    // daily K + volume + KD
    expect(charts(container, 'technical')).toHaveLength(3)
    expect(screen.getByText('週線')).toBeTruthy()
    expect(screen.getByText('季線')).toBeTruthy()
    expect(screen.getByText('BB上')).toBeTruthy()
    const tech = within(sec(container, 'technical'))
    expect(tech.queryByText(/多頭排列/)).toBeNull()
    const q = within(sec(container, 'quote'))
    expect(q.getByText(`指標摘要（${rows[rows.length - 1][0]}）`)).toBeTruthy()
    expect(q.getByText(/多頭排列/)).toBeTruthy()
    expect(q.getByText('布林')).toBeTruthy()
    expect(q.getByText('量比')).toBeTruthy()
  })

  it('技術面：成交量表格排在 KD 之後，預設 20 列可展開', async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 80 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 3, 1) + i * 86400000).toISOString().slice(0, 10)
      const close = 100 + i
      return [date, close - 1, close + 1, close - 2, close, 1_000_000 + i * 20_000] as [
        string, number, number, number, number, number,
      ]
    })
    fetchDailySeries.mockResolvedValue({
      ticker: '2330',
      asOf: '2026-07-27T09:31:00.000Z',
      lastDate: rows[rows.length - 1][0],
      rows,
    })

    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    await user.click(screen.getByRole('tab', { name: '技術面' }))
    await screen.findByText(/日 K · 均線 · 布林通道/)

    const heads = [...sec(container, 'technical').querySelectorAll('.rpt-section h3')].map(
      (h) => h.textContent,
    )
    expect(heads[0]).toMatch(/^日 K · 均線 · 布林通道/)
    expect(heads.slice(1)).toEqual(['KD 指標', '成交量'])

    const t = within(sec(container, 'technical'))
    const tableRows = () => sec(container, 'technical').querySelectorAll('.data-table tbody tr')
    expect(tableRows()).toHaveLength(20)
    expect(tableRows()[0].textContent).toContain('2026-06-19')
    expect(tableRows()[0].textContent).toContain('2,580 張')
    const ratio = [...tableRows()[0].querySelectorAll('td.num')][1].textContent!
    expect(Number(ratio.replace(' 倍', ''))).toBeGreaterThan(1)

    await user.click(t.getByRole('button', { name: /顯示全部 60 日/ }))
    expect(tableRows()).toHaveLength(60)
  })

  it('技術面：切到近 3 月時均線與布林仍畫得出來', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => {
      const date = new Date(Date.UTC(2025, 9, 1) + i * 86400000).toISOString().slice(0, 10)
      const close = 100 + i
      return [date, close - 1, close + 1, close - 2, close, 1_000_000] as [
        string,
        number,
        number,
        number,
        number,
        number,
      ]
    })
    fetchDailySeries.mockResolvedValue({
      ticker: '2330',
      asOf: '2026-07-27T09:31:00.000Z',
      lastDate: rows[rows.length - 1][0],
      rows,
    })

    const user = userEvent.setup()
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    await user.click(screen.getByRole('tab', { name: '技術面' }))
    await screen.findByText(/日 K · 均線 · 布林通道/)

    await user.click(screen.getByRole('button', { name: '近 3 月' }))
    const kChart = charts(container, 'technical')[0]
    // MA5/20/60 + BB upper/mid/lower = 6 polylines minimum
    expect(kChart.querySelectorAll('polyline').length).toBeGreaterThanOrEqual(6)
  })

  it('各區塊各自標示資料日與更新時間（三個來源公布時間不同）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    const tags = [...sec(container, 'chips').querySelectorAll('.source-tag')].map((el) => el.textContent)
    expect(tags).toHaveLength(3)
    // The three crawl times are different - this is the reason for block-by-block marking
    expect(new Set(tags).size).toBe(3)
    expect(tags[0]).toContain('資料日 2026-07-23') // 三大法人
    expect(tags[2]).toContain('資料日 2026-07-24') // 借券是下一個交易日，比籌碼晚一天
  })

  it('融資融券尚未公布時說明是「還沒到」而非故障，並點出三大法人不受影響', async () => {
    fetchStoredReport.mockResolvedValue({
      ...report,
      margin: null,
      history: report.history.map((d) => ({ ...d, margin: null })),
      sources: { ...report.sources!, margin: null },
    })
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')
    expect(screen.getByText(/今日融資融券尚未公布（約 21:00–22:00 才會有）/)).toBeTruthy()
    expect(screen.getByText(/上方的三大法人不受影響/)).toBeTruthy()
    // There should be no more old copy that could be misinterpreted as a glitch.
    expect(screen.queryByText(/來源暫時無回應/)).toBeNull()
  })

  it('舊格式報告（schema 2、無 sources）不會炸，只是沒有時間標記', async () => {
    const { sources: _omit, ...legacy } = report
    fetchStoredReport.mockResolvedValue({ ...legacy, schema: 2 })
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    expect(sec(container, 'chips').querySelectorAll('.source-tag')).toHaveLength(0)
  })

  it('PDF 功能已完全拔除，畫面上沒有下載 PDF 按鈕', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')
    expect(screen.queryByRole('button', { name: /下載 PDF/ })).toBeNull()
  })

  it('AI 分析仍是獨立分頁，切過去後長頁四段都不在畫面上', async () => {
    const user = userEvent.setup()
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')
    await user.click(screen.getByRole('button', { name: 'AI 分析' }))
    expect(screen.queryByText('三大法人買賣超')).toBeNull()
    expect(screen.queryByText('持股概況')).toBeNull()
    // There is no report to retrieve for AI paging, and the PDF download does not appear.
    expect(screen.queryByRole('button', { name: /下載 PDF/ })).toBeNull()
  })

  it('Storage 未命中時走即點即產 fallback', async () => {
    fetchStoredReport.mockResolvedValue(null)
    generateReport.mockResolvedValue(report)
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
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
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('格式不符'))
  })

  it('history 只有 2 天時，標題與資料同步（不假裝有 7 天）', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')
    // The table footer counts the same days
    expect(screen.getByText('2 日累計')).toBeTruthy()
    expect(screen.getByText('近 2 日餘額走勢')).toBeTruthy()
  })

  it('應包含「AI 分析」分頁籤並可點擊切換', async () => {
    const user = userEvent.setup()
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')

    const aiTabButton = screen.getByRole('button', { name: 'AI 分析' })
    expect(aiTabButton).toBeTruthy()

    await user.click(aiTabButton)
    expect(screen.getByText('AI 個股綜合分析')).toBeTruthy()
  })

  it('應包含「基本面」分頁籤；有資料時顯示估值，無資料時顯示尚未產生', async () => {
    const user = userEvent.setup()
    fetchFundamental.mockResolvedValue({
      ticker: '2330',
      asOf: '2026-07-27T09:31:00.000Z',
      dataDate: '2026-07-25',
      industry: '半導體業',
      valuation: {
        peRatio: 31.59,
        dividendYieldPercent: 0.94,
        pbRatio: 10.34,
        dataDate: '2026-07-24',
      },
      revenueUnit: '千元',
      revenueMonths: [],
      profitQuarters: [],
      notes: [],
    })

    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    await user.click(screen.getByRole('tab', { name: '基本面' }))

    // 0.9.17: 本益比 now also appears in the 行情 card's rail, so a page-wide getByText('31.59')
    // matches twice. Scope it to the section this test is actually about.
    expect(within(sec(container, 'fundamental')).getByText('31.59')).toBeTruthy()
    expect(screen.getByText('估值指標')).toBeTruthy()
  })

  it('產業別 badge：有資料才出現在標題旁', async () => {
    fetchFundamental.mockResolvedValue({
      ticker: '2330',
      asOf: '2026-07-27T09:31:00.000Z',
      dataDate: '2026-07-25',
      industry: '半導體業',
      valuation: null,
      revenueUnit: '千元',
      revenueMonths: [],
      profitQuarters: [],
      notes: [],
    })
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    expect(await screen.findByText('半導體業')).toBeTruthy()
  })

  it('基本面查無時補叫 warm；成功產出後重讀並顯示（新加入的股票不必等夜間批次）', async () => {
    const fresh = {
      ticker: '2609',
      asOf: '2026-07-27T09:31:00.000Z',
      dataDate: '2026-07-25',
      industry: '航運業',
      valuation: { peRatio: 16.72, dividendYieldPercent: 3.88, pbRatio: 0.55, dataDate: '2026-07-24' },
      revenueUnit: '千元' as const,
      revenueMonths: [],
      profitQuarters: [],
      notes: [],
    }
    fetchFundamental.mockResolvedValueOnce(null).mockResolvedValueOnce(fresh)
    warmStockCore.mockResolvedValue({
      ok: true,
      dailySynced: 1,
      fundamentalSynced: 1,
      fundamentalComplete: true,
      backfilled: 0,
      phase: 'core',
    })

    render(<StockDetailPage ticker="2609" name="陽明" holding={holding} quote={quote} />)

    expect(await screen.findByText('航運業')).toBeTruthy()
    expect(warmStockCore).toHaveBeenCalledWith('2609', '陽明')
    expect(warmStockHistory).not.toHaveBeenCalled()
    expect(fetchFundamental).toHaveBeenCalledTimes(2)
  })

  it('基本面明顯過短（月 < 6 或無季）時仍補叫 warm，有進度再重讀', async () => {
    /*
      Soft threshold 0.6.44-dev.7: warm when thin, not whenever count < 12.
      Two months + zero quarters still qualifies.
    */
    const month = (yearMonth: string) => ({
      yearMonth,
      revenueThousandTwd: 1,
      momPercent: null,
      yoyPercent: null,
      cumulativeYoyPercent: null,
    })
    const partial = {
      ticker: '2609',
      asOf: '2026-07-27T09:31:00.000Z',
      dataDate: '2026-07-25',
      industry: '航運業',
      valuation: null,
      revenueUnit: '千元' as const,
      revenueMonths: [month('2026-05'), month('2026-06')],
      profitQuarters: [],
      notes: [],
    }
    const full = {
      ...partial,
      asOf: '2026-07-27T10:00:00.000Z',
      revenueMonths: Array.from({ length: 12 }, (_, i) =>
        month(`2025-${String(i + 1).padStart(2, '0')}`),
      ),
    }
    // Paint partial first; core writes nothing new; history backfills → re-read full.
    fetchFundamental.mockResolvedValueOnce(partial).mockResolvedValueOnce(full)
    warmStockCore.mockResolvedValue({
      ok: true,
      dailySynced: 0,
      fundamentalSynced: 0,
      fundamentalComplete: false,
      backfilled: 0,
      phase: 'core',
    })
    warmStockHistory.mockResolvedValue({
      ok: true,
      dailySynced: 0,
      fundamentalSynced: 0,
      fundamentalComplete: true,
      backfilled: 10,
      phase: 'history',
    })

    const user = userEvent.setup()
    const { container } = render(<StockDetailPage ticker="2609" name="陽明" holding={holding} quote={quote} />)

    // Storage paints first (industry badge) before warm finishes
    await screen.findByText('航運業')
    expect(warmStockCore).toHaveBeenCalledWith('2609', '陽明')
    await waitFor(() => expect(warmStockHistory).toHaveBeenCalledWith('2609', '陽明'))
    await user.click(screen.getByRole('tab', { name: '基本面' }))
    await waitFor(() =>
      expect(container.querySelectorAll('#sec-fundamental .data-table tbody tr').length).toBe(12),
    )
  })

  it('月營收已夠長且季報已達 soft min 時不再 warm（其餘交給夜批）', async () => {
    const month = (yearMonth: string) => ({
      revenueThousandTwd: 1,
      yearMonth,
      momPercent: null,
      yoyPercent: null,
      cumulativeYoyPercent: null,
    })
    const quarter = (yearQuarter: string) => ({
      yearQuarter,
      revenueMillionTwd: 1,
      grossMarginPercent: null,
      operatingMarginPercent: null,
      pretaxMarginPercent: null,
      netMarginPercent: null,
      epsTwd: null,
    })
    // Daily present so useDailySeries does not call warm either
    fetchDailySeries.mockResolvedValue({
      ticker: '2059',
      asOf: '2026-08-07T09:00:00.000Z',
      lastDate: '2026-08-07',
      rows: [
        ['2026-08-01', 1, 1, 1, 1, 1],
        ['2026-08-07', 1, 1, 1, 1, 1],
      ],
    })
    fetchFundamental.mockResolvedValue({
      ticker: '2059',
      asOf: '2026-08-07T09:00:00.000Z',
      dataDate: '2026-08-07',
      industry: '電子零組件業',
      valuation: null,
      revenueUnit: '千元' as const,
      revenueMonths: Array.from({ length: 12 }, (_, i) =>
        month(`2025-${String(i + 1).padStart(2, '0')}`),
      ),
      // 8/12 — above PROFIT_WARM_MIN(6); soft rule must not warm (night batch finishes rest)
      profitQuarters: Array.from({ length: 8 }, (_, i) => {
        const y = 2023 + Math.floor(i / 4)
        return quarter(`${y}-Q${(i % 4) + 1}`)
      }),
      notes: [],
    })

    render(<StockDetailPage ticker="2059" name="川湖" holding={holding} quote={quote} />)
    await screen.findByText('電子零組件業')
    expect(warmStockCore).not.toHaveBeenCalled()
    expect(warmStockHistory).not.toHaveBeenCalled()
  })

  it('月營收已滿但季報偏薄時只打 history、不扣 core 額度', async () => {
    const month = (yearMonth: string) => ({
      yearMonth,
      revenueThousandTwd: 1,
      momPercent: null,
      yoyPercent: null,
      cumulativeYoyPercent: null,
    })
    const quarter = (yearQuarter: string) => ({
      yearQuarter,
      revenueMillionTwd: 1,
      grossMarginPercent: null,
      operatingMarginPercent: null,
      pretaxMarginPercent: null,
      netMarginPercent: null,
      epsTwd: null,
    })
    fetchDailySeries.mockResolvedValue({
      ticker: '2330',
      asOf: '2026-08-07T09:00:00.000Z',
      lastDate: '2026-08-07',
      rows: [
        ['2026-08-01', 1, 1, 1, 1, 1],
        ['2026-08-07', 1, 1, 1, 1, 1],
      ],
    })
    const thinQuarters = {
      ticker: '2330',
      asOf: '2026-08-07T09:00:00.000Z',
      dataDate: '2026-08-07',
      industry: '半導體業',
      valuation: null,
      revenueUnit: '千元' as const,
      revenueMonths: Array.from({ length: 12 }, (_, i) =>
        month(`2025-${String(i + 1).padStart(2, '0')}`),
      ),
      profitQuarters: [quarter('2025-Q4'), quarter('2026-Q1')],
      notes: [],
    }
    const fuller = {
      ...thinQuarters,
      profitQuarters: Array.from({ length: 10 }, (_, i) => {
        const y = 2023 + Math.floor(i / 4)
        return quarter(`${y}-Q${(i % 4) + 1}`)
      }),
    }
    fetchFundamental.mockResolvedValueOnce(thinQuarters).mockResolvedValueOnce(fuller)
    warmStockHistory.mockResolvedValue({
      ok: true,
      dailySynced: 0,
      fundamentalSynced: 0,
      fundamentalComplete: false,
      backfilled: 8,
      phase: 'history',
    })

    render(<StockDetailPage ticker="2330" name="台積電" holding={null} quote={quote} />)
    await screen.findByText('半導體業')
    expect(warmStockCore).not.toHaveBeenCalled()
    await waitFor(() => expect(warmStockHistory).toHaveBeenCalledWith('2330', '台積電'))
  })

  it('warm 產不出基本面（例如 ETF）時不重讀，維持空狀態', async () => {
    const user = userEvent.setup()
    warmStockCore.mockResolvedValue({
      ok: true,
      dailySynced: 1,
      fundamentalSynced: 0,
      fundamentalComplete: true,
      backfilled: 0,
      phase: 'core',
    })

    render(<StockDetailPage ticker="0050" name="元大台灣50" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')
    await user.click(screen.getByRole('tab', { name: '基本面' }))

    expect(screen.getByText('基本面資料尚未產生')).toBeTruthy()
    // I only read it once: If the warm return has no output, you should not call Storage again.
    expect(fetchFundamental).toHaveBeenCalledTimes(1)
    expect(warmStockHistory).not.toHaveBeenCalled()
  })

  it('查無基本面時標題不出現 badge、分頁顯示空狀態', async () => {
    const user = userEvent.setup()
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')
    await user.click(screen.getByRole('tab', { name: '基本面' }))

    expect(screen.getByText('基本面資料尚未產生')).toBeTruthy()
    expect(screen.queryByText('半導體業')).toBeNull()
  })

  // After 0.6.1, the batch will be polled every 15 minutes, and the report will be updated while the user is watching.
  // Without this set of behaviors, the paging that is open will always stop at the snapshot of the moment when the page is opened.
  describe('切回前景時比對報告是否已更新（0.6.2）', () => {
    const fireVisible = async (state: 'visible' | 'hidden' = 'visible') => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }

    it('報告換過一份 → 自動換上新的，不必重新整理', async () => {
      render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
      await screen.findByText('三大法人買賣超')
      expect(screen.getByText(/資料日期 2026-07-23/)).toBeTruthy()

      const next: ReportData = {
        ...report,
        dataDate: '2026-07-24',
        generatedAt: '2026-07-24T09:15:00.000Z',
      }
      fetchStoredReport.mockResolvedValue(next)
      await fireVisible()

      await waitFor(() => expect(screen.getByText(/資料日期 2026-07-24/)).toBeTruthy())
    })

    it('generatedAt 沒變 → 不動 state（否則每次切回都重繪，捲動與展開狀態會被洗掉）', async () => {
      const { container } = render(
        <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
      )
      await screen.findByText('三大法人買賣超')
      const before = container.querySelector('.detail-card .rpt-head')!.textContent

      // Return the same copy (different object entities, but the same generatedAt)
      fetchStoredReport.mockResolvedValue({ ...report })
      await fireVisible()
      await waitFor(() => expect(fetchStoredReport).toHaveBeenCalledTimes(2))

      expect(container.querySelector('.detail-card .rpt-head')!.textContent).toBe(before)
    })

    it('切到背景時不抓（只在使用者真的要看的時候才打 Storage）', async () => {
      render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
      await screen.findByText('三大法人買賣超')
      expect(fetchStoredReport).toHaveBeenCalledTimes(1)

      await fireVisible('hidden')
      expect(fetchStoredReport).toHaveBeenCalledTimes(1)
    })

    it('切回前景時查無 Storage 報告 → 保留畫面上這份，不清空', async () => {
      render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
      await screen.findByText('三大法人買賣超')

      fetchStoredReport.mockResolvedValue(null)
      await fireVisible()
      await waitFor(() => expect(fetchStoredReport).toHaveBeenCalledTimes(2))

      expect(screen.getByText('三大法人買賣超')).toBeTruthy()
      expect(screen.getByText(/資料日期 2026-07-23/)).toBeTruthy()
    })
  })
})
