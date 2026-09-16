import { describe, it, expect } from 'vitest'
import { marketSession, isMarketOpen, openRegions, anyMarketOpen } from './sessionHours'

/**
 * All instants are absolute UTC so the DST rules of America/New_York are exercised.
 * 2026-09-15 is a Tuesday (EDT, UTC-4); 2026-01-15 is a Thursday (EST, UTC-5).
 */
describe('marketSession — 日本 (JP)', () => {
  it('09:00 JST 開盤', () => {
    expect(marketSession('JP', new Date('2026-09-15T00:00:00Z'))).toBe('open')
  })

  it('08:59 JST 尚未開盤', () => {
    expect(marketSession('JP', new Date('2026-09-14T23:59:00Z'))).toBe('closed')
  })

  it('11:30 JST 進入午休', () => {
    expect(marketSession('JP', new Date('2026-09-15T02:30:00Z'))).toBe('break')
  })

  it('12:30 JST 午休結束、後盤開盤', () => {
    expect(marketSession('JP', new Date('2026-09-15T03:30:00Z'))).toBe('open')
  })

  it('15:29 JST 仍在盤中，15:30 JST 收盤', () => {
    expect(marketSession('JP', new Date('2026-09-15T06:29:00Z'))).toBe('open')
    expect(marketSession('JP', new Date('2026-09-15T06:30:00Z'))).toBe('closed')
  })
})

describe('marketSession — 韓國 (KR)', () => {
  it('09:00 KST 開盤', () => {
    expect(marketSession('KR', new Date('2026-09-15T00:00:00Z'))).toBe('open')
  })

  it('11:30 KST 沒有午休，仍是 open（與日本的差異）', () => {
    expect(marketSession('KR', new Date('2026-09-15T02:30:00Z'))).toBe('open')
  })

  it('15:29 KST 仍在盤中，15:30 KST 收盤', () => {
    expect(marketSession('KR', new Date('2026-09-15T06:29:00Z'))).toBe('open')
    expect(marketSession('KR', new Date('2026-09-15T06:30:00Z'))).toBe('closed')
  })
})

describe('marketSession — 美國 (US) 夏令時間 EDT', () => {
  it('09:30 ET = 13:30 UTC 開盤', () => {
    expect(marketSession('US', new Date('2026-09-15T13:30:00Z'))).toBe('open')
  })

  it('09:29 ET 尚未開盤', () => {
    expect(marketSession('US', new Date('2026-09-15T13:29:00Z'))).toBe('closed')
  })

  it('15:59 ET 仍在盤中，16:00 ET 收盤', () => {
    expect(marketSession('US', new Date('2026-09-15T19:59:00Z'))).toBe('open')
    expect(marketSession('US', new Date('2026-09-15T20:00:00Z'))).toBe('closed')
  })
})

describe('marketSession — 美國 (US) 冬令時間 EST', () => {
  it('09:30 ET = 14:30 UTC 開盤（不可寫死 UTC-4）', () => {
    expect(marketSession('US', new Date('2026-01-15T14:30:00Z'))).toBe('open')
  })

  it('13:30 UTC 在冬令時間只是 08:30 ET，尚未開盤', () => {
    expect(marketSession('US', new Date('2026-01-15T13:30:00Z'))).toBe('closed')
  })
})

describe('marketSession — 週末以當地星期判斷', () => {
  it('台北週六凌晨，日韓皆休市', () => {
    expect(marketSession('JP', new Date('2026-09-19T01:00:00Z'))).toBe('closed')
    expect(marketSession('KR', new Date('2026-09-19T01:00:00Z'))).toBe('closed')
  })

  it('UTC 已是週一 00:30，但紐約仍是週日晚上 → 休市', () => {
    expect(marketSession('US', new Date('2026-09-21T00:30:00Z'))).toBe('closed')
  })

  it('UTC 週六 13:30 對應紐約週六 09:30 → 休市', () => {
    expect(marketSession('US', new Date('2026-09-19T13:30:00Z'))).toBe('closed')
  })
})

describe('isMarketOpen / openRegions / anyMarketOpen', () => {
  it('isMarketOpen 只有 open 算開盤，午休不算', () => {
    expect(isMarketOpen('JP', new Date('2026-09-15T00:00:00Z'))).toBe(true)
    expect(isMarketOpen('JP', new Date('2026-09-15T02:30:00Z'))).toBe(false)
  })

  // Task 164 added TW; 01:00Z is 09:00 Taipei, so the TW session is open too.
  it('10:00 台北時段：台日韓開盤、美股休市', () => {
    expect(openRegions(new Date('2026-09-15T01:00:00Z'))).toEqual(['TW', 'JP', 'KR'])
  })

  it('21:30 台北時段：只有美股開盤', () => {
    expect(openRegions(new Date('2026-09-15T13:30:00Z'))).toEqual(['US'])
  })

  it('週六全休市', () => {
    expect(openRegions(new Date('2026-09-19T05:00:00Z'))).toEqual([])
    expect(anyMarketOpen(new Date('2026-09-19T05:00:00Z'))).toBe(false)
  })

  it('有任一市場開盤時 anyMarketOpen 為 true', () => {
    expect(anyMarketOpen(new Date('2026-09-15T01:00:00Z'))).toBe(true)
  })
})
