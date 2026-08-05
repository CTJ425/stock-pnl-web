import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PriceQuote } from './priceProxy'
import { cacheTtlMs, isClosed, isFresh, tradeDateLabel } from './priceProxy'

function quote(asOf: string, stale = false, tradeTime: string | null = null): PriceQuote {
  return {
    price: 100,
    prevClose: 99,
    open: null,
    high: null,
    low: null,
    volume: null,
    tradeDate: null,
    tradeTime,
    trial: false,
    asOf,
    source: 'edge',
    stale,
  }
}

/*
 * 台股 TTL 自 0.6.36 起隨台北時間浮動，所以這裡一律固定系統時間再測。
 * 05:00Z = 台北 13:00（盤中），沿用它讓既有的 60 秒案例維持原意。
 */
const INTRADAY = '2026-07-20T05:00:00Z'

describe('cacheTtlMs', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('盤中：台股 60 秒、其餘市場 10 分鐘', () => {
    vi.setSystemTime(new Date(INTRADAY))
    expect(cacheTtlMs('TPE:2330')).toBe(60 * 1000)
    expect(cacheTtlMs('US:AAPL')).toBe(10 * 60 * 1000)
  })

  it('收盤後：帶收盤定案值的台股鎖到隔天 08:25，美股不受影響', () => {
    // 07:00Z = 台北 15:00，收盤後 90 分鐘 → 距離隔天 08:25 還有 17 小時 25 分
    vi.setSystemTime(new Date('2026-07-20T07:00:00Z'))
    const closed = quote('2026-07-20T05:30:00Z', false, '13:30:00')
    expect(cacheTtlMs('TPE:2330', closed)).toBe((17 * 60 + 25) * 60 * 1000)
    expect(cacheTtlMs('US:AAPL')).toBe(10 * 60 * 1000)
  })

  /*
   * 0.6.37：沒有撮合時間就不鎖。正式區踩過 —— 升級前寫入的快取列沒有這個欄位，
   * 卻被鎖到隔天早上，畫面一路顯示「盤中」、開高低量全是「—」。
   */
  it('收盤後：拿不到撮合時間的台股快取不鎖，會重抓', () => {
    vi.setSystemTime(new Date('2026-07-20T07:00:00Z'))
    expect(cacheTtlMs('TPE:2330')).toBe(60 * 1000)
    expect(cacheTtlMs('TPE:2330', quote('2026-07-20T03:00:00Z'))).toBe(60 * 1000)
  })
})

describe('isFresh', () => {
  const now = Date.parse(INTRADAY)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(INTRADAY))
  })
  afterEach(() => vi.useRealTimers())

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

  it('收盤價在整個夜間都算新鮮 —— 這是「收盤後不再抓價」的實際效果', () => {
    // 台北 22:00 打開頁面，快取是當天 13:30 收盤抓的
    vi.setSystemTime(new Date('2026-07-20T14:00:00Z'))
    const closed = quote('2026-07-20T05:30:00Z', false, '13:30:00')
    expect(isFresh('TPE:2330', closed, Date.parse('2026-07-20T14:00:00Z'))).toBe(true)
  })

  it('13:30 剛過但撮合還沒落地的過渡值不鎖夜，仍走 60 秒', () => {
    // 05:31Z = 台北 13:31，來源回的最後撮合時間還停在 13:29:58
    vi.setSystemTime(new Date('2026-07-20T05:31:00Z'))
    const pending = quote('2026-07-20T05:29:00Z', false, '13:29:58')
    expect(isFresh('TPE:2330', pending, Date.parse('2026-07-20T05:31:00Z'))).toBe(false)
  })
})

describe('isClosed / tradeDateLabel', () => {
  it('撮合時間達 13:30 才算收盤定案', () => {
    expect(isClosed(quote('x', false, '13:30:00'))).toBe(true)
    expect(isClosed(quote('x', false, '13:29:59'))).toBe(false)
    expect(isClosed(quote('x', false, null))).toBe(false)
    expect(isClosed(null)).toBe(false)
  })

  it('交易日轉成 M/D，格式不符回 null', () => {
    expect(tradeDateLabel('20260805')).toBe('8/5')
    expect(tradeDateLabel('20261231')).toBe('12/31')
    expect(tradeDateLabel('2026-08-05')).toBeNull()
    expect(tradeDateLabel(null)).toBeNull()
  })
})
