import { beforeEach, describe, expect, it, vi } from 'vitest'

const { downloadReportsJson } = vi.hoisted(() => ({ downloadReportsJson: vi.fn() }))
vi.mock('./reportsBucket', () => ({ downloadReportsJson }))

import { fetchSectorFlow } from './sectorFlowProxy'

const row = (over: Record<string, unknown> = {}) => ({
  code: '24',
  name: '半導體',
  parent: null,
  foreignTwd: 1,
  trustTwd: 2,
  dealerTwd: 3,
  totalTwd: 6,
  turnoverTwd: 100,
  stocks: 4,
  topBuy: [{ ticker: '2330', name: '台積電', netTwd: 5 }],
  topSell: [],
  ...over,
})
const day = (date: string, over: Record<string, unknown> = {}) => ({
  date,
  coverage: { listed: true, otc: true },
  rows: [row()],
  marketTurnoverTwd: 1000,
  estimateListedTotalTwd: 10,
  officialListedTotalTwd: 11,
  unpriced: 0,
  ...over,
})

describe('fetchSectorFlow', () => {
  beforeEach(() => downloadReportsJson.mockReset())

  it('reads the file the Edge Function writes', async () => {
    downloadReportsJson.mockResolvedValue({ schema: 1, asOf: 't', days: [day('2026-10-02')] })
    const r = await fetchSectorFlow()
    expect(downloadReportsJson).toHaveBeenCalledWith('market/sector_flow.json')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.data.days[0].rows[0]).toMatchObject({ code: '24', totalTwd: 6, parent: null })
      expect(r.data.days[0].rows[0].topBuy[0].name).toBe('台積電')
    }
  })

  it('says empty when there is no file, invalid when there is one that does not parse', async () => {
    downloadReportsJson.mockResolvedValue(null)
    expect((await fetchSectorFlow()).kind).toBe('empty')
    downloadReportsJson.mockResolvedValue({ schema: 0, days: [day('2026-10-02')] })
    expect((await fetchSectorFlow()).kind).toBe('invalid')
    downloadReportsJson.mockResolvedValue({ schema: 1, days: 'nope' })
    expect((await fetchSectorFlow()).kind).toBe('invalid')
    downloadReportsJson.mockResolvedValue({ schema: 1, days: [{ date: 'x' }] })
    expect((await fetchSectorFlow()).kind).toBe('invalid')
  })

  it('accepts a newer schema (the backend only ever adds fields)', async () => {
    downloadReportsJson.mockResolvedValue({ schema: 7, asOf: 't', days: [day('2026-10-02')] })
    expect((await fetchSectorFlow()).kind).toBe('ok')
  })

  it('drops a broken row or day instead of failing the whole file, and sorts days oldest first', async () => {
    downloadReportsJson.mockResolvedValue({
      schema: 1,
      asOf: 't',
      days: [
        day('2026-10-02', { rows: [row(), row({ code: 5 }), row({ totalTwd: 'x' })] }),
        day('2026-10-01'),
        { ...day('2026-09-30'), rows: [] },
      ],
    })
    const r = await fetchSectorFlow()
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.data.days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02'])
      expect(r.data.days[1].rows).toHaveLength(1)
    }
  })

  it('keeps a missing official total as null, never 0', async () => {
    downloadReportsJson.mockResolvedValue({
      schema: 1,
      asOf: 't',
      days: [day('2026-10-02', { officialListedTotalTwd: null })],
    })
    const r = await fetchSectorFlow()
    if (r.kind === 'ok') expect(r.data.days[0].officialListedTotalTwd).toBeNull()
  })
})
