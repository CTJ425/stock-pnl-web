import { describe, expect, it } from 'vitest'
import { twMaxTtlMs, twQuoteTtlMs } from '../../supabase/functions/stock-price/quoteWindow.ts'

const MIN = 60 * 1000
const HOUR = 60 * MIN
/** Retry interval for a quote that cannot be confirmed as settled, outside trading hours (0.6.42) */
const RETRY = 10 * MIN

/** Taipei Time → Date (Taiwan fixed +8)*/
const taipei = (ymd: string, hms: string) => new Date(`${ymd}T${hms}+08:00`)

describe('twQuoteTtlMs', () => {
  it('盤中（08:25–13:30）維持 60 秒', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '08:25:00'))).toBe(MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '09:00:00'))).toBe(MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:29:59'))).toBe(MIN)
  })

  it('08:25 前一秒仍在鎖定中，且只剩 1 秒就解鎖', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '08:24:59'), '13:30:00')).toBe(1000)
  })

  // The following "locked" cases always include a closing and finalizing matching time - there is no way to confirm without it, and the rule is no locking
  it('13:30 一到就鎖到隔天 08:25', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:30:00'), '13:30:00')).toBe(18 * HOUR + 55 * MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '15:23:00'), '13:30:00')).toBe(17 * HOUR + 2 * MIN)
  })

  it('跨午夜後算到當天早上的 08:25，不是隔天', () => {
    expect(twQuoteTtlMs(taipei('2026-08-06', '00:00:00'), '13:30:00')).toBe(8 * HOUR + 25 * MIN)
    expect(twQuoteTtlMs(taipei('2026-08-06', '08:00:00'), '13:30:00')).toBe(25 * MIN)
  })

  it('週末不需要交易日曆：13:30 後照樣落入長 TTL', () => {
    // 2026-08-08 is Saturday
    expect(twQuoteTtlMs(taipei('2026-08-08', '20:00:00'), '13:30:00')).toBe(12 * HOUR + 25 * MIN)
  })

  /*
   * Only lock quotes that are "confirmed to be the finalized closing value" (0.6.37 revision).
   *
   * 0.6.36 Originally, all locks were locked after 13:30. Even if the matching time could not be obtained, the lock was still locked - something happened in the official area on the same day:
   * The cache column written before the upgrade does not have trade_time. It is a snapshot of a certain moment in the disk, but it is locked to 08:25 the next day.
   * The screen displays "Intraday" all the way, and the opening high and low volume are all "-".
   */
  it('撮合時間未達 13:30 就不鎖夜（收盤撮合尚未落地）', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:31:00'), '13:30:00')).toBe(18 * HOUR + 54 * MIN)
  })

  /*
    BUG-025：13:30–14:00 是「收盤撮合還沒落地」的正常暫態，不是 AUDIT-02 講的來源斷線。
    0.6.42 把十分鐘退避套用到 13:30 之後的每一刻，於是 13:30:30 那一輪拿著 13:29 的盤中快照
    直接被判為「還新鮮十分鐘」——行情卡就一路印「盤中」與收盤前的價量到約 13:40，
    連手動重新整理都救不了（Edge 的 price_cache 也是用這支函式判定）。
  */
  it('13:30–14:00 沉澱窗內，未定案的報價維持每分鐘重試（BUG-025）', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:30:00'), '13:29:58')).toBe(MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:31:00'), '13:29:58')).toBe(MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:59:59'), '13:29:58')).toBe(MIN)
    // 沉澱窗內就算完全沒有撮合時間（Yahoo 備援）也照樣快輪，才追得回收盤價
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:45:00'), null)).toBe(MIN)
  })

  it('沉澱窗只護未定案的：拿到 13:30:00 就立刻鎖夜，不會白輪半小時', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:31:00'), '13:30:00')).toBe(18 * HOUR + 54 * MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:59:00'), '13:30:00')).toBe(18 * HOUR + 26 * MIN)
  })

  it('過了 14:00 退回十分鐘退避 —— 沉澱窗有界，不會變成整夜每分鐘輪詢', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '14:00:00'), '11:05:23')).toBe(RETRY)
    expect(twQuoteTtlMs(taipei('2026-08-05', '20:00:00'), '11:05:23')).toBe(RETRY)
    expect(twQuoteTtlMs(taipei('2026-08-05', '14:00:00'), '13:30:00')).toBe(18 * HOUR + 25 * MIN)
  })

  it('沒有撮合時間就不鎖，但改為 10 分鐘重試而非每分鐘（0.6.42，AUDIT-02）', () => {
    /*
      Not locking is 0.6.37's fix and must stay —— such a row may be an intraday snapshot (BUG-011).
      What 0.6.42 adds is a bound: the Yahoo fallback never reports a matching time, so an outage used to mean
      per-minute polling all night for every user. Ten minutes keeps the recovery, at a tenth of the traffic.
    */
    expect(twQuoteTtlMs(taipei('2026-08-05', '16:55:00'), null)).toBe(RETRY)
    expect(twQuoteTtlMs(taipei('2026-08-05', '16:55:00'))).toBe(RETRY)
    // The same goes for early morning, otherwise the old train will last all the way until morning
    expect(twQuoteTtlMs(taipei('2026-08-06', '03:00:00'), null)).toBe(RETRY)
  })
})

describe('twMaxTtlMs（DB 粗篩的下界）', () => {
  it('以「已定案」為假設取上界，不會把昨天的收盤價濾掉', () => {
    // Calling twQuoteTtlMs(now) directly returns the short retry interval (no matching time given), and a coarse
    // filter built on that would drop yesterday's settled close.
    const now = taipei('2026-08-05', '20:00:00')
    expect(twQuoteTtlMs(now)).toBe(RETRY)
    // Back to today's 08:25: a row fetched after it can still be locked, one fetched before it cannot (BUG-086)
    expect(twMaxTtlMs(now)).toBe(11 * HOUR + 35 * MIN)
  })

  it('盤中與盤後一致地回傳該時段的上界', () => {
    expect(twMaxTtlMs(taipei('2026-08-05', '10:00:00'))).toBe(MIN)
    // Before 08:25 the latest resume is yesterday's, so yesterday's settled close is still in range
    expect(twMaxTtlMs(taipei('2026-08-06', '03:00:00'))).toBe(18 * HOUR + 35 * MIN)
  })
})

/**
 * BUG-050: a TW quote fetched after the settle window is that day's final available price, even when
 * the source cannot report a matching time (Yahoo fallback returns none) or the last match predates
 * 13:30 (a thin ticker with no closing-auction trade). 0.6.42 refetched such a row every ten minutes
 * all night and never showed it as settled.
 *
 * The third argument is the fetch time of the cached row. It must stay optional: without it the
 * 0.6.42 retry behaviour is unchanged, and a row fetched *before* 14:00 must still never lock —
 * that row can be an intraday snapshot, which is the defect BUG-011 was about.
 */
describe('twQuoteTtlMs — 沉澱窗之後抓到的報價鎖定 (BUG-050)', () => {
  it('未帶 fetchedAt 時維持 0.6.42 的十分鐘退避', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '15:00:00'), null)).toBe(RETRY)
    expect(twQuoteTtlMs(taipei('2026-08-05', '15:00:00'), '11:30:00')).toBe(RETRY)
  })

  it('沉澱窗之後抓到的報價鎖到隔天 08:25，即使來源沒有撮合時間', () => {
    expect(
      twQuoteTtlMs(taipei('2026-08-05', '15:00:00'), null, taipei('2026-08-05', '14:30:00')),
    ).toBe(17 * HOUR + 55 * MIN)
  })

  it('冷門股最後撮合早於 13:30，收盤後抓到一樣鎖定', () => {
    expect(
      twQuoteTtlMs(taipei('2026-08-05', '15:00:00'), '11:30:00', taipei('2026-08-05', '14:05:00')),
    ).toBe(18 * HOUR + 20 * MIN)
  })

  it('盤中抓到的快照不鎖定 —— 這正是 BUG-011 的原始缺陷', () => {
    expect(
      twQuoteTtlMs(taipei('2026-08-05', '15:00:00'), null, taipei('2026-08-05', '13:00:00')),
    ).toBe(RETRY)
  })

  it('13:30–14:00 沉澱窗仍以 60 秒輪詢，不因 fetchedAt 提前鎖定', () => {
    expect(
      twQuoteTtlMs(taipei('2026-08-05', '13:45:00'), null, taipei('2026-08-05', '13:45:00')),
    ).toBe(MIN)
  })

  it('過了午夜，昨天收盤後抓到的報價仍鎖到今天早上的 08:25', () => {
    // TTL is measured from the fetch (BUG-086): 14:05 → 08:25 is 18h20m, and at 02:00 the row is 11h55m old
    expect(
      twQuoteTtlMs(taipei('2026-08-06', '02:00:00'), null, taipei('2026-08-05', '14:05:00')),
    ).toBe(18 * HOUR + 20 * MIN)
  })

  it('凌晨（08:25 前）抓到的報價同樣視為收盤後', () => {
    expect(
      twQuoteTtlMs(taipei('2026-08-06', '03:00:00'), null, taipei('2026-08-06', '02:00:00')),
    ).toBe(6 * HOUR + 25 * MIN)
  })
})

/**
 * BUG-086: the TTL used to be "time left until the next 08:25, from now", while both callers compare it
 * with the row's age. A settled row fetched after Monday's close therefore stayed "fresh" on Tuesday
 * afternoon until about 15:45, and a ticker nobody opened during Tuesday's session showed Monday's close.
 * Real case, DEV 2026-09-29: 0050 and 2303 kept the 9/24 close (fetched 9/28 23:01) after 9/29's close.
 */
describe('twQuoteTtlMs — 鎖定期從抓價時間起算 (BUG-086)', () => {
  const fresh = (now: Date, tradeTime: string | null, fetchedAt: Date) =>
    now.getTime() - fetchedAt.getTime() < twQuoteTtlMs(now, tradeTime, fetchedAt)

  it('前一個休市日抓到的收盤價，下一個交易日收盤後就過期', () => {
    const fetchedAt = taipei('2026-09-28', '23:01:16')
    for (const hms of ['13:31:00', '14:10:00', '15:00:00', '15:40:00', '20:00:00']) {
      expect(fresh(taipei('2026-09-29', hms), '13:30:00', fetchedAt)).toBe(false)
    }
  })

  it('收盤後抓到的收盤價整夜有效，到隔天 08:25 才過期', () => {
    const fetchedAt = taipei('2026-09-29', '13:30:30')
    expect(fresh(taipei('2026-09-29', '20:00:00'), '13:30:00', fetchedAt)).toBe(true)
    expect(fresh(taipei('2026-09-30', '03:00:00'), '13:30:00', fetchedAt)).toBe(true)
    expect(fresh(taipei('2026-09-30', '08:24:59'), '13:30:00', fetchedAt)).toBe(true)
    expect(fresh(taipei('2026-09-30', '08:25:00'), '13:30:00', fetchedAt)).toBe(false)
  })

  it('盤中抓到的昨日收盤（撮合時間 13:30:00）不算今天定案', () => {
    // Before 08:30 trial trading MIS still returns yesterday's close with t = 13:30:00
    const fetchedAt = taipei('2026-09-29', '08:26:00')
    expect(fresh(taipei('2026-09-29', '15:00:00'), '13:30:00', fetchedAt)).toBe(false)
  })

  it('DB 粗篩下界涵蓋所有仍有效的列', () => {
    const now = taipei('2026-09-30', '07:00:00')
    const fetchedAt = taipei('2026-09-29', '13:30:30')
    expect(fresh(now, '13:30:00', fetchedAt)).toBe(true)
    expect(now.getTime() - fetchedAt.getTime()).toBeLessThanOrEqual(twMaxTtlMs(now))
  })
})
