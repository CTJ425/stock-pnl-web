import { describe, expect, it } from 'vitest'
import type { FundamentalData } from './fundamentalProxy'
import {
  isFundamentalIncomplete,
  needsFundamentalBackfill,
  PROFIT_TARGET,
  REVENUE_TARGET,
  REVENUE_WARM_MIN,
} from './needsFundamentalBackfill'

function fund(partial: Partial<FundamentalData> & Pick<FundamentalData, 'revenueMonths' | 'profitQuarters'>): FundamentalData {
  return {
    ticker: '2330',
    asOf: '2026-08-01T00:00:00Z',
    dataDate: '2026-08-01',
    industry: null,
    valuation: null,
    revenueUnit: '千元',
    notes: [],
    ...partial,
  }
}

const month = (ym: string) => ({
  yearMonth: ym,
  revenueThousandTwd: 1,
  momPercent: null,
  yoyPercent: null,
  cumulativeYoyPercent: null,
})

const quarter = (yq: string) => ({
  yearQuarter: yq,
  revenueMillionTwd: 1,
  grossMarginPercent: 1,
  operatingMarginPercent: 1,
  pretaxMarginPercent: 1,
  netMarginPercent: 1,
  epsTwd: null,
})

describe('needsFundamentalBackfill', () => {
  it('true when no revenue months', () => {
    expect(needsFundamentalBackfill(fund({ revenueMonths: [], profitQuarters: [quarter('2026-Q1')] }))).toBe(true)
  })

  it('true when revenue under warm min even if profit exists', () => {
    const months = Array.from({ length: REVENUE_WARM_MIN - 1 }, (_, i) => month(`2026-${String(i + 1).padStart(2, '0')}`))
    expect(needsFundamentalBackfill(fund({ revenueMonths: months, profitQuarters: [quarter('2026-Q1')] }))).toBe(true)
  })

  it('true when zero profit quarters', () => {
    const months = Array.from({ length: REVENUE_WARM_MIN }, (_, i) => month(`2026-${String(i + 1).padStart(2, '0')}`))
    expect(needsFundamentalBackfill(fund({ revenueMonths: months, profitQuarters: [] }))).toBe(true)
  })

  it('false when at least warm-min months and one quarter', () => {
    const months = Array.from({ length: REVENUE_WARM_MIN }, (_, i) => month(`2026-${String(i + 1).padStart(2, '0')}`))
    expect(needsFundamentalBackfill(fund({ revenueMonths: months, profitQuarters: [quarter('2026-Q1')] }))).toBe(false)
  })
})

describe('isFundamentalIncomplete', () => {
  it('true until both targets are met', () => {
    const months = Array.from({ length: REVENUE_TARGET }, (_, i) =>
      month(`2025-${String((i % 12) + 1).padStart(2, '0')}`),
    )
    const qs = Array.from({ length: PROFIT_TARGET - 1 }, (_, i) => quarter(`2023-Q${(i % 4) + 1}`))
    expect(isFundamentalIncomplete(fund({ revenueMonths: months, profitQuarters: qs }))).toBe(true)
  })

  it('false at 12/12', () => {
    const months = Array.from({ length: REVENUE_TARGET }, (_, i) =>
      month(`2025-${String((i % 12) + 1).padStart(2, '0')}`),
    )
    const qs = Array.from({ length: PROFIT_TARGET }, (_, i) => quarter(`2023-Q${(i % 4) + 1}`))
    expect(isFundamentalIncomplete(fund({ revenueMonths: months, profitQuarters: qs }))).toBe(false)
  })
})
