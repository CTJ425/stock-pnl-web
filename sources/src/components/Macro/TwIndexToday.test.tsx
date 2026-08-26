// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchIntraday } = vi.hoisted(() => ({ fetchIntraday: vi.fn() }))
vi.mock('../../services/intradayProxy', () => ({ fetchIntraday }))

import { TwIndexToday } from './TwIndexToday'
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

const show = () => render(<TwIndexToday />)

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

    await userEvent.click(screen.getByRole('button', { name: '5日' }))

    await waitFor(() =>
      expect(fetchIntraday.mock.calls.some((c) => c[1] === '5d')).toBe(true),
    )
  })

  it('不顯示成交金額 —— Yahoo 對指數不提供，該數字留在下方最近交易日的指標卡', async () => {
    fetchIntraday.mockResolvedValue(series())
    show()

    await waitFor(() => expect(screen.getByTestId('tw-index-open')).toBeTruthy())

    expect(screen.queryByText(/成交金額/)).toBeNull()
  })
})
