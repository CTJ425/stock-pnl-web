/**
 * One round of `market/etf_holdings/<etf>.json` (Task 200): fetch what the issuer published, check
 * it is whole, and write it if it is new.
 *
 * I/O is injected so the decisions that matter — no request once the expected day is stored, a
 * partial or older response never replaces a good file — are covered by `npm test`.
 *
 * Never throws and never overwrites a good file with a worse one: every failure returns a `reason`
 * and leaves the file as it was.
 */
import {
  ETF_HOLDINGS_SCHEMA,
  appendHoldingsDay,
  etfHoldingsPath,
  expectedLatestTradeDate,
  holdingsFingerprint,
  parseYuantaHoldings,
  validateHoldingsDay,
  yuantaHoldingsUrl,
  yuantaRatioPageUrl,
  type EtfHoldingsFile,
  type HoldingsRules,
} from './etfHoldings.ts'

export interface EtfHoldingsSyncDeps {
  /** GET a URL as JSON; null on any failure. */
  fetchJson: (url: string) => Promise<unknown | null>
  /**
   * null **only** when the file does not exist; a failed read must throw. Treating a failed read
   * as "no file" would let a good response replace 20 stored days with one.
   */
  download: <T>(path: string) => Promise<T | null>
  upload: (path: string, payload: unknown) => Promise<boolean>
  now: () => Date
}

export type EtfHoldingsReason =
  | 'unchanged'
  | 'not-published'
  | 'fetch-failed'
  | 'parse-failed'
  | 'invalid'
  | 'stale'
  | 'upload-failed'
  | 'error'

export interface EtfHoldingsSyncResult {
  etf: string
  synced: boolean
  /** 'YYYY-MM-DD' of the newest day the file now holds (or the fetched day when it was refused). */
  tradeDate: string | null
  reason: EtfHoldingsReason | null
  /** The failed check when `reason` is 'invalid'. */
  rule?: string
  /** The exception message when `reason` is 'error'. */
  detail?: string
}

const taipeiYmd = (d: Date): string =>
  new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '')

export async function syncEtfHoldings(
  etf: string,
  rules: HoldingsRules,
  deps: EtfHoldingsSyncDeps,
): Promise<EtfHoldingsSyncResult> {
  const out = (r: Omit<EtfHoldingsSyncResult, 'etf'>): EtfHoldingsSyncResult => ({ etf, ...r })
  try {
    const path = etfHoldingsPath(etf)
    const now = deps.now()
    const stored = await deps.download<EtfHoldingsFile>(path)
    // A file that does not parse as ours is replaced, not appended to.
    // A malformed day is dropped rather than read: one bad element must not fail every later run.
    const existing = stored && Array.isArray(stored.days)
      ? stored.days.filter((d) => d !== null && typeof d === 'object' && typeof d.tradeDate === 'string')
      : []
    const newest = existing[0]
    const expected = expectedLatestTradeDate(now)
    // The schedule runs this several times a day; once the expected day is in, ask nobody.
    if (newest && newest.tradeDate >= expected) {
      return out({ synced: false, tradeDate: newest.tradeDate, reason: 'unchanged' })
    }

    const raw = await deps.fetchJson(yuantaHoldingsUrl(etf))
    if (raw === null) return out({ synced: false, tradeDate: newest?.tradeDate ?? null, reason: 'fetch-failed' })
    const parsed = parseYuantaHoldings(raw)
    if (!parsed) return out({ synced: false, tradeDate: newest?.tradeDate ?? null, reason: 'parse-failed' })
    const { day, fundName } = parsed

    const check = validateHoldingsDay(day, rules, taipeiYmd(now))
    if (!check.ok) return out({ synced: false, tradeDate: day.tradeDate, reason: 'invalid', rule: check.rule })

    if (newest && day.tradeDate < newest.tradeDate) {
      return out({ synced: false, tradeDate: newest.tradeDate, reason: 'stale' })
    }
    if (newest && day.tradeDate === newest.tradeDate && holdingsFingerprint(day) === holdingsFingerprint(newest)) {
      // Same day as stored, and the stored day is older than expected (else we returned above):
      // the issuer has not published the next one yet — or it is a holiday.
      return out({ synced: false, tradeDate: day.tradeDate, reason: 'not-published' })
    }

    const file: EtfHoldingsFile = {
      schema: ETF_HOLDINGS_SCHEMA,
      etf,
      fundName: fundName || stored?.fundName || etf,
      issuer: 'yuanta',
      sourceUrl: yuantaRatioPageUrl(etf),
      updatedAt: now.toISOString(),
      days: appendHoldingsDay(existing, day),
    }
    const ok = await deps.upload(path, file)
    return out({ synced: ok, tradeDate: day.tradeDate, reason: ok ? null : 'upload-failed' })
  } catch (e) {
    return out({ synced: false, tradeDate: null, reason: 'error', detail: e instanceof Error ? e.message : String(e) })
  }
}
