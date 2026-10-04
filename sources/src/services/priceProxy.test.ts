import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PriceQuote } from './priceProxy'
import { PRICE_CACHE_MAX_ENTRIES, cacheTtlMs, capPriceCache, isClosed, isFresh, tradeDateLabel } from './priceProxy'

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
    // Fetched at Taipei 13:30 → locked for 18h55m, to 08:25 the next day; measured from the fetch (BUG-086)
    vi.setSystemTime(new Date('2026-07-20T07:00:00Z'))
    const closed = quote('2026-07-20T05:30:00Z', false, '13:30:00')
    expect(cacheTtlMs('TPE:2330', closed)).toBe((18 * 60 + 55) * 60 * 1000)
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

describe('cacheTtlMs — 備援報價不鎖到隔天（Task 193 M7）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // TWSE daily list close, stamped by fetchPrices when Edge failed: no matching time, `source: 'twse'`.
  const fallback = (asOf: string): PriceQuote => ({ ...quote(asOf), source: 'twse', prevClose: null })

  it('收盤後抓到的備援價 60 秒就過期，不會被當成「今天收盤價」鎖到 08:25', () => {
    // Fetched at Taipei 14:30 (06:30Z); a 'edge' quote with no matching time would be locked to 08:25.
    vi.setSystemTime(new Date('2026-07-20T07:00:00Z'))
    expect(cacheTtlMs('TPE:2330', quote('2026-07-20T06:30:00Z'))).toBeGreaterThan(60 * 60 * 1000)
    expect(cacheTtlMs('TPE:2330', fallback('2026-07-20T06:30:00Z'))).toBe(60 * 1000)
  })

  it('isFresh：過一分鐘就會重新向 Edge 要價', () => {
    const fetchedAt = '2026-07-20T06:30:00Z'
    vi.setSystemTime(new Date('2026-07-20T06:30:30Z'))
    expect(isFresh('TPE:2330', fallback(fetchedAt), Date.now())).toBe(true)
    vi.setSystemTime(new Date('2026-07-20T06:31:30Z'))
    expect(isFresh('TPE:2330', fallback(fetchedAt), Date.now())).toBe(false)
  })

  it('美股不受影響', () => {
    expect(cacheTtlMs('US:AAPL', fallback('2026-07-20T06:30:00Z'))).toBe(10 * 60 * 1000)
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

  it('交易日是週末的報價是測試盤撮合，一律視為過期（BUG-110）', () => {
    // Sunday 2026-10-04 09:07 Taipei: MIS served test-session matches with d=20261004
    vi.setSystemTime(new Date('2026-10-04T02:00:00Z'))
    const test = { ...quote('2026-10-04T01:07:46Z', false, '09:07:33'), tradeDate: '20261004' }
    expect(isFresh('TPE:0050', test, Date.parse('2026-10-04T02:00:00Z'))).toBe(false)
    // The same row without the weekend date is a Yahoo-style weekend fetch, locked until Monday
    expect(isFresh('TPE:0050', { ...test, tradeTime: null, tradeDate: null }, Date.parse('2026-10-04T02:00:00Z'))).toBe(true)
  })

  it('交易日是平日休市日的報價同樣視為過期（2026-10-09 國慶日補假）', () => {
    vi.setSystemTime(new Date('2026-10-09T02:00:00Z'))
    const test = { ...quote('2026-10-09T01:07:46Z', false, '09:07:33'), tradeDate: '20261009' }
    expect(isFresh('TPE:0050', test, Date.parse('2026-10-09T02:00:00Z'))).toBe(false)
    expect(isFresh('TPE:0050', { ...test, tradeTime: null, tradeDate: null }, Date.parse('2026-10-09T02:00:00Z'))).toBe(true)
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

  /*
   * BUG-050 split this case in two. The ten-minute backoff belongs to a row fetched *inside* the
   * session: that row can still be an intraday snapshot, and locking one is BUG-011. A row fetched
   * after 14:00 is the day's final available price even when the source cannot prove it —— a thin
   * ticker with no closing-auction trade keeps `13:29:58` for ever —— so that row locks like a
   * settled close instead of refetching the same number every ten minutes until the next morning.
   */
  it('沉澱窗結束後（14:00 起）：盤中抓到的列退回十分鐘退避', () => {
    vi.setSystemTime(new Date('2026-07-20T08:00:00Z')) // Taipei 16:00
    const pending = quote('2026-07-20T05:29:00Z', false, '13:29:58') // 台北 13:29 抓的
    expect(cacheTtlMs('TPE:2330', pending)).toBe(10 * 60 * 1000)
    expect(isFresh('TPE:2330', pending, Date.parse('2026-07-20T05:38:00Z'))).toBe(true)
    expect(isFresh('TPE:2330', pending, Date.parse('2026-07-20T05:40:00Z'))).toBe(false)
  })

  it('沉澱窗結束後（14:00 起）：收盤後才抓到的列鎖到隔天 08:25（BUG-050）', () => {
    vi.setSystemTime(new Date('2026-07-20T08:00:00Z')) // Taipei 16:00
    const late = quote('2026-07-20T07:58:00Z', false, '13:29:58') // 台北 15:58 抓的
    expect(cacheTtlMs('TPE:2330', late)).toBe((16 * 60 + 27) * 60 * 1000)
    expect(isFresh('TPE:2330', late, Date.parse('2026-07-20T08:09:00Z'))).toBe(true)
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

/**
 * BUG-050: `isClosed` used to require a matching time at or after 13:30. Two real TW sources never
 * satisfy that: the Yahoo fallback reports no matching time at all, and a thin ticker with no
 * closing-auction trade keeps an earlier one. Both made the quote card print 「盤中」 all evening.
 *
 * The inference reads the quote's own fetch time on the Taipei clock, so it needs the market: the
 * US session runs while Taipei is past 14:00, and inferring a close there would be wrong.
 */
describe('isClosed — 收盤後推論 (BUG-050)', () => {
  /** Taipei 14:05 — after the 14:00 settle window */
  const AFTER_SETTLE = '2026-08-05T06:05:00.000Z'
  /** Taipei 11:00 — inside the session */
  const INTRADAY = '2026-08-05T03:00:00.000Z'
  /** Taipei 22:00 — the US session is open, the TW one closed hours ago */
  const US_SESSION = '2026-08-05T14:00:00.000Z'

  it('撮合時間到 13:30 仍然直接判定已收盤', () => {
    expect(isClosed(quote(INTRADAY, false, '13:30:00'))).toBe(true)
  })

  it('沒有指定市場時維持原行為，不做推論', () => {
    expect(isClosed(quote(AFTER_SETTLE, false, null))).toBe(false)
  })

  it('台股：沉澱窗之後抓到的報價沒有撮合時間也算已收盤', () => {
    expect(isClosed(quote(AFTER_SETTLE, false, null), 'TPE')).toBe(true)
  })

  it('台股：冷門股最後撮合早於 13:30，收盤後抓到一樣算已收盤', () => {
    expect(isClosed(quote(AFTER_SETTLE, false, '11:30:00'), 'TPE')).toBe(true)
  })

  it('台股：盤中抓到的報價仍然是盤中', () => {
    expect(isClosed(quote(INTRADAY, false, null), 'TPE')).toBe(false)
  })

  it('美股不套用台北時鐘的推論', () => {
    expect(isClosed(quote(US_SESSION, false, null), 'US')).toBe(false)
  })

  it('沒有報價時為 false', () => {
    expect(isClosed(null, 'TPE')).toBe(false)
    expect(isClosed(undefined, 'TPE')).toBe(false)
  })
})

// Task 193: the localStorage price cache never evicted anything.
describe('capPriceCache', () => {
  const at = (minutesAgo: number) => quote(new Date(Date.UTC(2026, 6, 20, 5, 0) - minutesAgo * 60_000).toISOString())

  it('leaves a small cache alone (same object, nothing copied)', () => {
    const map = { 'TPE:2330': at(0) }
    expect(capPriceCache(map)).toBe(map)
  })

  it('keeps the newest quotes and drops the oldest past the bound', () => {
    const map: Record<string, PriceQuote> = {}
    for (let i = 0; i < PRICE_CACHE_MAX_ENTRIES + 25; i++) map[`TPE:${1000 + i}`] = at(i)
    const capped = capPriceCache(map)
    expect(Object.keys(capped)).toHaveLength(PRICE_CACHE_MAX_ENTRIES)
    expect(capped['TPE:1000']).toBeDefined() // newest (0 minutes ago)
    expect(capped[`TPE:${1000 + PRICE_CACHE_MAX_ENTRIES + 24}`]).toBeUndefined() // oldest
  })

  it('treats an unreadable asOf as the oldest', () => {
    const map = { 'TPE:1': quote('garbage'), 'TPE:2': at(0), 'TPE:3': at(1) }
    expect(Object.keys(capPriceCache(map, 2)).sort()).toEqual(['TPE:2', 'TPE:3'])
  })
})
