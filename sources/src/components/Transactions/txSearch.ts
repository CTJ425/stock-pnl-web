import type { Transaction } from '../../types/models'
import { displayStockName } from '../../services/usStockNames'

/**
 * 交易紀錄過濾：依代號、原始名稱或中文譯名（如 AAPL → 蘋果）進行即時子字串比對
 */
export function filterTransactions(txs: Transaction[], query: string): Transaction[] {
  const q = query.trim().toLowerCase()
  if (!q) return txs

  return txs.filter((tx) => {
    const ticker = tx.ticker.toLowerCase()
    if (ticker.includes(q)) return true

    const name = tx.name.toLowerCase()
    if (name.includes(q)) return true

    const displayName = displayStockName(tx.market, tx.ticker, tx.name).toLowerCase()
    if (displayName.includes(q)) return true

    return false
  })
}
