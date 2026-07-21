// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import type { ComponentId, ComponentResult } from './serviceHealth'
import {
  DEGRADED_MS,
  HISTORY_KEY,
  HISTORY_LIMIT,
  appendHealthSample,
  classifyLatency,
  overallStatus,
  readHealthHistory,
} from './serviceHealth'

describe('serviceHealth (pure logic)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('classifyLatency boundary exactly at DEGRADED_MS', () => {
    expect(classifyLatency(DEGRADED_MS)).toBe('ok')
    expect(classifyLatency(DEGRADED_MS - 1)).toBe('ok')
    expect(classifyLatency(DEGRADED_MS + 1)).toBe('degraded')
  })

  it('overallStatus for various combinations', () => {
    const makeRes = (status: ComponentResult['status']): ComponentResult => ({ status })
    
    // all-ok
    expect(overallStatus({ app: makeRes('ok'), auth: makeRes('ok') } as Record<ComponentId, ComponentResult>)).toBe('ok')
    
    // with-degraded
    expect(overallStatus({ app: makeRes('ok'), auth: makeRes('degraded') } as Record<ComponentId, ComponentResult>)).toBe('degraded')
    
    // with-down
    expect(overallStatus({ app: makeRes('ok'), auth: makeRes('down') } as Record<ComponentId, ComponentResult>)).toBe('down')
    
    // down-beats-degraded
    expect(overallStatus({ app: makeRes('ok'), auth: makeRes('degraded'), database: makeRes('down') } as Record<ComponentId, ComponentResult>)).toBe('down')
    
    // all-idle => ok
    expect(overallStatus({ app: makeRes('idle'), auth: makeRes('idle') } as Record<ComponentId, ComponentResult>)).toBe('ok')
    
    // mixed idle+ok => ok
    expect(overallStatus({ app: makeRes('ok'), auth: makeRes('idle') } as Record<ComponentId, ComponentResult>)).toBe('ok')
  })

  it('readHealthHistory returning [] on corrupt JSON', () => {
    localStorage.setItem(HISTORY_KEY, '{ invalid ]')
    expect(readHealthHistory()).toEqual([])
    
    localStorage.setItem(HISTORY_KEY, '{"not":"array"}')
    expect(readHealthHistory()).toEqual([])
  })

  it('appendHealthSample rolling to exactly HISTORY_LIMIT', () => {
    // Fill up to HISTORY_LIMIT
    for (let i = 0; i < HISTORY_LIMIT; i++) {
      appendHealthSample({ at: `time-${i}`, results: {} as Record<ComponentId, ComponentResult> })
    }
    const h1 = readHealthHistory()
    expect(h1.length).toBe(HISTORY_LIMIT)
    expect(h1[0].at).toBe('time-0')
    expect(h1[HISTORY_LIMIT - 1].at).toBe(`time-${HISTORY_LIMIT - 1}`)

    // Add one more, should push out the oldest
    appendHealthSample({ at: `time-${HISTORY_LIMIT}`, results: {} as Record<ComponentId, ComponentResult> })
    const h2 = readHealthHistory()
    expect(h2.length).toBe(HISTORY_LIMIT)
    expect(h2[0].at).toBe('time-1')
    expect(h2[HISTORY_LIMIT - 1].at).toBe(`time-${HISTORY_LIMIT}`)
  })
})
