/**
 * Grouping per-account 經濟快報 (full edition) webhook overrides by URL (Task 165 Phase 2 step 2d,
 * spec discord-admin-accounts.md §3.2). Pure, no side effects.
 */

export interface MarketOverride {
  userId: string
  url: string
  /** Task 165 step 2e (spec §5b.1): the per-account 經濟快報 switch. Required — a missing flag
   * must never read as "enabled" (fail-open). */
  enabled: boolean
}

export interface MarketTarget {
  url: string
  userIds: string[]
}

/** Task 165 step 2e (spec §5b.6): `db.select()` types as `any`, so a column left out of a
 * query is invisible to the compiler. This mapper is the only thing that catches a row missing
 * `market_enabled` — it throws instead of silently defaulting to "enabled" or "disabled". */
export function toMarketOverride(row: Record<string, unknown>): MarketOverride {
  const { user_id: userId, market_webhook_url: url, market_enabled: enabled } = row
  if (typeof userId !== 'string') throw new Error('toMarketOverride: user_id missing or not a string')
  if (typeof url !== 'string') throw new Error('toMarketOverride: market_webhook_url missing or not a string')
  if (typeof enabled !== 'boolean') throw new Error('toMarketOverride: market_enabled missing or not a boolean')
  return { userId, url, enabled }
}

/** URLs are compared after `trim()`. An override equal to the (trimmed) global URL is dropped —
 * that account already gets it from the shared channel (spec U4). The rest are grouped by URL,
 * in order of first appearance; `userIds` keep their input order. */
export function groupMarketTargets(globalUrl: string, overrides: MarketOverride[]): MarketTarget[] {
  const global = globalUrl.trim()
  const order: string[] = []
  const byUrl = new Map<string, string[]>()

  for (const { userId, url: rawUrl, enabled } of overrides) {
    if (!enabled) continue
    const url = rawUrl.trim()
    if (url === global) continue
    let userIds = byUrl.get(url)
    if (!userIds) {
      userIds = []
      byUrl.set(url, userIds)
      order.push(url)
    }
    userIds.push(userId)
  }

  return order.map((url) => ({ url, userIds: byUrl.get(url)! }))
}
