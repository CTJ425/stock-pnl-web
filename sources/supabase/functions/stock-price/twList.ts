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

export interface TwListFailure {
  source: 'TWSE' | 'TPEx'
  reason: string
}

export type TwListResult =
  | { ok: true; rows: TwListRow[] }
  | { ok: false; error: string; failures: TwListFailure[] }

function listNumber(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

function rejectionReason(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason)
  return text.slice(0, 200)
}

export function buildTwList(twse: TwListSource, tpex: TwListSource): TwListResult {
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
    raw: unknown,
    read: (row: Record<string, unknown>) => [unknown, unknown, unknown],
  ): number => {
    if (!Array.isArray(raw)) return 0
    let usable = 0
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue
      const [symbol, name, close] = read(row as Record<string, unknown>)
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

  const failures: TwListFailure[] = []

  if (twse.status === 'rejected') {
    failures.push({ source: 'TWSE', reason: rejectionReason(twse.reason) })
  } else if (!Array.isArray(twse.value)) {
    failures.push({ source: 'TWSE', reason: 'response is not an array' })
  } else {
    const usable = collect(twse.value, (r) => [r.Code, r.Name, r.ClosingPrice])
    if (usable === 0) {
      failures.push({ source: 'TWSE', reason: `0 usable rows of ${twse.value.length} returned` })
    }
  }

  if (tpex.status === 'rejected') {
    failures.push({ source: 'TPEx', reason: rejectionReason(tpex.reason) })
  } else if (!Array.isArray(tpex.value)) {
    failures.push({ source: 'TPEx', reason: 'response is not an array' })
  } else {
    const usable = collect(tpex.value, (r) => [
      r.SecuritiesCompanyCode ?? r.Code,
      r.CompanyName ?? r.Name,
      r.Close ?? r.ClosingPrice ?? r.LatestPrice,
    ])
    if (usable === 0) {
      failures.push({ source: 'TPEx', reason: `0 usable rows of ${tpex.value.length} returned` })
    }
  }

  if (failures.length > 0) {
    const error = `台股清單來源不完整：${failures.map((f) => `${f.source} ${f.reason}`).join('；')}`
    return { ok: false, error, failures }
  }
  return { ok: true, rows }
}
