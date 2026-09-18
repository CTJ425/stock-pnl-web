/**
 * Grouping per-account 經濟快報 (full edition) webhook overrides by URL (Task 165 Phase 2 step 2d,
 * spec discord-admin-accounts.md §3.2). Pure, no side effects.
 */

export interface MarketOverride {
  userId: string
  url: string
}

export interface MarketTarget {
  url: string
  userIds: string[]
}

/** URLs are compared after `trim()`. An override equal to the (trimmed) global URL is dropped —
 * that account already gets it from the shared channel (spec U4). The rest are grouped by URL,
 * in order of first appearance; `userIds` keep their input order. */
export function groupMarketTargets(globalUrl: string, overrides: MarketOverride[]): MarketTarget[] {
  const global = globalUrl.trim()
  const order: string[] = []
  const byUrl = new Map<string, string[]>()

  for (const { userId, url: rawUrl } of overrides) {
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
