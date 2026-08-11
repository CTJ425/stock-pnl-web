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
 * The TTL of Taiwan stocks has fluctuated with Taipei time since 0.6.36, so the system time will be fixed here before testing.
 * 05:00Z = Taipei 13:00 (intraday), use this to keep the existing 60-second case as it is.
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
    // 07:00Z = Taipei 15:00, 90 minutes after the close → 17 hours and 25 minutes until 08:25 the next day
    vi.setSystemTime(new Date('2026-07-20T07:00:00Z'))
    const closed = quote('2026-07-20T05:30:00Z', false, '13:30:00')
    expect(cacheTtlMs('TPE:2330', closed)).toBe((17 * 60 + 25) * 60 * 1000)
    expect(cacheTtlMs('US:AAPL')).toBe(10 * 60 * 1000)
  })

  /*
   * 0.6.37: No locking until matching time. The official area has been checked - the cache column written before the upgrade does not have this field.
   * But it was locked until the next morning, and the screen showed "Intraday" all the way, and the open high and low volume all showed "-".
   */
  it('收盤後：拿不到撮合時間的台股快取不鎖，改以 10 分鐘重試（0.6.42，AUDIT-02）', () => {
    // Still not locked (that is 0.6.37 / BUG-011), but no longer once a minute all night —— the fallback path
    // never reports a matching time, so an outage used to mean per-minute polling with no cap.
    vi.setSystemTime(new Date('2026-07-20T07:00:00Z'))
    expect(cacheTtlMs('TPE:2330')).toBe(10 * 60 * 1000)
    expect(cacheTtlMs('TPE:2330', quote('2026-07-20T03:00:00Z'))).toBe(10 * 60 * 1000)
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
    // Open the page at 22:00 in Taipei, and the cache is captured at the close of trading at 13:30 that day.
    vi.setSystemTime(new Date('2026-07-20T14:00:00Z'))
    const closed = quote('2026-07-20T05:30:00Z', false, '13:30:00')
    expect(isFresh('TPE:2330', closed, Date.parse('2026-07-20T14:00:00Z'))).toBe(true)
  })

  /*
    BUG-025. This case used to assert the opposite —— that a two-minute-old intraday snapshot is still
    "fresh" at 13:31 —— which is precisely how the quote card stayed on 「盤中」 for ten minutes after
    the close. Inside the 13:30–14:00 settle window the closing match is seconds away, so the row must
    expire on the normal one-minute poll.
  */
  it('13:30 剛過但撮合還沒落地：沉澱窗內每分鐘重問，不是等十分鐘（BUG-025）', () => {
    // 05:31Z = Taipei 13:31, the last matching time from the source is still at 13:29:58
    vi.setSystemTime(new Date('2026-07-20T05:31:00Z'))
    const pending = quote('2026-07-20T05:29:00Z', false, '13:29:58')
    // Two minutes old, close already passed → stale, so the next poll actually goes and fetches
    expect(isFresh('TPE:2330', pending, Date.parse('2026-07-20T05:31:00Z'))).toBe(false)
    // 30 秒前抓的仍算新鮮，維持盤中同樣的節奏而不是每一輪都打
    expect(isFresh('TPE:2330', pending, Date.parse('2026-07-20T05:29:30Z'))).toBe(true)
  })

  it('沉澱窗結束後（14:00 起）才退回十分鐘退避', () => {
    vi.setSystemTime(new Date('2026-07-20T08:00:00Z')) // Taipei 16:00
    const pending = quote('2026-07-20T07:58:00Z', false, '13:29:58')
    expect(isFresh('TPE:2330', pending, Date.parse('2026-07-20T08:00:00Z'))).toBe(true)
    expect(isFresh('TPE:2330', pending, Date.parse('2026-07-20T08:09:00Z'))).toBe(false)
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
