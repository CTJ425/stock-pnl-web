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

/**
 * `tx_nature` is optional and nullable; absent means *unknown*, not 現股 (models.ts). When it is
 * null the chip falls back to the plain BUY/SELL label instead of claiming a nature it does not know.
 * DIVIDEND/STOCK_DIVIDEND rows always write a null nature (TransactionForm), but a `${nature}買/賣`
 * label only makes sense for an actual buy or sell — a dividend row falls back to its own
 * TX_TYPE_LABEL even if a nature value somehow made it through CSV import.
 */
export function txChipLabel(tx: Transaction): string {
  if (!tx.tx_nature || (tx.tx_type !== 'BUY' && tx.tx_type !== 'SELL')) return TX_TYPE_LABEL[tx.tx_type]
  return `${TX_NATURE_LABEL[tx.tx_nature]}${tx.tx_type === 'BUY' ? '買' : '賣'}`
}
