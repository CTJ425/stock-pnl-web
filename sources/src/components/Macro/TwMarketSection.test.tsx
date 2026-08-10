// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchMarketDaily } = vi.hoisted(() => ({ fetchMarketDaily: vi.fn() }))
vi.mock('../../services/marketProxy', () => ({ fetchMarketDaily }))

import { TwMarketSection } from './TwMarketSection'
import type { MarketDay } from '../../services/marketProxy'

const side = (total: number, foreign: number) => ({
  foreignTwd: foreign,
  foreignDealerTwd: 0,
  trustTwd: 5e8,
  dealerSelfTwd: -1e8,
  dealerHedgeTwd: -2e8,
  totalTwd: total,
})

/** There is no buy/sell function by default (simulating the old data added before 0.6.32); you need to test it carefully and add it yourself*/
const inst = (total: number, foreign: number) => ({
  ...side(total, foreign),
  buy: null,
  sell: null,
})

/** A day with buy/sell details*/
const instFull = (total: number, foreign: number) => ({
  ...side(total, foreign),
  buy: side(4e11, 3.5e11),
  sell: side(4e11 - total, 3.5e11 - foreign),
})

const day = (date: string, value: number, institutional: MarketDay['institutional']): MarketDay => ({
  date,
  tradeVolumeShares: 11_000_000_000,
  tradeValueTwd: value,
  transactions: 4_000_000,
  taiex: 43386.41,
  changePoints: 266.66,
  taiexOpen: 42780.42,
  taiexHigh: 43784.19,
  taiexLow: 42780.42,
  institutional,
})

/*
  Two `.data-table`s live on this card since 0.6.38 (每日成交量 first, then 三大法人買賣超), so every selector has
  to say which one it means —— an unscoped `.data-table tbody tr` silently returns both tables' rows.
*/
const instTable = (c: HTMLElement) =>
  c.querySelector<HTMLElement>('table[aria-label="三大法人買賣超"]')!
const instRows = (c: HTMLElement) => instTable(c).querySelectorAll('tbody tr')
const turnoverRows = (c: HTMLElement) =>
  c.querySelector<HTMLElement>('table[aria-label="每日成交量"]')!.querySelectorAll('tbody tr')

describe('TwMarketSection', () => {
  afterEach(() => {
    cleanup()
    fetchMarketDaily.mockReset()
  })

  it('金額一律換算成億元顯示（來源是元，直接印沒有人讀得懂）', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        day('2026-08-04', 1_087_045_875_836, inst(23_000_000_000, 12_000_000_000)),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    // The same number will also appear in the daily table below, so it is limited to KPI block comparison.
    const kpis = () => [...container.querySelectorAll('.kpi-value')].map((e) => e.textContent)
    // 1,087,045,875,836 yuan = 1,087.05 billion
    expect(kpis()).toContain('10870.5 億')
    // The buying and selling super has a positive and negative sign, the direction must be seen
    expect(kpis()).toContain('+230.0 億')
    expect(kpis()).toContain('+120.0 億')
  })

  it('最新一天還沒補到法人金額時，退回最近一筆有的並說明是哪一天', async () => {
    // The legal person amount is not announced until about 15:00–15:30 and is replenished daily. There will be a shortage in the hours just after the market closes.
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        day('2026-08-04', 1_087_045_875_836, null),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByText('2026-08-03 全市場合計')

    const kpis = [...container.querySelectorAll('.kpi-value')].map((e) => e.textContent)
    expect(kpis).toContain('-165.2 億')
    // The transaction amount is still the latest day
    expect(kpis).toContain('10870.5 億')
  })

  it('開高低還沒補到的日子不畫 K 線，不用收盤價冒充（會變成一排十字線）', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        { ...day('2026-08-04', 1_087_045_875_836, null), taiexOpen: null, taiexHigh: null, taiexLow: null },
      ],
    })
    render(<TwMarketSection />)
    // The title will indicate how many roots were actually drawn.
    expect(await screen.findByText('加權指數日 K（近 1 個交易日）')).toBeTruthy()
  })

  it('每日成交量表格：股數與金額並列，預設 7 列可展開全部（0.6.38）', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 30 }, (_, i) =>
      day(`2026-07-${String(i + 1).padStart(2, '0')}`, 8e11, inst(1e9, 5e8)),
    )
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-04T08:30:00.000Z', days: many })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    expect(turnoverRows(container)).toHaveLength(7)
    // Newest first, opposite to the charts above
    expect(turnoverRows(container)[0].textContent).toContain('2026-07-30')

    const cells = [...turnoverRows(container)[0].querySelectorAll('td')].map((td) => td.textContent)
    // 11,000,000,000 shares → 110.0 億股; 8e11 元 → 8000.0 億; 4,000,000 筆 → 400.0 萬
    expect(cells[1]).toBe('110.0 億股')
    expect(cells[2]).toBe('8000.0 億')
    expect(cells[3]).toBe('400.0 萬')
    expect(cells[5]).toBe('+266.66')

    await user.click(screen.getByRole('button', { name: /顯示全部 30 日/ }))
    expect(turnoverRows(container)).toHaveLength(30)
  })

  it('成交股數與筆數缺料時給「—」，不用 0 冒充（0.6.38）', async () => {
    // Days written before these columns existed read back as undefined, not null
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [{ ...day('2026-08-04', 8e11, null), tradeVolumeShares: null, transactions: null }],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    const cells = [...turnoverRows(container)[0].querySelectorAll('td')].map((td) => td.textContent)
    expect(cells[1]).toBe('—')
    expect(cells[3]).toBe('—')
    // The amount is still there, so a missing column must not blank the whole row
    expect(cells[2]).toBe('8000.0 億')
  })

  it('法人只看最近 7 個交易日（與個股籌碼一致）', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      day(`2026-07-${String(i + 1).padStart(2, '0')}`, 8e11, inst(1e9, 5e8)),
    )
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-04T08:30:00.000Z', days: many })
    const { container } = render(<TwMarketSection />)

    await screen.findByText(/三大法人買賣超（億元）・近 7 個交易日/)
    // 0.6.33 After removing the bar chart, the 7-day window is represented by a table (the two index charts and transaction amounts above are still 30 days)
    expect(instRows(container)).toHaveLength(7)
  })

  it('逐日買賣超表格：由新到舊，五個法人分欄，缺料給「—」', async () => {
    // You can see the direction in the chart, and you can see the numbers in the table (users reported that the amount in days is not visible in the bar chart)
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        day('2026-08-04', 1_087_045_875_836, null),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const rows = instRows(container)
    expect(rows).toHaveLength(2)
    // The table is from new to old (the picture is from old to new, the two are deliberately opposite)
    expect(rows[0].textContent).toContain('2026-08-04')
    // The legal person amount has not been paid on the latest day → The six legal person columns should be filled with "—", do not pretend to be 0
    // (The last two td.num are trend and continuity. If there is no total on that day, there will be no trend. The same is "-")
    expect([...rows[0].querySelectorAll('td.num')].map((td) => td.textContent)).toEqual(
      Array(8).fill('—'),
    )
    // Data available the day before: foreign investment −19.19 billion, investment credit +500 million, total −16.52 billion
    const prev = [...rows[1].querySelectorAll('td.num')].map((td) => td.textContent)
    expect(prev[0]).toBe('-191.9 億')
    expect(prev[2]).toBe('+5.0 億')
    expect(prev[5]).toBe('-165.2 億')
  })

  it('有買賣明細的列預設展開，可見六單位買進／賣出；舊資料無展開鈕（0.7.1-dev.1）', async () => {
    const user = userEvent.setup()
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 8e11, inst(-1.65e10, -1.9e10)), // 舊資料：只有差額
        day('2026-08-04', 8e11, instFull(1.445e10, 1.127e10)), // 有買賣明細
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    // Default open (0.7.1-dev.1): buy/sell visible without an extra click
    expect(container.querySelectorAll('.detail-row')).toHaveLength(1)
    const collapseBtn = screen.getByRole('button', { name: /收合 2026-08-04 的買進賣出明細/ })
    expect(collapseBtn).toBeTruthy()
    // Old row has no toggle
    expect(screen.queryByRole('button', { name: /2026-08-03 的買進賣出明細/ })).toBeNull()

    const detail = container.querySelector('.detail-row')!
    expect(detail.textContent).toContain('2026-08-04 明細')
    const unitRows = detail.querySelectorAll('tbody > tr')
    expect(unitRows).toHaveLength(6)
    const cells = [...unitRows[0].querySelectorAll('td')].map((td) => td.textContent)
    // Foreign capital: buying 350 billion, selling 3500−112.7 = 338.73 billion, buying and selling exceeding +11.27 billion
    expect(cells).toEqual(['外資', '3500.0 億', '3387.3 億', '+112.7 億'])

    await user.click(collapseBtn)
    expect(container.querySelectorAll('.detail-row')).toHaveLength(0)
  })

  it('趨勢欄：連續同向天數，且走勢不受表格只顯示 7 列的限制（0.6.32）', async () => {
    // 10 consecutive days of overbuying - the table only lists the last 7 days, but the trend must last for 10 days
    const days = Array.from({ length: 10 }, (_, i) =>
      day(`2026-08-${String(i + 1).padStart(2, '0')}`, 8e11, inst(1e9 * (i + 1), 1e9)),
    )
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-10T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const rows = instRows(container)
    expect(rows).toHaveLength(7)
    // The latest column (8/10): even the 10th day of overbuying, the 3 days outside the table are also included.
    expect(rows[0].textContent).toContain('連 10 日買超')
    // The oldest column (8/04) is day 4
    expect(rows[6].textContent).toContain('連 4 日買超')
  })

  it('趨勢欄：轉向當天不算連續，走勢線畫得出來', async () => {
    const days = [
      day('2026-08-01', 8e11, inst(-3e9, -1e9)),
      day('2026-08-02', 8e11, inst(-2e9, -1e9)),
      day('2026-08-03', 8e11, inst(5e9, 1e9)), // 由賣超轉買超
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-03T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const rows = instRows(container)
    // There is only 1 day in the same direction on the turning day → Do not print "N days in a row" (1 day in a row is not a trend)
    expect(rows[0].textContent).not.toContain('連')
    // The day before was the second consecutive day of overselling.
    expect(rows[1].textContent).toContain('連 2 日賣超')
    // Three points draw a trend line
    expect(instTable(container).querySelectorAll('.mac-spark').length).toBeGreaterThan(0)
  })

  it('抓取週期不寫在卡片上，班次常數只有後台一份（0.6.33）', async () => {
    // The card's own shift will inevitably drift with pg_cron - the actual drift (the backend is already 15 when writing "up to 5 days")
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [day('2026-08-04', 8e11, inst(1e9, 1e9))],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })
    expect(screen.queryByText(/抓取週期/)).toBeNull()
    expect(container.textContent).not.toContain('market-daily')
    // The sentence you replaced still needs to be clear about what "—" stands for.
    expect(screen.getByText(/還沒補到，不是沒有進出/)).toBeTruthy()
  })

  it('三張圖上中下疊放，滑到某一天時三張一起給出那天的提示（0.6.34）', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        day('2026-08-04', 1_087_045_875_836, inst(23_000_000_000, 12_000_000_000)),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByText('加權指數走勢（收盤）')
    // The legal person bar chart has been removed, leaving K-line/index trend/transaction amount; the side-by-side .chart-pair has been removed
    const wraps = container.querySelectorAll('.chart-wrap')
    expect(wraps).toHaveLength(3)
    expect(container.querySelectorAll('.chart-pair')).toHaveLength(0)

    // The first day when you slide to the bottom picture (transaction amount) → point to all three pictures 08/03
    const hits = wraps[2].querySelectorAll('rect[fill="transparent"]')
    fireEvent.mouseEnter(hits[0])
    const tips = [...container.querySelectorAll('.chart-tip')].map((e) => e.textContent)
    expect(tips).toHaveLength(3)
    for (const t of tips) expect(t).toContain('08/03')
  })

  it('開高低沒補到的日子仍佔一欄——過濾掉會讓三張圖的索引錯開（0.6.34）', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        { ...day('2026-08-03', 8e11, inst(-1.6e10, -1.9e10)), taiexOpen: null },
        day('2026-08-04', 1e12, inst(2.3e10, 1.2e10)),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByText('加權指數走勢（收盤）')
    // Only one line can be drawn, but the hit fields in the three pictures are still two columns.
    expect(screen.getByText('加權指數日 K（近 1 個交易日）')).toBeTruthy()
    for (const wrap of container.querySelectorAll('.chart-wrap')) {
      expect(wrap.querySelectorAll('rect[fill="transparent"]')).toHaveLength(2)
    }
  })

  it('全部展開 / 全部收起：只認展得開的列（0.6.33）；載入後預設已展開', async () => {
    const user = userEvent.setup()
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 8e11, inst(-1.65e10, -1.9e10)), // 舊資料，沒有明細
        day('2026-08-04', 8e11, instFull(1.445e10, 1.127e10)),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    // Default open for the one expandable day
    expect(container.querySelectorAll('.detail-row')).toHaveLength(1)
    const collapse = screen.getByRole('button', { name: /全部收起/ })

    await user.click(collapse)
    expect(container.querySelectorAll('.detail-row')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /全部展開/ }))
    expect(container.querySelectorAll('.detail-row')).toHaveLength(1)
  })

  it('趨勢與連續分成兩欄，走勢線才不會被標籤推歪（0.6.33）', async () => {
    const days = [
      day('2026-08-01', 8e11, inst(-3e9, -1e9)),
      day('2026-08-02', 8e11, inst(-2e9, -1e9)),
      day('2026-08-03', 8e11, inst(5e9, 1e9)), // 轉買超，連 1 日不算趨勢
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-03T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })
    expect(screen.getByRole('columnheader', { name: '連續' })).toBeTruthy()

    const rows = instRows(container)
    const cells = (r: Element) => [...r.querySelectorAll('td.num')]
    // The last two grids are fixed to be trend and continuity: the trend line is only in the trend grid, and the text is only in the continuous grid.
    const top = cells(rows[0])
    expect(top[top.length - 2].querySelector('svg')).toBeTruthy()
    expect(top[top.length - 1].querySelector('svg')).toBeNull()
    // Turn to the current day and then 1 day → leave "-" in the continuous column instead of leaving it blank
    expect(top[top.length - 1].textContent).toBe('—')

    const prev = cells(rows[1])
    expect(prev[prev.length - 1].textContent).toBe('連 2 日賣超')
    expect(prev[prev.length - 2].querySelector('svg')).toBeTruthy()
  })

  it('查無資料時顯示空狀態，不是一片空白', async () => {
    fetchMarketDaily.mockResolvedValue(null)
    render(<TwMarketSection />)
    await waitFor(() => expect(screen.getByText(/市場資料尚未產生/)).toBeTruthy())
  })
})
