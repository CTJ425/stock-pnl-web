/**
 * 由持股 + 現價組出「每檔的損益列」。
 *
 * 抽成共用模組的原因：庫存總覽（表格）與個股分析（下拉選單 + 我的持股）需要同一份計算 ——
 * 台股零股/整股最低手續費、預扣賣出費稅的未實現淨損益、報酬率分母口徑。
 * 兩邊各寫一份必然會走鐘，這裡是單一來源。
 */
import type { Holding } from './pnlEngine'
import { estimateUnrealized } from './pnlEngine'
import { breakEvenPrice } from './fees'
import { getMinFee } from './settings'
import type { PriceMap } from '../services/priceProxy'

export interface HoldingRow {
  holding: Holding
  price: number | null
  priceStale: boolean
  mktVal: number | null
  unrealized: number | null
  /** 未含任何費用的純價差：市值 − 未含費成本，與年度收益的 rawRealized 同構 */
  rawUnrealized: number | null
  /** 未實現報酬率（未實現 ÷ 當前部位成本）；無現價時為 null */
  roi: number | null
  /** 保本賣出價：以此價全數賣出（扣手續費 / 證交稅）恰好不虧 */
  breakEven: number
}

export function buildHoldingRows(
  holdings: Holding[],
  prices: PriceMap,
  feeRate: number,
  workspaceId?: string,
): HoldingRow[] {
  return holdings.map((h) => {
    const quote = prices[h.key]
    const price = quote?.price ?? null
    const mktVal = price !== null ? price * h.qty : null
    // 台股依持股規模套用整股 / 零股最低手續費；美股無下限
    const minFee =
      h.currency === 'TWD' ? getMinFee(h.qty >= 1000 ? 'whole' : 'odd', workspaceId) : undefined
    const unrealized = price !== null ? estimateUnrealized(h, price, feeRate, minFee) : null
    const rawUnrealized = mktVal !== null ? mktVal - h.rawCost : null
    // 僅當前部位（與券商 APP 同口徑）：分母為現有持股的移動平均成本
    const roi = unrealized !== null && h.cost !== 0 ? unrealized / h.cost : null
    const breakEven = breakEvenPrice(h, feeRate, minFee)
    return {
      holding: h,
      price,
      priceStale: quote?.stale ?? false,
      mktVal,
      unrealized,
      rawUnrealized,
      roi,
      breakEven,
    }
  })
}
