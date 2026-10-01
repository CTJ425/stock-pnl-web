import { describe, expect, it } from 'vitest'
import { basisLabel, formatFeeRatePct, pnlBasis, rowRoi, rowUnrealized } from './pnlBasis'
import type { HoldingRow } from './holdingRows'

const row = (over: Partial<HoldingRow>): HoldingRow =>
  ({ unrealized: 100, roi: 0.1, brokerUnrealized: 90, brokerRoi: 0.09, brokerNotApplicable: false, ...over }) as HoldingRow

describe('pnlBasis', () => {
  it('a monthly-rebate discount withholds the statutory rate', () => {
    expect(pnlBasis(0.000399, 'monthly')).toBe('list')
  })
  it('an instant discount, an unset rebate and no discount all use the net figure', () => {
    expect(pnlBasis(0.000399, 'instant')).toBe('net')
    expect(pnlBasis(0.000399, null)).toBe('net')
    expect(pnlBasis(0.000399, undefined)).toBe('net')
    expect(pnlBasis(0.001425, 'monthly')).toBe('net')
  })
})

describe('labels', () => {
  it('formats rates without trailing zeros', () => {
    expect(formatFeeRatePct(0.001425)).toBe('0.1425%')
    expect(formatFeeRatePct(0.000399)).toBe('0.0399%')
    expect(formatFeeRatePct(0)).toBe('0%')
  })
  it('names the rate actually withheld', () => {
    expect(basisLabel('list', 0.000399)).toBe('牌告 0.1425% 預扣')
    expect(basisLabel('net', 0.000399)).toBe('折扣後 0.0399% 預扣')
    expect(basisLabel('net', 0.001425)).toBe('牌告 0.1425% 預扣')
  })
})

describe('row figures', () => {
  it('list basis reads the broker figure on TW rows', () => {
    expect(rowUnrealized(row({}), 'list')).toBe(90)
    expect(rowRoi(row({}), 'list')).toBe(0.09)
  })
  it('net basis, US rows and a missing broker figure read the net figure', () => {
    expect(rowUnrealized(row({}), 'net')).toBe(100)
    expect(rowUnrealized(row({ brokerNotApplicable: true }), 'list')).toBe(100)
    expect(rowUnrealized(row({ brokerUnrealized: null }), 'list')).toBe(100)
    expect(rowRoi(row({ brokerRoi: null }), 'list')).toBe(0.1)
  })
})
