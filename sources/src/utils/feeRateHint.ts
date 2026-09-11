import { DEFAULT_FEE_RATE } from './fees'

export interface FeeRateHint {
  /** The rate as a discount of the statutory rate, e.g. 「＝ 6 折」. Null when not meaningful. */
  discount: string | null
  /** Shown when the rate is implausible, e.g. a discount typed as a decimal (0.6 for 6 折). */
  warning: string | null
}

/**
 * Describe a Taiwan broker fee rate as a discount (折) of the statutory 0.001425.
 * Display only: the stored rate keeps its meaning (Task 159 D2).
 */
export function describeTwFeeRate(rate: number): FeeRateHint {
  if (!Number.isFinite(rate)) return { discount: null, warning: null }
  if (rate < 0) return { discount: null, warning: '手續費率不能是負數。' }
  if (rate === 0) return { discount: '＝ 不收手續費', warning: null }
  const ratio = rate / DEFAULT_FEE_RATE
  if (Math.abs(ratio - 1) < 1e-6) return { discount: '＝ 原價（不打折）', warning: null }
  if (ratio > 1) {
    return {
      discount: null,
      warning: '高於原價 0.001425，請確認是不是把折數填成小數（例如 6 折應填 0.000855）。',
    }
  }
  const tenths = Math.round(ratio * 1000) / 100
  return { discount: `＝ ${tenths} 折`, warning: null }
}
