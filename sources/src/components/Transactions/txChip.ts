import type { Transaction, TxNature } from '../../types/models'
import { TX_NATURE_LABEL, TX_TYPE_LABEL } from '../../types/models'

/** Chip colour for the 類型 cell (Task 142 C4): direction/nature hues only, never the price up/down ones. */
export function txChipClass(nature?: TxNature | null): string {
  switch (nature) {
    case 'DAY_TRADE':
      return 'tx-chip-day'
    case 'MARGIN':
      return 'tx-chip-margin'
    case 'SHORT':
      return 'tx-chip-short'
    default:
      return 'tx-chip-spot'
  }
}

/** 買 / 賣 for a buy or sell row, null for dividend rows (they are neither). */
export function txDirection(tx: Transaction): '買' | '賣' | null {
  if (tx.tx_type === 'BUY') return '買'
  if (tx.tx_type === 'SELL') return '賣'
  return null
}

/**
 * The chip beside the direction mark: the nature (現股 / 當沖 / 融資 / 融券) for a buy or sell, the
 * type label for a dividend row. `tx_nature` is optional and nullable; absent means *unknown*, not
 * 現股 (models.ts), so a buy or sell without one gets no chip rather than a nature it does not know.
 * A dividend row keeps its own TX_TYPE_LABEL even if a nature slipped in through CSV import.
 */
export function txNatureChipLabel(tx: Transaction): string | null {
  if (tx.tx_type !== 'BUY' && tx.tx_type !== 'SELL') return TX_TYPE_LABEL[tx.tx_type]
  return tx.tx_nature ? TX_NATURE_LABEL[tx.tx_nature] : null
}
