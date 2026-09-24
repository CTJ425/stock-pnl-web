/**
 * Hash routes for the shell's pages: `#/transactions`, `#/analysis/2330`, …
 *
 * Only a hash that starts with `#/` is a route. Supabase auth redirects arrive as
 * `#access_token=…&type=recovery` and auth-js consumes and clears them itself (services/supabase.ts),
 * so anything else parses as "no route" and is never rewritten here.
 */
export interface ViewRoute<V extends string> {
  view: V
  /** Only meaningful for `analysis`: the stock handed over from another page. */
  ticker?: string
}

export function parseViewHash<V extends string>(hash: string, views: readonly V[]): ViewRoute<V> | null {
  if (!hash.startsWith('#/')) return null
  const [head, ...rest] = hash.slice(2).split('/')
  const view = views.find((v) => v === head)
  if (!view) return null
  let ticker: string | undefined
  if (rest.length > 0 && rest[0] !== '') {
    try {
      ticker = decodeURIComponent(rest.join('/'))
    } catch {
      ticker = undefined
    }
  }
  return ticker ? { view, ticker } : { view }
}

export function formatViewHash<V extends string>(route: ViewRoute<V>): string {
  return route.ticker ? `#/${route.view}/${encodeURIComponent(route.ticker)}` : `#/${route.view}`
}
