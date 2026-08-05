import { describe, expect, it } from 'vitest'
import { twQuoteTtlMs } from '../../supabase/functions/stock-price/quoteWindow.ts'

const MIN = 60 * 1000
const HOUR = 60 * MIN

/** 台北時間 → Date（台灣固定 +8） */
const taipei = (ymd: string, hms: string) => new Date(`${ymd}T${hms}+08:00`)

describe('twQuoteTtlMs', () => {
  it('盤中（08:25–13:30）維持 60 秒', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '08:25:00'))).toBe(MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '09:00:00'))).toBe(MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:29:59'))).toBe(MIN)
  })

  it('08:25 前一秒仍在鎖定中，且只剩 1 秒就解鎖', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '08:24:59'))).toBe(1000)
  })

  it('13:30 一到就鎖到隔天 08:25', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:30:00'))).toBe(18 * HOUR + 55 * MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '15:23:00'))).toBe(17 * HOUR + 2 * MIN)
  })

  it('跨午夜後算到當天早上的 08:25，不是隔天', () => {
    expect(twQuoteTtlMs(taipei('2026-08-06', '00:00:00'))).toBe(8 * HOUR + 25 * MIN)
    expect(twQuoteTtlMs(taipei('2026-08-06', '08:00:00'))).toBe(25 * MIN)
  })

  it('週末不需要交易日曆：13:30 後照樣落入長 TTL', () => {
    // 2026-08-08 是週六
    expect(twQuoteTtlMs(taipei('2026-08-08', '20:00:00'))).toBe(12 * HOUR + 25 * MIN)
  })

  /*
   * 13:30–14:00 的過渡窗：收盤撮合還沒落地時抓到的不是定案值，
   * 把它鎖上一整夜就等於整晚顯示一個錯的收盤價。
   */
  it('13:30–14:00 之間，來源時間未達 13:30 就不鎖夜', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:31:00'), '13:29:58')).toBe(MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:31:00'), '13:30:00')).toBe(18 * HOUR + 54 * MIN)
  })

  it('過了 14:00 就不再看來源時間，一律鎖定', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '14:00:00'), '13:29:58')).toBe(18 * HOUR + 25 * MIN)
  })

  it('來源沒給撮合時間（美股 / OpenAPI 備援 / 舊快取）時不阻擋鎖定', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:31:00'), null)).toBe(18 * HOUR + 54 * MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:31:00'))).toBe(18 * HOUR + 54 * MIN)
  })
})
