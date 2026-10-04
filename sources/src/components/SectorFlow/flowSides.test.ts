import { describe, expect, it } from 'vitest'
import type { SectorFlowDay, SectorFlowRow } from '../../services/sectorFlowProxy'
import { RING, TOP_SLICES, buildSides, rankPosition, ringArcs } from './flowSides'
import { buildView } from './sectorFlowView'

const E8 = 1e8

function row(code: string, name: string, totalE8: number, over: Partial<SectorFlowRow> = {}): SectorFlowRow {
  return {
    code,
    name,
    parent: null,
    foreignTwd: totalE8 * E8,
    trustTwd: 0,
    dealerTwd: 0,
    totalTwd: totalE8 * E8,
    turnoverTwd: 100 * E8,
    stocks: 3,
    topBuy: [],
    topSell: [],
    ...over,
  }
}

const day = (rows: SectorFlowRow[]): SectorFlowDay => ({
  date: '2026-10-02',
  coverage: { listed: true, otc: true },
  rows,
  marketTurnoverTwd: 1000 * E8,
  estimateListedTotalTwd: 0,
  officialListedTotalTwd: null,
  unpriced: 0,
})

/** Semiconductors: the parent nets +3.4 but IC 設計 alone sold 69.9 (the 2026-10-02 shape). */
const SEMI = [
  row('24', '半導體', 3.4),
  row('24:design', 'IC 設計', -69.9, { parent: '24' }),
  row('24:foundry', '晶圓製造', 31.6, { parent: '24' }),
  row('24:osat', '封裝測試', 9.5, { parent: '24' }),
  row('24:other', '設備、材料與其他', 32.2, { parent: '24' }),
]

const sides = (rows: SectorFlowRow[], metric: 'total' | 'foreign' = 'total') =>
  buildSides(buildView([day(rows)], 'day', metric)!)

describe('buildSides', () => {
  it('splits semiconductors into their parts instead of showing the parent', () => {
    const s = sides([row('28', '電子零組件', 233.9), row('25', '電腦及週邊', -113.8), ...SEMI])
    const names = [...s.buy.slices, ...s.sell.slices].map((x) => x.name)
    expect(names).not.toContain('半導體')
    expect(s.sell.slices.map((x) => x.name)).toContain('IC 設計')
    expect(s.buy.slices.map((x) => x.name)).toEqual(['電子零組件', '設備、材料與其他', '晶圓製造', '封裝測試'])
  })

  it('marks the semiconductor parts, and only them', () => {
    const s = sides([row('28', '電子零組件', 10), ...SEMI])
    expect(s.sell.slices.find((x) => x.name === 'IC 設計')?.semiconductor).toBe(true)
    expect(s.buy.slices.find((x) => x.name === '電子零組件')?.semiconductor).toBe(false)
  })

  it('totals each side and the net', () => {
    const s = sides([row('28', '電子零組件', 233.9), row('25', '電腦及週邊', -113.8), ...SEMI])
    // buy: 233.9 + 31.6 + 9.5 + 32.2 = 307.2; sell: 113.8 + 69.9 = 183.7
    expect(s.buy.totalTwd).toBeCloseTo(307.2 * E8, -3)
    expect(s.sell.totalTwd).toBeCloseTo(-183.7 * E8, -3)
    expect(s.netTwd).toBeCloseTo(123.5 * E8, -3)
    expect(s.buy.count).toBe(4)
    expect(s.sell.count).toBe(2)
  })

  it('keeps the biggest TOP_SLICES and folds the rest into 其他 with the count', () => {
    const many = Array.from({ length: 9 }, (_, i) => row(`b${i}`, `買${i}`, 10 - i))
    const s = sides(many)
    expect(s.buy.slices).toHaveLength(TOP_SLICES + 1)
    expect(s.buy.slices.slice(0, TOP_SLICES).map((x) => x.name)).toEqual(['買0', '買1', '買2', '買3', '買4'])
    const other = s.buy.slices[TOP_SLICES]
    expect(other).toMatchObject({ code: 'other', name: '其他 4 個類股', other: true })
    expect(other.netTwd).toBeCloseTo((5 + 4 + 3 + 2) * E8, -3)
    expect(s.buy.count).toBe(9)
  })

  it('does not fold anything when a side has no more than TOP_SLICES sectors', () => {
    const s = sides([row('a', 'A', 5), row('b', 'B', 3)])
    expect(s.buy.slices.some((x) => x.other)).toBe(false)
  })

  it('makes every side a whole: shares add up to 1', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`s${i}`, `賣${i}`, -(i + 1)))
    const s = sides(rows)
    expect(s.sell.slices.reduce((t, x) => t + x.share, 0)).toBeCloseTo(1, 9)
  })

  it('uses the chosen investor group', () => {
    const rows = [row('28', '電子零組件', 10, { foreignTwd: -4 * E8, trustTwd: 14 * E8 })]
    expect(sides(rows, 'total').buy.slices[0].netTwd).toBeCloseTo(10 * E8, -3)
    const foreign = sides(rows, 'foreign')
    expect(foreign.buy.slices).toEqual([])
    expect(foreign.sell.slices[0].netTwd).toBeCloseTo(-4 * E8, -3)
  })

  it('has an empty side when nothing was bought, or sold', () => {
    const onlySells = sides([row('a', 'A', -5)])
    expect(onlySells.buy).toEqual({ totalTwd: 0, count: 0, slices: [] })
    expect(onlySells.netTwd).toBeCloseTo(-5 * E8, -3)
  })

  it('leaves out sectors that did not move', () => {
    const s = sides([row('a', 'A', 0), row('b', 'B', 5)])
    expect(s.buy.count).toBe(1)
    expect(s.sell.count).toBe(0)
  })

  it('breaks ties by code, so the order is the same every day', () => {
    const s = sides([row('z', 'Z', 5), row('a', 'A', 5)])
    expect(s.buy.slices.map((x) => x.code)).toEqual(['a', 'z'])
  })
})

describe('ringArcs / rankPosition', () => {
  const slices = (shares: number[]) =>
    shares.map((share, i) => ({ code: `c${i}`, name: `c${i}`, netTwd: share, share, semiconductor: false, other: false }))

  it('sweeps clockwise from the top and adds up to the whole ring', () => {
    const arcs = ringArcs(slices([0.5, 0.25, 0.25]))
    expect(arcs.map((a) => a.start)).toEqual([0, 180, 270])
    expect(arcs.map((a) => a.sweep)).toEqual([180, 90, 90])
    expect(arcs.map((a) => a.mid)).toEqual([90, 225, 315])
    expect(arcs.reduce((t, a) => t + a.sweep, 0)).toBeCloseTo(360, 9)
  })

  it('puts the numeral just outside the ring, centred on the middle of its arc', () => {
    const half = RING.labelBox / 2
    // 12 o'clock: straight above the centre.
    const top = rankPosition(0)
    expect(top.left + half).toBeCloseTo(RING.center, 6)
    expect(top.top + half).toBeCloseTo(RING.center - RING.labelRadius, 6)
    // 3 o'clock: straight to the right.
    const right = rankPosition(90)
    expect(right.left + half).toBeCloseTo(RING.center + RING.labelRadius, 6)
    expect(right.top + half).toBeCloseTo(RING.center, 6)
    // Outside the ring's outer edge.
    expect(RING.labelRadius).toBeGreaterThan(RING.radius + RING.stroke / 2)
  })
})
