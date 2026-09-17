import { describe, expect, it } from 'vitest'
import {
  SUMMARY_INDICES,
  indexChartUrl,
  lastCompletedClose,
  type IndexChartResponse,
} from './globalIndexClose.ts'
import { GSPC_PREOPEN, N225_FETCHED_AT, N225_MIDSESSION } from './discordTestFixtures.ts'

function clone(r: IndexChartResponse): IndexChartResponse {
  return JSON.parse(JSON.stringify(r))
}

describe('SUMMARY_INDICES', () => {
  it('is the eight user-approved indices in display order', () => {
    expect(SUMMARY_INDICES.map((i) => i.symbol)).toEqual([
      '^N225', '^KS11', '^KQ11', '^DJI', '^GSPC', '^IXIC', '^SOX', '^RUT',
    ])
  })
})

describe('indexChartUrl', () => {
  it('requests five daily bars and encodes the caret', () => {
    expect(indexChartUrl('^N225')).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EN225?interval=1d&range=5d',
    )
  })
})

describe('lastCompletedClose', () => {
  it('drops the bar of a session that is still open (real ^N225)', () => {
    const out = lastCompletedClose(N225_MIDSESSION, N225_FETCHED_AT)
    expect(out?.date).toBe('09/16')
    expect(out?.close).toBe(63923.0)
    expect(out?.changePct).toBeCloseTo(0.69135, 4)
  })

  it('keeps today once the session has ended', () => {
    const out = lastCompletedClose(N225_MIDSESSION, 1789626600)
    expect(out?.date).toBe('09/17')
    expect(out?.close).toBe(64096.69140625)
    expect(out?.changePct).toBeCloseTo(0.27172, 4)
  })

  it('keeps the last bar before the next session opens (real ^GSPC)', () => {
    const out = lastCompletedClose(GSPC_PREOPEN, N225_FETCHED_AT)
    expect(out?.date).toBe('09/16')
    expect(out?.close).toBe(7551.81005859375)
    expect(out?.changePct).toBeCloseTo(-0.44715, 4)
  })

  it('skips null closes', () => {
    const r = clone(GSPC_PREOPEN)
    r.chart!.result![0].indicators!.quote![0].close![3] = null
    const out = lastCompletedClose(r, N225_FETCHED_AT)
    expect(out?.close).toBe(7551.81005859375)
    expect(out?.changePct).toBeCloseTo(((7551.81005859375 - 7619.97998046875) / 7619.97998046875) * 100, 6)
  })

  it('orders bars by timestamp before choosing the last one', () => {
    const r = clone(GSPC_PREOPEN)
    const res = r.chart!.result![0]
    const order = [4, 0, 3, 1, 2]
    res.timestamp = order.map((i) => GSPC_PREOPEN.chart!.result![0].timestamp![i])
    res.indicators!.quote![0].close = order.map((i) => GSPC_PREOPEN.chart!.result![0].indicators!.quote![0].close![i])
    const out = lastCompletedClose(r, N225_FETCHED_AT)
    expect(out?.date).toBe('09/16')
    expect(out?.close).toBe(7551.81005859375)
    expect(out?.changePct).toBeCloseTo(-0.44715, 4)
  })

  it('ignores bars whose timestamp is missing', () => {
    const r = clone(GSPC_PREOPEN)
    r.chart!.result![0].timestamp = r.chart!.result![0].timestamp!.slice(0, 4)
    const out = lastCompletedClose(r, N225_FETCHED_AT)
    expect(out?.close).toBe(7585.72998046875)
  })

  it('treats a missing trading period as completed', () => {
    const r = clone(N225_MIDSESSION)
    delete r.chart!.result![0].meta!.currentTradingPeriod
    expect(lastCompletedClose(r, N225_FETCHED_AT)?.date).toBe('09/17')
  })

  it('returns a null change for a single bar', () => {
    const r = clone(GSPC_PREOPEN)
    r.chart!.result![0].timestamp = [1789565400]
    r.chart!.result![0].indicators!.quote![0].close = [7551.81005859375]
    expect(lastCompletedClose(r, N225_FETCHED_AT)).toEqual({ date: '09/16', close: 7551.81005859375, changePct: null })
  })

  it('returns null when nothing usable is left', () => {
    const r = clone(N225_MIDSESSION)
    r.chart!.result![0].timestamp = [1789603200]
    r.chart!.result![0].indicators!.quote![0].close = [64096.69140625]
    expect(lastCompletedClose(r, N225_FETCHED_AT)).toBeNull()
  })

  it.each([
    ['empty object', {}],
    ['null result', { chart: { result: null } }],
    ['no quote', { chart: { result: [{ timestamp: [1], indicators: {} }] } }],
  ])('returns null for %s', (_name, resp) => {
    expect(lastCompletedClose(resp as IndexChartResponse, N225_FETCHED_AT)).toBeNull()
  })
})
