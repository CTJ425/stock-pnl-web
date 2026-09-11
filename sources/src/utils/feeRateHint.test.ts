import { describe, expect, it } from 'vitest'
import { describeTwFeeRate } from './feeRateHint'

describe('describeTwFeeRate', () => {
  it('names the statutory rate as undiscounted', () => {
    expect(describeTwFeeRate(0.001425)).toEqual({ discount: '＝ 原價（不打折）', warning: null })
  })

  it.each([
    [0.00092625, '＝ 6.5 折'],
    [0.0004275, '＝ 3 折'],
    [0.000855, '＝ 6 折'],
    [0.000399, '＝ 2.8 折'],
  ])('describes %f as a discount', (rate, discount) => {
    expect(describeTwFeeRate(rate)).toEqual({ discount, warning: null })
  })

  it('describes zero as no fee', () => {
    expect(describeTwFeeRate(0)).toEqual({ discount: '＝ 不收手續費', warning: null })
  })

  it('warns when a discount is typed as a decimal (0.6 for 6 折)', () => {
    const hint = describeTwFeeRate(0.6)
    expect(hint.discount).toBeNull()
    expect(hint.warning).toContain('0.001425')
    expect(hint.warning).toContain('0.000855')
  })

  it('warns on a negative rate', () => {
    expect(describeTwFeeRate(-0.001)).toEqual({ discount: null, warning: '手續費率不能是負數。' })
  })

  it('says nothing for a value that is not a number', () => {
    expect(describeTwFeeRate(Number.NaN)).toEqual({ discount: null, warning: null })
  })
})
