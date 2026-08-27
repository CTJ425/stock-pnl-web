// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchMarketDaily } = vi.hoisted(() => ({ fetchMarketDaily: vi.fn() }))
vi.mock('../../services/marketProxy', () => ({ fetchMarketDaily }))

// TwMarketSection mounts <ForeignTopSection />, which fetches its own snapshot. Stub the service
// boundary so this file keeps testing only TwMarketSection. Without it the section's real
// fetchForeignTop() runs here, and it stays harmless only because vite.config.ts blanks
// VITE_SUPABASE_URL for the whole suite — an unrelated setting this file should not depend on.
const { fetchForeignTop } = vi.hoisted(() => ({ fetchForeignTop: vi.fn() }))
vi.mock('../../services/foreignTopProxy', () => ({ fetchForeignTop }))
fetchForeignTop.mockResolvedValue(null)

// Since 0.9.19 TwMarketSection also mounts <TwIndexToday />, which fetches its own intraday
// series. Stub that boundary for the same reason as the one above: this file tests
// TwMarketSection, and it must not depend on the suite blanking VITE_SUPABASE_URL.
const { fetchIntraday } = vi.hoisted(() => ({ fetchIntraday: vi.fn() }))
vi.mock('../../services/intradayProxy', () => ({ fetchIntraday }))
fetchIntraday.mockResolvedValue(null)

import { TwMarketSection } from './TwMarketSection'
import type { MarketDay } from '../../services/marketProxy'
import { CHART_COLORS } from '../Charts/chartColors'

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

  it('每日成交量表格為 日期×項目：七個日期列（最新在上）、五個指標欄，走勢與統計下沉至頁尾', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      day(`2026-07-${String(i + 1).padStart(2, '0')}`, 8e11, inst(1e9, 5e8)),
    )
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-04T08:30:00.000Z', days: many })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    const table = container.querySelector<HTMLElement>('table[aria-label="每日成交量"]')!
    expect(table.classList.contains('inst-matrix')).toBe(true)

    // Seven daily rows in tbody (newest to oldest)
    expect(turnoverRows(container)).toHaveLength(7)
    expect(screen.queryByRole('button', { name: /顯示全部/ })).toBeNull()

    const heads = [...table.querySelectorAll('thead th')].map((e) => e.textContent)
    expect(heads).toEqual([
      '日期',
      '成交金額（億元）',
      '成交股數（億股）',
      '成交筆數（萬筆）',
      '加權指數',
      '指數漲跌',
    ])

    const rows = [...turnoverRows(container)]
    // First row is the newest date (07/30), last is 07/24
    expect(rows[0].querySelector('td')!.textContent).toBe('07/30')
    expect(rows[6].querySelector('td')!.textContent).toBe('07/24')
  })

  it('每日成交量表格計算：金額/股數/筆數/指數計算 7 日日均值，漲跌計算 7 日累計淨漲跌', async () => {
    const days = [
      day('2026-07-24', 8e11, null),
      day('2026-07-25', 9e11, null),
      day('2026-07-26', 1e12, null),
      day('2026-07-27', 7e11, null),
      day('2026-07-28', 8e11, null),
      day('2026-07-29', 8.5e11, null),
      day('2026-07-30', 8.8e11, null),
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-04T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    const table = container.querySelector<HTMLElement>('table[aria-label="每日成交量"]')!
    const rows = [...turnoverRows(container)]

    // First row (newest: 07/30): 8800.0 億
    const firstRowCells = [...rows[0].querySelectorAll('td')].map((td) => td.textContent)
    expect(firstRowCells[0]).toBe('07/30')
    expect(firstRowCells[1]).toBe('8800.0 億')

    // Seventh row (oldest: 07/24): 8000.0 億
    const lastRowCells = [...rows[6].querySelectorAll('td')].map((td) => td.textContent)
    expect(lastRowCells[0]).toBe('07/24')
    expect(lastRowCells[1]).toBe('8000.0 億')

    // tfoot 7 日統計 row
    const footCells = [...table.querySelectorAll('tfoot td')].map((td) => td.textContent)
    expect(footCells[0]).toBe('7 日統計')
    // 7 日均量: (8000 + 9000 + 10000 + 7000 + 8000 + 8500 + 8800) / 7 = 8471.4 億
    expect(footCells[1]).toContain('8471.4 億')
    // 7 日累計漲跌: 266.66 * 7 = +1866.62
    expect(footCells[5]).toContain('+1866.62')
    expect(table.querySelectorAll('tfoot .mac-spark')).toHaveLength(5)
  })

  it('成交股數與筆數缺料時給「—」，不用 0 冒充', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [{ ...day('2026-08-04', 8e11, null), tradeVolumeShares: null, transactions: null }],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    const rows = [...turnoverRows(container)]
    const cells = [...rows[0].querySelectorAll('td')].map((td) => td.textContent)
    expect(cells[0]).toBe('08/04')
    expect(cells[2]).toBe('—') // 成交股數
    expect(cells[3]).toBe('—') // 成交筆數

    const footCells = [...container.querySelectorAll('table[aria-label="每日成交量"] tfoot td')].map(
      (td) => td.querySelector('div')?.textContent ?? td.textContent,
    )
    expect(footCells[2]).toBe('—') // 7 日統計股數
    expect(footCells[3]).toBe('—') // 7 日統計筆數
  })

  it('三大法人買賣超為 日期×單位：七個日期列、六個單位欄，沒有任何展開狀態', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      day(`2026-07-${String(i + 1).padStart(2, '0')}`, 8e11, inst(1e9, 5e8)),
    )
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-04T08:30:00.000Z', days: many })
    const { container } = render(<TwMarketSection />)

    await screen.findByText(/三大法人買賣超（億元）・近 7 個交易日/)
    // Seven days in tbody
    expect(instRows(container)).toHaveLength(7)
    expect(screen.queryByRole('button', { name: /全部展開|全部收起/ })).toBeNull()

    const heads = [...instTable(container).querySelectorAll('thead th')].map((e) => e.textContent)
    expect(heads).toEqual([
      '日期',
      '外資',
      '外資自營商',
      '投信',
      '自營商（自行）',
      '自營商（避險）',
      '合計',
    ])
  })

  it('列為日期、末欄合計；缺料的那天給「—」而不是把整列變空', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        day('2026-08-04', 1_087_045_875_836, null),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const rows = [...instRows(container)]
    // First row: 08/04 (not yet filled) -> shows "—"
    expect(rows[0].querySelector('td')!.textContent).toBe('08/04')
    expect([...rows[0].querySelectorAll('td.num')].map((td) => td.textContent)).toEqual([
      '—',
      '—',
      '—',
      '—',
      '—',
      '—',
    ])

    // Second row: 08/03 (filled)
    expect(rows[1].querySelector('td')!.textContent).toBe('08/03')
    expect(rows[1].querySelectorAll('td.num')[0].textContent).toBe('-191.9 億') // 外資
    expect(rows[1].querySelectorAll('td.num')[5].textContent).toBe('-165.2 億') // 合計
  })

  it('買進／賣出改用口徑切換，不再常駐兩個欄位', async () => {
    const user = userEvent.setup()
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 8e11, inst(-1.65e10, -1.9e10)),
        day('2026-08-04', 8e11, instFull(1.445e10, 1.127e10)),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const rows = () => [...instRows(container)]
    // Row 0 is 08/04, Row 1 is 08/03
    // Default 買賣超:
    expect(rows()[0].querySelectorAll('td.num')[0].textContent).toBe('+112.7 億')
    expect(rows()[0].querySelectorAll('td.num')[0].className).toContain('pnl-up')
    expect(rows()[1].querySelectorAll('td.num')[0].textContent).toBe('-190.0 億')

    await user.click(screen.getByRole('button', { name: '買進' }))
    expect(screen.getByText(/三大法人買進（億元）/)).toBeTruthy()
    // 08/04 gross buy is 3500.0 億
    expect(rows()[0].querySelectorAll('td.num')[0].textContent).toBe('3500.0 億')
    expect(rows()[0].querySelectorAll('td.num')[0].className).not.toContain('pnl-')

    await user.click(screen.getByRole('button', { name: '賣出' }))
    expect(rows()[0].querySelectorAll('td.num')[0].textContent).toBe('3387.3 億')

    await user.click(screen.getByRole('button', { name: '買賣超' }))
    expect(rows()[0].querySelectorAll('td.num')[0].textContent).toBe('+112.7 億')
  })

  it('走勢：連續天數屬於合計，且讀滿 15 日不受表格 7 欄的限制', async () => {
    // 10 consecutive days of overbuying
    const days = Array.from({ length: 10 }, (_, i) =>
      day(`2026-08-${String(i + 1).padStart(2, '0')}`, 8e11, inst(1e9 * (i + 1), 1e9)),
    )
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-10T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    expect(instTable(container).textContent).toContain('連 10 買')
  })

  it('走勢：轉向當天不算連續', async () => {
    const days = [
      day('2026-08-01', 8e11, inst(-3e9, -1e9)),
      day('2026-08-02', 8e11, inst(-2e9, -1e9)),
      day('2026-08-03', 8e11, inst(5e9, 1e9)), // 合計由賣超轉買超
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-03T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const footCells = instTable(container).querySelectorAll('tfoot td')
    const totalCell = footCells[footCells.length - 1]
    // 合計 turned today -> not a streak (streak < 2)
    expect(totalCell.textContent).not.toContain('連 ')
    expect(instTable(container).querySelectorAll('tfoot .mac-spark')).toHaveLength(6)
  })

  it('底色深淺以「該單位自己」的最大值為準，小額單位才看得出自己的大日子', async () => {
    const custom = (date: string, foreign: number, trust: number) =>
      day(date, 8e11, {
        foreignTwd: foreign,
        foreignDealerTwd: 0,
        trustTwd: trust,
        dealerSelfTwd: 0,
        dealerHedgeTwd: 0,
        totalTwd: foreign + trust,
        buy: null,
        sell: null,
      })
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [custom('2026-08-03', 1e11, 1e9), custom('2026-08-04', 1e10, 1e10)],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const rows = [...instRows(container)]
    // Row 0 is 08/04, Row 1 is 08/03
    const cell = (r: number, c: number) => rows[r].querySelectorAll('td.num')[c] as HTMLElement
    // Both are +100.0 億, but for 投信 (col index 2) it is its biggest day on 08/04 (row 0), for 外資 (col index 0) it is its smallest
    expect(cell(0, 0).textContent).toBe('+100.0 億') // 08/04 外資
    expect(cell(0, 2).textContent).toBe('+100.0 億') // 08/04 投信
    const pct = (e: HTMLElement) => Number(/([\d.]+)%/.exec(e.style.background)![1])
    expect(pct(cell(0, 2))).toBeGreaterThan(pct(cell(0, 0)))
  })

  it('抓取週期不寫在卡片上，班次常數只有後台一份（0.6.33）', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [day('2026-08-04', 8e11, inst(1e9, 1e9))],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    expect(container.textContent).not.toContain('15:00')
    expect(container.textContent).not.toContain('21:00')
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
    const wraps = container.querySelectorAll('.chart-wrap')
    expect(wraps).toHaveLength(3)
    expect(container.querySelectorAll('.chart-pair')).toHaveLength(0)

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
    expect(screen.getByText('加權指數日 K（近 1 個交易日）')).toBeTruthy()
    for (const wrap of container.querySelectorAll('.chart-wrap')) {
      expect(wrap.querySelectorAll('rect[fill="transparent"]')).toHaveLength(2)
    }
  })

  it('走勢：三大法人統計欄有各單位的走勢波折圖，且首欄凍結以免橫捲後讀到無名的數字', async () => {
    const days = [
      day('2026-08-01', 8e11, inst(-3e9, -1e9)),
      day('2026-08-02', 8e11, inst(-2e9, -1e9)),
      day('2026-08-03', 8e11, inst(5e9, 1e9)),
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-03T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const sparks = instTable(container).querySelectorAll('tfoot .mac-spark')
    expect(sparks).toHaveLength(6)
    expect(instTable(container).className).toContain('inst-matrix')
  })

  it('走勢欄：每日成交量呈現金額/股數/筆數之增減與指數上漲/下跌 Streak 標籤，且折線圖帶有紅綠趨勢色', async () => {
    const days = [
      { ...day('2026-08-01', 7e11, null), tradeVolumeShares: 10e8, transactions: 20e4, changePoints: 100 },
      { ...day('2026-08-02', 8e11, null), tradeVolumeShares: 12e8, transactions: 25e4, changePoints: 150 },
      { ...day('2026-08-03', 9e11, null), tradeVolumeShares: 14e8, transactions: 30e4, changePoints: 200 },
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-03T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    const table = container.querySelector<HTMLElement>('table[aria-label="每日成交量"]')!
    // Taiex row has positive change: all 3 days positive
    expect(table.textContent).toContain('連 3 日上漲')
    expect(table.textContent).toContain('連 2 日增量')
    expect(table.textContent).toContain('連 2 日增筆')
    const sparks = table.querySelectorAll('tfoot .mac-spark')
    expect(sparks).toHaveLength(5)
    const polylineColors = [...sparks].map((s) => s.querySelector('polyline')?.getAttribute('stroke'))
    expect(polylineColors[0]).toBe(CHART_COLORS.up) // 成交金額
    expect(polylineColors[1]).toBe(CHART_COLORS.up) // 成交股數
    expect(polylineColors[2]).toBe(CHART_COLORS.up) // 成交筆數
    expect(polylineColors[3]).toBe(CHART_COLORS.up) // 加權指數
  })

  it('指數漲跌儲存格套用熱力底色與紅綠色彩', async () => {
    const days = [
      { ...day('2026-08-01', 8e11, null), changePoints: 100 },
      { ...day('2026-08-02', 8e11, null), changePoints: -50 },
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-02T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    const rows = [...turnoverRows(container)]
    // Row 0 is 08/02 (-50), Row 1 is 08/01 (+100). Col index 5 is 指數漲跌.
    const cell0802 = rows[0].querySelectorAll('td')[5]
    const cell0801 = rows[1].querySelectorAll('td')[5]
    expect(cell0802.className).toContain('pnl-down')
    expect(cell0802.style.backgroundColor).toBeTruthy()
    expect(cell0801.className).toContain('pnl-up')
    expect(cell0801.style.backgroundColor).toBeTruthy()
  })

  it('成交金額/股數/筆數/指數依據相較前一交易日之增減套用紅綠與熱力底色', async () => {
    const days = [
      {
        ...day('2026-08-01', 7e11, null),
        tradeVolumeShares: 1e10,
        transactions: 3e6,
        taiex: 22000,
      },
      {
        ...day('2026-08-02', 8e11, null), // amount up (+1000億), shares down (-20億股), txns up (+50萬), taiex up (+100)
        tradeVolumeShares: 8e9,
        transactions: 3.5e6,
        taiex: 22100,
        changePoints: 100,
      },
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-02T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    const rows = [...turnoverRows(container)]
    // Row 0 is 08/02
    const cells0802 = rows[0].querySelectorAll('td')
    expect(cells0802[1].className).toContain('pnl-up') // 成交金額 +1000億
    expect(cells0802[1].style.backgroundColor).toBeTruthy()

    expect(cells0802[2].className).toContain('pnl-down') // 成交股數 -20億股
    expect(cells0802[2].style.backgroundColor).toBeTruthy()

    expect(cells0802[3].className).toContain('pnl-up') // 成交筆數 +50萬
    expect(cells0802[3].style.backgroundColor).toBeTruthy()

    expect(cells0802[4].className).toContain('pnl-up') // 加權指數 +100
    expect(cells0802[4].style.backgroundColor).toBeTruthy()
  })

  it('查無資料時顯示空狀態，不是一片空白', async () => {
    fetchMarketDaily.mockResolvedValue(null)
    render(<TwMarketSection />)
    await waitFor(() => expect(screen.getByText(/市場資料尚未產生/)).toBeTruthy())
  })
})

/**
 * The 當日大盤 panel (0.9.19) sits above everything already on the tab. The order carries
 * meaning: the panel describes today, while the KPI cards and the candle chart describe the
 * latest complete trading day — and today's row only lands in market/daily.json about 90
 * minutes after the close (measured 2026-08-26: asOf 15:00 for a 13:30 close). Newest first
 * is what stops the two timeframes from reading as one.
 */
describe('TwMarketSection — 當日大盤 panel', () => {
  afterEach(() => {
    cleanup()
    fetchMarketDaily.mockReset()
    fetchIntraday.mockReset()
  })

  const intraday = () => ({
    symbol: '^TWII',
    range: '1d' as const,
    interval: '1m' as const,
    prevClose: 45169.46,
    dayOpen: 45157.64,
    dayHigh: 45878.39,
    dayLow: 44925.84,
    points: [
      { t: 1787702400, c: 45044.2, v: 0 },
      { t: 1787702460, c: 45832.62, v: 0 },
    ],
  })

  it('KPI 卡整併進當日大盤面板，頁面上不再有獨立的 kpi-grid', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-26T07:00:00.000Z',
      days: [
        day('2026-08-25', 8.1e11, instFull(5.2e10, 3.1e10)),
        day('2026-08-26', 8.36e11, instFull(5.93e10, 3.65e10)),
      ],
    })
    fetchIntraday.mockResolvedValue(intraday())

    const { container } = render(<TwMarketSection />)

    const panel = await screen.findByTestId('tw-index-today')
    expect(container.querySelector('.kpi-grid')).toBeNull()

    // The three surviving KPI values moved inside the panel rather than disappearing.
    const kpis = [...container.querySelectorAll('.kpi-value')]
    expect(kpis.length).toBeGreaterThan(0)
    expect(kpis.every((e) => panel.contains(e))).toBe(true)
  })

  it('當日大盤取不到資料時，既有區塊照常顯示', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-26T07:00:00.000Z',
      days: [day('2026-08-26', 8.36e11, instFull(5.93e10, 3.65e10))],
    })
    fetchIntraday.mockResolvedValue(null)

    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    expect(container.querySelectorAll('.kpi-value').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })
})

/**
 * 自營商 in the panel's aside is the sum of the self and hedge legs. `market/daily.json` can
 * land one leg before the other, and this project's rule — stated in TwIndexToday.tsx — is
 * "'—' for a value the day has not produced yet, never a guessed 0". Summing a single leg
 * would print a confident wrong 自營商 number instead of admitting the gap.
 */
describe('TwMarketSection — 側欄自營商合計', () => {
  // An earlier describe's afterEach resets the shared fetchIntraday mock, which drops the
  // module-level mockResolvedValue and makes TwIndexToday's load() call .then() on undefined.
  beforeEach(() => {
    fetchIntraday.mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
    fetchMarketDaily.mockReset()
  })

  const dealerCell = (c: HTMLElement) => {
    const card = c.querySelector<HTMLElement>('.inst-day-card')!
    const cells = [...card.querySelectorAll<HTMLElement>('.inst-leg-cell')]
    const dealer = cells.find((el) => el.querySelector('.inst-leg-k')?.textContent === '自營商')!
    return dealer.querySelector('.inst-leg-v')?.textContent
  }

  const withDealer = (self: number | null, hedge: number | null) => ({
    asOf: '2026-08-04T08:30:00.000Z',
    days: [
      day('2026-08-04', 8e11, {
        ...inst(1e10, 5e9),
        dealerSelfTwd: self,
        dealerHedgeTwd: hedge,
      }),
    ],
  })

  it('兩腳都落地時才相加', async () => {
    fetchMarketDaily.mockResolvedValue(withDealer(-1e8, -2e8))
    const { container } = render(<TwMarketSection />)

    await waitFor(() => expect(container.querySelector('.inst-day-card')).toBeTruthy())
    expect(dealerCell(container)).toBe('-3.0 億')
  })

  it('只有一腳落地時顯示「—」，不把缺的那腳當 0', async () => {
    fetchMarketDaily.mockResolvedValue(withDealer(-1e8, null))
    const { container } = render(<TwMarketSection />)

    await waitFor(() => expect(container.querySelector('.inst-day-card')).toBeTruthy())
    expect(dealerCell(container)).toBe('—')
  })
})
