// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntradayChart, finalVwap } from './IntradayChart'
import type {
  IntradayPoint,
  IntradaySeries,
} from '../../../supabase/functions/stock-price/intradayParse'

/**
 * The chart's arithmetic has no other gate — it draws SVG, so a divide-by-zero does not throw,
 * it silently emits `d="M NaN,NaN …"` and the card renders an empty box nobody notices.
 * Every case here therefore ends at `expectNoNaN`, which reads every generated path back.
 *
 * The degenerate shapes are the real ones, not invented: a single point is what the first minute
 * of a session gives, all-equal closes is a limit-locked stock (the price domain is built around
 * `max|c − prevClose|`, which is then 0), and zero total volume is any bar before the first match.
 */

/** Real 2330.TW bars, 2026-08-25 09:00 onward, from the captured Yahoo chart v8 response. */
const REAL_CLOSE = [
  2360, 2355, 2355, 2360, 2360, 2355, 2360, 2350, 2360, 2360, 2360, 2355,
  2360, 2360, 2365, 2355, 2355, 2360, 2360, 2355, 2360, 2355, 2360, 2355,
]
const REAL_VOLUME = [
  0, 123000, 50000, 87000, 48000, 116000, 44000, 207000, 221000, 100322, 43997, 43193,
  31391, 33159, 105274, 64962, 15330, 16181, 20530, 24940, 19216, 28964, 12598, 30548,
]
/** 09:00 Asia/Taipei on 2026-08-25, epoch seconds. */
const T0 = 1787616000

const seriesOf = (
  close: number[],
  volume: number[],
  prevClose: number | null = 2375,
): IntradaySeries => ({
  symbol: '2330.TW',
  range: '1d',
  interval: '1m',
  prevClose,
  points: close.map<IntradayPoint>((c, i) => ({ t: T0 + i * 60, c, v: volume[i] ?? 0 })),
})

const real = () => seriesOf(REAL_CLOSE, REAL_VOLUME)

const show = (series: IntradaySeries | null, loading = false) =>
  render(
    <IntradayChart series={series} loading={loading} range="1d" onRangeChange={vi.fn()} />,
  )

/** Every coordinate the component emitted, across both stacked frames. */
const coordAttrs = () =>
  [...document.querySelectorAll('svg [d], svg [points], svg circle, svg rect, svg line')].flatMap(
    (el) =>
      ['d', 'points', 'cx', 'cy', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height']
        .map((a) => el.getAttribute(a))
        .filter((v): v is string => v !== null),
  )

const expectNoNaN = () => {
  const attrs = coordAttrs()
  // Guard against a vacuous pass: a component that rendered nothing has no bad coordinates either.
  expect(attrs.length).toBeGreaterThan(0)
  expect(attrs.filter((v) => /NaN|Infinity|undefined/.test(v))).toEqual([])
}

describe('IntradayChart', () => {
  beforeEach(cleanup)

  it('畫得出真實一日走勢，座標全部是有限數', () => {
    show(real())
    expect(document.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2) // 價格 + 成交量兩個圖框
    expect(coordAttrs().length).toBeGreaterThan(0)
    expectNoNaN()
  })

  it('只有一個點也不會算出 NaN（開盤第一分鐘）', () => {
    show(seriesOf([2360], [1000]))
    expectNoNaN()
  })

  it('全場同一價也不會除以零（漲跌停鎖死）', () => {
    show(seriesOf([2375, 2375, 2375], [1000, 2000, 3000]))
    expectNoNaN()
  })

  it('全場零成交量不會讓量圖除以零', () => {
    show(seriesOf([2360, 2365, 2370], [0, 0, 0]))
    expectNoNaN()
  })

  it('沒有昨收時仍然畫得出來，只是不以昨收為基準', () => {
    show(seriesOf(REAL_CLOSE, REAL_VOLUME, null))
    expectNoNaN()
  })

  it('昨收為零不會讓漲跌幅變成 Infinity', () => {
    show(seriesOf([2360, 2365], [1000, 2000], 0))
    expectNoNaN()
  })

  it('沒有資料時顯示空狀態，不畫空圖', () => {
    show(null)
    expect(screen.getByText('無走勢資料')).toBeTruthy()
    expect(document.querySelectorAll('svg')).toHaveLength(0)
  })

  it('載入中顯示骨架，不是空狀態', () => {
    show(null, true)
    expect(screen.queryByText('無走勢資料')).toBeNull()
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
  })

  it('提供一日與五日兩個區間，且標出目前選的是哪個', () => {
    show(real())
    const group = screen.getByRole('group', { name: '走勢區間' })
    const buttons = [...group.querySelectorAll('button')]
    expect(buttons.map((b) => b.textContent)).toEqual(['一日', '五日'])
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false')
  })

  it('標示當日走勢的時間備註徽章', () => {
    render(
      <IntradayChart
        series={real()}
        loading={false}
        range="1d"
        onRangeChange={vi.fn()}
        tradeDate="2026-08-25"
      />,
    )
    expect(screen.getByText('2026-08-25 當日走勢')).toBeTruthy()
  })
})

describe('finalVwap', () => {
  it('是累計成交量加權均價，不是收盤價的算術平均', () => {
    // (2400×1000 + 2410×2000 + 2405×1000) / 4000 = 2406.25；算術平均會是 2405
    expect(
      finalVwap([
        { t: 1, c: 2400, v: 1000 },
        { t: 2, c: 2410, v: 2000 },
        { t: 3, c: 2405, v: 1000 },
      ]),
    ).toBeCloseTo(2406.25, 6)
  })

  it('零量的 bar 不影響加權', () => {
    expect(
      finalVwap([
        { t: 1, c: 2400, v: 1000 },
        { t: 2, c: 9999, v: 0 },
      ]),
    ).toBeCloseTo(2400, 6)
  })

  it('完全沒有成交量時給 null，而不是 0 或 NaN', () => {
    expect(finalVwap([{ t: 1, c: 2400, v: 0 }])).toBeNull()
  })

  it('空序列給 null', () => {
    expect(finalVwap([])).toBeNull()
  })
})
