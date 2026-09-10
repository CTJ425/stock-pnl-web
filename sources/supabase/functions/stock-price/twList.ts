/**
 * Pure merge and completeness check for the `twlist` action.
 *
 * Kept free of Supabase/Deno imports so it can be unit tested with plain vitest —
 * see twList.test.ts.
 *
 * A half list is worse than no list: the client caches it for 30 minutes, and every stock
 * from the dead source then reads as "no such stock". A source that resolves with an empty
 * array is the same failure wearing a success code, so it counts as a failure too.
 */

export type TwListSource = PromiseSettledResult<Array<Record<string, unknown>>>

export interface TwListRow {
  symbol: string
  name: string
  close: number | null
}

export type TwListResult = { ok: true; rows: TwListRow[] } | { ok: false; error: string }

function listNumber(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

export function buildTwList(twse: TwListSource, tpex: TwListSource): TwListResult {
  if (twse.status === 'rejected' || tpex.status === 'rejected') {
    return { ok: false, error: '台股清單來源不完整（上市或上櫃來源無回應）' }
  }

  const rows: TwListRow[] = []
  const seen = new Set<string>()

  /**
   * Adds one source's rows and returns how many of them were structurally usable.
   *
   * "Usable" is counted before the duplicate check on purpose. A non-empty response whose
   * rows all lack a code or a name is a dead source wearing a success code, and array length
   * alone cannot tell the two apart. A row that is merely a duplicate of one the other
   * exchange already supplied still proves this source answered, so it counts.
   */
  const collect = (
    raw: Array<Record<string, unknown>>,
    read: (row: Record<string, unknown>) => [unknown, unknown, unknown],
  ): number => {
    let usable = 0
    for (const row of raw) {
      const [symbol, name, close] = read(row)
      const s = String(symbol ?? '').trim()
      const n = String(name ?? '').trim()
      if (!s || !n) continue
      usable += 1
      if (seen.has(s)) continue
      seen.add(s)
      rows.push({ symbol: s, name: n, close: listNumber(close) })
    }
    return usable
  }

  const twseUsable = collect(twse.value, (r) => [r.Code, r.Name, r.ClosingPrice])
  const tpexUsable = collect(tpex.value, (r) => [
    r.SecuritiesCompanyCode ?? r.Code,
    r.CompanyName ?? r.Name,
    r.Close ?? r.ClosingPrice ?? r.LatestPrice,
  ])

  if (twseUsable === 0 || tpexUsable === 0) {
    return { ok: false, error: '台股清單來源不完整（上市或上櫃來源無有效資料）' }
  }
  return { ok: true, rows }
}
