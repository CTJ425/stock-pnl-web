import { describe, expect, it } from 'vitest'
import { twMaxTtlMs, twQuoteTtlMs } from '../../supabase/functions/stock-price/quoteWindow.ts'

const MIN = 60 * 1000
const HOUR = 60 * MIN

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
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:31:00'), '13:29:58')).toBe(MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:31:00'), '13:30:00')).toBe(18 * HOUR + 54 * MIN)
  })

  it('過了 14:00 仍然只鎖定案值 —— 盤中時刻的快照不會被凍一整夜', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '14:00:00'), '11:05:23')).toBe(MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '20:00:00'), '11:05:23')).toBe(MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '14:00:00'), '13:30:00')).toBe(18 * HOUR + 25 * MIN)
  })

  it('沒有撮合時間就不鎖（升級前的舊快取、Yahoo / OpenAPI 備援）', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '16:55:00'), null)).toBe(MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '16:55:00'))).toBe(MIN)
    // The same goes for early morning, otherwise the old train will last all the way until morning
    expect(twQuoteTtlMs(taipei('2026-08-06', '03:00:00'), null)).toBe(MIN)
  })
})

describe('twMaxTtlMs（DB 粗篩的下界）', () => {
  it('以「已定案」為假設取上界，不會把昨天的收盤價濾掉', () => {
    // Directly using twQuoteTtlMs(now) will return 60 seconds (without matching time), and the coarse filter will miss the final cache.
    const now = taipei('2026-08-05', '20:00:00')
    expect(twQuoteTtlMs(now)).toBe(MIN)
    expect(twMaxTtlMs(now)).toBe(12 * HOUR + 25 * MIN)
  })

  it('盤中與盤後一致地回傳該時段的上界', () => {
    expect(twMaxTtlMs(taipei('2026-08-05', '10:00:00'))).toBe(MIN)
    expect(twMaxTtlMs(taipei('2026-08-06', '03:00:00'))).toBe(5 * HOUR + 25 * MIN)
  })
})
