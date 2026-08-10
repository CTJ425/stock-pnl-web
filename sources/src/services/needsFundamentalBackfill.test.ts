import { describe, expect, it } from 'vitest'
import type { FundamentalData } from './fundamentalProxy'
import {
  isFundamentalIncomplete,
  needsCoreWarm,
  needsFundamentalBackfill,
  needsHistoryWarm,
  PROFIT_TARGET,
  PROFIT_WARM_MIN,
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

const nMonths = (n: number) =>
  Array.from({ length: n }, (_, i) => month(`2025-${String((i % 12) + 1).padStart(2, '0')}`))
const nQuarters = (n: number) =>
  Array.from({ length: n }, (_, i) => quarter(`2023-Q${(i % 4) + 1}`))

describe('needsCoreWarm', () => {
  it('true when null / no months / no quarters', () => {
    expect(needsCoreWarm(null)).toBe(true)
    expect(needsCoreWarm(fund({ revenueMonths: [], profitQuarters: [quarter('2026-Q1')] }))).toBe(true)
    expect(needsCoreWarm(fund({ revenueMonths: nMonths(12), profitQuarters: [] }))).toBe(true)
  })

  it('false when both series have at least one row', () => {
    expect(needsCoreWarm(fund({ revenueMonths: nMonths(1), profitQuarters: nQuarters(1) }))).toBe(false)
  })
})

describe('needsHistoryWarm', () => {
  it('true when months under warm min', () => {
    expect(
      needsHistoryWarm(fund({ revenueMonths: nMonths(REVENUE_WARM_MIN - 1), profitQuarters: nQuarters(12) })),
    ).toBe(true)
  })

  it('true when quarters under warm min even if months full (watchlist partial warm)', () => {
    expect(
      needsHistoryWarm(fund({ revenueMonths: nMonths(12), profitQuarters: nQuarters(PROFIT_WARM_MIN - 1) })),
    ).toBe(true)
  })

  it('false when both series at soft mins', () => {
    expect(
      needsHistoryWarm(fund({ revenueMonths: nMonths(REVENUE_WARM_MIN), profitQuarters: nQuarters(PROFIT_WARM_MIN) })),
    ).toBe(false)
  })
})

describe('needsFundamentalBackfill', () => {
  it('true when no revenue months', () => {
    expect(needsFundamentalBackfill(fund({ revenueMonths: [], profitQuarters: [quarter('2026-Q1')] }))).toBe(true)
  })

  it('true when revenue under warm min even if profit exists', () => {
    expect(
      needsFundamentalBackfill(
        fund({ revenueMonths: nMonths(REVENUE_WARM_MIN - 1), profitQuarters: [quarter('2026-Q1')] }),
      ),
    ).toBe(true)
  })

  it('true when zero profit quarters', () => {
    expect(needsFundamentalBackfill(fund({ revenueMonths: nMonths(REVENUE_WARM_MIN), profitQuarters: [] }))).toBe(
      true,
    )
  })

  it('true when quarters short of PROFIT_WARM_MIN (even with full months)', () => {
    expect(
      needsFundamentalBackfill(fund({ revenueMonths: nMonths(12), profitQuarters: nQuarters(2) })),
    ).toBe(true)
  })

  it('false when both series meet soft mins', () => {
    expect(
      needsFundamentalBackfill(
        fund({ revenueMonths: nMonths(REVENUE_WARM_MIN), profitQuarters: nQuarters(PROFIT_WARM_MIN) }),
      ),
    ).toBe(false)
  })
})

describe('isFundamentalIncomplete', () => {
  it('true until both targets are met', () => {
    expect(
      isFundamentalIncomplete(fund({ revenueMonths: nMonths(REVENUE_TARGET), profitQuarters: nQuarters(PROFIT_TARGET - 1) })),
    ).toBe(true)
  })

  it('false at 12/12', () => {
    expect(
      isFundamentalIncomplete(fund({ revenueMonths: nMonths(REVENUE_TARGET), profitQuarters: nQuarters(PROFIT_TARGET) })),
    ).toBe(false)
  })
})
