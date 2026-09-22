/**
 * Shared "apply, then report" flow for StockSplitModal and RecalcFeesModal (TX-09).
 *
 * Both modals used to await one `updateTransaction` per row inside a loop, so a failure part
 * way through left the earlier rows converted and the rest untouched — a split or a fee
 * recalculation applied to only some of the affected rows corrupts the position's cost basis.
 * `updateTransactionsBatch` (TX-03) removed that risk by applying every row in one atomic
 * request; this helper is the one place that wraps it in busy/error state so both callers report
 * a failure the same way and a future fix to that wrapping lands in both at once.
 */
import type { TxUpdate } from '../../services/dataProvider'

/**
 * Runs `updateTransactionsBatch(updates)`, toggling `setBusy` around the call and setting
 * `setError` on failure. Returns whether the batch succeeded — callers do their own
 * success-only work (recording a split, toasting, closing the modal) after checking the result,
 * since that work differs between callers and must not run when the batch was rejected.
 */
export async function runBatchApply(
  updateTransactionsBatch: (updates: TxUpdate[]) => Promise<void>,
  updates: TxUpdate[],
  setBusy: (busy: boolean) => void,
  setError: (message: string | null) => void,
): Promise<boolean> {
  if (updates.length === 0) return false
  setBusy(true)
  setError(null)
  try {
    await updateTransactionsBatch(updates)
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : '批次更新失敗，請稍後再試'
    setError(`批次更新失敗，共 ${updates.length} 筆均未變更：${message}`)
    return false
  } finally {
    setBusy(false)
  }
}
