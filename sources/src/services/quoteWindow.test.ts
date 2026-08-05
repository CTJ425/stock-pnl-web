import { describe, expect, it } from 'vitest'
import { twMaxTtlMs, twQuoteTtlMs } from '../../supabase/functions/stock-price/quoteWindow.ts'

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
    expect(twQuoteTtlMs(taipei('2026-08-05', '08:24:59'), '13:30:00')).toBe(1000)
  })

  // 以下的「鎖定」案例一律帶收盤定案的撮合時間 —— 沒有它就無從確認，規則是不鎖
  it('13:30 一到就鎖到隔天 08:25', () => {
    expect(twQuoteTtlMs(taipei('2026-08-05', '13:30:00'), '13:30:00')).toBe(18 * HOUR + 55 * MIN)
    expect(twQuoteTtlMs(taipei('2026-08-05', '15:23:00'), '13:30:00')).toBe(17 * HOUR + 2 * MIN)
  })

  it('跨午夜後算到當天早上的 08:25，不是隔天', () => {
    expect(twQuoteTtlMs(taipei('2026-08-06', '00:00:00'), '13:30:00')).toBe(8 * HOUR + 25 * MIN)
    expect(twQuoteTtlMs(taipei('2026-08-06', '08:00:00'), '13:30:00')).toBe(25 * MIN)
  })

  it('週末不需要交易日曆：13:30 後照樣落入長 TTL', () => {
    // 2026-08-08 是週六
    expect(twQuoteTtlMs(taipei('2026-08-08', '20:00:00'), '13:30:00')).toBe(12 * HOUR + 25 * MIN)
  })

  /*
   * 只鎖「確認是收盤定案值」的報價（0.6.37 修正）。
   *
   * 0.6.36 原本在 13:30 之後一律鎖定，取不到撮合時間也照鎖 —— 正式區當天就出事：
   * 升級前寫入的快取列沒有 trade_time，是盤中某一刻的快照，卻被鎖到隔天 08:25，
   * 畫面一路顯示「盤中」、開高低量全是「—」。
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
    // 凌晨同理，否則舊列會一路撐到早上
    expect(twQuoteTtlMs(taipei('2026-08-06', '03:00:00'), null)).toBe(MIN)
  })
})

describe('twMaxTtlMs（DB 粗篩的下界）', () => {
  it('以「已定案」為假設取上界，不會把昨天的收盤價濾掉', () => {
    // 直接用 twQuoteTtlMs(now) 會回 60 秒（沒帶撮合時間），粗篩就會漏掉定案快取
    const now = taipei('2026-08-05', '20:00:00')
    expect(twQuoteTtlMs(now)).toBe(MIN)
    expect(twMaxTtlMs(now)).toBe(12 * HOUR + 25 * MIN)
  })

  it('盤中與盤後一致地回傳該時段的上界', () => {
    expect(twMaxTtlMs(taipei('2026-08-05', '10:00:00'))).toBe(MIN)
    expect(twMaxTtlMs(taipei('2026-08-06', '03:00:00'))).toBe(5 * HOUR + 25 * MIN)
  })
})
