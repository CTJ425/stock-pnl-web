// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchIntraday } = vi.hoisted(() => ({ fetchIntraday: vi.fn() }))
vi.mock('../../services/intradayProxy', () => ({ fetchIntraday }))

import { TwIndexToday, type TwIndexCloseStats } from './TwIndexToday'
import type { IntradaySeries } from '../../../supabase/functions/stock-price/intradayParse'

/**
 * 當日大盤 panel for 總體經濟 > 台股 (0.9.19).
 *
 * The fixture is the real `^TWII` response of 2026-08-26, reduced to the numbers that reach
 * the screen. Two of them are the reason this component exists at all:
 *   - `dayLow` 44925.84 is BELOW every close in the series (the lowest close was 44979.04),
 *     so a low derived from closes would print a number 53.2 points wrong.
 *   - `dayOpen` 45157.64 is not the first close (45044.20).
 * A test that used self-consistent numbers would pass against the broken implementation.
 */
const T0 = 1787702400 // 09:00 Asia/Taipei, 2026-08-26

const CLOSES = [45044.2, 45120.64, 44979.04, 45410.11, 45832.62]

const series = (over: Partial<IntradaySeries> = {}): IntradaySeries => ({
  symbol: '^TWII',
  range: '1d',
  interval: '1m',
  prevClose: 45169.46,
  dayOpen: 45157.64,
  dayHigh: 45878.39,
  dayLow: 44925.84,
  points: CLOSES.map((c, i) => ({ t: T0 + i * 60, c, v: 0 })),
  ...over,
})

/** Reads a stat cell's number back without depending on the separator the UI picks. */
const statNum = (id: string) => {
  const el = screen.getByTestId(id)
  const raw = (el.textContent ?? '').replace(/[,\s%]/g, '')
  return Number(raw)
}

/** Latest complete trading day, as TwMarketSection derives it from market/daily.json. */
const closeStats = (over: Partial<TwIndexCloseStats> = {}): TwIndexCloseStats => ({
  date: '2026-08-26',
  tradeValueTwd: 836_243_796_302,
  instDate: '2026-08-26',
  instTotalTwd: 59_387_214_887,
  instForeignTwd: 36_598_312_109,
  instTrustTwd: 4_855_180_879,
  ...over,
})

const show = (stats: TwIndexCloseStats | null = closeStats()) =>
  render(<TwIndexToday closeStats={stats} />)

describe('TwIndexToday', () => {
  beforeEach(() => {
    cleanup()
    fetchIntraday.mockReset()
  })
  afterEach(cleanup)

  it('六格統計取自 dayOpen / dayHigh / dayLow / prevClose，不是收盤序列', async () => {
    fetchIntraday.mockResolvedValue(series())
    show()

    await waitFor(() => expect(screen.getByTestId('tw-index-open')).toBeTruthy())

    expect(statNum('tw-index-open')).toBeCloseTo(45157.64, 2)
    expect(statNum('tw-index-high')).toBeCloseTo(45878.39, 2)
    expect(statNum('tw-index-low')).toBeCloseTo(44925.84, 2)
    expect(statNum('tw-index-prev-close')).toBeCloseTo(45169.46, 2)

    // The guard: a close-derived low would be 44979.04 and an open-from-close 45044.20.
    expect(statNum('tw-index-low')).toBeLessThan(Math.min(...CLOSES))
    expect(statNum('tw-index-open')).not.toBeCloseTo(CLOSES[0], 2)
  })

  it('指數與漲跌由最後一點對昨收算出，上漲用紅色', async () => {
    fetchIntraday.mockResolvedValue(series())
    show()

    await waitFor(() => expect(screen.getByTestId('tw-index-value')).toBeTruthy())

    expect(statNum('tw-index-value')).toBeCloseTo(45832.62, 2)
    expect(statNum('tw-index-change')).toBeCloseTo(663.16, 2)
    expect(statNum('tw-index-change-pct')).toBeCloseTo(1.47, 2)
    expect(screen.getByTestId('tw-index-change').className).toContain('pnl-up')
    expect(screen.getByTestId('tw-index-change-pct').className).toContain('pnl-up')
  })

  it('下跌用綠色', async () => {
    fetchIntraday.mockResolvedValue(series({ prevClose: 46000 }))
    show()

    await waitFor(() => expect(screen.getByTestId('tw-index-change')).toBeTruthy())

    expect(statNum('tw-index-change')).toBeCloseTo(-167.38, 2)
    expect(screen.getByTestId('tw-index-change').className).toContain('pnl-down')
  })

  it('沒有資料時顯示空狀態，不印出 0，也不崩潰', async () => {
    fetchIntraday.mockResolvedValue(null)
    show()

    await waitFor(() => expect(screen.getByTestId('tw-index-empty')).toBeTruthy())

    expect(screen.queryByTestId('tw-index-value')).toBeNull()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('昨收缺席時漲跌格顯示破折號而不是 NaN', async () => {
    fetchIntraday.mockResolvedValue(series({ prevClose: null }))
    show()

    await waitFor(() => expect(screen.getByTestId('tw-index-change')).toBeTruthy())

    expect(screen.getByTestId('tw-index-change').textContent).toContain('—')
    expect(screen.getByTestId('tw-index-change-pct').textContent).toContain('—')
    expect(screen.getByTestId('tw-index-change').className).not.toContain('pnl-up')
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('切到 5日 會用 5d 重新取一次', async () => {
    fetchIntraday.mockResolvedValue(series())
    show()

    await waitFor(() => expect(fetchIntraday).toHaveBeenCalled())
    expect(fetchIntraday.mock.calls[0][1]).toBe('1d')
    expect(fetchIntraday.mock.calls[0][0]).toMatchObject({ ticker: '^TWII' })

    await userEvent.click(screen.getByRole('button', { name: '五日' }))

    await waitFor(() =>
      expect(fetchIntraday.mock.calls.some((c) => c[1] === '5d')).toBe(true),
    )
  })

})

/**
 * Layout, 0.9.20. Two things the previous arrangement got wrong on screen:
 *   - the stats sat *below* the chart, so the numbers a reader wants first were last;
 *   - the panel drew its own 1日/5日 buttons while IntradayChart already draws 一日/五日,
 *     putting two range controls on the same card.
 *
 * The second band row folds in the three KPI cards that used to sit under this panel.
 * They describe the latest *complete* trading day, not the current session, and the two
 * dates genuinely differ: institutional money lands about 15:00, so `instDate` can be a
 * day behind `date`. The row keeps its own caption for exactly that reason.
 */
describe('TwIndexToday — 版面與收盤統計整併', () => {
  beforeEach(() => {
    cleanup()
    fetchIntraday.mockReset()
  })

  it('統計帶排在走勢圖之前，而且不包住走勢圖', async () => {
    fetchIntraday.mockResolvedValue(series())
    show()

    const band = await screen.findByTestId('tw-index-band')
    const chart = document.querySelector('.chart-svg')
    expect(chart).toBeTruthy()
    expect(band.contains(chart)).toBe(false)
    // compareDocumentPosition bit 4 = the argument follows the receiver.
    expect(band.compareDocumentPosition(chart!) & 4).toBeTruthy()
  })

  it('只有一組區間按鈕（來自 IntradayChart），不再自己畫一組', async () => {
    fetchIntraday.mockResolvedValue(series())
    show()

    await screen.findByTestId('tw-index-band')
    expect(screen.queryAllByRole('button', { name: '一日' })).toHaveLength(1)
    expect(screen.queryAllByRole('button', { name: '五日' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '1日' })).toBeNull()
    expect(screen.queryByRole('button', { name: '5日' })).toBeNull()
  })

  it('收盤統計三格併入面板，沿用既有的 kpi-value 類別', async () => {
    fetchIntraday.mockResolvedValue(series())
    const { container } = show()

    await screen.findByTestId('tw-index-band')
    const vals = [...container.querySelectorAll('.kpi-value')].map((e) => e.textContent)
    expect(vals).toContain('8362.4 億')
    expect(vals).toContain('+593.9 億')
    expect(vals).toContain('+366.0 億')
  })

  it('法人金額還沒補到當日時，兩個日期都要在統計帶上說清楚', async () => {
    fetchIntraday.mockResolvedValue(series())
    show(closeStats({ instDate: '2026-08-25' }))

    // Scoped to the band on purpose: IntradayChart prints the session date in its own badge,
    // and an unscoped getByText would throw on two matches — which is what pushed an earlier
    // implementation into dropping the date from this row altogether.
    const band = await screen.findByTestId('tw-index-band')
    expect(within(band).getByText(/2026-08-26/)).toBeTruthy()

    // Both institutional cells must carry the older date, not just the first of them.
    // On a narrow viewport `.tw-index-stats` drops to two columns (index.css), so 其中外資
    // wraps onto its own line and loses sight of the 三大法人買賣超 cell beside it — a reader
    // landing on it alone would otherwise read yesterday's print as today's close.
    expect(within(band).getAllByText(/2026-08-25/).length).toBe(2)
  })

  it('成交金額那格要說出它是哪一天的，不能只說「最近交易日」', async () => {
    fetchIntraday.mockResolvedValue(series())
    show(closeStats({ date: '2026-08-24' }))

    const band = await screen.findByTestId('tw-index-band')
    expect(within(band).getByText(/2026-08-24/)).toBeTruthy()
  })

  it('完全沒有法人金額時說明原因，不印出 0', async () => {
    fetchIntraday.mockResolvedValue(series())
    show(closeStats({ instDate: null, instTotalTwd: null, instForeignTwd: null, instTrustTwd: null }))

    await screen.findByTestId('tw-index-band')
    expect(screen.getByText('尚未補到法人金額')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('沒有收盤統計時只顯示當日那一列，不崩潰', async () => {
    fetchIntraday.mockResolvedValue(series())
    const { container } = show(null)

    await screen.findByTestId('tw-index-band')
    expect(screen.getByTestId('tw-index-open')).toBeTruthy()
    expect(container.querySelectorAll('.kpi-value')).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })
})
