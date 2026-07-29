// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// 以 mock 取代網路層：這裡驗的是版面與分頁切換，不是抓取邏輯
const { fetchStoredReport, generateReport, fetchDailySeries, fetchFundamental, warmStock } =
  vi.hoisted(() => ({
    fetchStoredReport: vi.fn(),
    generateReport: vi.fn(),
    fetchDailySeries: vi.fn(),
    fetchFundamental: vi.fn(),
    warmStock: vi.fn(),
  }))
vi.mock('../../services/reportProxy', () => ({
  isReportConfigured: true,
  fetchStoredReport,
  generateReport,
}))
vi.mock('../../services/dailyProxy', () => ({ fetchDailySeries }))
vi.mock('../../services/fundamentalProxy', () => ({ fetchFundamental }))
vi.mock('../../services/warmStock', () => ({ warmStock }))

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
  sources: {
    institutional: { date: '2026-07-23', fetchedAt: '2026-07-23T09:40:00.000Z' },
    margin: { date: '2026-07-23', fetchedAt: '2026-07-23T14:10:00.000Z' },
    borrow: { date: '2026-07-24', fetchedAt: '2026-07-23T15:30:00.000Z' },
  },
  notes: [],
}

const holding = { qty: 3000, avgCost: 100.5, price: 120, unrealized: 58500, roi: 0.194 }

/*
 * 0.6.8 起四段併成一頁，全頁的「第 N 個 svg」「第一個 .rpt-section」這種順序假設
 * 全部失效，而且是那種「今天剛好會過、明天加一段就爆」的脆弱寫法。
 * 一律改成以區塊 id 定位（#sec-chips / #sec-fundamental / #sec-technical / #sec-holding）。
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
    warmStock.mockReset()
    fetchStoredReport.mockResolvedValue(report)
    // 預設無日線 / 無基本面（批次尚未跑過）；需要的個案自行覆寫
    fetchDailySeries.mockResolvedValue(null)
    fetchFundamental.mockResolvedValue(null)
    // 預設 warm 也產不出東西（例如 ETF），避免測試意外進入重讀分支
    warmStock.mockResolvedValue({ ok: true, dailySynced: 0, fundamentalSynced: 0 })
  })

  it('Storage 命中時直接顯示籌碼分頁，不呼叫即點即產', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
    expect(await screen.findByText('三大法人買賣超')).toBeTruthy()
    expect(generateReport).not.toHaveBeenCalled()
  })

  it('報告表頭在擷取範圍內，含代號、資料日期與更新時間（PDF 才認得出是哪份報告）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')
    const head = container.querySelector('.detail-card .rpt-head')
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
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')
    expect(container.querySelector('.detail-head')!.textContent).not.toContain('資料日期')
  })

  it('三大法人表格顯示買進 / 賣出 / 買賣超與連買連賣', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
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
    // 融資融券的「連增連減」由前端依 history 計算：fixture 兩天都 +105 / +1，故皆為連 2 增
    const marginTable = within(screen.getAllByRole('table')[1])
    expect(within(marginTable.getByText('融資').closest('tr')!).getByText('連 2 增')).toBeTruthy()
    expect(within(marginTable.getByText('融券').closest('tr')!).getByText('連 2 增')).toBeTruthy()
  })

  it('三大法人表格可切換檢視 7 天中任一天，連買連賣隨之重算', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')

    const rowOf = (label: string) =>
      within(within(screen.getAllByRole('table')[0]).getByText(label).closest('tr')!)
    // 三大法人區塊的說明句（籌碼段內第一個 .rpt-section 的 .hint）
    const caption = () => sec(container, 'chips').querySelector('.rpt-section .hint')!.textContent

    // 預設看最新交易日（07/23）：外資 net +5,000、連 2 買
    expect(caption()).toContain('2026-07-23')
    expect(rowOf('外資（不含自營）').getByText('+5,000')).toBeTruthy()
    expect(rowOf('外資（不含自營）').getByText('連 2 買')).toBeTruthy()

    // 切到前一天（07/22）：net 變 +3,000，連買天數降為 1
    await user.click(screen.getByRole('button', { name: /07\/22/ }))
    expect(caption()).toContain('2026-07-22')
    expect(rowOf('外資（不含自營）').getByText('+3,000')).toBeTruthy()
    expect(rowOf('外資（不含自營）').getByText('連 1 買')).toBeTruthy()
  })

  it('圖表預設並排四個法人，並附色塊圖例（身分不只靠顏色）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')
    const legend = within(container.querySelector('.chart-legend-side')! as HTMLElement)
    for (const label of ['外資（不含自營）', '外資自營商', '投信', '自營商']) {
      expect(legend.getByText(label)).toBeTruthy()
    }
    // 合計不入圖（它就是四項相加，畫進去等於重複計算）
    expect(legend.queryByText('三大法人合計')).toBeNull()
    expect(container.querySelectorAll('.chart-legend-swatch').length).toBe(4)
    // 2 天 × 4 個法人 = 8 根長條
    expect(charts(container, 'chips')[0].querySelectorAll('rect[rx]').length).toBe(8)
  })

  it('切成單一法人時圖例改講紅正綠負（顏色改為表達極性）', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')
    await user.click(screen.getByRole('button', { name: '投信' }))
    const labels = [...container.querySelectorAll('.chart-legend-label')].map((el) => el.textContent)
    expect(labels).toEqual(['買超（買比賣多）', '賣超（賣比買多）'])
    // 單一序列 2 天 = 2 根長條
    expect(charts(container, 'chips')[0].querySelectorAll('rect[rx]').length).toBe(2)
  })

  it('畫出走勢圖（inline SVG，非圖表函式庫）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')
    // 籌碼段：買賣超長條圖 + 融資 / 融券兩張折線圖
    expect(charts(container, 'chips').length).toBe(3)
    expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0)
  })

  it('可切換法人，重畫買賣超長條圖', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')
    const before = charts(container, 'chips')[0]?.innerHTML
    await user.click(screen.getByRole('button', { name: '投信' }))
    const after = charts(container, 'chips')[0]?.innerHTML
    expect(after).not.toBe(before)
  })

  it('四段同時在一頁上，順序為 持股 → 籌碼 → 基本面 → 技術面', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')

    const ids = [...container.querySelectorAll('[id^="sec-"]')].map((el) => el.id)
    expect(ids).toEqual(['sec-holding', 'sec-chips', 'sec-fundamental', 'sec-technical'])
    // 卡片標題也照同一個順序
    const titles = [...container.querySelectorAll('.card-head h3')].map((el) => el.textContent)
    expect(titles).toEqual(['我的持股', '籌碼', '基本面', '技術面'])
  })

  it('持股與技術面各自渲染，不必再切分頁', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')

    const hold = within(sec(container, 'holding'))
    expect(hold.getByText('持股概況')).toBeTruthy()
    expect(hold.getByText('3,000')).toBeTruthy() // 持有股數
    expect(hold.getByText('+NT$58,500')).toBeTruthy() // 未實現淨損益

    // 技術面（fixture 無日線）顯示自己的空狀態，且不影響其他三段
    expect(await within(sec(container, 'technical')).findByText(/這檔還沒有歷史股價/)).toBeTruthy()
    expect(screen.getByText('三大法人買賣超')).toBeTruthy()
  })

  it('只有「分析內容」與「AI 分析」兩個分頁籤', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')
    const tabs = [...container.querySelectorAll('.subtabs .subtab')].map((el) => el.textContent)
    expect(tabs).toEqual(['分析內容', 'AI 分析'])
  })

  it('技術面：有日線時畫出 K 線與均線，並標出指標摘要', async () => {
    // 造 80 根遞增日線，讓 MA60 也有值（少於 60 根就驗不到季線）
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
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')

    await screen.findByText('日 K 與均線')
    // 技術面段：日K、成交量、KD 三張（籌碼段另有 3 張，故必須限定範圍）
    expect(charts(container, 'technical')).toHaveLength(3)
    // 均線圖例（週/月/季線的台股說法要出現，否則只認得其中一種的人看不懂）
    expect(screen.getByText('週線')).toBeTruthy()
    expect(screen.getByText('季線')).toBeTruthy()
    // 摘要取最新一根：收盤 179、一路上漲 → 多頭排列
    const tech = within(sec(container, 'technical'))
    expect(tech.getByText('179')).toBeTruthy()
    expect(tech.getByText(/多頭排列/)).toBeTruthy()
  })

  it('技術面：切到近 3 月時季線仍畫得出來（指標以完整序列計算後才裁切）', async () => {
    // 200 根資料、顯示 60 根。若實作先裁切再算指標，MA60 會整條消失、
    // 圖上就只剩兩條均線 —— 這正是 PLAN 標記為「最容易寫錯」的地方。
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
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')
    await screen.findByText('日 K 與均線')

    await user.click(screen.getByRole('button', { name: '近 3 月' }))
    const kChart = charts(container, 'technical')[0]
    // 三條均線都必須有折線（polyline）；少一條就是 MA60 被裁沒了
    expect(kChart.querySelectorAll('polyline').length).toBeGreaterThanOrEqual(3)
  })

  it('各區塊各自標示資料日與更新時間（三個來源公布時間不同）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')
    const tags = [...sec(container, 'chips').querySelectorAll('.source-tag')].map((el) => el.textContent)
    expect(tags).toHaveLength(3)
    // 三個抓取時間不同 —— 這正是逐區塊標示的理由
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
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
    await screen.findByText('三大法人買賣超')
    expect(screen.getByText(/今日融資融券尚未公布（約 21:00–22:00 才會有）/)).toBeTruthy()
    expect(screen.getByText(/上方的三大法人不受影響/)).toBeTruthy()
    // 不該再出現會被誤解成故障的舊文案
    expect(screen.queryByText(/來源暫時無回應/)).toBeNull()
  })

  it('舊格式報告（schema 2、無 sources）不會炸，只是沒有時間標記', async () => {
    const { sources: _omit, ...legacy } = report
    fetchStoredReport.mockResolvedValue({ ...legacy, schema: 2 })
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')
    expect(sec(container, 'chips').querySelectorAll('.source-tag')).toHaveLength(0)
  })

  it('PDF 擷取範圍含籌碼／基本面／技術面，但不含持股（個資不進匯出檔）', async () => {
    const { container } = render(
      <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
    )
    await screen.findByText('三大法人買賣超')
    expect(screen.getByRole('button', { name: /下載 PDF/ })).toBeTruthy()

    /*
      共用報告一路以來就不含個資，持股數字是前端依交易紀錄算的。
      四段併成一頁之後，唯一擋住它流進匯出檔的就是「持股排在 surfaceRef 之外」——
      這條測試就是釘住那件事，否則哪天有人把持股搬進去也不會有人發現。
      辨識方式：持股段必須不是任何 .detail-stack[ref] 的後代 ——
      實作上 surfaceRef 那層是第二個 .detail-stack。
    */
    const stacks = container.querySelectorAll('.detail-stack')
    const captured = stacks[stacks.length - 1]
    expect(captured.querySelector('#sec-chips')).toBeTruthy()
    expect(captured.querySelector('#sec-fundamental')).toBeTruthy()
    expect(captured.querySelector('#sec-technical')).toBeTruthy()
    expect(captured.querySelector('#sec-holding')).toBeNull()
    expect(captured.textContent).not.toContain('+NT$58,500') // 未實現損益
  })

  it('AI 分析仍是獨立分頁，切過去後長頁四段都不在畫面上', async () => {
    const user = userEvent.setup()
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
    await screen.findByText('三大法人買賣超')
    await user.click(screen.getByRole('button', { name: 'AI 分析' }))
    expect(screen.queryByText('三大法人買賣超')).toBeNull()
    expect(screen.queryByText('持股概況')).toBeNull()
    // AI 分頁沒有報告可擷取，下載 PDF 不出現
    expect(screen.queryByRole('button', { name: /下載 PDF/ })).toBeNull()
  })

  it('Storage 未命中時走即點即產 fallback', async () => {
    fetchStoredReport.mockResolvedValue(null)
    generateReport.mockResolvedValue(report)
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
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
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('格式不符'))
  })

  it('history 只有 2 天時，圖表標題與資料同步（不假裝有 7 天）', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
    expect(await screen.findByText('近 2 日買賣超')).toBeTruthy()
    expect(screen.getByText('近 2 日餘額走勢')).toBeTruthy()
  })

  it('應包含「AI 分析」分頁籤並可點擊切換', async () => {
    const user = userEvent.setup()
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
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

    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
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
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
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
    warmStock.mockResolvedValue({ ok: true, dailySynced: 1, fundamentalSynced: 1 })

    render(<StockDetailPage ticker="2609" name="陽明" holding={holding} />)

    expect(await screen.findByText('航運業')).toBeTruthy()
    expect(warmStock).toHaveBeenCalledWith('2609')
    expect(fetchFundamental).toHaveBeenCalledTimes(2)
  })

  it('warm 產不出基本面（例如 ETF）時不重讀，維持空狀態', async () => {
    warmStock.mockResolvedValue({ ok: true, dailySynced: 1, fundamentalSynced: 0 })

    render(<StockDetailPage ticker="0050" name="元大台灣50" holding={holding} />)
    await screen.findByText('三大法人買賣超')

    expect(screen.getByText('基本面資料尚未產生')).toBeTruthy()
    // 只讀過一次：warm 回報沒產出就不該再打一次 Storage
    expect(fetchFundamental).toHaveBeenCalledTimes(1)
  })

  it('查無基本面時標題不出現 badge、分頁顯示空狀態', async () => {
    render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
    await screen.findByText('三大法人買賣超')

    expect(screen.getByText('基本面資料尚未產生')).toBeTruthy()
    expect(screen.queryByText('半導體業')).toBeNull()
  })

  // 0.6.1 起盤後批次每 15 分鐘輪詢一次，報告會在使用者看著的當下更新。
  // 沒有這組行為的話，開著不動的分頁會一直停在開頁那一刻的快照。
  describe('切回前景時比對報告是否已更新（0.6.2）', () => {
    const fireVisible = async (state: 'visible' | 'hidden' = 'visible') => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }

    it('報告換過一份 → 自動換上新的，不必重新整理', async () => {
      render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
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
        <StockDetailPage ticker="2330" name="台積電" holding={holding} />,
      )
      await screen.findByText('三大法人買賣超')
      const before = container.querySelector('.detail-card .rpt-head')!.textContent

      // 回同一份（不同物件實體，但 generatedAt 相同）
      fetchStoredReport.mockResolvedValue({ ...report })
      await fireVisible()
      await waitFor(() => expect(fetchStoredReport).toHaveBeenCalledTimes(2))

      expect(container.querySelector('.detail-card .rpt-head')!.textContent).toBe(before)
    })

    it('切到背景時不抓（只在使用者真的要看的時候才打 Storage）', async () => {
      render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
      await screen.findByText('三大法人買賣超')
      expect(fetchStoredReport).toHaveBeenCalledTimes(1)

      await fireVisible('hidden')
      expect(fetchStoredReport).toHaveBeenCalledTimes(1)
    })

    it('切回前景時查無 Storage 報告 → 保留畫面上這份，不清空', async () => {
      render(<StockDetailPage ticker="2330" name="台積電" holding={holding} />)
      await screen.findByText('三大法人買賣超')

      fetchStoredReport.mockResolvedValue(null)
      await fireVisible()
      await waitFor(() => expect(fetchStoredReport).toHaveBeenCalledTimes(2))

      expect(screen.getByText('三大法人買賣超')).toBeTruthy()
      expect(screen.getByText(/資料日期 2026-07-23/)).toBeTruthy()
    })
  })
})
