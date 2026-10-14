/**
 * One round of `market/etf_holdings/<etf>.json` (Task 200): fetch what the issuer published, check
 * it is whole, and write it if it is new. `syncEtfUniverse` runs that for every ETF users have traded
 * or watch whose issuer has a source.
 *
 * I/O is injected so the decisions that matter — no request once the expected day is stored, a
 * partial or older response never replaces a good file — are covered by `npm test`.
 *
 * Never throws and never overwrites a good file with a worse one: every failure returns a `reason`
 * and leaves the file as it was.
 */
import { etfIssuerOf, isEtfCode, type EtfIssuerId } from '../_shared/etfIssuer.ts'
import {
  ETF_HOLDINGS_SCHEMA,
  appendHoldingsDay,
  etfHoldingsPath,
  expectedLatestTradeDate,
  holdingsFingerprint,
  parseYuantaHoldings,
  rulesFor,
  validateHoldingsDay,
  yuantaHoldingsUrl,
  yuantaRatioPageUrl,
  YUANTA_PUBLISH_HOUR_TAIPEI,
  type EtfHoldingsDay,
  type EtfHoldingsFile,
  type HoldingsRules,
} from './etfHoldings.ts'
import { createCtbcSession, ctbcRatioPageUrl, parseCtbcHoldings, type CtbcPost } from './etfHoldingsCtbc.ts'
import { capitalRatioPageUrl, createCapitalSession, parseCapitalHoldings, type CapitalPost } from './etfHoldingsCapital.ts'

export type EtfFileIssuer = EtfHoldingsFile['issuer']

/** One issuer's way to get a fund's holdings. */
export interface HoldingsSource {
  issuer: EtfFileIssuer
  /** Hour (Taipei) from which today's day is expected; null = only the previous weekday is. */
  publishHourTaipei: number | null
  /** The official page for the user to check against (may need the issuer's own fund id). */
  sourceUrl: (etf: string) => string | Promise<string>
  /** The raw response for the latest day; null on any failure. `todayYmd` is YYYYMMDD Taipei. */
  fetch: (etf: string, todayYmd: string) => Promise<unknown | null>
  /** Longest the next `fetch` can take, so the round never starts one it cannot finish. */
  worstCaseMs: () => number
  parse: (raw: unknown) => ParsedHoldings | null
}

/**
 * A parsed day, or a well-formed response holding something no screen exists for yet (bonds, a
 * foreign-currency fund) — skipped quietly, unlike a malformed response (null → parse-failed).
 */
export type ParsedHoldings = { fundName: string; day: EtfHoldingsDay } | { unsupported: string }

/**
 * Per-call budgets the index.ts fetchers pass to `fetchWithRetry`: 3 s an attempt inside 7 s, so a
 * slow first attempt still leaves room for one retry (3 + 0.4 backoff + 3). The issuers answer Edge in
 * 0.1–1 s; on 2026-10-14 one Capital call stalled with 6 s / 7 s, which left no retry at all.
 */
export const ETF_CALL_ATTEMPT_MS = 3_000
export const ETF_CALL_BUDGET_MS = 7_000

export function yuantaSource(fetchJson: (url: string) => Promise<unknown | null>): HoldingsSource {
  return {
    issuer: 'yuanta',
    worstCaseMs: () => ETF_CALL_BUDGET_MS,
    publishHourTaipei: YUANTA_PUBLISH_HOUR_TAIPEI,
    sourceUrl: yuantaRatioPageUrl,
    fetch: (etf) => fetchJson(yuantaHoldingsUrl(etf)),
    parse: parseYuantaHoldings,
  }
}

/** One Capital session (ticker → fundNo) per source, so build one source per run. */
export function capitalSource(post: CapitalPost): HoldingsSource {
  const session = createCapitalSession(post)
  return {
    issuer: 'capital',
    worstCaseMs: () => session.pendingCalls() * ETF_CALL_BUDGET_MS,
    // Same-day publish time not observed yet (T was there by T+1 11:00); expect the previous weekday.
    publishHourTaipei: null,
    sourceUrl: async (etf) => {
      const fundNo = await session.fundNoOf(etf)
      return fundNo ? capitalRatioPageUrl(fundNo) : 'https://www.capitalfund.com.tw/etf'
    },
    fetch: (etf) => session.fetchHoldings(etf),
    parse: parseCapitalHoldings,
  }
}

/** One CTBC session (token + ticker → FID) per source, so build one source per run. */
export function ctbcSource(post: CtbcPost): HoldingsSource {
  const session = createCtbcSession(post)
  return {
    issuer: 'ctbc',
    worstCaseMs: () => session.pendingCalls() * ETF_CALL_BUDGET_MS,
    publishHourTaipei: null,
    sourceUrl: ctbcRatioPageUrl,
    fetch: (etf, todayYmd) => session.fetchHoldings(etf, todayYmd),
    parse: parseCtbcHoldings,
  }
}

export interface EtfHoldingsSyncDeps {
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
  | 'no-stocks'
  | 'unsupported-holdings'
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

/** Outcomes that mean a file could not be refreshed for a reason someone should look at. */
export const ETF_HOLDINGS_FAILURES: ReadonlySet<string> = new Set([
  'fetch-failed',
  'parse-failed',
  'invalid',
  'upload-failed',
  'error',
])

const taipeiYmd = (d: Date): string =>
  new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '')

export async function syncEtfHoldings(
  etf: string,
  source: HoldingsSource,
  rules: HoldingsRules,
  deps: EtfHoldingsSyncDeps,
): Promise<EtfHoldingsSyncResult> {
  const out = (r: Omit<EtfHoldingsSyncResult, 'etf'>): EtfHoldingsSyncResult => ({ etf, ...r })
  try {
    const path = etfHoldingsPath(etf)
    const now = deps.now()
    const stored = await deps.download<EtfHoldingsFile>(path)
    // A file that does not parse as ours is replaced, not appended to. A malformed day is dropped
    // rather than read: one bad element must not fail every later run.
    const existing = stored && Array.isArray(stored.days)
      ? stored.days.filter((d) => d !== null && typeof d === 'object' && typeof d.tradeDate === 'string')
      : []
    const newest = existing[0]
    const expected = expectedLatestTradeDate(now, source.publishHourTaipei)
    // The schedule runs this several times a day; once the expected day is in, ask nobody.
    if (newest && newest.tradeDate >= expected) {
      return out({ synced: false, tradeDate: newest.tradeDate, reason: 'unchanged' })
    }

    const today = taipeiYmd(now)
    const raw = await source.fetch(etf, today)
    if (raw === null) return out({ synced: false, tradeDate: newest?.tradeDate ?? null, reason: 'fetch-failed' })
    const parsed = source.parse(raw)
    if (!parsed) return out({ synced: false, tradeDate: newest?.tradeDate ?? null, reason: 'parse-failed' })
    if ('unsupported' in parsed) {
      return out({ synced: false, tradeDate: newest?.tradeDate ?? null, reason: 'unsupported-holdings', rule: parsed.unsupported })
    }
    const { day, fundName } = parsed
    // A fund with neither stocks nor futures (a bond fund) has no screen yet (spec § Expansion 7):
    // skipped — not a failure that would turn every run red. Futures-led funds are written.
    if (day.stocks.length === 0 && day.futures.length === 0) {
      return out({ synced: false, tradeDate: day.tradeDate, reason: 'no-stocks' })
    }

    const check = validateHoldingsDay(day, rules, today)
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
      issuer: source.issuer,
      sourceUrl: await source.sourceUrl(etf),
      updatedAt: now.toISOString(),
      days: appendHoldingsDay(existing, day),
    }
    const ok = await deps.upload(path, file)
    return out({ synced: ok, tradeDate: day.tradeDate, reason: ok ? null : 'upload-failed' })
  } catch (e) {
    return out({ synced: false, tradeDate: null, reason: 'error', detail: e instanceof Error ? e.message : String(e) })
  }
}

export interface EtfUniverseResult {
  results: EtfHoldingsSyncResult[]
  /** ETF codes whose issuer has no source yet (the tab says 尚未串接). */
  unsupported: string[]
  /** Codes not started because the time budget ran out; the next run picks them up. */
  skippedForBudget: string[]
}

/**
 * Every ETF in `etfs` (code + short name) whose issuer has a source, one after another. A fund is
 * started only when its source's worst case still fits in `budgetMs` counted from `startedAt` — pass
 * the time the round began (before the universe query), so that query counts too.
 */
export async function syncEtfUniverse(
  etfs: Array<{ ticker: string; name: string }>,
  sources: Partial<Record<EtfIssuerId, HoldingsSource>>,
  deps: EtfHoldingsSyncDeps,
  budgetMs: number,
  startedAt: number = deps.now().getTime(),
): Promise<EtfUniverseResult> {
  const results: EtfHoldingsSyncResult[] = []
  const unsupported: string[] = []
  const skippedForBudget: string[] = []
  const seen = new Set<string>()
  // 0050 first: it was the only ETF before release 1, so a tight budget must not starve it.
  const ordered = [...etfs].sort((a, b) => Number(b.ticker === '0050') - Number(a.ticker === '0050'))
  for (const { ticker, name } of ordered) {
    if (!isEtfCode(ticker) || seen.has(ticker)) continue
    seen.add(ticker)
    const issuer = etfIssuerOf(name)
    const source = issuer ? sources[issuer.id] : undefined
    if (!source) {
      unsupported.push(ticker)
      continue
    }
    if (deps.now().getTime() - startedAt + source.worstCaseMs() > budgetMs) {
      skippedForBudget.push(ticker)
      continue
    }
    results.push(await syncEtfHoldings(ticker, source, rulesFor(ticker), deps))
  }
  return { results, unsupported, skippedForBudget }
}
