/**
 * Reconciles the per-workspace fee rate between Supabase (`workspaces.fee_rate`) and the
 * `localStorage` cache read by `getFeeRate`. Runs at workspace bootstrap and on save.
 */
import type { Workspace } from '../types/models'
import type { DataProvider } from './dataProvider'
import { getStoredFeeRate, setFeeRate } from '../utils/settings'
import { planFeeSync } from '../utils/feeSync'

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
      } catch {
        // A write failure must not block login; the cache still has the rate.
      }
    }
  }
}

/** Writes the cache first, then the row. A provider failure keeps the cache write. */
export async function saveWorkspaceFeeRate(
  provider: DataProvider,
  workspaceId: string,
  rate: number,
): Promise<void> {
  setFeeRate(rate, workspaceId)
  try {
    await provider.setWorkspaceFeeRate(workspaceId, rate)
  } catch {
    // Swallow: the cache already has the new rate.
  }
}
