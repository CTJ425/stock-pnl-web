import { describe, it, expect } from 'vitest'
import {
  MAX_SCANS_PER_DAY,
  RELEASE_CALENDAR,
  SCAN_WINDOW_HOURS,
  SKIP_INTENSIVE,
  decideMacroScan,
  expectedLatestPeriod,
  isEasternDst,
  releaseInstant,
  taipeiYmdOf,
} from './macroCalendar.ts'

/** The official release time of CPI 2026-07 issue: 2026-08-12 08:30 EDT = 12:30 UTC*/
const CPI_JUL_RELEASE = Date.UTC(2026, 7, 12, 12, 30)

/** Five indicators have been achieved 2026-06 (= normal status before 8/12)*/
const ALL_AT_JUN = [
  { id: 'CPILFESL', latestPeriod: '2026-06' },
  { id: 'PPIFES', latestPeriod: '2026-06' },
  { id: 'PAYEMS', latestPeriod: '2026-06' },
  { id: 'PCEPILFE', latestPeriod: '2026-06' },
  { id: 'UMCSENT', latestPeriod: '2026-05' },
]

describe('isEasternDst', () => {
  it('夏季是 EDT、冬季是 EST', () => {
    expect(isEasternDst(new Date(Date.UTC(2026, 6, 15)))).toBe(true)
    expect(isEasternDst(new Date(Date.UTC(2026, 0, 15)))).toBe(false)
  })

  it('切換點：3 月第二個週日起、11 月第一個週日止', () => {
    // 2026-03-08 is the second Sunday, 2026-11-01 is the first Sunday
    expect(isEasternDst(new Date(Date.UTC(2026, 2, 1)))).toBe(false)
    expect(isEasternDst(new Date(Date.UTC(2026, 2, 20)))).toBe(true)
    expect(isEasternDst(new Date(Date.UTC(2026, 10, 20)))).toBe(false)
  })
})

describe('releaseInstant', () => {
  it('夏令 8:30 ET = 12:30 UTC（台北 20:30）', () => {
    const t = releaseInstant({ date: '2026-08-12', period: '2026-07' }, 'CPILFESL')
    expect(new Date(t).toISOString()).toBe('2026-08-12T12:30:00.000Z')
  })

  it('冬令 8:30 ET = 13:30 UTC（台北 21:30）——21:00 那班會跑在發布之前', () => {
    const t = releaseInstant({ date: '2026-12-10', period: '2026-11' }, 'CPILFESL')
    expect(new Date(t).toISOString()).toBe('2026-12-10T13:30:00.000Z')
  })

  it('密大是 10:00 ET，與其他四項的 8:30 不同', () => {
    const t = releaseInstant({ date: '2026-08-12', period: '2026-07' }, 'UMCSENT')
    expect(new Date(t).toISOString()).toBe('2026-08-12T14:00:00.000Z')
  })
})

describe('expectedLatestPeriod', () => {
  it('發布時刻之前，那一期還不算「應該已有」', () => {
    const before = new Date(CPI_JUL_RELEASE - 60_000)
    expect(expectedLatestPeriod('CPILFESL', before).period).toBe('2026-06')
  })

  it('發布時刻之後，期別才往前推進', () => {
    const after = new Date(CPI_JUL_RELEASE + 60_000)
    expect(expectedLatestPeriod('CPILFESL', after).period).toBe('2026-07')
  })

  it('行事曆涵蓋期間內不算 stale', () => {
    expect(expectedLatestPeriod('CPILFESL', new Date(CPI_JUL_RELEASE)).stale).toBe(false)
  })

  it('行事曆用完（跨年未更新）→ fallback 且標記 stale，不得整組失效', () => {
    const far = new Date(Date.UTC(2027, 4, 20))
    const r = expectedLatestPeriod('CPILFESL', far)
    expect(r.stale).toBe(true)
    // 2027-05-20 Estimate date 14 has passed → the data from last month (2027-04) should have been released
    expect(r.period).toBe('2027-04')
  })
})

describe('decideMacroScan', () => {
  const base = {
    indicators: ALL_AT_JUN,
    scansToday: 1,
    lastScanYmd: taipeiYmdOf(new Date(CPI_JUL_RELEASE)),
  }

  it('今天還沒掃過 → 掃（例行班，用來跟上 FRED 回頭修正歷史值）', () => {
    const d = decideMacroScan({ ...base, now: new Date(CPI_JUL_RELEASE), lastScanYmd: null })
    expect(d).toMatchObject({ scan: true, reason: 'routine' })
  })

  it('跨日後 lastScanYmd 不同 → 視為今天還沒掃', () => {
    const d = decideMacroScan({ ...base, now: new Date(CPI_JUL_RELEASE), lastScanYmd: '2026-08-11' })
    expect(d.scan).toBe(true)
    expect(d.reason).toBe('routine')
  })

  it('發布時刻已到但還沒拿到 → 掃，並指出是哪個指標', () => {
    const d = decideMacroScan({ ...base, now: new Date(CPI_JUL_RELEASE + 60_000) })
    expect(d.scan).toBe(true)
    expect(d.reason).toBe('due')
    expect(d.dueIds).toContain('CPILFESL')
  })

  // ★ This is the core behavior of this change
  it('已經拿到那一期 → 不掃（「一旦抓到就不抓」）', () => {
    // As of 8/12, the non-agricultural issue 2026-07 (released on 8/7) should have been obtained long ago.
    // Therefore, both must be filled in up to date to truly "get them both."
    const got = ALL_AT_JUN.map((i) =>
      i.id === 'CPILFESL' || i.id === 'PAYEMS' ? { ...i, latestPeriod: '2026-07' } : i,
    )
    const d = decideMacroScan({
      ...base,
      indicators: got,
      now: new Date(CPI_JUL_RELEASE + 60_000),
    })
    expect(d).toMatchObject({ scan: false, reason: 'satisfied', dueIds: [] })
  })

  it('發布時刻之前不掃——那時本來就還沒有新資料', () => {
    const d = decideMacroScan({ ...base, now: new Date(CPI_JUL_RELEASE - 3600_000) })
    expect(d.scan).toBe(false)
  })

  it('超出掃描窗就停手，等明天的例行班', () => {
    const late = new Date(CPI_JUL_RELEASE + (SCAN_WINDOW_HOURS + 1) * 3600_000)
    // lastScanYmd must be converted into late current Taipei day, otherwise the routine will be triggered first
    // (+7h has crossed the Taipei date line 16:00 UTC)
    const d = decideMacroScan({ ...base, now: late, lastScanYmd: taipeiYmdOf(late) })
    expect(d.scan).toBe(false)
    expect(d.reason).toBe('outside-window')
  })

  it('掃描窗邊界內仍要掃', () => {
    const edge = new Date(CPI_JUL_RELEASE + (SCAN_WINDOW_HOURS - 0.1) * 3600_000)
    expect(decideMacroScan({ ...base, now: edge }).scan).toBe(true)
  })

  it('達到次數上限就停——來源真的掛掉時不能無限掃', () => {
    const d = decideMacroScan({
      ...base,
      now: new Date(CPI_JUL_RELEASE + 60_000),
      scansToday: MAX_SCANS_PER_DAY,
    })
    expect(d).toMatchObject({ scan: false, reason: 'capped' })
  })

  it('UMCSENT 不觸發密集掃——它在 FRED 上已停更，納入只會白掃到上限', () => {
    // Fill in the other four items up to date, leaving only UMCSENT behind.
    const onlyUmcBehind = [
      { id: 'CPILFESL', latestPeriod: '2026-07' },
      { id: 'PPIFES', latestPeriod: '2026-07' },
      { id: 'PAYEMS', latestPeriod: '2026-07' },
      { id: 'PCEPILFE', latestPeriod: '2026-07' },
      { id: 'UMCSENT', latestPeriod: '2026-05' },
    ]
    const d = decideMacroScan({
      ...base,
      indicators: onlyUmcBehind,
      now: new Date(CPI_JUL_RELEASE + 60_000),
    })
    expect(d.scan).toBe(false)
    expect(d.dueIds).not.toContain('UMCSENT')
  })
})

describe('RELEASE_CALENDAR 資料完整性', () => {
  it('日期與期別格式正確，且期別早於發布月（資料總是落後一個月發）', () => {
    for (const [id, entries] of Object.entries(RELEASE_CALENDAR)) {
      for (const e of entries) {
        expect(e.date, `${id} ${e.date}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(e.period, `${id} ${e.period}`).toMatch(/^\d{4}-\d{2}$/)
        expect(e.date.slice(0, 7) > e.period, `${id} ${e.date} 應晚於期別 ${e.period}`).toBe(true)
      }
    }
  })

  it('同一指標的日期由舊到新排列，不得重複期別', () => {
    for (const [id, entries] of Object.entries(RELEASE_CALENDAR)) {
      const dates = entries.map((e) => e.date)
      expect(dates, id).toEqual([...dates].sort())
      expect(new Set(entries.map((e) => e.period)).size, id).toBe(entries.length)
    }
  })

  it('UMCSENT 不在行事曆中（刻意不密集掃）', () => {
    expect(RELEASE_CALENDAR.UMCSENT).toBeUndefined()
    expect(SKIP_INTENSIVE).toContain('UMCSENT')
  })
})
