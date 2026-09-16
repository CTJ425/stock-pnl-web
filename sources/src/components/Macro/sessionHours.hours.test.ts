import { describe, it, expect } from 'vitest'
import { marketSession, openRegions, SESSION_HOURS } from './sessionHours'

/**
 * Task 164 §4.3. 2026-09-15 is a Tuesday. All instants are absolute UTC.
 * Taipei is UTC+8 all year, so no DST rule applies to the TW bounds.
 */
describe('SESSION_HOURS', () => {
  it('四個地區都有本地與台北對照時間', () => {
    for (const region of ['TW', 'JP', 'KR', 'US'] as const) {
      expect(SESSION_HOURS[region].local).toBeTruthy()
      expect(SESSION_HOURS[region].taipei).toBeTruthy()
    }
  })

  it('日本有午休字串，韓國與美國沒有', () => {
    expect(SESSION_HOURS.JP.breakLocal).toBeTruthy()
    expect(SESSION_HOURS.KR.breakLocal).toBeNull()
    expect(SESSION_HOURS.US.breakLocal).toBeNull()
  })

  it('美國的台北對照同時寫出夏令與冬令，不是單一算出來的值', () => {
    expect(SESSION_HOURS.US.taipei).toMatch(/夏令/)
    expect(SESSION_HOURS.US.taipei).toMatch(/冬令/)
  })
})

describe('marketSession — 台灣 (TW)', () => {
  it('09:00 台北開盤', () => {
    expect(marketSession('TW', new Date('2026-09-15T01:00:00Z'))).toBe('open')
  })

  it('08:59 台北尚未開盤', () => {
    expect(marketSession('TW', new Date('2026-09-15T00:59:00Z'))).toBe('closed')
  })

  it('13:29 仍在盤中，13:30 收盤', () => {
    expect(marketSession('TW', new Date('2026-09-15T05:29:00Z'))).toBe('open')
    expect(marketSession('TW', new Date('2026-09-15T05:30:00Z'))).toBe('closed')
  })

  it('週六休市', () => {
    expect(marketSession('TW', new Date('2026-09-19T03:00:00Z'))).toBe('closed')
  })

  it('台股盤中時 openRegions 以 TW 為首', () => {
    expect(openRegions(new Date('2026-09-15T03:00:00Z'))[0]).toBe('TW')
  })
})
