/**
 * One round of `market/sector_flow.json`: fetch what TWSE and TPEx published for the day, build the
 * per-sector money flow (twSectorFlow.ts), and write it if it changed.
 *
 * I/O is injected so the decisions that are easy to get wrong — a partial industry list must never
 * be published, TPEx still showing yesterday must not be mixed into today, an unchanged snapshot
 * must not be rewritten — are covered by `npm test` instead of waiting for the exchange.
 *
 * Never throws and never overwrites a good snapshot with a worse one: every failure returns a
 * `reason` and leaves the file as it was.
 */
import {
  INDUSTRY_LISTED_URL,
  INDUSTRY_OTC_URL,
  TPEX_INSTITUTIONAL_URL,
  TPEX_QUOTES_URL,
  appendSectorFlowDay,
  buildSectorFlowDay,
  miIndexUrl,
  officialListedTotal,
  parseIndustryMap,
  parseMiIndexPrices,
  parseTpexInstitutional,
  parseTpexQuotes,
  parseTwseInstitutional,
  sectorFlowFingerprint,
  type SectorFlowFile,
} from './twSectorFlow.ts'
import { bfi82uDayUrl } from './twMarket.ts'

export const SECTOR_FLOW_PATH = 'market/sector_flow.json'
export const INDUSTRY_MAP_PATH = 'market/industry_map.json'
/** Industry assignments change a few times a year; a week-old list is as good as today's. */
export const INDUSTRY_MAP_MAX_AGE_MS = 7 * 24 * 3600 * 1000
/**
 * A list below these sizes is a failed or truncated fetch, not the market (2026-10-02: 1,095 listed
 * and about 800 TPEx rows). Publishing sector sums from half a list would put real money in the
 * wrong sector without any sign of it.
 */
const MIN_LISTED_INDUSTRY_ROWS = 500
const MIN_OTC_INDUSTRY_ROWS = 300

export interface SectorFlowSyncDeps {
  /** GET a URL as JSON; null on any failure. */
  fetchJson: (url: string) => Promise<unknown | null>
  /** The T86 response of the day (cache first, then TWSE); null when not published. */
  loadT86: (ymd: string) => Promise<unknown | null>
  download: <T>(path: string) => Promise<T | null>
  upload: (path: string, payload: unknown) => Promise<boolean>
  now: () => Date
}

export type SectorFlowReason =
  | 'unchanged'
  | 'no-t86'
  | 'bad-t86'
  | 'no-prices'
  | 'no-industry'
  | 'upload-failed'
  | 'error'

export interface SectorFlowSyncResult {
  synced: boolean
  /** 'YYYY-MM-DD' of the day the file now covers (or already covered). */
  date: string | null
  /** Whether TPEx was on the same day and is part of the figures. */
  otc: boolean
  reason: SectorFlowReason | null
}

interface IndustryMapFile {
  schema: number
  asOf: string
  industry: Record<string, string>
}

async function loadIndustry(deps: SectorFlowSyncDeps): Promise<Map<string, string> | null> {
  const stored = await deps.download<IndustryMapFile>(INDUSTRY_MAP_PATH)
  const storedMap =
    stored && typeof stored.industry === 'object' && stored.industry !== null
      ? new Map(Object.entries(stored.industry))
      : null
  const age = stored ? deps.now().getTime() - Date.parse(stored.asOf) : Infinity
  if (storedMap && storedMap.size > 0 && age < INDUSTRY_MAP_MAX_AGE_MS) return storedMap

  const [listedRaw, otcRaw] = await Promise.all([
    deps.fetchJson(INDUSTRY_LISTED_URL),
    deps.fetchJson(INDUSTRY_OTC_URL),
  ])
  const listed = parseIndustryMap(listedRaw, '公司代號', '產業別')
  const otc = parseIndustryMap(otcRaw, 'SecuritiesCompanyCode', 'SecuritiesIndustryCode')
  if (listed.size >= MIN_LISTED_INDUSTRY_ROWS && otc.size >= MIN_OTC_INDUSTRY_ROWS) {
    const merged = new Map([...listed, ...otc])
    await deps.upload(INDUSTRY_MAP_PATH, {
      schema: 1,
      asOf: deps.now().toISOString(),
      industry: Object.fromEntries(merged),
    } satisfies IndustryMapFile)
    return merged
  }
  // Half a fetch: an old complete list beats a new partial one.
  return storedMap && storedMap.size > 0 ? storedMap : null
}

export async function syncSectorFlow(ymd: string, deps: SectorFlowSyncDeps): Promise<SectorFlowSyncResult> {
  try {
    const t86Raw = await deps.loadT86(ymd)
    if (!t86Raw) return { synced: false, date: null, otc: false, reason: 'no-t86' }
    const listedInst = parseTwseInstitutional(t86Raw)
    if (!listedInst) return { synced: false, date: null, otc: false, reason: 'bad-t86' }

    const pricesUrl = miIndexUrl(ymd)
    const bfiUrl = bfi82uDayUrl(ymd)
    if (!pricesUrl || !bfiUrl) return { synced: false, date: null, otc: false, reason: 'no-prices' }
    const [miRaw, bfiRaw, tpexInstRaw, tpexQuotesRaw, industry] = await Promise.all([
      deps.fetchJson(pricesUrl),
      deps.fetchJson(bfiUrl),
      deps.fetchJson(TPEX_INSTITUTIONAL_URL),
      deps.fetchJson(TPEX_QUOTES_URL),
      loadIndustry(deps),
    ])

    const listedPrices = parseMiIndexPrices(miRaw)
    const dashDate = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
    if (!listedPrices || listedPrices.date !== dashDate) {
      return { synced: false, date: null, otc: false, reason: 'no-prices' }
    }
    if (!industry) return { synced: false, date: dashDate, otc: false, reason: 'no-industry' }

    // TPEx publishes "the latest day" with no date parameter, so it can still be yesterday.
    // Yesterday's TPEx figures next to today's listed ones would be wrong, not just late.
    const tpexInst = parseTpexInstitutional(tpexInstRaw)
    const tpexQuotes = parseTpexQuotes(tpexQuotesRaw)
    const otc =
      tpexInst && tpexQuotes && tpexInst.date === dashDate && tpexQuotes.date === dashDate
        ? { prices: tpexQuotes.prices, inst: tpexInst.net }
        : null

    const day = buildSectorFlowDay({
      date: dashDate,
      listedPrices: listedPrices.prices,
      listedInst,
      otc,
      industry,
      officialListedTotalTwd: officialListedTotal(bfiRaw),
    })

    const stored = await deps.download<SectorFlowFile>(SECTOR_FLOW_PATH)
    // A file that does not parse as ours is replaced, not appended to.
    const existing = stored && Array.isArray(stored.days) ? stored : null
    const fp = sectorFlowFingerprint(day)
    const newest = existing?.days?.[existing.days.length - 1]
    if (newest?.date === day.date && existing?.fingerprint === fp) {
      return { synced: false, date: day.date, otc: otc !== null, reason: 'unchanged' }
    }

    const ok = await deps.upload(SECTOR_FLOW_PATH, appendSectorFlowDay(existing, day, deps.now().toISOString()))
    return { synced: ok, date: day.date, otc: otc !== null, reason: ok ? null : 'upload-failed' }
  } catch {
    return { synced: false, date: null, otc: false, reason: 'error' }
  }
}
