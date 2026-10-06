import { describe, expect, it } from 'vitest'
import { fugleDailyRows, fugleDateRanges, splitAdjust, yearsBack } from './fugleDaily'
import type { DailyRow } from './twDaily'

// 2026-10-06 15:00 Taipei: after the close, so today's bar is kept.
const AFTER_CLOSE = new Date('2026-10-06T07:00:00Z')
// 2026-10-06 10:00 Taipei: in session, so today's bar is dropped.
const IN_SESSION = new Date('2026-10-06T02:00:00Z')

describe('fugleDateRanges', () => {
  it('keeps one year in a single piece (the span Fugle accepted on 2026-10-06)', () => {
    expect(fugleDateRanges('2025-10-07', '2026-10-06')).toEqual([['2025-10-07', '2026-10-06']])
  })

  it('splits five years into pieces under a year, contiguous and ending on `to`', () => {
    const ranges = fugleDateRanges(yearsBack(AFTER_CLOSE, 5), '2026-10-06')
    expect(ranges[0][0]).toBe('2021-10-07')
    expect(ranges[ranges.length - 1][1]).toBe('2026-10-06')
    for (const [from, to] of ranges) {
      expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBeLessThanOrEqual(364)
    }
    for (let i = 1; i < ranges.length; i++) {
      expect((Date.parse(ranges[i][0]) - Date.parse(ranges[i - 1][1])) / 86_400_000).toBe(1)
    }
  })
})

describe('yearsBack', () => {
  it('starts the day after the same date a year ago (Yahoo range=1y)', () => {
    expect(yearsBack(AFTER_CLOSE, 1)).toBe('2025-10-07')
  })
})

describe('fugleDailyRows', () => {
  // 2330, real Fugle rows (desc, as Fugle sends them); volumes equal TWSE STOCK_DAY 成交股數.
  const resp = {
    data: [
      { date: '2026-10-06', open: 2575, high: 2590, low: 2565, close: 2585, volume: 19953802, change: 10 },
      { date: '2026-10-05', open: 2550, high: 2580, low: 2545, close: 2575, volume: 26800187, change: 75 },
      { date: '2026-10-02', open: 2505, high: 2515, low: 2495, close: 2500, volume: 15792206, change: -10 },
    ],
  }

  it('sorts oldest first and keeps shares as volume', () => {
    expect(fugleDailyRows([resp], AFTER_CLOSE)).toEqual([
      ['2026-10-02', 2505, 2515, 2495, 2500, 15792206],
      ['2026-10-05', 2550, 2580, 2545, 2575, 26800187],
      ['2026-10-06', 2575, 2590, 2565, 2585, 19953802],
    ])
  })

  it("drops today's unfinished bar before 13:30", () => {
    expect(fugleDailyRows([resp], IN_SESSION).map((r) => r[0])).toEqual(['2026-10-02', '2026-10-05'])
  })

  it('merges pieces and de-duplicates a date seen twice', () => {
    const rows = fugleDailyRows([resp, { data: [resp.data[2]] }], AFTER_CLOSE)
    expect(rows).toHaveLength(3)
  })

  it('skips malformed rows', () => {
    expect(fugleDailyRows([{ data: [{ date: '2026-10-02', open: 1 }, { date: 'x', open: 1, high: 1, low: 1, close: 1 }] }])).toEqual([])
  })
})

describe('splitAdjust', () => {
  // 0050, real raw Fugle rows around the 1:4 split on 2025-06-18 (adjusted=false).
  const raw = [
    { row: ['2025-06-10', 184.9, 189, 184.9, 188.65, 31483080] as DailyRow, change: 4.95 },
    { row: ['2025-06-18', 47.5, 47.6, 47.3, 47.57, 252639825] as DailyRow, change: 0.41 },
  ]

  it('scales the days before a split like Yahoo does (prices ÷4, volume ×4)', () => {
    const [before, after] = splitAdjust(raw)
    // reference 47.16 / previous close 188.65
    const f = (47.57 - 0.41) / 188.65
    expect(before[4]).toBeCloseTo(188.65 * f, 4)
    expect(before[4]).toBeCloseTo(47.16, 2)
    expect(before[5]).toBe(Math.round(31483080 / f))
    expect(after).toEqual(raw[1].row)
  })

  it('leaves an ordinary ex-dividend gap alone (Yahoo does not dividend-adjust)', () => {
    // 2330 2026-10-05 → 06: reference 2575 = previous close; a 1% cash dividend would be 0.99.
    const rows = [
      { row: ['2026-10-05', 2550, 2580, 2545, 2575, 1] as DailyRow, change: 75 },
      { row: ['2026-10-06', 2575, 2590, 2565, 2585, 1] as DailyRow, change: 2585 - 2575 * 0.99 },
    ]
    expect(splitAdjust(rows)).toEqual(rows.map((r) => r.row))
  })

  it('ignores a row with no change field', () => {
    const rows = [
      { row: ['2025-06-10', 1, 1, 1, 188.65, 1] as DailyRow, change: null },
      { row: ['2025-06-18', 1, 1, 1, 47.57, 1] as DailyRow, change: null },
    ]
    expect(splitAdjust(rows)).toEqual(rows.map((r) => r.row))
  })
})
