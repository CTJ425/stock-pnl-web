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

  it('每日成交量矩陣為 項目×日期：五列固定、七個日期欄，由舊至新排列', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      day(`2026-07-${String(i + 1).padStart(2, '0')}`, 8e11, inst(1e9, 5e8)),
    )
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-04T08:30:00.000Z', days: many })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    const table = container.querySelector<HTMLElement>('table[aria-label="每日成交量"]')!
    expect(table.classList.contains('inst-matrix')).toBe(true)

    // Five metric rows, always
    expect(turnoverRows(container)).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /顯示全部/ })).toBeNull()

    const heads = [...table.querySelectorAll('thead th')].map((e) => e.textContent)
    // 項目 + 7 days + 統計 + 走勢. Oldest → newest, matching the charts above.
    expect(heads).toEqual([
      '項目',
      '07/24',
      '07/25',
      '07/26',
      '07/27',
      '07/28',
      '07/29',
      '07/30',
      '7 日統計',
      '近 15 日走勢',
    ])

    const rows = [...turnoverRows(container)]
    expect(rows.map((r) => r.querySelector('td')!.textContent)).toEqual([
      '成交金額',
      '成交股數',
      '成交筆數',
      '加權指數',
      '指數漲跌',
    ])
  })

  it('每日成交量矩陣計算：金額/股數/筆數/指數計算 7 日日均值，漲跌計算 7 日累計淨漲跌', async () => {
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

    const rows = [...turnoverRows(container)]
    // First row: 成交金額
    const amountCells = [...rows[0].querySelectorAll('td')].map((td) => td.textContent)
    expect(amountCells[0]).toBe('成交金額')
    expect(amountCells[1]).toBe('8000.0 億') // 07/24
    expect(amountCells[7]).toBe('8800.0 億') // 07/30
    // 7 日均量: (8000 + 9000 + 10000 + 7000 + 8000 + 8500 + 8800) / 7 = 8471.4 億
    expect(amountCells[8]).toBe('8471.4 億')

    // Fifth row: 指數漲跌
    const changeCells = [...rows[4].querySelectorAll('td')].map((td) => td.textContent)
    expect(changeCells[0]).toBe('指數漲跌')
    expect(changeCells[1]).toBe('+266.66')
    // 7 日累計漲跌: 266.66 * 7 = +1866.62
    expect(changeCells[8]).toBe('+1866.62')
  })

  it('成交股數與筆數缺料時給「—」，不用 0 冒充', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [{ ...day('2026-08-04', 8e11, null), tradeVolumeShares: null, transactions: null }],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    const rows = [...turnoverRows(container)]
    const sharesCells = [...rows[1].querySelectorAll('td')].map((td) => td.textContent)
    const txCells = [...rows[2].querySelectorAll('td')].map((td) => td.textContent)
    expect(sharesCells[0]).toBe('成交股數')
    expect(sharesCells[1]).toBe('—')
    expect(sharesCells[2]).toBe('—') // 7 日統計
    expect(txCells[0]).toBe('成交筆數')
    expect(txCells[1]).toBe('—')
    expect(txCells[2]).toBe('—') // 7 日統計
  })

  it('矩陣為 單位×日期：六列固定、七個日期欄，沒有任何展開狀態（0.7.6）', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      day(`2026-07-${String(i + 1).padStart(2, '0')}`, 8e11, inst(1e9, 5e8)),
    )
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-04T08:30:00.000Z', days: many })
    const { container } = render(<TwMarketSection />)

    await screen.findByText(/三大法人買賣超（億元）・近 7 個交易日/)
    // Six units, always —— the predecessor swung between 7 and 42 rows depending on what was expanded
    expect(instRows(container)).toHaveLength(6)
    expect(screen.queryByRole('button', { name: /全部展開|全部收起/ })).toBeNull()

    const heads = [...instTable(container).querySelectorAll('thead th')].map((e) => e.textContent)
    // 單位 + 7 days + 累計 + 走勢. Oldest → newest, the same direction as the three charts above.
    expect(heads).toEqual([
      '單位',
      '07/24',
      '07/25',
      '07/26',
      '07/27',
      '07/28',
      '07/29',
      '07/30',
      '7 日累計',
      '近 15 日走勢',
    ])
  })

  it('列為六個單位、末列合計；缺料的那天給「—」而不是把整列變空（0.7.6）', async () => {
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
    expect(rows.map((r) => r.querySelector('td')!.textContent)).toEqual([
      '外資',
      '外資自營商',
      '投信',
      '自營商（自行）',
      '自營商（避險）',
      '合計',
    ])

    // 外資: filled day, then the day that is not filled in yet, then the sum of what is known
    expect([...rows[0].querySelectorAll('td.num')].map((td) => td.textContent)).toEqual([
      '-191.9 億',
      '—',
      '-191.9 億',
    ])
    // 合計 is the last row and carries .row-total
    expect(rows[5].className).toContain('row-total')
    expect([...rows[5].querySelectorAll('td.num')].map((td) => td.textContent)).toEqual([
      '-165.2 億',
      '—',
      '-165.2 億',
    ])
  })

  it('買進／賣出改用口徑切換，不再常駐兩個欄位（0.7.6）', async () => {
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

    const foreignCells = () =>
      [...instRows(container)[0].querySelectorAll('td.num')].map((td) => td.textContent)
    // Default 買賣超: signed and coloured
    expect(foreignCells()).toEqual(['-190.0 億', '+112.7 億', '-77.3 億'])
    expect(instRows(container)[0].querySelectorAll('td.num')[1].className).toContain('pnl-up')

    await user.click(screen.getByRole('button', { name: '買進' }))
    expect(screen.getByText(/三大法人買進（億元）/)).toBeTruthy()
    // Old files carry the net only —— the leg is absent, not zero
    expect(foreignCells()).toEqual(['—', '3500.0 億', '3500.0 億'])
    // Gross amounts are all positive, so no up/down colour on them
    expect(instRows(container)[0].querySelectorAll('td.num')[1].className).not.toContain('pnl-')

    await user.click(screen.getByRole('button', { name: '賣出' }))
    expect(foreignCells()).toEqual(['—', '3387.3 億', '3387.3 億'])

    await user.click(screen.getByRole('button', { name: '買賣超' }))
    expect(foreignCells()).toEqual(['-190.0 億', '+112.7 億', '-77.3 億'])
  })

  it('走勢：連續天數屬於單位，且讀滿 15 日不受表格 7 欄的限制（0.7.6）', async () => {
    // 10 consecutive days of overbuying —— the table only lists the last 7, but the streak must say 10
    const days = Array.from({ length: 10 }, (_, i) =>
      day(`2026-08-${String(i + 1).padStart(2, '0')}`, 8e11, inst(1e9 * (i + 1), 1e9)),
    )
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-10T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const rows = [...instRows(container)]
    expect(rows).toHaveLength(6)
    // The streak lives on the unit's own row now, not in a date cell
    expect(rows[0].textContent).toContain('連 10 日買超')
    expect(rows[5].textContent).toContain('連 10 日買超')
    // Label sits above the spark (DOM order)
    const trendCell = rows[0].querySelectorAll('td')[rows[0].querySelectorAll('td').length - 1]
    expect(trendCell.innerHTML.indexOf('連 10 日買超')).toBeLessThan(
      trendCell.innerHTML.indexOf('mac-spark'),
    )
  })

  it('走勢：轉向當天不算連續，且各單位各算各的（0.7.6）', async () => {
    const days = [
      day('2026-08-01', 8e11, inst(-3e9, -1e9)),
      day('2026-08-02', 8e11, inst(-2e9, -1e9)),
      day('2026-08-03', 8e11, inst(5e9, 1e9)), // 合計由賣超轉買超；投信三天都是買超
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-03T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const rows = [...instRows(container)]
    // 合計 turned today → not a streak
    expect(rows[5].textContent).not.toContain('連 ')
    // 投信 (trustTwd 5e8 every day) kept the same direction throughout —— per-unit, not per-day
    expect(rows[2].textContent).toContain('連 3 日買超')
    expect(instTable(container).querySelectorAll('.mac-spark')).toHaveLength(6)
  })

  it('底色深淺以「該單位自己」的最大值為準，小額單位才看得出自己的大日子（0.7.6）', async () => {
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
    const cell = (r: number, c: number) => rows[r].querySelectorAll('td.num')[c] as HTMLElement
    // Both are +100.0 億, but it is 投信's biggest day and only 外資's smallest
    expect(cell(0, 1).textContent).toBe('+100.0 億')
    expect(cell(2, 1).textContent).toBe('+100.0 億')
    const pct = (e: HTMLElement) => Number(/([\d.]+)%/.exec(e.style.background)![1])
    expect(pct(cell(2, 1))).toBeGreaterThan(pct(cell(0, 1)))
    // 外資's own biggest day is the strongest tint of its row
    expect(pct(cell(0, 0))).toBeGreaterThan(pct(cell(0, 1)))
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
    expect(screen.getByText(/還沒補到/)).toBeTruthy()
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

  it('走勢欄：每一列都有放大的波折圖，且首欄凍結以免橫捲後讀到無名的數字（0.7.6）', async () => {
    const days = [
      day('2026-08-01', 8e11, inst(-3e9, -1e9)),
      day('2026-08-02', 8e11, inst(-2e9, -1e9)),
      day('2026-08-03', 8e11, inst(5e9, 1e9)),
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-03T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const rows = [...instRows(container)]
    // Enlarged spark (display size > default 64×18)
    const spark = rows[0].querySelector('.mac-spark') as SVGElement
    expect(spark.getAttribute('style')).toMatch(/width:\s*100px/)
    expect(spark.getAttribute('style')).toMatch(/height:\s*36px/)
    // The frozen unit column is what makes horizontal scrolling readable
    expect(instTable(container).className).toContain('inst-matrix')
  })

  it('走勢欄：每日成交量呈現連 N 日增量/縮量與連 N 日上漲/下跌 Streak 標籤', async () => {
    const days = [
      { ...day('2026-08-01', 7e11, null), changePoints: 100 },
      { ...day('2026-08-02', 8e11, null), changePoints: 150 },
      { ...day('2026-08-03', 9e11, null), changePoints: 200 },
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-03T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    const rows = [...turnoverRows(container)]
    // Amount row has increasing volume: 7e11 -> 8e11 -> 9e11 (3 days)
    expect(rows[0].textContent).toContain('連 2 日增量')
    // Taiex row has positive change: all 3 days positive
    expect(rows[3].textContent).toContain('連 3 日上漲')
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
    const changeCells = rows[4].querySelectorAll('td')
    expect(changeCells[1].className).toContain('pnl-up')
    expect(changeCells[1].style.backgroundColor).toBeTruthy()
    expect(changeCells[2].className).toContain('pnl-down')
    expect(changeCells[2].style.backgroundColor).toBeTruthy()
  })

  it('查無資料時顯示空狀態，不是一片空白', async () => {
    fetchMarketDaily.mockResolvedValue(null)
    render(<TwMarketSection />)
    await waitFor(() => expect(screen.getByText(/市場資料尚未產生/)).toBeTruthy())
  })
})
