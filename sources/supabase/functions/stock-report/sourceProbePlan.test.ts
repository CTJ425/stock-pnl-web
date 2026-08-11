import { describe, expect, it } from 'vitest'
import {
  formatProbeTickLabel,
  minutesFromHhmm,
  sourcesForTaipeiTime,
  ymdToRocYmd,
} from './sourceProbePlan'

describe('sourceProbePlan', () => {
  it('minutesFromHhmm', () => {
    expect(minutesFromHhmm('15:30')).toBe(15 * 60 + 30)
    expect(minutesFromHhmm('09:05')).toBe(9 * 60 + 5)
    expect(minutesFromHhmm('bad')).toBeNull()
  })

  it('下午只開 BFI／T86 窗', () => {
    expect(sourcesForTaipeiTime('15:05', true)).toEqual(['bfi82u'])
    expect(sourcesForTaipeiTime('15:30', true)).toEqual(['bfi82u', 't86'])
    expect(sourcesForTaipeiTime('16:45', true)).toEqual(['t86'])
    expect(sourcesForTaipeiTime('12:00', true).sort()).toEqual(
      ['mops_profit', 'mops_revenue'].sort(),
    )
  })

  it('晚間融資借券窗（21:00 仍在估值窗內）', () => {
    expect(sourcesForTaipeiTime('21:00', true).sort()).toEqual(
      ['borrow', 'bwibbu', 'margin', 'mops_profit', 'mops_revenue'].sort(),
    )
    expect(sourcesForTaipeiTime('21:30', true).sort()).toEqual(
      ['borrow', 'bwibbu', 'margin'].sort(),
    )
  })

  it('窗外與週末不探日頻', () => {
    expect(sourcesForTaipeiTime('10:00', true)).toEqual([])
    expect(sourcesForTaipeiTime('15:30', false)).toEqual([])
  })

  it('formatProbeTickLabel', () => {
    expect(formatProbeTickLabel('15:00', false)).toBe('1500 沒中')
    expect(formatProbeTickLabel('15:05', true)).toBe('1505 中')
  })

  it('ymdToRocYmd', () => {
    expect(ymdToRocYmd('20260811')).toBe('1150811')
  })
})
