import type { Transaction } from '../../types/models'
import { displayStockName } from '../../services/usStockNames'

/**
 * Transaction record filtering: real-time substring comparison based on code name, original name or Chinese translation (such as AAPL → Apple)
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
