import { useEffect, useSyncExternalStore } from 'react'
import { getTwStockList, subscribeTwNames, twNamesVersion } from '../services/twMarketData'

/**
 * Loads the official TW list once and re-renders the caller when its names arrive (BUG-109), so
 * `displayStockName` labels holdings with the exchange's name instead of the newest row's. Mounted
 * once in AppShell; a failed load is already logged by `getTwStockList` and leaves the fallback names.
 */
export function useTwOfficialNames(): number {
  const version = useSyncExternalStore(subscribeTwNames, twNamesVersion)
  useEffect(() => {
    getTwStockList().catch(() => undefined)
  }, [])
  return version
}
