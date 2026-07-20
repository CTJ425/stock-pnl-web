import { describe, expect, it } from 'vitest'
import type { PriceQuote } from './priceProxy'
import { cacheTtlMs, isFresh } from './priceProxy'

function quote(asOf: string, stale = false): PriceQuote {
  return { price: 100, asOf, source: 'edge', stale }
}

describe('cacheTtlMs', () => {
  it('台股用短 TTL（60 秒）、其餘市場 10 分鐘', () => {
    expect(cacheTtlMs('TPE:2330')).toBe(60 * 1000)
    expect(cacheTtlMs('US:AAPL')).toBe(10 * 60 * 1000)
  })
})

describe('isFresh', () => {
  const now = Date.parse('2026-07-20T05:00:00Z')

  it('台股 60 秒內新鮮、超過即過期', () => {
    expect(isFresh('TPE:2330', quote('2026-07-20T04:59:30Z'), now)).toBe(true)
    expect(isFresh('TPE:2330', quote('2026-07-20T04:58:59Z'), now)).toBe(false)
  })

  it('美股 10 分鐘內新鮮、超過即過期', () => {
    expect(isFresh('US:AAPL', quote('2026-07-20T04:51:00Z'), now)).toBe(true)
    expect(isFresh('US:AAPL', quote('2026-07-20T04:49:59Z'), now)).toBe(false)
  })

  it('stale 快取價與無效 asOf 一律視為過期', () => {
    expect(isFresh('TPE:2330', quote('2026-07-20T04:59:59Z', true), now)).toBe(false)
    expect(isFresh('TPE:2330', quote('not-a-date'), now)).toBe(false)
    expect(isFresh('TPE:2330', undefined, now)).toBe(false)
  })
})
