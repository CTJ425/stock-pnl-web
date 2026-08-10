// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Replace the network layer with mock: what is tested here is the layout and paging switching, not the crawling logic
const {
  fetchStoredReport, generateReport, fetchDailySeries, fetchFundamental,
  warmStockCore, warmStockHistory,
  generatePdfBlob, downloadBlob,
} = vi.hoisted(() => ({
  fetchStoredReport: vi.fn(),
  generateReport: vi.fn(),
  fetchDailySeries: vi.fn(),
  fetchFundamental: vi.fn(),
  warmStockCore: vi.fn(),
  warmStockHistory: vi.fn(),
  generatePdfBlob: vi.fn(),
  downloadBlob: vi.fn(),
}))
vi.mock('../../services/reportProxy', () => ({
  isReportConfigured: true,
  fetchStoredReport,
  generateReport,
}))
vi.mock('../../services/dailyProxy', () => ({ fetchDailySeries }))
vi.mock('../../services/fundamentalProxy', () => ({ fetchFundamental }))
vi.mock('../../services/warmStock', () => ({ warmStockCore, warmStockHistory }))
// html2canvas cannot run in jsdom, and the test here is "capturing what the current DOM looks like"
vi.mock('../../services/reportPdf', () => ({ generatePdfBlob, downloadBlob }))

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
    generatePdfBlob.mockReset()
    downloadBlob.mockReset()
    generatePdfBlob.mockResolvedValue(new Blob(['pdf']))
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

  it('三大法人表格顯示買進 / 賣出 / 買賣超與連買連賣', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')
    // The same numbers will also appear on the chart axis labels, so the search is limited to the three major legal entity tables.
    const instTable = within(screen.getAllByRole('table')[0])
    const foreignRow = within(instTable.getByText('外資（不含自營）').closest('tr')!)
    // Foreign leg: buy 6,000 / sell 1,000 / buy and sell over +5,000 / contract +5 lots / buy 2 in a row
    expect(foreignRow.getByText('6,000')).toBeTruthy()
    expect(foreignRow.getByText('1,000')).toBeTruthy()
    expect(foreignRow.getByText('+5,000')).toBeTruthy()
    expect(foreignRow.getByText('+5')).toBeTruthy()
    expect(foreignRow.getByText('連 2 買')).toBeTruthy()
    // The "consecutive increases and consecutive decreases" of margin trading are calculated by the front end based on history: the fixture is +105 / +1 on both days, so they are both consecutive increases of 2
    const marginTable = within(screen.getAllByRole('table')[1])
    expect(within(marginTable.getByText('融資').closest('tr')!).getByText('連 2 增')).toBeTruthy()
    expect(within(marginTable.getByText('融券').closest('tr')!).getByText('連 2 增')).toBeTruthy()
  })

  it('三大法人表格可切換檢視 7 天中任一天，連買連賣隨之重算', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')

    const rowOf = (label: string) =>
      within(within(screen.getAllByRole('table')[0]).getByText(label).closest('tr')!)
    // Explanatory sentences for the three major legal person blocks (the .hint of the first .rpt-section in the chip section)
    const caption = () => sec(container, 'chips').querySelector('.rpt-section .hint')!.textContent

    // Default to see the latest trading day (07/23): foreign investment net +5,000, 2 consecutive purchases
    expect(caption()).toContain('2026-07-23')
    expect(rowOf('外資（不含自營）').getByText('+5,000')).toBeTruthy()
    expect(rowOf('外資（不含自營）').getByText('連 2 買')).toBeTruthy()

    // Cut to the previous day (07/22): net becomes +3,000, and the number of consecutive buying days is reduced to 1
    await user.click(screen.getByRole('button', { name: /07\/22/ }))
    expect(caption()).toContain('2026-07-22')
    expect(rowOf('外資（不含自營）').getByText('+3,000')).toBeTruthy()
    expect(rowOf('外資（不含自營）').getByText('連 1 買')).toBeTruthy()
  })

  it('圖表預設並排四個法人，並附色塊圖例（身分不只靠顏色）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    const legend = within(container.querySelector('.chart-legend-side')! as HTMLElement)
    for (const label of ['外資（不含自營）', '外資自營商', '投信', '自營商']) {
      expect(legend.getByText(label)).toBeTruthy()
    }
    // The total does not appear in the picture (it is the sum of four items, and drawing it in means double counting)
    expect(legend.queryByText('三大法人合計')).toBeNull()
    expect(container.querySelectorAll('.chart-legend-swatch').length).toBe(4)
    // 2 days × 4 legal persons = 8 bars
    expect(charts(container, 'chips')[0].querySelectorAll('rect[rx]').length).toBe(8)
  })

  it('切成單一法人時圖例改講紅正綠負（顏色改為表達極性）', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    await user.click(screen.getByRole('button', { name: '投信' }))
    const labels = [...container.querySelectorAll('.chart-legend-label')].map((el) => el.textContent)
    expect(labels).toEqual(['買超（買比賣多）', '賣超（賣比買多）'])
    // Single sequence 2 days = 2 bars
    expect(charts(container, 'chips')[0].querySelectorAll('rect[rx]').length).toBe(2)
  })

  it('畫出走勢圖（inline SVG，非圖表函式庫）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    // Chip segment: buying and selling super long bar chart + two line charts of financing/securities lending
    expect(charts(container, 'chips').length).toBe(3)
    expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0)
  })

  it('可切換法人，重畫買賣超長條圖', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    const before = charts(container, 'chips')[0]?.innerHTML
    await user.click(screen.getByRole('button', { name: '投信' }))
    const after = charts(container, 'chips')[0]?.innerHTML
    expect(after).not.toBe(before)
  })

  it('四段同時在一頁上，順序為 行情 → 籌碼 → 基本面 → 技術面', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')

    const ids = [...container.querySelectorAll('[id^="sec-"]')].map((el) => el.id)
    expect(ids).toEqual(['sec-quote', 'sec-chips', 'sec-fundamental', 'sec-technical'])
    // Card titles are also in the same order.
    const titles = [...container.querySelectorAll('.card-head h3')].map((el) => el.textContent)
    expect(titles).toEqual(['行情', '籌碼', '基本面', '技術面'])
  })

  it('行情與技術面各自渲染，不必再切分頁', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')

    const q = within(sec(container, 'quote'))
    // 0.6.38: the inner「今日行情」heading is gone —— the card head already says 行情
    expect(q.queryByText('今日行情')).toBeNull()
    expect(q.getByText('31,851 張')).toBeTruthy() // 成交量
    // The box after closing is called "Today's Close" instead of "Deal", and the card title indicates the transaction date and status.
    expect(q.getByText('今收')).toBeTruthy()
    expect(container.querySelector('#sec-quote')?.previousElementSibling?.textContent).toContain(
      '8/5 · 已收盤 · 13:30:00',
    )

    // The shareholding figures no longer appear on the screen (since 0.6.36, this page only talks about market data)
    expect(screen.queryByText('持股概況')).toBeNull()
    expect(screen.queryByText('+NT$58,500')).toBeNull()

    // The technical aspect (fixture has no daily line) shows its own empty state and does not affect the other three segments.
    expect(await within(sec(container, 'technical')).findByText(/這檔還沒有歷史股價/)).toBeTruthy()
    expect(screen.getByText('三大法人買賣超')).toBeTruthy()
  })

  it('只有「分析內容」與「AI 分析」兩個分頁籤', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    const tabs = [...container.querySelectorAll('.subtabs .subtab')].map((el) => el.textContent)
    expect(tabs).toEqual(['分析內容', 'AI 分析'])
  })

  it('技術面畫日 K／均線／布林，指標摘要在行情卡（0.6.51）', async () => {
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

  it('PDF 擷取範圍含四段，且不含任何持股數字（個資不進匯出檔）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />,
    )
    await screen.findByText('三大法人買賣超')
    expect(screen.getByRole('button', { name: /下載 PDF/ })).toBeTruthy()

    /*
      The shared report has never contained personal data. Before 0.6.35 that was enforced by keeping holdings
      outside surfaceRef; since 0.6.36 that card is the quote (public market data) and all four sections are in
      the export range —— what guards it now is that no holding figure appears on screen at all, and this test
      pins the latter.
    */
    const stacks = container.querySelectorAll('.detail-stack')
    const captured = stacks[stacks.length - 1]
    expect(captured.querySelector('#sec-quote')).toBeTruthy()
    expect(captured.querySelector('#sec-chips')).toBeTruthy()
    expect(captured.querySelector('#sec-fundamental')).toBeTruthy()
    expect(captured.querySelector('#sec-technical')).toBeTruthy()
    expect(captured.textContent).not.toContain('+NT$58,500') // 未實現損益
    expect(captured.textContent).not.toContain('持股概況')
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

  it('history 只有 2 天時，圖表標題與資料同步（不假裝有 7 天）', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    expect(await screen.findByText('近 2 日買賣超')).toBeTruthy()
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

    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')

    expect(screen.getByText('31.59')).toBeTruthy()
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

    const { container } = render(<StockDetailPage ticker="2609" name="陽明" holding={holding} quote={quote} />)

    // Storage paints first (industry badge) before warm finishes
    await screen.findByText('航運業')
    expect(warmStockCore).toHaveBeenCalledWith('2609', '陽明')
    await waitFor(() => expect(warmStockHistory).toHaveBeenCalledWith('2609', '陽明'))
    await waitFor(() =>
      expect(container.querySelectorAll('#sec-fundamental .data-table tbody tr').length).toBe(12),
    )
  })

  it('月營收已夠長且季報已達 soft min 時不再 warm（其餘交給夜批）', async () => {
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

  it('月營收已滿但季報偏薄時只打 history、不扣 core 額度（其他台股典型）', async () => {
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

    expect(screen.getByText('基本面資料尚未產生')).toBeTruthy()
    // I only read it once: If the warm return has no output, you should not call Storage again.
    expect(fetchFundamental).toHaveBeenCalledTimes(1)
    expect(warmStockHistory).not.toHaveBeenCalled()
  })

  it('查無基本面時標題不出現 badge、分頁顯示空狀態', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')

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

  describe('法人買賣超圖的圖例可切換（0.6.27）', () => {
    /** Foreign capital (excluding self-operated) is CATEGORICAL_COLORS[0]; the bar is filled with this color*/
    const foreignBars = () => document.querySelectorAll('svg rect[fill="#3987e5"]')
    const yTicks = () =>
      [...document.querySelectorAll('#sec-chips svg text')]
        .map((t) => t.textContent ?? '')
        .filter((t) => /^-?[\d,]+$/.test(t))

    /*
      Located by title rather than role + name: the institutional toggle .chip-btn above uses the same words, so
      querying by name would match two buttons (the toggle and the legend).
    */
    const legendToggle = (label: string) =>
      screen.getByTitle(new RegExp(`^(隱藏|顯示)${label.replace(/[()（）]/g, '\\$&')}$`))

    it('點圖例關掉某個法人，縱軸依剩下的重算', async () => {
      const user = userEvent.setup()
      render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
      await screen.findByText('三大法人買賣超')

      // Foreign investors bought more than 3,000 to 5,000 shares in a single day, and the other three companies all bought less than 100 shares.
      expect(foreignBars().length).toBeGreaterThan(0)
      expect(yTicks().some((t) => Number(t.replace(/,/g, '')) >= 4000)).toBe(true)

      await user.click(legendToggle('外資（不含自營）'))
      expect(foreignBars()).toHaveLength(0)
      // The magnitudes of the remaining three are two orders of magnitude smaller, and the value range must be narrowed to see the difference between them.
      expect(yTicks().some((t) => Number(t.replace(/,/g, '')) >= 4000)).toBe(false)

      await user.click(legendToggle('外資（不含自營）'))
      expect(foreignBars().length).toBeGreaterThan(0)
    })

    it('最後一個法人不給關（全部關掉只會剩空座標軸）', async () => {
      const user = userEvent.setup()
      render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
      await screen.findByText('三大法人買賣超')

      for (const label of ['外資（不含自營）', '外資自營商', '投信']) {
        await user.click(legendToggle(label))
      }
      expect(screen.getByTitle('至少要留一條線').hasAttribute('disabled')).toBe(true)
    })
  })

  /*
    0.6.23 briefly made the tables collapsible; a collapsed block is not in the DOM, so exporting produced a PDF
    with the table missing. After 0.6.24 removed collapsing, the capture range is simply "whatever is on screen"
    —— this test holds that line, and incidentally checks that the expand/restore logic added for collapsing left
    nothing behind.
  */
  it('匯出 PDF：擷取的是報價＋籌碼＋基本面＋技術面四段', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} quote={quote} />)
    await screen.findByText('三大法人買賣超')

    fireEvent.click(screen.getByRole('button', { name: /下載 PDF/ }))
    await waitFor(() => expect(generatePdfBlob).toHaveBeenCalled())

    const surface = generatePdfBlob.mock.calls[0][0] as HTMLElement
    expect(surface.querySelector('#sec-quote')).toBeTruthy()
    expect(surface.querySelector('#sec-chips')).toBeTruthy()
    expect(surface.querySelector('#sec-fundamental')).toBeTruthy()
    expect(surface.querySelector('#sec-technical')).toBeTruthy()
    expect(within(surface).getByText('三大法人買賣超')).toBeTruthy()
    // The shared report does not contain personal information: the quotation is public information, and the shareholding figures no longer appear on the entire page.
    expect(surface.textContent).not.toContain('持股概況')

    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), '個股分析-2330-2026-07-23.pdf'),
    )
  })
})
