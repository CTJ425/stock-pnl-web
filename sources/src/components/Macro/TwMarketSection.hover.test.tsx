// @vitest-environment jsdom
/**
 * Task 193 M17: the hover index is shared by the three stacked charts, and it used to live in
 * TwMarketSection itself — so every mouse move re-rendered the whole card (both tables, the
 * 當日走勢 chart and the 外資 top list) just to move a crosshair. It now lives in the chart stack.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { fetchMarketDaily } = vi.hoisted(() => ({ fetchMarketDaily: vi.fn() }))
vi.mock('../../services/marketProxy', () => ({ fetchMarketDaily }))

const renders = vi.hoisted(() => ({ foreignTop: 0, indexToday: 0 }))
vi.mock('./ForeignTopSection', () => ({
  ForeignTopSection: () => {
    renders.foreignTop += 1
    return null
  },
}))
vi.mock('./TwIndexToday', () => ({
  TwIndexToday: () => {
    renders.indexToday += 1
    return null
  },
}))

import { TwMarketSection } from './TwMarketSection'
import type { MarketDay } from '../../services/marketProxy'

const side = (total: number, foreign: number) => ({
  foreignTwd: foreign,
  foreignDealerTwd: 0,
  trustTwd: 5e8,
  dealerSelfTwd: -1e8,
  dealerHedgeTwd: -2e8,
  totalTwd: total,
  buy: null,
  sell: null,
})

const day = (date: string): MarketDay => ({
  date,
  tradeVolumeShares: 11_000_000_000,
  tradeValueTwd: 900_000_000_000,
  transactions: 4_000_000,
  taiex: 43386.41,
  changePoints: 266.66,
  taiexOpen: 42780.42,
  taiexHigh: 43784.19,
  taiexLow: 42780.42,
  institutional: side(1e9, 5e8),
})

afterEach(() => {
  cleanup()
  fetchMarketDaily.mockReset()
  renders.foreignTop = 0
  renders.indexToday = 0
})

describe('TwMarketSection — hover 只重繪圖表', () => {
  it('moving over a chart does not re-render the rest of the card', async () => {
    fetchMarketDaily.mockResolvedValue({
      kind: 'ok',
      data: { asOf: '2026-08-04T08:30:00.000Z', days: ['2026-08-03', '2026-08-04', '2026-08-05'].map(day) },
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByRole('table', { name: '每日成交量' })

    const before = { ...renders }
    // Each chart builds one transparent hit rect per day (chartFrame.tsx).
    const hits = container.querySelectorAll('svg.chart-svg rect[fill="transparent"]')
    expect(hits.length).toBeGreaterThan(0)
    fireEvent.mouseEnter(hits[1])
    fireEvent.mouseEnter(hits[2])

    // The siblings did not render again…
    expect(renders.foreignTop).toBe(before.foreignTop)
    expect(renders.indexToday).toBe(before.indexToday)
    // …while the shared crosshair still works: hovering one chart highlights the same day on the others.
    expect(container.querySelectorAll('.chart-tip').length).toBeGreaterThan(0)
  })
})
