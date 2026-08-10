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
    // 0.7.1-dev.2: 7 days × 6 units per day
    expect(instRows(container)).toHaveLength(7 * 6)
  })

  it('主表欄位為 日期／單位／買進／賣出／買賣超；缺料給「—」（0.7.1-dev.2）', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        day('2026-08-04', 1_087_045_875_836, null),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const heads = [...instTable(container).querySelectorAll('thead th')].map((e) => e.textContent)
    expect(heads).toEqual(['日期', '單位', '買進', '賣出', '買賣超'])

    const rows = [...instRows(container)]
    // 2 days × 6 units
    expect(rows).toHaveLength(12)
    // Newest day first; first unit row carries the date cell
    expect(rows[0].textContent).toContain('2026-08-04')
    expect(rows[0].textContent).toContain('外資')
    // No institutional data → buy / sell / net all —
    expect([...rows[0].querySelectorAll('td.num')].map((td) => td.textContent)).toEqual([
      '—',
      '—',
      '—',
    ])
    // Previous day (starts at row 6): foreign net −191.9, trust +5.0, total −165.2
    const foreignPrev = [...rows[6].querySelectorAll('td')].map((td) => td.textContent)
    // rowspan date only on first unit row of that day → [單位, 買進, 賣出, 買賣超] or [日期, 單位, ...]
    expect(foreignPrev).toContain('外資')
    expect(foreignPrev).toContain('-191.9 億')
    const trustPrev = [...rows[8].querySelectorAll('td')].map((td) => td.textContent)
    expect(trustPrev).toContain('投信')
    expect(trustPrev).toContain('+5.0 億')
    const totalPrev = [...rows[11].querySelectorAll('td')].map((td) => td.textContent)
    expect(totalPrev).toContain('合計')
    expect(totalPrev).toContain('-165.2 億')
    // Old file without buy/sell legs → 買進／賣出 —
    expect(totalPrev).toContain('—')
  })

  it('有買賣明細時直接顯示買進／賣出／買賣超，無展開鈕（0.7.1-dev.2）', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 8e11, inst(-1.65e10, -1.9e10)),
        day('2026-08-04', 8e11, instFull(1.445e10, 1.127e10)),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    expect(screen.queryByRole('button', { name: /展開/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /全部展開/ })).toBeNull()
    expect(container.querySelectorAll('.detail-row')).toHaveLength(0)

    // Newest day, 外資 row: buy 3500 / sell 3387.3 / net +112.7
    const foreign = [...instRows(container)[0].querySelectorAll('td')].map((td) => td.textContent)
    expect(foreign).toEqual(
      expect.arrayContaining(['外資', '3500.0 億', '3387.3 億', '+112.7 億']),
    )
  })

  it('趨勢：連續同向天數，且走勢不受表格只顯示 7 日的限制（0.6.32）', async () => {
    // 10 consecutive days of overbuying - the table only lists the last 7 days, but the trend must last for 10 days
    const days = Array.from({ length: 10 }, (_, i) =>
      day(`2026-08-${String(i + 1).padStart(2, '0')}`, 8e11, inst(1e9 * (i + 1), 1e9)),
    )
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-10T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const rows = [...instRows(container)]
    expect(rows).toHaveLength(7 * 6)
    // First unit row of latest day (8/10) carries the streak label
    expect(rows[0].textContent).toContain('連 10 日買超')
    // First unit row of oldest listed day (8/04) is day 4
    expect(rows[6 * 6].textContent).toContain('連 4 日買超')
  })

  it('趨勢：轉向當天不算連續，走勢線畫得出來', async () => {
    const days = [
      day('2026-08-01', 8e11, inst(-3e9, -1e9)),
      day('2026-08-02', 8e11, inst(-2e9, -1e9)),
      day('2026-08-03', 8e11, inst(5e9, 1e9)), // 由賣超轉買超
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-03T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })

    const rows = [...instRows(container)]
    // Turning day (first block): 1 day in a row → no 「連」
    expect(rows[0].textContent).not.toContain('連')
    // Previous day block starts at row 6
    expect(rows[6].textContent).toContain('連 2 日賣超')
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

  it('日期列帶走勢與連續標籤（合計序列，0.7.1-dev.2）', async () => {
    const days = [
      day('2026-08-01', 8e11, inst(-3e9, -1e9)),
      day('2026-08-02', 8e11, inst(-2e9, -1e9)),
      day('2026-08-03', 8e11, inst(5e9, 1e9)), // 轉買超，連 1 日不算趨勢
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-03T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '三大法人買賣超' })
    // No separate 趨勢／連續 columns — both sit under the date cell
    expect(screen.queryByRole('columnheader', { name: '連續' })).toBeNull()

    const rows = [...instRows(container)]
    // First unit row of latest day has date + spark; 1-day streak → "—"
    expect(rows[0].querySelector('.mac-spark')).toBeTruthy()
    expect(rows[0].textContent).toMatch(/—/)
    expect(rows[0].textContent).not.toContain('連 ')
    // First unit row of previous day (index 6)
    expect(rows[6].textContent).toContain('連 2 日賣超')
    expect(rows[6].querySelector('.mac-spark')).toBeTruthy()
  })

  it('查無資料時顯示空狀態，不是一片空白', async () => {
    fetchMarketDaily.mockResolvedValue(null)
    render(<TwMarketSection />)
    await waitFor(() => expect(screen.getByText(/市場資料尚未產生/)).toBeTruthy())
  })
})
