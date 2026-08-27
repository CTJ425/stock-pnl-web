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

  it('點擊重新整理按鈕會重新觸發 fetchIntraday', async () => {
    fetchIntraday.mockResolvedValue(series())
    show()

    await waitFor(() => expect(screen.getByTestId('tw-index-open')).toBeTruthy())
    const initialCalls = fetchIntraday.mock.calls.length

    const refreshBtn = screen.getByRole('button', { name: /重新整理/ })
    await userEvent.click(refreshBtn)

    await waitFor(() => expect(fetchIntraday.mock.calls.length).toBe(initialCalls + 1))
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

  it('加權指數標題旁 badge 標明實際交易日期與當日字樣', async () => {
    fetchIntraday.mockResolvedValue(series())
    render(<TwIndexToday closeStats={closeStats()} />)

    // T0 = 1787702400 is 2026-08-26 in Asia/Taipei
    await waitFor(() => {
      expect(screen.getByText('2026-08-26 當日')).toBeTruthy()
    })
  })

  it('走勢圖旁三大法人近 2 交易日買賣超動向正確渲染', async () => {
    fetchIntraday.mockResolvedValue(series())
    const recentInstDays = [
      {
        date: '2026-08-26',
        totalTwd: 59_387_214_887,
        foreignTwd: 36_598_312_109,
        trustTwd: 4_855_180_879,
        dealerTwd: 17_933_721_899,
      },
      {
        date: '2026-08-25',
        totalTwd: -5_340_000_000,
        foreignTwd: -790_000_000,
        trustTwd: -4_610_000_000,
        dealerTwd: 60_000_000,
      },
    ]

    const { container } = render(
      <TwIndexToday closeStats={closeStats()} recentInstDays={recentInstDays} />,
    )

    await waitFor(() => {
      expect(screen.getByText('三大法人買賣超動向')).toBeTruthy()
    })

    const cards = container.querySelectorAll('.inst-day-card')
    expect(cards).toHaveLength(2)
    expect(within(cards[0] as HTMLElement).getByText('08/26')).toBeTruthy()
    expect(within(cards[0] as HTMLElement).getByText('最新')).toBeTruthy()
    expect(within(cards[0] as HTMLElement).getByText('+593.9 億')).toBeTruthy()
    expect(within(cards[0] as HTMLElement).getByText('+366.0 億')).toBeTruthy()

    expect(within(cards[1] as HTMLElement).getByText('08/25')).toBeTruthy()
    expect(within(cards[1] as HTMLElement).getByText('前日')).toBeTruthy()
    expect(within(cards[1] as HTMLElement).getByText('-53.4 億')).toBeTruthy()
  })

  /**
   * The badge names the session the chart is showing. `points` is ascending, so in the
   * 五日 range `points[0]` is the OLDEST day — reading the date from there made the badge
   * claim a session five days stale.
   */
  it('badge 取序列最後一點的日期，跨日序列不會顯示最舊那天', async () => {
    fetchIntraday.mockResolvedValue(
      series({
        range: '5d',
        points: [
          { t: T0 - 86_400 * 2, c: 44_800, v: 0 },
          { t: T0, c: 45_832.62, v: 0 },
        ],
      }),
    )
    render(<TwIndexToday closeStats={closeStats()} />)

    await waitFor(() => expect(screen.getByText('2026-08-26 當日')).toBeTruthy())
    expect(screen.queryByText('2026-08-24 當日')).toBeNull()
  })

  it('序列沒有任何點時 badge 只寫「當日」，不宣告一個交易日', async () => {
    fetchIntraday.mockResolvedValue(series({ points: [] }))
    const { container } = render(<TwIndexToday closeStats={closeStats()} />)

    await waitFor(() => expect(container.querySelector('.badge')).toBeTruthy())
    expect(container.querySelector('.badge')?.textContent).toBe('當日')
    expect(document.body.textContent).not.toMatch(/\d{4}-\d{2}-\d{2} 當日/)
  })

  /**
   * The panel shows the 三大法人 aside, whose data comes from the parent's market.json.
   * Its own 重新整理 must refresh both, or the aside silently stays stale.
   */
  it('面板的重新整理同時重抓盤中序列與父層的市場資料', async () => {
    fetchIntraday.mockResolvedValue(series())
    const onRefresh = vi.fn()
    render(<TwIndexToday closeStats={closeStats()} onRefresh={onRefresh} />)

    await waitFor(() => expect(screen.getByTestId('tw-index-open')).toBeTruthy())
    const initialCalls = fetchIntraday.mock.calls.length

    await userEvent.click(screen.getByRole('button', { name: /重新整理/ }))

    await waitFor(() => expect(fetchIntraday.mock.calls.length).toBe(initialCalls + 1))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  /** Without the aside the grid must not reserve its 300px column. */
  it('沒有三大法人側欄時圖表區不保留側欄的欄位', async () => {
    fetchIntraday.mockResolvedValue(series())
    const { container } = render(<TwIndexToday closeStats={closeStats()} />)

    await waitFor(() => expect(container.querySelector('.tw-index-chart-layout')).toBeTruthy())
    expect(container.querySelector('.tw-index-inst-aside')).toBeNull()
    expect(container.querySelector('.tw-index-chart-layout')?.classList.contains('has-aside')).toBe(
      false,
    )
  })

  it('有三大法人側欄時圖表區標記 has-aside', async () => {
    fetchIntraday.mockResolvedValue(series())
    const { container } = render(
      <TwIndexToday
        closeStats={closeStats()}
        recentInstDays={[
          {
            date: '2026-08-26',
            totalTwd: 59_387_214_887,
            foreignTwd: 36_598_312_109,
            trustTwd: 4_855_180_879,
            dealerTwd: 17_933_721_899,
          },
        ]}
      />,
    )

    await waitFor(() => expect(container.querySelector('.tw-index-inst-aside')).toBeTruthy())
    expect(container.querySelector('.tw-index-chart-layout')?.classList.contains('has-aside')).toBe(
      true,
    )
  })

  /**
   * Without a `.catch` subject to the same staleness guard, a rejected fetch never clears
   * `loading` — the 重新整理 button stays disabled and the icon spins forever.
   */
  it('盤中請求失敗時解除 loading，重新整理鈕不會永久停用', async () => {
    fetchIntraday.mockResolvedValueOnce(series())
    render(<TwIndexToday closeStats={closeStats()} />)

    await waitFor(() => expect(screen.getByTestId('tw-index-open')).toBeTruthy())

    fetchIntraday.mockRejectedValueOnce(new Error('network down'))
    const btn = screen.getByRole('button', { name: /重新整理/ }) as HTMLButtonElement
    await userEvent.click(btn)

    await waitFor(() => expect(btn.disabled).toBe(false))
    // A failed refresh must leave the last good series on screen, not blank the panel.
    // Assert the VALUE, not the cell: `tw-index-open` renders unconditionally and shows '—'
    // when `series` is null, so a presence check would pass even if .catch cleared the series.
    expect(statNum('tw-index-open')).toBeCloseTo(45157.64, 2)
  })
})
