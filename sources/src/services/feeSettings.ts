/**
 * Reconciles the per-workspace fee rate between Supabase (`workspaces.fee_rate`) and the
 * `localStorage` cache read by `getFeeRate`. Runs at workspace bootstrap and on save.
 */
import type { Workspace } from '../types/models'
import type { DataProvider } from './dataProvider'
import { getStoredFeeRate, setFeeRate } from '../utils/settings'
import { planFeeSync } from '../utils/feeSync'
import { logClient } from './appLog'

/** Reconciles every workspace's row against the cache. Never rejects — this runs on login. */
export async function syncWorkspaceFees(list: Workspace[], provider: DataProvider): Promise<void> {
  for (const ws of list) {
    const local = getStoredFeeRate(ws.id)
    const action = planFeeSync(ws.fee_rate, local)
    if (action.kind === 'adopt-remote') {
      setFeeRate(action.rate, ws.id)
    } else if (action.kind === 'push-local') {
      try {
        await provider.setWorkspaceFeeRate(ws.id, action.rate)
      } catch (err) {
        logClient('error', 'syncWorkspaceFees', err instanceof Error ? err.message : String(err), {})
        // A write failure must not block login; the cache still has the rate.
      }
    }
  }
}

/**
 * Writes the cache first, then the row. A provider failure keeps the cache write — the rate is
 * still usable locally — but EN-08: it must not be invisible to the user, since the cloud row is
 * now stale. `onError` is called with the failure message so the caller (the workspace fee-rate
 * dialog) can surface it through its existing toast/notice mechanism; the promise still resolves
 * on failure so a caller that does not pass `onError` keeps its current behaviour.
 */
export async function saveWorkspaceFeeRate(
  provider: DataProvider,
  workspaceId: string,
  rate: number,
  onError?: (message: string) => void,
): Promise<void> {
  setFeeRate(rate, workspaceId)
  try {
    await provider.setWorkspaceFeeRate(workspaceId, rate)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logClient('error', 'saveWorkspaceFeeRate', message, {})
    onError?.(message)
  }
}
