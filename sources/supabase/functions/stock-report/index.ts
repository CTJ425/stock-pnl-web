/**
 * Supabase Edge Function: stock-report (after-hours chip report generator)
 *
 * The server side captures TWSE after-hours chips and generates **structured data** (HTML is no longer generated starting from schema 2,
 * The screen is always drawn by front-end React). The report embeds the history of the last 7 trading days for front-end self-drawn trend charts.
 * Shared raw file cache (chip_raw_cache data table, see sources/supabase/schema.sql).
 * Deployment method (need to install Supabase CLI and log in):
 *   supabase functions deploy stock-report --no-verify-jwt
 *
 * interface:
 *   POST { action: 'generate', market: 'TPE', ticker: string, name: string, holding?: HoldingContext }
 *     → { reportId, generatedAt, dataDate, data } (chips are generated immediately with one click, used for front-end fallback)
 *   POST { action: 'warm', ticker: string, name?: string, phase?: 'core' | 'history' | 'full' }
 *     → { ok, ticker, ymd, dailySynced, fundamentalSynced, fundamentalComplete, phase, ... }
 *       Instant production for a single symbol (0.6.0-dev.7). From 0.6.46-dev.4 the caller may
 *       split work: `core` = daily + latest fundamental only (fast first paint); `history` = MOPS
 *       revenue/profit backfill (no second quota charge; requires an existing fundamental file);
 *       `full` (default) = core then history in one request (legacy / background prefetch).
 *   POST { action: 'generate-all' } header: x-cron-secret (after-hours pg_cron trigger)
 *     → Orchestrates phases chips → market-data → history under GENERATE_ALL_BUDGET_MS (0.6.49).
 *       May skip later phases when wall time is short; next cron tick continues. P1: history is one
 *       backfill round only. Admin console prefers per-phase admin-run jobs (separate HTTP budgets).
 *   POST { action: 'generate-chips' | 'generate-market-data' | 'generate-history' } x-cron-secret
 *     → Single phase (same handlers as generate-all internals).
 *   POST { action: 'sync-macro' } header: x-cron-secret (triggered by macro-daily schedule)
 *     → Capture five FRED sequences and write them into macro/us.json (global single file). It has nothing to do with Taiwan stock trading days, so it is scheduled independently.
 *   POST { action: 'sync-fx' } header: x-cron-secret (triggered by fx-daily schedule)
 *     → Capture eight Yahoo currency pairs and write them into fx/twd.json (global single file). It has nothing to do with Taiwan stock trading days, so it is scheduled independently.
 *   POST { action: 'backfill-revenue' }  header: x-cron-secret
 *     → The monthly revenue of fundamental/{ticker}.json is supplemented to 12 months (0.6.4) by MOPS monthly report.
 *       generate-all will also run once every round. This entrance is for those who "don't want to wait for the schedule".
 *
 * `generate` and `warm` require a signed-in user (`assertUser`) and the ticker must appear in
 * `heldTwTickers()` (0.7.0 restored holdings whitelist after removing full-market search / TOP20).
 * `warm` additionally charges `WARM_DAILY_LIMIT` via `take_warm_quota`. Deployed with
 * --no-verify-jwt; see 0.3.9 for what happens with no gate at all.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  UA,
  fetchJson,
  t86Url,
  marginDatedUrl,
  marginDatedOk,
  MI_MARGN_URL,
  BORROW_DATED_URL,
  borrowDatedOk,
  borrowDatedDate,
  extractBorrowDated,
  type BorrowDatedResponse,
  extractInstitutional,
  extractMargin,
  extractMarginDated,
  extractBorrow,
  type MarginDatedResponse,
  type T86ResponseShape,
} from './twChips.ts'
import {
  buildReport,
  dashDate,
  isWeekendYmd,
  taipeiYmd,
  tradingDateCandidates,
  type ChipDay,
  type HoldingContext,
  type ReportSources,
  type SourceStamp,
} from './report.ts'
import {
  DAILY_SCHEMA,
  dailyUrl,
  extractDaily,
  yahooDailySymbols,
  type ChartResponse,
  type DailyFile,
} from './twDaily.ts'
import {
  BWIBBU_ALL_URL,
  FUNDAMENTAL_SCHEMA,
  T187AP03_URL,
  T187AP05_URL,
  T187AP17_URL,
  buildFundamentalFile,
  extractIndustry,
  extractProfit,
  extractRevenue,
  extractValuation,
  mergeProfitQuarters,
  mergeRevenueMonths,
  PROFIT_QUARTERS_CAP,
  REVENUE_MONTHS_CAP,
  type FundamentalFile,
  type ProfitQuarter,
  type RevenueMonth,
} from './twFundamental.ts'
import {
  MOPS_MARKETS,
  mopsRevenueUrl,
  nextBackfilledThrough,
  parseMopsRevenue,
  closedAttemptedMonths,
  planRevenueBackfill,
  publishedMonths,
  type RevenueProgress,
} from './twRevenueHistory.ts'
import {
  MOPS_T163_HOST,
  MOPS_T163_PATH,
  T163_MARKETS,
  mopsProfitBody,
  nextProfitThrough,
  parseMopsProfit,
  planProfitBackfill,
  publishedQuarters,
  type ProfitProgress,
} from './twProfitHistory.ts'
import {
  MARKET_SCHEMA,
  bfi82uDayUrl,
  fmtqikMonthUrl,
  isMarketSessionReady,
  mergeInstitutional,
  mergeMarketDays,
  parseBfi82u,
  parseFmtqik,
  parseTaiexHist,
  planInstitutionalBackfill,
  planMarketMonths,
  taiexHistMonthUrl,
  type MarketDay,
  type MarketFile,
} from './twMarket.ts'
import {
  FRED_SERIES,
  macroCatalogIncomplete,
  MACRO_LOOKBACK_MONTHS,
  MACRO_SCHEMA,
  meetingRatePoints,
  deriveIndicator,
  fredCsvUrl,
  fredSinceDate,
  MACRO_UA,
  macroFingerprint,
  parseFredCsv,
  parseFredCsvDaily,
  type MacroFile,
  type MacroIndicator,
} from './usMacro.ts'
import {
  decideMacroScan,
  nextReleaseFor,
  RELEASE_CALENDAR,
  taipeiYmdOf,
  type ScanReason,
} from './macroCalendar.ts'
import {
  FX_CURRENCIES,
  FX_MIN_POINTS,
  FX_SCHEMA,
  buildCurrency,
  extractFxPoints,
  fxUrl,
  type FxCurrency,
  type FxFile,
} from './fxRates.ts'
import {
  decideSkip,
  fingerprint,
  marginSigPart,
  nextT86State,
  rowsFingerprint,
  runSignature,
  t86Fingerprint,
  type T86State,
} from './pollPlan.ts'
import {
  PROBE_SOURCE_LABELS,
  PROBE_SOURCE_ORDER,
  borrowHit,
  mopsIssueRocYmd,
  pendingSources,
  sourcesForTaipeiTime,
  ymdToRocYmd,
  type ProbeSourceId,
} from './sourceProbePlan.ts'

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are automatically injected by the Supabase execution environment;
// The service role is not restricted by RLS and is the only way to read and write chip_raw_cache.
const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

const TICKER_RE = /^[0-9A-Za-z]{2,8}$/

/** The number of historical trading days embedded in the report (**Trading days**, not calendar days)*/
const HISTORY_DAYS = 7
/** The number of calendar days to push back must be enough to cover HISTORY_DAYS trading days (including weekends and consecutive holidays)*/
const LOOKBACK_DAYS = 14
/** A single call can capture up to a few missing days; the Edge Function has a wall-clock upper limit, and the missing days are scheduled to be filled in every other day.*/
const MAX_BACKFILL_DAYS = 5
/**
 * Monthly revenue history replenishment: a single call can be captured for up to several months.
 * There are two copies of listing + listing in a month, each about 400KB, the same reason as MAX_BACKFILL_DAYS——
 * The upper limit of the CPU/wall-clock of the Edge Function is the tightest line on this path, not the amount of data.
 * It takes about 3 rounds to fill up REVENUE_MONTHS_CAP (12) months, which can be completed in one night's schedule.
 */
const MAX_BACKFILL_MONTHS = 4
/**
 * Quarterly profitability replenishment: the maximum number of quarters that can be captured in a single call.
 *
 * **Conservative compared to monthly revenue (4 → 2)**: One quarter should focus on listing + over-the-counter listings, each about **1.6MB** (monthly revenue is 400KB),
 * During parsing, the entire string is stored in memory. It takes about 6 rounds to fill up PROFIT_QUARTERS_CAP (12).
 * The after-hours batch runs 32 rounds in one night and can be completed in one night.
 */
const MAX_BACKFILL_QUARTERS = 2

/**
 * Replenishment of instant production (`warm`): **Replenish one round until there is nothing left to replenish, or until the time budget is used up** (0.6.29).
 *
 * The goal is "the newly added stocks will be as complete as the existing stocks when opening the page for the first time", so you can't just make up one round -
 * It takes about 3 rounds of monthly revenue and 6 rounds of quarterly reports to complete 12 months + 12 quarters.
 *
 * The budget is **time** not the number of rounds: the cost per round between the two is very different (monthly revenue per round 4 months × two markets × 400KB,
 * Quarterly report is one round (2 quarters × two markets × 1.6MB). Using the number of rounds as the upper limit will cause timeout on the slow side and waste on the fast side.
 * Supplement the monthly revenue first and then the quarterly report: Monthly revenue is much cheaper, and the same number of seconds can be exchanged for more completeness first.
 *
 * It doesn’t matter if it can’t be filled up: the night batch will still take over, and the front end will call again when it sees that there is still a shortage when the page is opened.
 */
const WARM_BUDGET_MS = 30_000
const WARM_ROUND_MONTHS = 4
const WARM_ROUND_QUARTERS = 2
/**
 * Orchestrated `generate-all` wall budget (0.6.49).
 * Cloud Edge ~150s idle/wall; 546 is often CPU/memory from packing chips+daily+history
 * in one isolate. Leave headroom; remaining phases wait for the next cron tick (P1).
 */
const GENERATE_ALL_BUDGET_MS = 110_000
/** Do not start another phase if fewer ms remain than this reserve. */
const GENERATE_ALL_PHASE_RESERVE_MS = 12_000
/**
 * How many `warm` calls one account may make per Taipei day (0.6.44).
 *
 * Why a cap exists at all: until 0.6.44 the abuse ceiling was `heldTwTickers()` —— only codes
 * somebody already held could be warmed, so the whole endpoint could not amplify against MOPS.
 * The analysis page now searches the whole market, so that ceiling is gone and a new one is needed.
 * `assertUser` alone is not it: signup is open, and an attacker registers an account in a second.
 *
 * Sized against the only expensive path, the `backfillRevenue` / `backfillProfit` loops below:
 * each is capped at `WARM_BUDGET_MS`, so 30 calls is at most 15 wall-clock minutes of MOPS traffic
 * per account per day. A human hits nothing like it —— `warmStock.ts` only calls this when Storage
 * is missing or the fundamental history is short, and seals the ticker for the rest of the session,
 * so 30 is 30 *different, never-before-seen* stocks in one day.
 */
const WARM_DAILY_LIMIT = 30
/** The maximum number of simultaneous external crawls (T86 single file is about 1–2MB)*/
const FETCH_CONCURRENCY = 3

function t86Ok(r: T86ResponseShape): boolean {
  const data = r.data ?? r.tables?.[0]?.data
  return r.stat === 'OK' && Array.isArray(data) && data.length > 0
}

export function makeReportId(dateYmd: string, ticker: string): string {
  return `${dateYmd}_${ticker}_${crypto.randomUUID().slice(0, 8)}`
}

/**
 * The time when each dataset was last written to the cache. This is "when did we catch this information"——
 * There is no need to create another field, `chip_raw_cache.updated_at` is already remembered.
 */
const fetchedAtByDataset = new Map<string, string>()

async function readCache<T>(ymd: string, dataset: string): Promise<T | null> {
  try {
    const { data, error } = await db
      .from('chip_raw_cache')
      .select('payload, updated_at')
      .eq('ymd', ymd)
      .eq('dataset', dataset)
      .maybeSingle()
    if (error || !data?.payload) return null
    if (data.updated_at) fetchedAtByDataset.set(`${ymd}:${dataset}`, String(data.updated_at))
    return data.payload as T
  } catch {
    return null
  }
}

async function writeCache(ymd: string, dataset: string, payload: unknown): Promise<void> {
  try {
    const now = new Date().toISOString()
    fetchedAtByDataset.set(`${ymd}:${dataset}`, now)
    await db.from('chip_raw_cache').upsert({
      ymd,
      dataset,
      payload,
      updated_at: now,
    })
  } catch {
    // Cache writing failure does not affect the main process
  }
}

/**
 * Which (date, dataset) combinations have been cached, return the `${ymd}:${dataset}` collection.
 * Only search the key, do not retrieve the payload - each payload is 1-2MB, and retrieving them all will directly consume the memory.
 * It must be judged dataset by dataset: only T86 was cached during the v1 period, and MI_MARGN_D still needs to be captured in those days.
 */
async function cachedDayDatasets(candidates: string[]): Promise<Set<string>> {
  try {
    const { data, error } = await db
      .from('chip_raw_cache')
      .select('ymd, dataset')
      .in('dataset', ['T86', 'MI_MARGN_D'])
      .in('ymd', candidates)
    if (error || !data) return new Set()
    return new Set(data.map((r) => `${String(r.ymd)}:${String(r.dataset)}`))
  } catch {
    return new Set()
  }
}

/** Read the "latest trading day" type whole-market file (without date parameter) and cache it in Postgres based on the parsed date*/
async function readLatest<T>(ymd: string, dataset: string, url: string): Promise<T | null> {
  const cached = await readCache<T>(ymd, dataset)
  if (cached) return cached
  try {
    const data = await fetchJson<T>(url)
    await writeCache(ymd, dataset, data)
    return data
  } catch {
    return null
  }
}

// ---- Daily chip sequence ----

/** One day's market-wide raw files. Disposable: Release the chips of each code after drawing them to avoid holding dozens of MB at the same time*/
interface DayRaw {
  ymd: string
  t86: T86ResponseShape
  margin: MarginDatedResponse | null
}

/** The chips of "Codenames We Care" during the day (keyed by ticker)*/
interface DaySlice {
  ymd: string
  chips: Map<string, ChipDay>
}

/**
 * The T86 content fingerprint captured in this round uses ymd as the key.
 * Each time `handleGenerateAll` is cleared at the beginning to avoid the same isolate remaining across requests.
 */
const t86FingerprintByYmd = new Map<string, string>()

/**
 * Read T86 on a certain day (cache priority); return null if it is not a trading day/has not yet closed. Read-only cache when fetch=false.
 *
 * When `refresh=true` **re-fetch and compare even if the cache already exists** - this is the core of 0.6.1 polling.
 * T86 is updated every 15 minutes starting from 16:00, the first catch of the day is not necessarily the final one;
 * The original practice of "cache the first time you catch it and never update it again" would lock the first version as the answer for that day.
 * It's worse than being caught once too late. Only today, and not yet finalized, will go this route (see pollPlan.nextT86State).
 */
async function loadT86(
  ymd: string,
  fetchAllowed: boolean,
  refresh = false,
): Promise<T86ResponseShape | null> {
  const cached = await readCache<T86ResponseShape>(ymd, 'T86')
  if (cached && t86Ok(cached) && !refresh) {
    t86FingerprintByYmd.set(ymd, t86Fingerprint(cached))
    return cached
  }
  if (!fetchAllowed && !refresh) return null
  try {
    const resp = await fetchJson<T86ResponseShape>(t86Url(ymd))
    if (!t86Ok(resp)) {
      // Non-trading days/not released yet: do not respond quickly. Existing caches in re-fetch mode are still valid.
      // Don’t throw away good information just because you got an empty one this time.
      if (cached && t86Ok(cached)) {
        t86FingerprintByYmd.set(ymd, t86Fingerprint(cached))
        return cached
      }
      return null
    }
    const fp = t86Fingerprint(resp)
    t86FingerprintByYmd.set(ymd, fp)
    // If the content has not changed, don’t rewrite it to save the 194KB UPSERT and the dead tuple that comes with it.
    if (!cached || !t86Ok(cached) || t86Fingerprint(cached) !== fp) {
      await writeCache(ymd, 'T86', resp)
    }
    return resp
  } catch {
    return cached && t86Ok(cached) ? cached : null
  }
}

/** Read the margin trading with date on a certain day (cache priority); if the endpoint format changes or the fetch fails, null will be returned*/
async function loadMarginDated(ymd: string, fetchAllowed: boolean): Promise<MarginDatedResponse | null> {
  const cached = await readCache<MarginDatedResponse>(ymd, 'MI_MARGN_D')
  if (cached && marginDatedOk(cached)) return cached
  if (!fetchAllowed) return null
  try {
    const resp = await fetchJson<MarginDatedResponse>(marginDatedUrl(ymd))
    if (!marginDatedOk(resp)) return null
    await writeCache(ymd, 'MI_MARGN_D', resp)
    return resp
  } catch {
    return null
  }
}

async function loadDayRaw(
  ymd: string,
  allow: { t86: boolean; margin: boolean; refreshT86?: boolean },
): Promise<DayRaw | null> {
  const t86 = await loadT86(ymd, allow.t86, allow.refreshT86 ?? false)
  if (!t86) return null // T86 是交易日的判定依據，沒有就當這天沒資料
  const margin = await loadMarginDated(ymd, allow.margin)
  return { ymd, t86, margin }
}

/** Compress one day's raw files into slices containing only the target code, and then release the raw*/
function sliceDay(raw: DayRaw, tickers: string[]): DaySlice {
  const date = dashDate(raw.ymd)
  const chips = new Map<string, ChipDay>()
  for (const ticker of tickers) {
    chips.set(ticker, {
      date,
      institutional: extractInstitutional(raw.t86, ticker),
      margin: raw.margin ? extractMarginDated(raw.margin, ticker) : null,
    })
  }
  return { ymd: raw.ymd, chips }
}

export interface SeriesResult {
  /** Slice transaction days from old to new, up to HISTORY_DAYS transactions; an empty array represents no data at all*/
  days: DaySlice[]
  /** Latest trading day YYYYMMDD (if no data is available, the nearest non-weekend candidate day will be returned and marked)*/
  dataYmd: string
  /** Is it less than HISTORY_DAYS days due to crawl quota exhausted?*/
  incomplete: boolean
  /**
   * `days` is the actual trading day with margin trading** (from old to new).
   * The heavy production gate looks at this instead of `marginDatedFailed` - see `pollPlan.marginSigPart` for the reason.
   */
  marginYmds: string[]
  /** rwd Whether the entire batch of margin trading is unavailable (the caller falls back to OpenAPI accordingly)*/
  marginDatedFailed: boolean
}

/**
 * Create a chip sequence for the last HISTORY_DAYS trading days.
 *
 * Strategy (see docs/agent/PLAN.md §E):
 * - The candidate days are pushed back LOOKBACK_DAYS calendar days, excluding Saturdays and Sundays first (must be non-trading days, so as to save wasted time).
 * - The days that have been cached do not account for the crawl quota; the rest are crawled concurrently with FETCH_CONCURRENCY.
 * - A single call can capture up to MAX_BACKFILL_DAYS missing days, and the collection will stop after HISTORY_DAYS days.
 */
async function loadSeries(
  tickers: string[],
  now: Date,
  opts?: { refreshT86Ymd?: string },
): Promise<SeriesResult> {
  const candidates = tradingDateCandidates(now, LOOKBACK_DAYS - 1).filter((d) => !isWeekendYmd(d))
  const cached = await cachedDayDatasets(candidates)
  let fetchBudget = MAX_BACKFILL_DAYS
  const collected: DaySlice[] = []
  const marginYmdSet = new Set<string>()

  // Batch processing from new to old; concurrency within the same batch, sequence between batches, so as to control the number of concurrencies and the total amount of crawling at the same time
  for (let i = 0; i < candidates.length && collected.length < HISTORY_DAYS; i += FETCH_CONCURRENCY) {
    const batch = candidates.slice(i, i + FETCH_CONCURRENCY)
    const jobs: Array<Promise<DayRaw | null>> = []
    for (const ymd of batch) {
      // It is mandatory to retake the comparison today and it has not yet been finalized; it does not account for the fetchBudget (that is the daily quota for filling in the gaps,
      // Today’s portion is the protagonist of polling and cannot be squeezed out by replenishment)
      const refreshT86 = opts?.refreshT86Ymd === ymd
      if (refreshT86) {
        jobs.push(loadDayRaw(ymd, { t86: true, margin: !cached.has(`${ymd}:MI_MARGN_D`), refreshT86: true }))
        continue
      }
      const needT86 = !cached.has(`${ymd}:T86`)
      const needMargin = !cached.has(`${ymd}:MI_MARGN_D`)
      if (fetchBudget <= 0) {
        // Quota exhausted: T86 Without cache, there is no way to determine whether it is a trading day and can only be skipped;
        // If T86 has a cache, it will still produce the picture. There is simply no margin trading information on that day.
        if (needT86) continue
        jobs.push(loadDayRaw(ymd, { t86: false, margin: false }))
        continue
      }
      if (needT86 || needMargin) fetchBudget--
      jobs.push(loadDayRaw(ymd, { t86: needT86, margin: needMargin }))
    }
    const raws = await Promise.all(jobs)
    for (const raw of raws) {
      if (!raw) continue
      if (raw.margin) marginYmdSet.add(raw.ymd)
      collected.push(sliceDay(raw, tickers))
    }
  }

  // collected is new to old; converted to old to new and cropped to HISTORY_DAYS
  collected.sort((a, b) => a.ymd.localeCompare(b.ymd))
  const days = collected.slice(-HISTORY_DAYS)
  const latest = days[days.length - 1]
  // Only recognize the days that fall within the window: the batch may be collected for a few more days before being eliminated, and the eliminated ones are not included in the report.
  // Allowing them to influence the judgment of heavy production will only create false signals.
  const marginYmds = days.map((d) => d.ymd).filter((ymd) => marginYmdSet.has(ymd))
  return {
    days,
    dataYmd: latest?.ymd ?? candidates[0] ?? '',
    incomplete: days.length < HISTORY_DAYS,
    marginYmds,
    marginDatedFailed: days.length > 0 && marginYmds.length === 0,
  }
}

interface GenerateReportRequestBody {
  action?: string
  market?: string
  ticker?: string
  name?: string
  /**
   * warm only (0.6.46-dev.4). `core` | `history` | `full` (default).
   * See handleWarm header comment.
   */
  phase?: string
  holding?: HoldingContext | null
  /** admin-set-role is used: the account to be changed and whether to give it to the administrator*/
  userId?: string
  admin?: boolean
  /**
   * admin-run: which batch job(s) to fire. Same handlers as pg_cron / x-cron-secret,
   * but gated by assertAdmin so the console never needs CRON_SECRET in the browser.
   * `'all'` or a list of: generate-all | sync-market | sync-macro | sync-fx | probe
   */
  jobs?: string[] | 'all'
  /** Singular alias for a one-job admin-run */
  job?: string
}

/** warm phase: core = fast daily+latest; history = MOPS backfill; full = both (default). */
type WarmPhase = 'core' | 'history' | 'full'

function parseWarmPhase(raw: unknown): WarmPhase {
  const s = String(raw ?? 'full').trim().toLowerCase()
  if (s === 'core' || s === 'history' || s === 'full') return s
  return 'full'
}

/** Soft "12/12 present" check for warm-core responses (gap-driven backfill is the hard source of truth). */
function fundamentalHistoryLooksComplete(file: FundamentalFile | null): boolean {
  if (!file) return false
  const months = file.revenueMonths?.length ?? 0
  const quarters = file.profitQuarters?.length ?? 0
  return months >= REVENUE_MONTHS_CAP && quarters >= PROFIT_QUARTERS_CAP
}

/**
 * MOPS history loops for on-demand warm (shared by phase=history and phase=full).
 * Sequential on purpose: both rewrite the same fundamental/{ticker}.json.
 */
async function warmHistoryBackfill(
  one: Array<{ ticker: string; name: string }>,
  now: Date,
): Promise<{ revenueMonths: string[]; profitQuarters: string[]; complete: boolean }> {
  const deadline = Date.now() + WARM_BUDGET_MS
  const revenueMonths: string[] = []
  const profitQuarters: string[] = []

  let revenueDone = false
  while (Date.now() < deadline) {
    const r = await backfillRevenue(one, now, WARM_ROUND_MONTHS)
    if (r.months.length === 0) {
      revenueDone = true
      break
    }
    revenueMonths.push(...r.months)
  }

  let profitDone = false
  while (Date.now() < deadline) {
    const p = await backfillProfit(one, now, WARM_ROUND_QUARTERS)
    if (p.quarters.length === 0) {
      profitDone = true
      break
    }
    profitQuarters.push(...p.quarters)
  }

  return { revenueMonths, profitQuarters, complete: revenueDone && profitDone }
}

type MarginRows = Record<string, string>[] | null
type SblRows = Parameters<typeof extractBorrow>[0] | null

/** The report data of a single code is assembled from the captured sequences. When holding is null, the front end does not display the holding summary.*/
function assembleOne(opts: {
  ticker: string
  name: string
  holding: HoldingContext | null
  series: SeriesResult
  marginFallbackRows: MarginRows
  borrow: BorrowSource
}): ReturnType<typeof buildReport> {
  const { ticker, name, holding, series, marginFallbackRows, borrow: borrowSrc } = opts
  const notes: string[] = []

  // Make a copy and regroup: the slices of the series may be shared and read by multiple codenames, and the following fallback will fill in the value in place.
  const history: ChipDay[] = series.days.map((d) => {
    const chip = d.chips.get(ticker)
    return chip ? { ...chip } : { date: dashDate(d.ymd), institutional: null, margin: null }
  })
  const latest = history[history.length - 1] ?? null

  if (series.days.length === 0) {
    notes.push('三大法人資料暫無（可能尚未收盤或逢假日）。')
  } else if (series.incomplete) {
    notes.push(
      `歷史資料回補中：目前只取到 ${history.length} 個交易日（共需 ${HISTORY_DAYS} 天），走勢圖會逐日補齊。`,
    )
  }

  // When the rwd endpoint fails to complete the batch, use OpenAPI to make up the balance of the "latest trading day" (lack of buy/sell split items)
  if (latest && latest.margin === null && marginFallbackRows) {
    const fallback = extractMargin(marginFallbackRows, ticker)
    if (fallback) {
      latest.margin = fallback
      notes.push('融資融券改用備援來源，只有今日餘額，無買進 / 賣出拆項與走勢。')
    }
  }
  if (latest && latest.margin === null) {
    // Under staged execution, this is the norm rather than a fault: when I ran the morning shift, margin trading had not been announced at all.
    notes.push('今日融資融券尚未公布（約 21:00–22:00），稍晚會自動補上。')
  }

  const borrow = borrowSrc.resp
    ? extractBorrowDated(borrowSrc.resp, ticker)
    : borrowSrc.fallbackRows
      ? extractBorrow(borrowSrc.fallbackRows, ticker)
      : null

  if (latest && latest.institutional === null && latest.margin === null) {
    notes.push('此代號查無上市籌碼資料（可能為上櫃 / 興櫃，暫不支援上櫃）。')
  }

  const stamp = (ymd: string, dataset: string, date: string | null): SourceStamp | null => {
    const fetchedAt = fetchedAtByDataset.get(`${ymd}:${dataset}`) ?? null
    return date === null && fetchedAt === null ? null : { date, fetchedAt }
  }
  const latestYmd = series.dataYmd
  const sources: ReportSources = {
    institutional:
      latest?.institutional !== null && latest !== null
        ? stamp(latestYmd, 'T86', latest.date)
        : null,
    margin: latest?.margin ? stamp(latestYmd, 'MI_MARGN_D', latest.date) : null,
    borrow: borrowSrc.date
      ? stamp(borrowSrc.date.replace(/-/g, ''), 'SBL_D', borrowSrc.date)
      : null,
  }

  return buildReport({
    ticker,
    name,
    dataDateYmd: series.dataYmd,
    holding,
    history,
    borrow,
    sources,
    notes,
  })
}

/** Get the latest borrowing cache in "date >= minYmd"; if the search fails, null is returned (see the description of loadBorrow)*/
async function readBorrowCacheFrom(
  minYmd: string,
): Promise<{ resp: BorrowDatedResponse; date: string } | null> {
  try {
    const { data, error } = await db
      .from('chip_raw_cache')
      .select('ymd, payload')
      .eq('dataset', 'SBL_D')
      .gte('ymd', minYmd)
      .order('ymd', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data?.payload) return null
    const resp = data.payload as BorrowDatedResponse
    if (!borrowDatedOk(resp)) return null
    return { resp, date: borrowDatedDate(resp) ?? dashDate(String(data.ymd)) }
  } catch {
    return null
  }
}

interface BorrowSource {
  resp: BorrowDatedResponse | null
  /** rwd version responds to the date in title (= next trading day); null when using OpenAPI fallback*/
  date: string | null
  fallbackRows: SblRows
}

/**
 * Borrowing coupons: Priority is given to the rwd version with its own date.
 *
 * **Why do we need to look at the date first and then cache it**: The borrowing endpoint does not have a date parameter, and the returned value is always "the latest".
 * After the batch was changed to run several times a day, the morning shift (17:30) actually got the data from the previous day——
 * If you continue to save it directly as today, the subsequent batches will always use the wrong one because "the cache already exists".
 * After changing to parse the date of title, it becomes verifiable: whatever date you get is saved as that date.
 * If the morning shift saves the data from the previous day (which is correct in the first place), and if the evening shift gets new ones, they will naturally write new keys into them, and they will not contaminate each other.
 */
async function loadBorrow(minYmd?: string): Promise<BorrowSource> {
  // 0.6.1: The borrowing endpoint does not have a date parameter. Originally, it was unconditionally re-captured (244KB) every time it was executed.
  // In the third shift era, it was three times a day. After changing to 32 polls, it was a pure waste of 7.8MB a day.
  // If there is already a cache with "date >= today", just use it directly - that one is the latest quota we want.
  if (minYmd) {
    const cached = await readBorrowCacheFrom(minYmd)
    if (cached) return { resp: cached.resp, date: cached.date, fallbackRows: null }
  }
  let resp: BorrowDatedResponse | null = null
  try {
    resp = await fetchJson<BorrowDatedResponse>(BORROW_DATED_URL)
  } catch {
    resp = null
  }
  if (resp && borrowDatedOk(resp)) {
    const date = borrowDatedDate(resp)!
    const ymd = date.replace(/-/g, '')
    // Keyed by "date declared by the data itself" rather than the transaction date we are processing
    const cached = await readCache<BorrowDatedResponse>(ymd, 'SBL_D')
    if (!cached) await writeCache(ymd, 'SBL_D', resp)
    return { resp, date, fallbackRows: null }
  }
  return { resp: null, date: null, fallbackRows: null }
}

/** OpenAPI margin trading does not have a date parameter and is only used as a backup when the entire batch of rwd fails.*/
async function loadMarginFallback(dataYmd: string, needed: boolean): Promise<MarginRows> {
  return needed
    ? await readLatest<Record<string, string>[]>(dataYmd, 'MI_MARGN', MI_MARGN_URL)
    : null
}

async function handleGenerate(
  req: Request,
  body: GenerateReportRequestBody,
): Promise<Response> {
  if (body.market !== 'TPE') {
    return json({ error: '盤後籌碼報告僅支援台股（TPE）' }, 400)
  }
  const ticker = String(body.ticker ?? '').trim()
  if (!TICKER_RE.test(ticker)) {
    return json({ error: 'ticker 格式不正確' }, 400)
  }
  const name = String(body.name ?? '').trim().slice(0, 40)
  const holding = body.holding ?? null

  /*
   * Signed-in + holdings whitelist (0.7.0). No per-day counter: reads chip_raw_cache only.
   */
  const auth = await assertUser(req)
  if (auth instanceof Response) return auth
  const held = await heldTwTickers()
  if (!held.some((h) => h.ticker === ticker)) {
    return json({ error: '僅限有人持有的台股代號' }, 403)
  }

  const series = await loadSeries([ticker], new Date())
  const marginFallbackRows = await loadMarginFallback(
    series.dataYmd,
    series.marginDatedFailed || series.days.length === 0,
  )
  const borrow = await loadBorrow()
  const data = assembleOne({ ticker, name, holding, series, marginFallbackRows, borrow })

  const reportId = makeReportId(series.dataYmd, ticker)
  return json({ reportId, generatedAt: data.generatedAt, dataDate: data.dataDate, data })
}

// ---- After-hours batch: Generate a common report for all Taiwan stocks held and store it in Storage (reports bucket), retaining the last 7 days ----

const REPORTS_BUCKET = 'reports'

/** Reports are retained in Storage for a number of **calendar days**. The front-end only reads the latest manifest pointed to, the old one is simply kept for reference.*/
const REPORT_RETAIN_DAYS = 7
/**
 * The raw cache is kept for a number of **calendar days** and must cover the entire LOOKBACK_DAYS window.
 *
 * Why not 7: `HISTORY_DAYS` counts **trading days**, while prune counts **calendar days** ——
 * 7 trading days span 9–11 calendar days. Using it for 7 days will cut off the 2-3 days that need to be used the next day.
 * So every night's batches have to be re-captured for those days (actually measured, there are only 6 trading days left after the official area prune.
 * Still catching up every time generate). Setting it to the same as LOOKBACK_DAYS is the least likely to go wrong:
 * That's exactly the range that loadSeries will look back for, and older data will never be read in the first place.
 */
const CACHE_RETAIN_DAYS = LOOKBACK_DAYS

/** generate-all will write Storage, and the endpoint is public (--no-verify-jwt), so x-cron-secret is required to match the environment variable*/
function assertCronSecret(req: Request): Response | null {
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  const got = req.headers.get('x-cron-secret') ?? ''
  if (!expected || got !== expected) return json({ error: 'Unauthorized' }, 401)
  return null
}

/**
 * Gatekeeping for the admin-specific endpoint: Validate the caller's JWT and `app_metadata.role === 'admin'`.
 *
 * **Cannot use `assertCronSecret`** - that is the shared secret used by pg_cron,
 * The front end can't get it and shouldn't get it (once it's put in the front end, it's public, and anyone can trigger the entire batch of fetching).
 *
 * **Cannot use email to compare**. `app_metadata` can only be written by service role / Dashboard,
 * Users cannot change their own; email is a field that users can change by themselves. Using it as the basis for authorization means no authorization.
 * This is the same set of criteria as `isAiAdmin()` of `aiSettings.ts`, and both sides must be consistent.
 *
 * This function is deployed with `--no-verify-jwt`. The platform will not help verify JWT, so you can verify it yourself here.
 */
async function assertAdmin(req: Request): Promise<Response | null> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)
  try {
    const { data, error } = await db.auth.getUser(token)
    if (error || !data.user) return json({ error: 'Unauthorized' }, 401)
    const meta = data.user.app_metadata as Record<string, unknown> | undefined
    if (meta?.role !== 'admin') return json({ error: 'Forbidden' }, 403)
    return null
  } catch {
    return json({ error: 'Unauthorized' }, 401)
  }
}

/**
 * Login gate for browser-called endpoints (`generate` / `warm` / admin helpers).
 *
 * 0.7.0 pairs this with `heldTwTickers()` again (search/TOP removed). Keep both: account proof
 * via getUser (anon JWT has no sub) plus the holdings amplification ceiling.
 *
 * **Do not deploy this function with platform JWT verification on.** `generate-all` and cron
 * actions use `x-cron-secret` only; platform JWT would reject them before this file runs.
 */
async function assertUser(req: Request): Promise<{ userId: string } | Response> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)
  try {
    const { data, error } = await db.auth.getUser(token)
    if (error || !data.user) return json({ error: 'Unauthorized' }, 401)
    return { userId: data.user.id }
  } catch {
    return json({ error: 'Unauthorized' }, 401)
  }
}

/**
 * Count one `warm` against today's per-account allowance.
 *
 * Uses the `take_warm_quota` SQL function (atomic insert-or-increment with a WHERE used < limit)
 * so parallel warms cannot all read used=0 and each write used=1. The count is charged **before**
 * the work: charging on success would make a failing upstream free to retry against.
 *
 * Returns:
 * - `'ok'` — slot taken
 * - `'limited'` — already at `WARM_DAILY_LIMIT`
 * - `'error'` — RPC/table missing or other infrastructure fault (fail **closed**: without a working
 *   counter the only remaining ceiling after the holdings whitelist was retired would be "have an
 *   account", and signup is open)
 */
async function takeWarmQuota(
  userId: string,
  ymd: string,
): Promise<'ok' | 'limited' | 'error'> {
  try {
    const { data, error } = await db.rpc('take_warm_quota', {
      p_user_id: userId,
      p_ymd: ymd,
      p_limit: WARM_DAILY_LIMIT,
    })
    if (error) return 'error'
    return data === true ? 'ok' : 'limited'
  } catch {
    return 'error'
  }
}

function ymdMinusDays(ymd: string, days: number): string {
  const dt = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)))
  dt.setUTCDate(dt.getUTCDate() - days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`
}

/** The Taiwan stock code of all users' "net holdings (buy − sell > 0)" (service role scan transactions; cross-user deduplication)*/
async function heldTwTickers(): Promise<Array<{ ticker: string; name: string }>> {
  const { data, error } = await db
    .from('transactions')
    .select('ticker, name, tx_type, qty')
    .eq('market', 'TPE')
  if (error || !data) return []
  const acc = new Map<string, { net: number; name: string }>()
  for (const row of data) {
    const ticker = String(row.ticker ?? '').trim()
    if (!TICKER_RE.test(ticker)) continue
    const qty = Number(row.qty) || 0
    const delta = row.tx_type === 'BUY' ? qty : -qty
    const prev = acc.get(ticker) ?? { net: 0, name: '' }
    acc.set(ticker, { net: prev.net + delta, name: String(row.name ?? '').trim() || prev.name })
  }
  return [...acc.entries()]
    .filter(([, v]) => v.net > 0)
    .map(([ticker, v]) => ({ ticker, name: v.name }))
}

/** Night batch / backfill scope: holdings only (0.7.0 — no watchlist / TOP). */
async function batchTwTickers(): Promise<Array<{ ticker: string; name: string }>> {
  return heldTwTickers()
}

/**
 * Whether a chip report file exists for this ticker on dataYmd.
 *
 * Used by `evaluateTickerScope` for admin/batch scopes. Dropped by accident in 0.7.0 holdings-only
 * cleanup while the call site stayed — every chips phase then threw `chipReportReady is not defined`
 * after uploads, so `logBatchRun` never ran and later cron ticks all 500'd (融資融券 never sealed).
 */
async function chipReportReady(dataYmd: string, ticker: string): Promise<boolean> {
  const file = await downloadJson<unknown>(`${dataYmd}/${ticker}.json`)
  return file != null
}

/**
 * Soft-ready fundamental (batch reportComplete), aligned with frontend PROFIT/REVENUE_WARM_MIN = 6.
 * Empty shell after a real backfill pass (through markers) counts ready — typical ETF / no MOPS path.
 * Also dropped in the 0.7.0 holdings-only cleanup (same crash chain as chipReportReady).
 */
function fundamentalSoftReady(f: FundamentalFile | null | undefined): boolean {
  if (!f) return false
  const months = f.revenueMonths?.length ?? 0
  const quarters = f.profitQuarters?.length ?? 0
  if (months >= 6 && quarters >= 6) return true
  if (
    months === 0 &&
    quarters === 0 &&
    (f.revenueBackfilledThrough != null || f.profitBackfilledThrough != null)
  ) {
    return true
  }
  return false
}

async function evaluateTickerScope(
  tickers: Array<{ ticker: string }>,
  dataYmd: string | null,
): Promise<{
  total: number
  chipsReady: number
  fundReady: number
  chipsComplete: boolean
  fundComplete: boolean
  missingFund: string[]
}> {
  const missingFund: string[] = []
  let chipsReady = 0
  let fundReady = 0
  for (const { ticker } of tickers) {
    if (dataYmd && (await chipReportReady(dataYmd, ticker))) chipsReady++
    const f = await downloadJson<FundamentalFile>(`fundamental/${ticker}.json`)
    if (fundamentalSoftReady(f)) fundReady++
    else missingFund.push(ticker)
  }
  const total = tickers.length
  return {
    total,
    chipsReady,
    fundReady,
    chipsComplete: total === 0 || (dataYmd != null && chipsReady === total),
    fundComplete: total === 0 || fundReady === total,
    missingFund: missingFund.slice(0, 15),
  }
}

async function uploadJson(path: string, payload: unknown): Promise<boolean> {
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const { error } = await db.storage.from(REPORTS_BUCKET).upload(path, blob, {
      upsert: true,
      contentType: 'application/json; charset=utf-8',
      // ⚠️ Must be written clearly. If not, supabase-js defaults to 3600, and Storage will return
      // `cache-control: public, max-age=3600`, the data obtained by the front end will be one hour old.
      // And Ctrl+Shift+R can't save it (hard refactoring does not cover fetch issued by JS) - online crash in 0.6.4-dev.5.
      // These files are updated up to 32 times a day, making each revalidation much less expensive than displaying incorrect data.
      cacheControl: '0',
    })
    return !error
  } catch {
    return false
  }
}

async function downloadJson<T>(path: string): Promise<T | null> {
  try {
    const { data, error } = await db.storage.from(REPORTS_BUCKET).download(path)
    if (error || !data) return null
    return JSON.parse(await data.text()) as T
  } catch {
    return null
  }
}

// ----Daily OHLCV (for technical purposes)----

/**
 * For each Taiwanese stock, capture the one-year daily line and save it into daily/{ticker}.json (overwrite the entire copy).
 *
 * Why is Storage single file overwritten instead of the price_daily data table originally envisioned by PLAN §G:
 * 1. **No retention issues**. Overwrites are not cumulative and do not require prune - prune's retention period units are mismatched
 *    It is the pit that was repaired in 0.3.9 (cutting calendar days vs. counting trading days), don’t create a second one.
 * 2. **The front-end is downloaded directly, without consuming the Edge Function quota** (lesson from 0.3.9: burning out the quota will also cause the stock-price to stop).
 * The trade-off is to recapture the entire year each night rather than in increments, but 5 holdings = 5 requests, which is negligible.
 *
 * Skip conditions (must not drop data):
 * - Existing file `lastDate >= targetDate` → **no Yahoo call**, keep Storage file as-is.
 * - onDemand only: empty shell already checked today → no Yahoo retry (night batch still retries).
 * Re-fetch only when the file is missing, stale, or schema-mismatched — never wipe a good file
 * because a later fetch failed (failure is per-ticker catch; existing object stays).
 */
async function syncDaily(
  tickers: Array<{ ticker: string; name: string }>,
  dataYmd: string,
  opts?: { onDemand?: boolean },
): Promise<{ synced: number; skipped: number }> {
  const targetDate = dashDate(dataYmd)
  let synced = 0
  let skipped = 0
  for (const { ticker } of tickers) {
    try {
      const existing = await downloadJson<DailyFile>(`daily/${ticker}.json`)
      if (existing && existing.schema === DAILY_SCHEMA) {
        if (existing.lastDate >= targetDate) {
          skipped++
          continue
        }
        // Exclusively for immediate production: If you have checked today and confirmed that there is no information, please do not call again.
        // The night batch deliberately ignores this condition - the third shift should give the code names that have just been launched and Yahoo has not yet provided information a chance to try again.
        if (opts?.onDemand && (existing.emptyCheckedDate ?? '') >= targetDate) {
          skipped++
          continue
        }
      }

      let rows: ReturnType<typeof extractDaily> = []
      for (const symbol of yahooDailySymbols(ticker)) {
        const resp = await fetchJson<ChartResponse>(dailyUrl(symbol))
        rows = extractDaily(resp)
        if (rows.length > 0) break
      }

      // Even if there is no data to be found, a file must be written (empty shell + query date): it can be used to produce instant results without re-fetching every time the page is opened.
      // See the emptyCheckedDate annotation of twDaily.ts for the reason and why the batch will still be retried.
      // If Yahoo fails after we already had rows, we still write what we got this attempt — we never
      // upload an empty shell over a good existing file (empty only when rows.length === 0 from fetch).
      const file: DailyFile =
        rows.length === 0
          ? {
              schema: DAILY_SCHEMA,
              ticker,
              asOf: new Date().toISOString(),
              lastDate: '',
              rows: [],
              emptyCheckedDate: targetDate,
            }
          : {
              schema: DAILY_SCHEMA,
              ticker,
              asOf: new Date().toISOString(),
              lastDate: rows[rows.length - 1][0],
              rows,
            }
      // Protect against clobbering a good file with an empty shell (fetch failed / Yahoo empty).
      if (
        rows.length === 0 &&
        existing &&
        existing.schema === DAILY_SCHEMA &&
        (existing.rows?.length ?? 0) > 0
      ) {
        skipped++
        continue
      }
      if (await uploadJson(`daily/${ticker}.json`, file)) synced++
    } catch {
      // The failure of a single file does not affect other files, nor does it affect the chip report (consistent with the fault tolerance of borrow / margin)
    }
  }
  return { synced, skipped }
}

// ----Fundamentals (Valuation + Monthly Revenue + Industry)----

/**
 * Each Taiwan stock output is fundamental/{ticker}.json (overwritten in its entirety, the layout is the same as daily/:
 * The ^\d{8}$ directory name that does not match pruneStorage will not be cleared and does not need to be cleared).
 *
 * Three whole-market batches are loaded once outside the loop (chip_raw_cache is cached on this trading day,
 * The first shift will be the real ones, the last two shifts will be quick picks), and only code-by-code draws will be done in the circle.
 * revenueMonths reads back the existing files and merges them: the overwritten file relies on this accumulated monthly revenue history (1 transaction in the first month → 12 transactions).
 * None of the three listed stocks were found: still write the file (nulls + notes), so that the front-end can distinguish between "ran but no information" and "not yet ran".
 */
async function syncFundamental(
  tickers: Array<{ ticker: string; name: string }>,
  dataYmd: string,
): Promise<{ synced: number; skipped: number; bwibbuDate: string | null }> {
  const targetDate = dashDate(dataYmd)
  const bwibbu = await readLatest<Array<Record<string, string>>>(dataYmd, 'BWIBBU_ALL', BWIBBU_ALL_URL)
  const revenue = await readLatest<Array<Record<string, string>>>(dataYmd, 'T187AP05_L', T187AP05_URL)
  const company = await readLatest<Array<Record<string, string>>>(dataYmd, 'T187AP03_L', T187AP03_URL)
  // Profitability (0.6.5). The same is the whole-market large stall, go for chip_raw_cache,
  // So out of 32 rounds a day, only the first round is really going to be caught. The data is updated quarterly, and the values ​​extracted in most rounds are the same as yesterday.
  const profit = await readLatest<Array<Record<string, string>>>(dataYmd, 'T187AP17_L', T187AP17_URL)
  // The valuation file comes with the date of the Republic of China (for example: '1150724'). Enter batch_run_log to answer the question
  // "When will the fundamentals be updated?" - Originally, only the synced count was recorded, and that number would be interfered with by "new stocks".
  const bwibbuDate = bwibbu?.[0]?.Date ?? null
  // If all failed, skip the entire section. As long as one is caught, the file will be written as usual——
  // buildFundamentalFile will retain the existing fields and will not overwrite the uncaptured parts into empty shells.
  if (!bwibbu && !revenue && !company && !profit) {
    return { synced: 0, skipped: 0, bwibbuDate }
  }

  let synced = 0
  let skipped = 0
  for (const { ticker, name } of tickers) {
    try {
      const existing = await downloadJson<FundamentalFile>(`fundamental/${ticker}.json`)
      // Already written for this trading day — keep file, no rewrite (avoids thrash; does not drop data).
      if (existing && existing.schema === FUNDAMENTAL_SCHEMA && existing.dataDate >= targetDate) {
        skipped++
        continue
      }

      const valuation = extractValuation(bwibbu, ticker)
      const latestRevenue = extractRevenue(revenue, ticker)
      const latestProfit = extractProfit(profit, ticker)
      const industry = extractIndustry(revenue, company, ticker)

      // Field assembly and annotation judgment are all in the pure functions of twFundamental.ts (can be measured there)
      const file = buildFundamentalFile({
        ticker,
        name,
        dataDate: targetDate,
        asOf: new Date().toISOString(),
        existing,
        valuation,
        latestRevenue,
        latestProfit,
        industry,
        bwibbuLoaded: bwibbu !== null,
      })
      if (await uploadJson(`fundamental/${ticker}.json`, file)) synced++
    } catch {
      // Failure of a single file will not affect other files, nor will it affect the chip report that has been written.
    }
  }
  return { synced, skipped, bwibbuDate }
}

// ----Monthly revenue historical replenishment (MOPS t21sc03)----

/**
 * Grab big5 web pages. MOPS's t21sc03 is big5, and reading it directly as UTF-8 will cause the entire file to become garbled.
 * In case of failure (including 10 seconds timeout), null will be returned without throwing, which is consistent with the fault tolerance guidelines of syncDaily / syncMacro.
 */
async function fetchBig5Text(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return new TextDecoder('big5').decode(await res.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Add revenueMonths in fundamental/{ticker}.json to the most recent REVENUE_MONTHS_CAP published months.
 *
 * **Why is it needed**: The nightly syncFundamental only gets the latest month (the t187ap05_L endpoint does not take the year and month),
 * Therefore, there is only one transaction in the first month of the new bid, and it will take a full year to grow. Here, MOPS’s monthly reports are used to fill the gap at once.
 *
 * Three design decisions:
 * 1. **Notch Drive**. First read all the target files to figure out which months are missing. If they are full, you will reply directly without sending a single external request——
 *    In the same spirit as decideSkip's short circuit. After top-up, every night is zero cost.
 * 2. **Do not write chip_raw_cache**. pruneChipCache is a lexicographic comparison of `ymd < cutoff` (8-code date),
 *    Any month key ('2026-06') is smaller than it and will be deleted every round, so the cache is written in vain.
 *    fundamental/*.json itself is a cache: after all files are added in a certain month, they will never be requested again.
 * 3. **Catch the listing + two copies on the counter every month**. The code names do not overlap between the two copies (actually measured 991 / 860 companies),
 *    Combining a table eliminates the need to determine whether a certain file is listed or listed on the OTC market - this matter is not stored in our transactions.
 */
async function backfillRevenue(
  tickers: Array<{ ticker: string; name: string }>,
  now: Date,
  maxMonths = MAX_BACKFILL_MONTHS,
): Promise<{ filled: number; months: string[] }> {
  if (tickers.length === 0) return { filled: 0, months: [] }

  const wantMonths = publishedMonths(now, REVENUE_MONTHS_CAP)

  // Read one round first to figure out the gaps. By the way, keep the file so you don’t have to download it again after completing it.
  const files = new Map<string, FundamentalFile>()
  const have = new Map<string, RevenueProgress>()
  for (const { ticker } of tickers) {
    const file = await downloadJson<FundamentalFile>(`fundamental/${ticker}.json`)
    // Skip the file before it is generated: syncFundamental will create it earlier in the same round and fill it in the next round
    if (!file) continue
    files.set(ticker, file)
    have.set(ticker, {
      months: new Set((file.revenueMonths ?? []).map((m) => m.yearMonth)),
      through: file.revenueBackfilledThrough ?? null,
    })
  }

  const targets = planRevenueBackfill(have, wantMonths, maxMonths, now)
  if (targets.length === 0) return { filled: 0, months: [] }
  const wanted = new Set(files.keys())

  // month → (ticker → RevenueMonth)
  const fetched = new Map<string, Map<string, RevenueMonth>>()
  // "We actually went to see it this month." The judgment is **catch successfully**, not "the code we want is found"——
  // When all are ETFs, merged must be empty. Judging by the presence or absence of data will make the through forever unable to push and the replenishment will be stuck.
  const attempted: string[] = []
  for (const ym of targets) {
    const merged = new Map<string, RevenueMonth>()
    let ok = false
    for (const market of MOPS_MARKETS) {
      const url = mopsRevenueUrl(market, ym)
      if (!url) continue
      const html = await fetchBig5Text(url)
      if (!html) continue
      ok = true
      for (const [ticker, row] of parseMopsRevenue(html, ym, wanted)) merged.set(ticker, row)
    }
    if (ok) attempted.push(ym)
    if (merged.size > 0) fetched.set(ym, merged)
  }
  // If you haven't succeeded in catching it for a month (the other party is down/the network is unavailable), don't change anything and try again in the next round.
  if (attempted.length === 0) return { filled: 0, months: [] }

  // Only months past the 10th deadline may seal "not found" into through. Open-window hits still merge.
  const attemptedForThrough = closedAttemptedMonths(attempted, now)

  let filled = 0
  for (const [ticker, file] of files) {
    const incoming: RevenueMonth[] = []
    for (const byTicker of fetched.values()) {
      const row = byTicker.get(ticker)
      if (row) incoming.push(row)
    }

    // fillGapsOnly: Existing values ​​are retained. t187ap05_L caught the corrected number,
    // Cannot be overwritten by an older MOPS crawl (see description of mergeRevenueMonths).
    const merged = mergeRevenueMonths(file.revenueMonths, incoming, { fillGapsOnly: true })
    // ⚠️ Compare the monthly list instead of the length: when adding a new month to a file that already has 12 transactions, cap will cut off the oldest one.
    // The length is still 12 but the content has changed - judging by the length will treat this real update as nothing happened and not write the file.
    const before = (file.revenueMonths ?? []).map((m) => m.yearMonth).join(',')
    const monthsChanged = merged.map((m) => m.yearMonth).join(',') !== before

    // The progress must also be written back, **even if no information is found** - ETF relies on this to converge.
    // Otherwise it will re-list the same months as gaps each round.
    // Open-window months are excluded so a partial early MOPS page cannot pin through forever.
    const through = nextBackfilledThrough(file.revenueBackfilledThrough, attemptedForThrough)
    if (!monthsChanged && through === (file.revenueBackfilledThrough ?? null)) continue

    const next: FundamentalFile = {
      ...file,
      revenueMonths: merged,
      revenueBackfilledThrough: through,
      asOf: new Date().toISOString(),
    }
    if (await uploadJson(`fundamental/${ticker}.json`, next)) filled++
  }
  return { filled, months: [...fetched.keys()].sort() }
}

/**
 * Catch MOPS’s quarterly report summary. **POST form, UTF-8**, completely different from the monthly revenue one (GET, big5)——
 * These two points are most likely to be confused when the two are put together for maintenance.
 * In case of failure (including 20 seconds timeout), null will be returned without throwing, refer to the fault tolerance principle of `fetchBig5Text`.
 */
async function fetchMopsProfitHtml(market: 'sii' | 'otc', yearQuarter: string): Promise<string | null> {
  const body = mopsProfitBody(market, yearQuarter)
  if (!body) return null
  try {
    const res = await fetch(`${MOPS_T163_HOST}${MOPS_T163_PATH}`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
      },
      body,
      // A single copy is about 1.6MB, four times larger than the monthly revenue of 400KB, and the timeout is relaxed to 20 seconds.
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/**
 * Add the profitQuarters of fundamental/{ticker}.json to the latest PROFIT_QUARTERS_CAP quarter.
 *
 * The structure corresponds to `backfillRevenue` item by item (gap driver, do not write chip_raw_cache, write progress back to the file),
 * The reasons for those three design decisions can be found in the description of the function and will not be repeated here. There are only three differences:
 *
 * 1. **The source is POST form** (`ajax_t163sb04`), not a static URL.
 * 2. **The ratio must be calculated by yourself** (this item ÷ operating income), t187ap17_L is calculated by the official.
 *    The answer has been compared with the official value: the four ratios of 1802 / 2303 / 2609 of the Republic of China 115 Q1 are consistent bit by bit.
 * 3. **Only for 2 quarters at a time** (monthly revenue is 4 months) - a single copy is 1.6MB, which is four times the monthly revenue.
 */
async function backfillProfit(
  tickers: Array<{ ticker: string; name: string }>,
  now: Date,
  maxQuarters = MAX_BACKFILL_QUARTERS,
): Promise<{ filled: number; quarters: string[] }> {
  if (tickers.length === 0) return { filled: 0, quarters: [] }

  const wantQuarters = publishedQuarters(now, PROFIT_QUARTERS_CAP)

  const files = new Map<string, FundamentalFile>()
  const have = new Map<string, ProfitProgress>()
  for (const { ticker } of tickers) {
    const file = await downloadJson<FundamentalFile>(`fundamental/${ticker}.json`)
    // Skip the file before it is generated: syncFundamental will create it earlier in the same round and fill it in the next round
    if (!file) continue
    files.set(ticker, file)
    have.set(ticker, {
      quarters: new Set((file.profitQuarters ?? []).map((q) => q.yearQuarter)),
      /*
        0.6.28: a quarter that exists but has never been looked up for EPS counts as a gap too.
        Files written before 0.6.28 have no `epsChecked` at all, so their 12 quarters get re-fetched batch by
        batch (2 per round, about 6 rounds), after which only each new quarter needs filling.
      */
      needEps: new Set(
        (file.profitQuarters ?? []).filter((q) => !q.epsChecked).map((q) => q.yearQuarter),
      ),
      through: file.profitBackfilledThrough ?? null,
    })
  }

  const targets = planProfitBackfill(have, wantQuarters, maxQuarters)
  if (targets.length === 0) return { filled: 0, quarters: [] }
  const wanted = new Set(files.keys())

  // Quarter → (Codename → ProfitQuarter)
  const fetched = new Map<string, Map<string, ProfitQuarter>>()
  // "We actually went to see it this season." The judgment is **catch successfully**, not "the code we want is found"——
  // When all are ETFs, merged must be empty. Judging by the presence or absence of data will make the through unable to be pushed forever and the replenishment will be stuck.
  const attempted: string[] = []
  for (const yq of targets) {
    const merged = new Map<string, ProfitQuarter>()
    let ok = false
    for (const market of T163_MARKETS) {
      const html = await fetchMopsProfitHtml(market, yq)
      if (!html) continue
      ok = true
      for (const [ticker, row] of parseMopsProfit(html, yq, wanted)) merged.set(ticker, row)
    }
    if (ok) attempted.push(yq)
    if (merged.size > 0) fetched.set(yq, merged)
  }
  // If you haven’t succeeded in catching in one season (the opponent is down/the network is unavailable), don’t change anything and try again in the next round.
  if (attempted.length === 0) return { filled: 0, quarters: [] }

  let filled = 0
  for (const [ticker, file] of files) {
    const incoming: ProfitQuarter[] = []
    for (const byTicker of fetched.values()) {
      const row = byTicker.get(ticker)
      if (row) incoming.push(row)
    }

    // fillGapsOnly: Existing values ​​are retained. t187ap17_L is the officially calculated ratio.
    // It cannot be overwritten by our own calculated version (the two have the same answer, but the official one is accurate)
    const merged = mergeProfitQuarters(file.profitQuarters, incoming, { fillGapsOnly: true })
    /*
      ⚠️ Compare the quarter list, not its length: once 12 entries are full, adding one pushes the oldest out,
      so the length is still 12 while the content changed —— judging by length would treat a real update as
      nothing happening and skip the write.

      Since 0.6.28 the signature must carry the EPS state too: **filling only EPS leaves the quarter list
      identical**, so comparing quarters alone would treat "this round finally got the EPS" as nothing happening.
    */
    const signature = (qs: ProfitQuarter[] | null | undefined) =>
      (qs ?? []).map((q) => `${q.yearQuarter}:${q.epsChecked ? 1 : 0}`).join(',')
    const changed = signature(merged) !== signature(file.profitQuarters)

    // The progress must also be written back, **even if no information is found** - ETF relies on this to converge
    const through = nextProfitThrough(file.profitBackfilledThrough, attempted)
    if (!changed && through === (file.profitBackfilledThrough ?? null)) continue

    const next: FundamentalFile = {
      ...file,
      profitQuarters: merged,
      profitBackfilledThrough: through,
      asOf: new Date().toISOString(),
    }
    if (await uploadJson(`fundamental/${ticker}.json`, next)) filled++
  }
  return { filled, quarters: [...fetched.keys()].sort() }
}

// ----The total market volume of Taiwan stocks can be compared with the trading amount of the three major legal persons (0.6.28)----

/**
 * The maximum number of days of legal person trading amount in a single round can be supplemented.
 *
 * BFI82U makes one request per day (`type=month` returns the total of the whole month, not day by day), so there must be a budget to supplement the history.
 *
 * 0.6.32 Adjusted from 5 to 15: Buying/selling requires all the existing 120 days to be recaptured in one round, and 5 days/round takes 8 working days.
 * 15 days/round × three shifts a day → It takes about 3 working days to make up, and then there are only 1–2 days left to make up for each round, so the budget is not used at all.
 *
 * **Sustainable time budget**: Each request comes with a 10-second timeout, and the actual measured single-day request is about 0.2–0.4 seconds.
 * 15 of about 3–6 seconds, plus two monthly reports is still well below cron's 60 seconds `timeout_milliseconds`.
 * This class is an independent action (does not share time with individual stock reports), so it will not crowd out what users need to see when they open it.
 */
const MAX_MARKET_INST_DAYS = 15

/** Grab the JSON of rwd. On failure (including timeout), null will be returned without throwing, refer to the fault tolerance principle of fetchBig5Text*/
async function fetchRwdJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Output/update market/daily.json: daily trading volume value of the entire market + trading amount of the three major legal persons.
 *
 * It has nothing to do with the individual stock report, so it is an independent entity and an independent action——
 * It is a **global single file** and does not increase or decrease with the target list (same as syncMacro's treatment).
 *
 * Two-stage form:
 * 1. Trading volume value: It can be captured once for the entire month (rwd version of FMTQIK), so every round, the current month is captured again and corrected along the way.
 * 2. Legal person amount: one request per day, and the budget of `planInstitutionalBackfill` is used to fill it up day by day.
 *
 * If all fails, the existing file will not be overwritten (leaving old data is better than empty files, the same principle as syncMacro).
 */
async function syncMarket(now: Date): Promise<{
  synced: boolean
  days: number
  /** How many days of legal person amount will be paid in this round?*/
  institutionalFilled: number
  asOf: string | null
  /**
   * skipped: session day already complete — zero external requests (0.6.46-dev.9)
   * unchanged: asked TWSE, content fingerprint same
   * updated: wrote a new file
   * empty: nothing usable from upstream
   */
  reason: 'skipped' | 'unchanged' | 'updated' | 'empty'
}> {
  const existing = await downloadJson<MarketFile>('market/daily.json')
  const have = existing?.days ?? []

  // Taipei calendar day: once FMTQIK + BFI82U (with buy) for this day are on disk, stop hammering TWSE.
  const sessionDate = dashDate(taipeiYmd(now))
  if (isMarketSessionReady(have, sessionDate)) {
    return {
      synced: false,
      days: have.length,
      institutionalFilled: 0,
      asOf: existing?.asOf ?? null,
      reason: 'skipped',
    }
  }

  let incoming: MarketDay[] = []
  let anyOk = false
  for (const yyyymm of planMarketMonths(now, have)) {
    const url = fmtqikMonthUrl(yyyymm)
    if (!url) continue
    const parsed = parseFmtqik(await fetchRwdJson(url))
    if (parsed.length === 0) continue
    anyOk = true

    /*
      Fetch the same month's TAIEX open/high/low as well (0.6.30, for the market daily-K chart).
      FMTQIK only has close and point change; open/high/low live in MI_5MINS_HIST —— both are "one month per
      request", so they are merged in the same round rather than each tracking its own progress.
      A failure here does not affect the volume figures: open/high/low stay null and the K chart simply draws
      fewer candles.
    */
    const histUrl = taiexHistMonthUrl(yyyymm)
    const hist = histUrl ? parseTaiexHist(await fetchRwdJson(histUrl)) : new Map()
    for (const d of parsed) {
      const h = hist.get(d.date)
      if (h) {
        d.taiexOpen = h.open
        d.taiexHigh = h.high
        d.taiexLow = h.low
      }
    }
    incoming = incoming.concat(parsed)
  }

  let days = mergeMarketDays(have, incoming)

  // Legal person amount: The list to be supplemented is the merged list, so that the new trading days just captured in this round will also be queued to be supplemented.
  let institutionalFilled = 0
  for (const ymd of planInstitutionalBackfill(days, MAX_MARKET_INST_DAYS)) {
    const url = bfi82uDayUrl(ymd)
    if (!url) continue
    const inst = parseBfi82u(await fetchRwdJson(url))
    if (!inst) continue
    anyOk = true
    institutionalFilled++
    const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}`
    // Use mergeInstitutional instead of overwriting directly: if the transaction amount is not spit out this time, you cannot wash out the completed ones.
    days = days.map((d) =>
      d.date === date ? { ...d, institutional: mergeInstitutional(d.institutional, inst) } : d,
    )
  }

  if (!anyOk) {
    return {
      synced: false,
      days: have.length,
      institutionalFilled: 0,
      asOf: existing?.asOf ?? null,
      reason: 'empty',
    }
  }

  /*
    Compare content, not length: when only some days had their institutional amounts filled in, the day count
    does not move —— judging by length would treat a real update as nothing happening and skip the write
    (the same pit as EPS in backfillProfit).
  */
  const signature = (ds: MarketDay[]) =>
    ds
      .map(
        (d) =>
          // The legal person must record "whether there is a transaction amount" instead of just "whether there is this item": the backfill of 0.6.32 is to make up for it
          // In the old days when there was already a balance, if only 1/0 was recorded, the signature would remain unchanged, and the amount of the transaction made up would be lost in each round.
          `${d.date}:${d.tradeValueTwd ?? ''}:${d.taiexOpen ?? ''}:${
            d.institutional ? (d.institutional.buy ? 2 : 1) : 0
          }`,
      )
      .join(',')
  if (signature(days) === signature(have)) {
    return {
      synced: false,
      days: days.length,
      institutionalFilled,
      asOf: existing?.asOf ?? null,
      reason: 'unchanged',
    }
  }

  const asOf = new Date().toISOString()
  const ok = await uploadJson('market/daily.json', {
    schema: MARKET_SCHEMA,
    asOf,
    days,
  } satisfies MarketFile)
  return {
    synced: ok,
    days: days.length,
    institutionalFilled,
    asOf: ok ? asOf : (existing?.asOf ?? null),
    reason: ok ? 'updated' : 'unchanged',
  }
}

// ----U.S. General Economic Indicator (0.6.5)----

/**
 * Output `macro/us.json`: the latest values ​​of the five FRED series and the trends in the past 12 periods.
 *
 * **This is the first non-individual stock data of this project**, several deliberate decisions:
 *
 * 1. **Single global file, not per-ticker**. Shared by the entire market, each stock sees exactly the same;
 *    Written per-ticker is just copying the same information N times. Shape closest to `manifest.json`.
 * 2. **Do not enter `tickers` loop, do not enter `warmStock`**. It has nothing to do with individual stocks;
 *    Hanging in will only cause "Add a new stock" to trigger five external requests by mistake.
 * 3. **The idempotent key is the content fingerprint, not the date** (from 0.6.11, fixes BUG-008).
 *    Originally it was "skip if caught on the same Taipei day", but `macro-daily` is scheduled in two shifts (13:00 / 15:00 UTC)
 *    The intention is to "let the second shift make up if the first shift doesn't receive it" - and the first shift "successfully caught a copy that has not been updated yet"
 *    Data", date idempotence will cause the second class not to send a single request, so it will have to wait until the next day.
 *    The core PCE of 2026-07-30 is exactly this: BEA released at 8:30 US ET (12:30 UTC in summer),
 *    FRED is imported even later, and the sequence obtained by the 13:00 batch is not as good as that of 2026-06; the winter time release time is
 *    13:30 UTC, the 13:00 class even runs before the release, and will be one day slower every month.
 *    The price is just five more CSV requests per day (one caught in each of the two shifts) and one error that is bound to occur.
 *    ⚠️ No need for `dataYmd`: US data is based on its own release date.
 *    It has nothing to do with the Taiwan stock trading day. If you use the trading day as the key, updates will be stopped during consecutive holidays.
 * 4. **Do not write `chip_raw_cache`**. The prune of that table is the 8-digit date lexicographic order with `ymd < cutoff`,
 *    The month key is deleted every round (`backfillRevenue` is not used for this purpose).
 *    `macro/us.json` itself is cached.
 * 5. **Do not overwrite existing files if all fails**: Keeping old data is better than empty files.
 */
async function syncMacro(now: Date): Promise<{
  /** Did you actually write the file this time (= the content has changed and the upload was successful)*/
  synced: boolean
  /** The number of indicators caught; combined with `reason`, we can distinguish between "unchanged" and "uncaught"*/
  count: number
  /** The last change time of the data (if it has not changed, it is the old value of the existing file)*/
  asOf: string | null
  /**
   * updated: There is new information｜unchanged: I asked but the content is the same｜empty: All five sequences are destroyed｜
   * skipped: No need to ask based on the release calendar (zero external requests, see macroCalendar.decideMacroScan)
   */
  reason: 'updated' | 'unchanged' | 'empty' | 'skipped'
  /** skipped / Scan the details of the decision for background display and subsequent interpretation*/
  scan?: { reason: ScanReason; dueIds: string[]; scansToday: number }
}> {
  const existing = await downloadJson<MacroFile>('macro/us.json')

  // 0.6.15: Let’s first ask “Do we really need to play FRED this round?”
  // I usually only scan once a day (to keep up with FRED and go back to correct the historical value), and only scan intensively on the day of release until I catch it.
  // "Once caught, don't catch it" falls into the satisfied branch of decideMacroScan.
  const todayYmd = taipeiYmdOf(now)
  const prevScans = existing?.scansToday?.ymd === todayYmd ? (existing.scansToday?.n ?? 0) : 0
  const decision = decideMacroScan({
    now,
    indicators: (existing?.indicators ?? []).map((i) => ({
      id: i.id,
      latestPeriod: i.latest?.period ?? null,
    })),
    scansToday: prevScans,
    lastScanYmd: existing?.scansToday?.ymd ?? null,
  })
  /*
    Catalog growth (0.6.44 FOMC): decideMacroScan only sees indicators **already in the file**.
    After a routine scan on an old 5-series file, reason becomes `satisfied` for the rest of the
    Taipei day and we never discover a newly added FRED_SERIES id. Force a fetch when the
    on-disk set is missing any catalog entry so deploy + same-day manual sync still fills FOMC.
  */
  const catalogIncomplete = macroCatalogIncomplete((existing?.indicators ?? []).map((i) => i.id))
  /*
    0.6.46-dev.2: FOMC switched from rate-change steps to meeting-calendar points.
    Legacy files keep a latest period that is a FRED effective day (e.g. 2025-12-11) rather
    than a statement day in RELEASE_CALENDAR (2025-12-10). Force one rebuild so holds appear
    even when decideMacroScan already said satisfied/outside-window for the Taipei day.
  */
  const fomc = (existing?.indicators ?? []).find((i) => i.id === 'DFEDTARU')
  const meetingSet = new Set((RELEASE_CALENDAR.DFEDTARU ?? []).map((e) => e.period))
  const fomcNeedsMeetingRebuild =
    !fomc?.latest?.period || !meetingSet.has(fomc.latest.period)
  // Catalog copy (labels/notes) drifted after a deploy — still force a rewrite.
  const catalogLabelMismatch = (existing?.indicators ?? []).some((i) => {
    const spec = FRED_SERIES.find((s) => s.id === i.id)
    return Boolean(spec && i.label !== spec.label)
  })

  if (
    !decision.scan &&
    existing &&
    !catalogIncomplete &&
    !fomcNeedsMeetingRebuild &&
    !catalogLabelMismatch
  ) {
    return {
      synced: false,
      count: existing.indicators?.length ?? 0,
      asOf: existing.asOf,
      reason: 'skipped',
      scan: { reason: decision.reason, dueIds: decision.dueIds, scansToday: prevScans },
    }
  }

  const indicators: MacroIndicator[] = []
  for (const spec of FRED_SERIES) {
    try {
      const since = fredSinceDate(now, spec.lookbackMonths ?? MACRO_LOOKBACK_MONTHS)
      const headers = { 'User-Agent': MACRO_UA, Accept: 'text/csv' }
      const res = await fetch(fredCsvUrl(spec.id, since), {
        // ⚠️ Not a UA by twChips. Sending a browser string will cause FRED to directly reset the connection, see MACRO_UA
        headers,
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) continue

      let raw
      if (spec.kind === 'rate' && spec.idLow) {
        // Target range: two daily series × official FOMC meeting calendar (holds included).
        const resLow = await fetch(fredCsvUrl(spec.idLow, since), {
          headers,
          signal: AbortSignal.timeout(15_000),
        })
        if (!resLow.ok) continue
        const meetingDates = (RELEASE_CALENDAR[spec.id] ?? []).map((e) => e.period)
        raw = meetingRatePoints(
          parseFredCsvDaily(await res.text()),
          parseFredCsvDaily(await resLow.text()),
          meetingDates,
          now,
        )
      } else {
        raw = parseFredCsv(await res.text())
      }

      const ind = deriveIndicator(spec, raw)
      // If you can't calculate one issue (the sequence has been stopped or the format has changed), don't put it in the file and let the front end show that it is missing materials.
      if (ind.latest) indicators.push(ind)
    } catch {
      // Failure of a single sequence does not affect the other four
    }
  }
  // Existing files will not be overwritten when completely destroyed (leaving old data is better than empty files).
  // Return count = 0 and mark reason - here once the entire batch failed and there was only one boolean false
  // However, I can’t tell whether it’s “skip” or “can’t catch”.
  if (indicators.length === 0) {
    return { synced: false, count: 0, asOf: existing?.asOf ?? null, reason: 'empty' }
  }

  // If the content does not change, it will not change asOf, so that it keeps the time of "the last real change of the data" rather than "the last time it ran".
  // (Follow the runSignature principle of pollPlan: the timestamp should not jump if the input fingerprint has not changed).
  // Still have to write a file to update checkedAt - that's the only clue that the schedule is still alive.
  // Otherwise, you will only see a date that has not moved for several days on the screen, and you cannot tell whether there is no new data or the schedule is down.
  if (
    existing?.schema === MACRO_SCHEMA &&
    Array.isArray(existing.indicators) &&
    macroFingerprint(existing.indicators) === macroFingerprint(indicators)
  ) {
    // Fingerprint ignores labels/notes. Still rewrite them when the catalog copy changes
    // (e.g. 「非農就業」→「非農就業 (NFP)」) without bumping asOf.
    const copyOnly = indicators.some((n) => {
      const e = existing.indicators.find((x) => x.id === n.id)
      return Boolean(e && (e.label !== n.label || e.note !== n.note))
    })
    await uploadJson('macro/us.json', {
      ...existing,
      indicators: copyOnly ? indicators : existing.indicators,
      checkedAt: now.toISOString(),
      scansToday: { ymd: todayYmd, n: prevScans + 1 },
    })
    return {
      synced: false,
      count: indicators.length,
      asOf: existing.asOf,
      reason: 'unchanged',
      scan: { reason: decision.reason, dueIds: decision.dueIds, scansToday: prevScans + 1 },
    }
  }

  const file: MacroFile = {
    schema: MACRO_SCHEMA,
    asOf: now.toISOString(),
    checkedAt: now.toISOString(),
    scansToday: { ymd: todayYmd, n: prevScans + 1 },
    region: '美國',
    indicators,
  }
  const ok = await uploadJson('macro/us.json', file)
  return {
    synced: ok,
    count: indicators.length,
    asOf: ok ? file.asOf : (existing?.asOf ?? null),
    reason: 'updated',
    scan: { reason: decision.reason, dueIds: decision.dueIds, scansToday: prevScans + 1 },
  }
}

/**
 * Get the exchange rate of the Taiwan dollar against eight major foreign currencies and write it into `fx/twd.json` (global single file).
 *
 * The structure roughly corresponds to `syncMacro` (single failure does not affect others, total destruction does not overwrite), there are three differences:
 *
 * 1. **Try currency pairs in two directions for each currency**. On one side of Yahoo is "Back to 200, complete structure,
 *    But there is only one grid of data", and which side is dead varies depending on the currency (actual measurement CNYTWD=X and TWDEUR=X
 *    They only return one square, and the direction is opposite). Therefore, `FX_MIN_POINTS` is used to determine whether it is enough. If it is not enough, the next candidate will be replaced.
 *    See the FxSpec.symbols annotation of fxRates.ts for details.
 * 2. **Exit the candidate loop if successful**. Under normal circumstances, only one request is sent for each currency, eight times for eight currencies.
 * 3. **Impotent is still the Taipei calendar day, deliberately not following the content fingerprint of `syncMacro`** (0.6.11).
 *    The general manager changed the fingerprints because "the monthly data was released later that day", and the first shift may have caught an older issue;
 *    The exchange rate doesn't have this problem - it closes a new price every trading day, at 03:00 UTC (after the New York close)
 *    What you get must be the complete daily line of the previous trading day, and the second shift cannot make up anything.
 *    For data that changes every day, content fingerprinting will only determine "changed" every time, which will only add one unnecessary crawl.
 */
async function syncFx(now: Date): Promise<{ synced: boolean; count: number; asOf: string | null }> {
  const today = taipeiYmdOf(now)
  const existing = await downloadJson<FxFile>('fx/twd.json')
  if (existing && existing.schema === FX_SCHEMA && taipeiYmdOf(new Date(existing.asOf)) === today) {
    // Already caught today. count uses the existing currency number to distinguish between "skip" and "cannot catch"
    return { synced: false, count: existing.currencies?.length ?? 0, asOf: existing.asOf }
  }

  const currencies: FxCurrency[] = []
  for (const spec of FX_CURRENCIES) {
    for (const cand of spec.symbols) {
      try {
        // Use the same helper used to catch the Yahoo daily line (with UA, non-200 throw error)——
        // Yahoo eats browser UA, which is the opposite of FRED's "cannot claim to be a browser", don't be confused
        const resp = await fetchJson<ChartResponse>(fxUrl(cand.symbol))
        const points = extractFxPoints(resp, cand.invert)
        // Insufficient points means this side is dead (only the current quote will be returned), change to the next candidate currency pair
        if (points.length < FX_MIN_POINTS) continue
        currencies.push(buildCurrency(spec, cand.symbol, points))
        break
      } catch {
        // If a single candidate fails, try the next one; the eight currencies are independent of each other
      }
    }
  }

  // Existing files will not be overwritten when completely destroyed (follow the principle of syncMacro: leaving old data is better than empty files).
  // Return count = 0 to let batch_run_log distinguish between "skip" and "catch"
  if (currencies.length === 0) return { synced: false, count: 0, asOf: existing?.asOf ?? null }

  const file: FxFile = {
    schema: FX_SCHEMA,
    asOf: now.toISOString(),
    base: 'TWD',
    currencies,
  }
  const ok = await uploadJson('fx/twd.json', file)
  return {
    synced: ok,
    count: currencies.length,
    asOf: ok ? file.asOf : (existing?.asOf ?? null),
  }
}

/** Delete the entire {ymd}/ directory in the reports bucket whose data date is earlier than cutoff*/
async function pruneStorage(cutoffYmd: string): Promise<void> {
  try {
    const { data: entries } = await db.storage.from(REPORTS_BUCKET).list('', { limit: 1000 })
    for (const e of entries ?? []) {
      if (!/^\d{8}$/.test(e.name) || e.name >= cutoffYmd) continue
      const { data: files } = await db.storage.from(REPORTS_BUCKET).list(e.name, { limit: 1000 })
      const paths = (files ?? []).map((f) => `${e.name}/${f.name}`)
      if (paths.length > 0) await db.storage.from(REPORTS_BUCKET).remove(paths)
    }
  } catch {
    // Failure to clean up does not affect the main process
  }
}

async function pruneChipCache(cutoffYmd: string): Promise<void> {
  try {
    await db.from('chip_raw_cache').delete().lt('ymd', cutoffYmd)
    // The warm counters key off the same 8-digit Taipei date, so the same lexicographic cutoff
    // clears them. Only today's row is ever read; everything older is dead weight.
    await db.from('warm_quota').delete().lt('ymd', cutoffYmd)
  } catch {
    // Failure to clean up does not affect the main process
  }
}

/**
 * The trading day to be used for click-to-produce: based on the ymd of `manifest.json`, which is the same as the night batch.
 * If there is no manifest (the batch has never been run), the nearest non-weekend day is used.
 */
async function warmDataYmd(): Promise<string> {
  const m = await downloadJson<{ ymd?: unknown }>('manifest.json')
  if (m && typeof m.ymd === 'string' && /^\d{8}$/.test(m.ymd)) return m.ymd
  const candidates = tradingDateCandidates(new Date())
  return candidates.find((y) => !isWeekendYmd(y)) ?? candidates[0] ?? ''
}

/**
 * Instant production of a single symbol: supplement the daily line and fundamentals (0.6.0-dev.7).
 *
 * Why it is needed: Newly added stocks have to wait for the next night batch to have daily lines and fundamentals.
 * Before that, the technical and fundamental pages are empty, and the AI ​​analysis will even fail because it cannot get the daily line.
 *
 * Why it’s safe (lessons from burning credits in 0.3.9):
 * 1. `assertUser` + `heldTwTickers()` whitelist (0.7.0) + `WARM_DAILY_LIMIT`. This is the only
 *    endpoint here that meters per user, because it is the only one whose cost is not already paid
 *    by `chip_raw_cache`.
 * 2. Both share the condition of "skip if it is the latest" with the batch, and **file will be written if no data is found**,
 *    Therefore, the same file will only actually do something once a day at most, and then the front end will directly read the Storage.
 * 3. The three fundamentals are the largest in the market and use `chip_raw_cache`, and the external amplification effect is close to zero.
 *
 * 4. **Also run historical backfill** (0.6.29): The source endpoint only returns the latest period; history and EPS
 *    rely on MOPS backfill. Budget is `WARM_BUDGET_MS` (see warmHistoryBackfill).
 *
 * 5. **Phased warm** (0.6.46-dev.4): `phase=core` returns after daily + latest fundamental so the UI can paint
 *    in seconds; `phase=history` runs only the MOPS loops (no second quota charge — same ticker already paid
 *    on core/full). `phase=full` (default) keeps the one-shot behaviour for background prefetch.
 *
 *    History still requires `assertUser`. Gap-driven backfill is free when the file is already complete, so a
 *    stray history call on a full stock costs two Storage reads. Thin files without a prior core still cost
 *    MOPS if they already exist from the night batch; session seal on the frontend is the main throttle.
 */
async function handleWarm(req: Request, body: GenerateReportRequestBody): Promise<Response> {
  const ticker = String(body.ticker ?? '').trim()
  if (!TICKER_RE.test(ticker)) {
    return json({ error: 'ticker 格式不正確' }, 400)
  }

  const auth = await assertUser(req)
  if (auth instanceof Response) return auth
  const heldForWarm = await heldTwTickers()
  if (!heldForWarm.some((h) => h.ticker === ticker)) {
    return json({ error: '僅限有人持有的台股代號' }, 403)
  }

  const phase = parseWarmPhase(body.phase)
  const now = new Date()
  const name = String(body.name ?? '').trim().slice(0, 40)
  const started = Date.now()

  // History is the second half of a progressive warm: quota was charged on core (or full).
  if (phase === 'history') {
    const one = [{ ticker, name }]
    const existing = await downloadJson<FundamentalFile>(`fundamental/${ticker}.json`)
    if (!existing) {
      return json({
        ok: true,
        ticker,
        phase: 'history',
        dailySynced: 0,
        fundamentalSynced: 0,
        revenueMonths: [],
        profitQuarters: [],
        fundamentalComplete: false,
        durationMs: Date.now() - started,
      })
    }
    if (fundamentalHistoryLooksComplete(existing)) {
      return json({
        ok: true,
        ticker,
        phase: 'history',
        dailySynced: 0,
        fundamentalSynced: 0,
        revenueMonths: [],
        profitQuarters: [],
        fundamentalComplete: true,
        durationMs: Date.now() - started,
      })
    }
    const hist = await warmHistoryBackfill(one, now)
    return json({
      ok: true,
      ticker,
      phase: 'history',
      dailySynced: 0,
      fundamentalSynced: 0,
      revenueMonths: hist.revenueMonths,
      profitQuarters: hist.profitQuarters,
      fundamentalComplete: hist.complete,
      durationMs: Date.now() - started,
    })
  }

  // core + full: charge quota once per call
  const quota = await takeWarmQuota(auth.userId, taipeiYmd(now))
  if (quota === 'limited') {
    return json({ error: '今日查詢新個股的次數已達上限，請明天再試' }, 429)
  }
  if (quota === 'error') {
    // Prefer a hard stop over an unbound warm once the whitelist is gone.
    return json({ error: '查詢額度服務暫時無法使用，請稍後再試' }, 503)
  }

  // The name used to come from the holdings whitelist. Without it the caller has to supply one ——
  // the search box already has it, and an empty string is harmless (buildFundamentalFile keeps
  // whatever the existing file had, and the batch overwrites it with the official name later).
  const dataYmd = await warmDataYmd()
  if (!dataYmd) return json({ error: '無法判斷交易日' }, 503)

  const one = [{ ticker, name }]
  const dailyResult = await syncDaily(one, dataYmd, { onDemand: true })
  const dailySynced = dailyResult.synced

  /*
    Does this code exist at all? (0.6.44)

    `TICKER_RE` accepts 2–8 alphanumerics, which is a space of millions, and before this release the
    holdings whitelist was what kept the made-up ones out. Yahoo is the cheapest oracle we already
    pay for: `syncDaily` has just asked it under both `.TW` and `.TWO`, and an empty `rows` means
    nobody trades this symbol.

    Only the two MOPS backfill loops are skipped —— not `syncFundamental`. That path only reads
    `chip_raw_cache`, and a genuinely newly-listed stock that Yahoo has not picked up yet still
    deserves its valuation row. The loops are the ones that hit MOPS for up to `WARM_BUDGET_MS`,
    and a symbol with no price history has no revenue history to go looking for either.

    `fundamentalComplete: true` on the unknown path tells `warmStock.ts` to seal the ticker so we
    do not re-ask MOPS on every page open for a code that will never have history.
  */
  const daily = await downloadJson<DailyFile>(`daily/${ticker}.json`)
  const fundamental = await syncFundamental(one, dataYmd)
  if (!daily || (daily.rows?.length ?? 0) === 0) {
    return json({
      ok: true,
      ticker,
      ymd: dataYmd,
      phase,
      unknownTicker: true,
      dailySynced,
      fundamentalSynced: fundamental.synced,
      revenueMonths: [],
      profitQuarters: [],
      fundamentalComplete: true,
      durationMs: Date.now() - started,
    })
  }

  // Fast path: stop after latest valuation / month / quarter so the UI can paint.
  if (phase === 'core') {
    const file = await downloadJson<FundamentalFile>(`fundamental/${ticker}.json`)
    return json({
      ok: true,
      ticker,
      ymd: dataYmd,
      phase: 'core',
      dailySynced,
      fundamentalSynced: fundamental.synced,
      revenueMonths: [],
      profitQuarters: [],
      fundamentalComplete: fundamentalHistoryLooksComplete(file),
      durationMs: Date.now() - started,
    })
  }

  /*
    phase=full (default): same as pre-0.6.46-dev.4 one-shot warm.
    History backfill within WARM_BUDGET_MS — see warmHistoryBackfill.
  */
  const hist = await warmHistoryBackfill(one, now)
  return json({
    ok: true,
    ticker,
    ymd: dataYmd,
    phase: 'full',
    dailySynced,
    fundamentalSynced: fundamental.synced,
    revenueMonths: hist.revenueMonths,
    profitQuarters: hist.profitQuarters,
    fundamentalComplete: hist.complete,
    durationMs: Date.now() - started,
  })
}

/**
 * Taipei time HH:MM. The purpose of saving into batch_run_log is to "see which class this is at a glance".
 * This prevents you from having to convert UTC to the time zone yourself every time you check it.
 */
function taipeiHhmm(d: Date): string {
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`
}

/**
 * Record a batch execution. The write failure does not affect the main process at all - this is observation data, not output.
 *
 * For the reason of existence, see schema.sql §7: pg_net’s response only keeps 6 hours, chip_raw_cache only remembers the success time.
 * Neither of them can answer "Whether that day's data arrived when that class ran?", and that is the only fact needed to fine-tune the cron schedule.
 */
async function logBatchRun(row: Record<string, unknown>): Promise<void> {
  try {
    await db.from('batch_run_log').insert(row)
  } catch {
    // Observation failure cannot bring down the batch
  }
}

// ----Data source probe (0.6.3 → 0.7.3 multi-source experiment)----

/**
 * 0.7.3 experiment: probe selected sources every 5 minutes **inside time windows**
 * (see sourceProbePlan.ts). Writes `source_probe_tick` (hit/miss) for admin UI.
 * Does **not** write reports / chip cache / product Storage.
 *
 * Hit = HTTP ok AND payload indicates "today's session data is present" (source-specific).
 * Fixed generate/sync crons are deactivated during the experiment; restore after validation.
 */
type ProbeTickResult = {
  source: ProbeSourceId
  hit: boolean
  ok: boolean
  data_ymd: string | null
  fingerprint: string | null
  rows: number | null
  note: string | null
  duration_ms: number
}

async function probeOne<T>(
  url: string,
  ok: (v: T) => boolean,
  dateOf: (v: T) => string | null,
  rowsOf: (v: T) => unknown,
): Promise<{ ok: boolean; date: string | null; fp: string | null; rows: number | null }> {
  try {
    const resp = await fetchJson<T>(url)
    if (!ok(resp)) return { ok: false, date: null, fp: null, rows: null }
    const rows = rowsOf(resp)
    return {
      ok: true,
      date: dateOf(resp),
      fp: rowsFingerprint(rows),
      rows: Array.isArray(rows) ? rows.length : null,
    }
  } catch {
    return { ok: false, date: null, fp: null, rows: null }
  }
}

function taipeiWeekday(d: Date): boolean {
  // 0=Sun … 6=Sat in Taipei
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const day = t.getUTCDay()
  return day >= 1 && day <= 5
}

/** Floor HH:mm to 5-minute slot label (15:07 → 15:05) for stable UI grouping */
function floorToFiveMin(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return hhmm
  const h = Number(m[1])
  const min = Math.floor(Number(m[2]) / 5) * 5
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

async function probeSource(
  id: ProbeSourceId,
  todayYmd: string,
): Promise<Omit<ProbeTickResult, 'source'>> {
  const t0 = Date.now()
  const fail = (note: string): Omit<ProbeTickResult, 'source'> => ({
    hit: false,
    ok: false,
    data_ymd: null,
    fingerprint: null,
    rows: null,
    note,
    duration_ms: Date.now() - t0,
  })

  try {
    if (id === 't86') {
      const resp = await fetchJson<T86ResponseShape>(t86Url(todayYmd))
      const hit = t86Ok(resp)
      const data = resp.data ?? resp.tables?.[0]?.data ?? []
      return {
        hit,
        ok: resp.stat === 'OK',
        data_ymd: hit ? todayYmd : null,
        fingerprint: hit ? t86Fingerprint(resp) : null,
        rows: Array.isArray(data) ? data.length : null,
        note: hit ? '當日 T86 有列' : '當日 T86 尚無資料',
        duration_ms: Date.now() - t0,
      }
    }
    if (id === 'bfi82u') {
      const url = bfi82uDayUrl(todayYmd)
      if (!url) return fail('bad ymd')
      const raw = await fetchJson<unknown>(url)
      const inst = parseBfi82u(raw)
      const hit = !!inst?.buy && inst.buy.totalTwd != null
      return {
        hit,
        ok: !!inst,
        data_ymd: hit ? todayYmd : null,
        fingerprint: inst ? fingerprint(inst) : null,
        rows: inst ? 1 : null,
        note: hit ? '當日 BFI82U 含買進' : '當日 BFI 尚未齊',
        duration_ms: Date.now() - t0,
      }
    }
    if (id === 'margin') {
      const resp = await fetchJson<MarginDatedResponse>(marginDatedUrl(todayYmd))
      const hit = marginDatedOk(resp)
      const table = (resp as { data?: unknown[] }).data
      return {
        hit,
        ok: hit || (resp as { stat?: string }).stat === 'OK',
        data_ymd: hit ? todayYmd : null,
        fingerprint: hit ? fingerprint(table) : null,
        rows: Array.isArray(table) ? table.length : null,
        note: hit ? '當日融資融券有表' : '當日融資尚未公布',
        duration_ms: Date.now() - t0,
      }
    }
    if (id === 'borrow') {
      const r = await probeOne<BorrowDatedResponse>(
        BORROW_DATED_URL,
        borrowDatedOk,
        borrowDatedDate,
        (v) => v.data ?? [],
      )
      // 端點盤中就有資料，「有沒有資料」量不到任何事；命中＝日期已翻到下一個交易日。
      const hit = borrowHit(r.date, todayYmd)
      return {
        hit,
        ok: r.ok,
        data_ymd: r.date,
        fingerprint: r.fp,
        rows: r.rows,
        note: !r.ok
          ? '借券端點無資料'
          : hit
            ? `借券日=${r.date}（已翻次一交易日）`
            : `借券日=${r.date ?? '?'}＝當日額度，尚未翻日`,
        duration_ms: Date.now() - t0,
      }
    }
    if (id === 'bwibbu') {
      const r = await probeOne<Array<Record<string, string>>>(
        BWIBBU_ALL_URL,
        (v) => Array.isArray(v) && v.length > 0,
        (v) => v[0]?.Date ?? null,
        (v) => v,
      )
      const roc = ymdToRocYmd(todayYmd)
      const hit = r.ok && !!r.date && !!roc && r.date === roc
      return {
        hit,
        ok: r.ok,
        data_ymd: r.date,
        fingerprint: r.fp,
        rows: r.rows,
        note: hit ? '估值日=今日' : r.ok ? `估值日=${r.date ?? '?'}≠今日` : '估值抓取失敗',
        duration_ms: Date.now() - t0,
      }
    }
    // 兩份 MOPS 彙整表同型：端點恆有資料，唯一能分辨新舊的是自報的出表日期。
    if (id === 'mops_revenue' || id === 'mops_profit') {
      const isRevenue = id === 'mops_revenue'
      const r = await probeOne<Array<Record<string, string>>>(
        isRevenue ? T187AP05_URL : T187AP17_URL,
        (v) => Array.isArray(v) && v.length > 0,
        (v) => mopsIssueRocYmd(v),
        (v) => v,
      )
      const roc = ymdToRocYmd(todayYmd)
      const hit = r.ok && !!r.date && !!roc && r.date === roc
      const what = isRevenue ? '月營收' : '季報'
      return {
        hit,
        ok: r.ok,
        data_ymd: r.date,
        fingerprint: r.fp,
        rows: r.rows,
        note: !r.ok
          ? `${what}彙整失敗`
          : hit
            ? `${what}出表日=今日（${r.rows ?? '?'} 筆）`
            : `${what}出表日=${r.date ?? '?'}≠今日`,
        duration_ms: Date.now() - t0,
      }
    }
    return fail('unknown source')
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

/**
 * Sources that already turned green today.
 *
 * A missing table or an RLS refusal returns an empty set, which degrades to the old behaviour (probe
 * everything in the window) rather than to "probe nothing" —— the probe going quiet would look exactly
 * like a source that never lands, and that is the one reading this experiment must never fake.
 */
async function readHitSourcesToday(todayYmd: string): Promise<Set<ProbeSourceId>> {
  try {
    const { data, error } = await db
      .from('source_probe_tick')
      .select('source')
      .eq('taipei_ymd', todayYmd)
      .eq('hit', true)
    if (error || !Array.isArray(data)) return new Set()
    return new Set(data.map((r) => r.source as ProbeSourceId))
  } catch {
    return new Set()
  }
}

async function handleProbe(): Promise<Response> {
  const startedAt = Date.now()
  const now = new Date()
  const todayYmd = taipeiYmd(now)
  const rawHhmm = taipeiHhmm(now)
  const slot = floorToFiveMin(rawHhmm)
  const weekday = taipeiWeekday(now)
  const planned = sourcesForTaipeiTime(slot, weekday)
  // 0.7.7: stop asking a source once it has answered today —— see pendingSources.
  const hitToday = planned.length > 0 ? await readHitSourcesToday(todayYmd) : new Set<ProbeSourceId>()
  const sources = pendingSources(planned, hitToday)
  const skipped = planned.filter((id) => !sources.includes(id))

  const ticks: ProbeTickResult[] = []
  // Sequential: keep wall time predictable on free tier
  for (const id of sources) {
    const r = await probeSource(id, todayYmd)
    ticks.push({ source: id, ...r })
  }

  // Persist ticks (one row per source)
  for (const t of ticks) {
    try {
      await db.from('source_probe_tick').insert({
        taipei_ymd: todayYmd,
        taipei_time: slot,
        source: t.source,
        hit: t.hit,
        ok: t.ok,
        data_ymd: t.data_ymd,
        fingerprint: t.fingerprint,
        rows: t.rows,
        note: t.note,
        duration_ms: t.duration_ms,
      })
    } catch {
      // table missing or RLS — probe must not crash cron
    }
  }

  // Legacy source_probe_log: keep last bwibbu/borrow snapshot if those ran
  const bw = ticks.find((t) => t.source === 'bwibbu')
  const br = ticks.find((t) => t.source === 'borrow')
  if (bw || br) {
    try {
      await db.from('source_probe_log').insert({
        taipei_ymd: todayYmd,
        taipei_time: slot,
        bwibbu_ok: bw?.ok ?? null,
        bwibbu_date: bw?.data_ymd ?? null,
        bwibbu_fp: bw?.fingerprint ?? null,
        bwibbu_rows: bw?.rows ?? null,
        borrow_ok: br?.ok ?? null,
        borrow_date: br?.data_ymd ?? null,
        borrow_fp: br?.fingerprint ?? null,
        borrow_rows: br?.rows ?? null,
        duration_ms: Date.now() - startedAt,
      })
    } catch {
      /* ignore */
    }
  }

  return json({
    ok: true,
    experiment: '0.7.3-probe-only',
    taipei_ymd: todayYmd,
    taipei_time: slot,
    weekday,
    sources,
    // Reported so a quiet round is readable as "already answered" rather than "the probe stopped working"
    skipped,
    ticks: ticks.map((t) => ({
      ...t,
      label: PROBE_SOURCE_LABELS[t.source],
      tickLabel: `${slot.replace(':', '')} ${t.hit ? '中' : '沒中'}`,
    })),
    durationMs: Date.now() - startedAt,
  })
}

/** The status left by the last execution today; if found (the first run, or the table does not exist), null will be returned*/
interface LastRun {
  runsToday: number
  t86: T86State | null
  runSig: string | null
}

/**
 * Retrieve the cross-run status from the last column of `batch_run_log` today.
 *
 * **Why put the status in the observation table**: These fields are what we want to observe (how many times will it be rewritten, when will it be finalized),
 * There is no need to create another table for the same data. The price is that it becomes half-loaded - when the write fails
 * (`logBatchRun` intentionally swallows exceptions) The next round will be regarded as the first run of the day, so T86 will be captured again and counted again.
 * That's **doing more** rather than doing wrong things, which is acceptable; but don't forget this characteristic.
 */
async function readLastRun(todayYmd: string): Promise<LastRun | null> {
  try {
    const { data, error } = await db
      .from('batch_run_log')
      .select('runs_today, t86_fingerprint, t86_revisions, t86_unchanged, t86_frozen, run_sig')
      .eq('taipei_ymd', todayYmd)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    const fp = data.t86_fingerprint
    return {
      runsToday: Number(data.runs_today ?? 0),
      t86:
        typeof fp === 'string' && fp
          ? {
              fingerprint: fp,
              revisions: Number(data.t86_revisions ?? 0),
              unchanged: Number(data.t86_unchanged ?? 0),
              frozen: Boolean(data.t86_frozen),
            }
          : null,
      runSig: typeof data.run_sig === 'string' ? data.run_sig : null,
    }
  } catch {
    return null
  }
}

/**
 * After-hours batch (changed to polling every 15 minutes from 16:00–23:45 starting from 0.6.1, replacing the original three shifts).
 *
 * Three things to keep “running 32 times a day” from turning into doing 32 times a day:
 * 1. **Short circuit**: If you have everything you need today, just reply directly without sending any external request (`decidSkip`).
 * 2. **Rewrite Detection**: T86 re-compares each round before finalization, and freezes after finalization (`nextT86State`).
 *    This is necessary - T86 is updated every 15 minutes starting from 16:00, and what is caught early may not be the final version.
 * 3. **Reproduction Gate**: Do not rewrite the report if the input does not change, so that `generatedAt` will only jump when there is a real change.
 *
 * All judgment logic is extracted in `pollPlan.ts` and pinned with tests - only wiring is responsible here.
 * The reason is shown at the beginning of this file: the cost of making a wrong judgment has been increased from 3 times to 32 times in the third shift era.
 */
/**
 * Nightly / manual post-close work, split so one Edge isolate does not pack
 * chips + Yahoo daily + MOPS history (546 on cloud Free/Pro compute).
 *
 * Phases (0.6.49, A2 + P1):
 * - `chips` — T86 series, per-ticker reports, prune
 * - `market-data` — syncDaily + syncFundamental
 * - `history` — one round of revenue + profit backfill (caps; full 12/12 needs many rounds)
 *
 * `generate-all` (cron) runs phases in order until `GENERATE_ALL_BUDGET_MS` is nearly spent.
 * Admin console invokes each phase as its own `admin-run` job (separate HTTP = separate budget).
 */
type GeneratePhaseId = 'chips' | 'market-data' | 'history'

const GENERATE_PHASE_IDS: GeneratePhaseId[] = ['chips', 'market-data', 'history']

async function runGeneratePhaseChips(): Promise<Record<string, unknown>> {
  const startedAt = Date.now()
  const now = new Date()
  const todayYmd = taipeiYmd(now)
  t86FingerprintByYmd.clear()

  const tickers = await batchTwTickers()
  const personalList = tickers

  // Chip short circuit before TWSE fetches. Fundamentals still run in later phases when chips skip.
  const last = await readLastRun(todayYmd)
  const cachedToday = await cachedDayDatasets([todayYmd])
  const skip = decideSkip({
    t86Today: cachedToday.has(`${todayYmd}:T86`),
    t86Frozen: last?.t86?.frozen ?? false,
    marginToday: cachedToday.has(`${todayYmd}:MI_MARGN_D`),
    runsToday: last?.runsToday ?? 0,
  })

  let generated = 0
  let regenerate = false
  let seriesDataYmd: string | null = null
  let t86Today = false
  let t86State: ReturnType<typeof nextT86State> | null = null
  let marginOk = false
  let marginToday = cachedToday.has(`${todayYmd}:MI_MARGN_D`)
  let borrowOk = false
  let borrowDataDate: string | null = null
  let historyDays = 0
  let runSig: string | null = last?.runSig ?? null
  let chipsSkipped = false
  let skipReason: string | null = null

  if (skip.skip) {
    chipsSkipped = true
    skipReason = skip.reason
    seriesDataYmd = cachedToday.has(`${todayYmd}:T86`) ? todayYmd : null
  } else {
    const refreshT86Ymd =
      cachedToday.has(`${todayYmd}:T86`) && !(last?.t86?.frozen ?? false) ? todayYmd : undefined
    const series = await loadSeries(
      tickers.map((t) => t.ticker),
      now,
      { refreshT86Ymd },
    )
    seriesDataYmd = series.dataYmd
    historyDays = series.days.length
    const marginFallbackRows = await loadMarginFallback(
      series.dataYmd,
      series.marginDatedFailed || series.days.length === 0,
    )
    const borrow = await loadBorrow(todayYmd)
    borrowOk = borrow.resp !== null
    borrowDataDate = borrow.date
    marginOk = !series.marginDatedFailed

    const cachedAfter = await cachedDayDatasets([todayYmd])
    marginToday = cachedAfter.has(`${todayYmd}:MI_MARGN_D`)

    t86Today = series.dataYmd === todayYmd
    const t86Fp = t86FingerprintByYmd.get(todayYmd) ?? ''
    t86State = t86Today && t86Fp ? nextT86State(last?.t86 ?? null, t86Fp) : null

    const sig = runSignature({
      dataYmd: series.dataYmd,
      t86: t86Fp,
      margin: marginSigPart(series.marginYmds),
      borrow: borrow.date ?? '',
      tickers: tickers.map((t) => t.ticker),
    })
    runSig = sig
    regenerate = sig !== last?.runSig

    if (regenerate) {
      for (const { ticker, name } of tickers) {
        const data = assembleOne({ ticker, name, holding: null, series, marginFallbackRows, borrow })
        const okUp = await uploadJson(`${series.dataYmd}/${ticker}.json`, {
          ticker,
          dataDate: data.dataDate,
          generatedAt: data.generatedAt,
          data,
        })
        if (okUp) generated++
      }

      await uploadJson('manifest.json', {
        ymd: series.dataYmd,
        dataDate: dashDate(series.dataYmd),
        generatedAt: new Date().toISOString(),
      })
    }
  }

  if (regenerate && seriesDataYmd) {
    await pruneStorage(ymdMinusDays(seriesDataYmd, REPORT_RETAIN_DAYS))
    await pruneChipCache(ymdMinusDays(seriesDataYmd, CACHE_RETAIN_DAYS))
  }

  const holdingsScope = await evaluateTickerScope(personalList, seriesDataYmd)

  // Nightly observation row: chips phase owns the primary batch_run_log write.
  await logBatchRun({
    taipei_ymd: todayYmd,
    taipei_time: taipeiHhmm(now),
    runs_today: (last?.runsToday ?? 0) + 1,
    skipped: chipsSkipped,
    skip_reason: skipReason,
    data_ymd: seriesDataYmd,
    t86_today: t86Today || cachedToday.has(`${todayYmd}:T86`),
    t86_fingerprint: t86State?.fingerprint ?? last?.t86?.fingerprint ?? null,
    t86_revisions: t86State?.revisions ?? last?.t86?.revisions ?? 0,
    t86_unchanged: t86State?.unchanged ?? last?.t86?.unchanged ?? 0,
    t86_frozen: t86State?.frozen ?? last?.t86?.frozen ?? false,
    margin_ok: marginOk,
    margin_today: marginToday,
    borrow_ok: borrowOk,
    borrow_data_date: borrowDataDate,
    bwibbu_date: null,
    run_sig: runSig,
    regenerated: regenerate,
    history_days: historyDays,
    generated,
    daily_synced: 0,
    fundamental_synced: 0,
    revenue_backfilled: 0,
    profit_backfilled: 0,
    duration_ms: Date.now() - startedAt,
  })

  return {
    phase: 'chips',
    ok: true,
    ymd: seriesDataYmd,
    generated,
    regenerated: regenerate,
    chipsSkipped,
    skipReason,
    total: tickers.length,
    historyDays,
    t86Today,
    t86Revisions: t86State?.revisions ?? last?.t86?.revisions ?? 0,
    t86Frozen: t86State?.frozen ?? last?.t86?.frozen ?? false,
    scopes: {
      holdings: {
        total: holdingsScope.total,
        chipsReady: holdingsScope.chipsReady,
        fundReady: holdingsScope.fundReady,
        chipsComplete: holdingsScope.chipsComplete,
        fundComplete: holdingsScope.fundComplete,
        missingFund: holdingsScope.missingFund,
      },
    },
    durationMs: Date.now() - startedAt,
  }
}

async function runGeneratePhaseMarketData(): Promise<Record<string, unknown>> {
  const startedAt = Date.now()
  const tickers = await batchTwTickers()
  const personalList = tickers

  let seriesDataYmd: string | null = null
  let dailySynced = 0
  let dailySkipped = 0
  let fundamentalSynced = 0
  let fundamentalSkipped = 0
  let bwibbuDate: string | null = null

  if (tickers.length > 0) {
    const dataYmdForDaily = await warmDataYmd()
    if (dataYmdForDaily) {
      seriesDataYmd = dataYmdForDaily
      const daily = await syncDaily(tickers, dataYmdForDaily)
      dailySynced = daily.synced
      dailySkipped = daily.skipped
      const fundamental = await syncFundamental(tickers, dataYmdForDaily)
      fundamentalSynced = fundamental.synced
      fundamentalSkipped = fundamental.skipped
      bwibbuDate = fundamental.bwibbuDate
    }
  }

  const holdingsScope = await evaluateTickerScope(personalList, seriesDataYmd)

  return {
    phase: 'market-data',
    ok: true,
    ymd: seriesDataYmd,
    total: tickers.length,
    dailySynced,
    dailySkipped,
    fundamentalSynced,
    fundamentalSkipped,
    /** True when every ticker already had daily+fund for this data day (no Yahoo / no rewrite). */
    allCached: tickers.length > 0 && dailySynced === 0 && fundamentalSynced === 0,
    bwibbuDate,
    scopes: {
      holdings: {
        total: holdingsScope.total,
        chipsReady: holdingsScope.chipsReady,
        fundReady: holdingsScope.fundReady,
        chipsComplete: holdingsScope.chipsComplete,
        fundComplete: holdingsScope.fundComplete,
        missingFund: holdingsScope.missingFund,
      },
    },
    durationMs: Date.now() - startedAt,
  }
}

/**
 * One backfill round only (P1). Full REVENUE_MONTHS_CAP / PROFIT_QUARTERS_CAP
 * still needs multiple cron/admin rounds — same caps as before.
 */
async function runGeneratePhaseHistory(): Promise<Record<string, unknown>> {
  const startedAt = Date.now()
  const now = new Date()
  const tickers = await batchTwTickers()

  let revenueFilled = 0
  let revenueMonths: string[] = []
  let profitFilled = 0
  let profitQuarters: string[] = []

  if (tickers.length > 0) {
    const revenue = await backfillRevenue(tickers, now)
    revenueFilled = revenue.filled
    revenueMonths = revenue.months
    const profit = await backfillProfit(tickers, now)
    profitFilled = profit.filled
    profitQuarters = profit.quarters
  }

  return {
    phase: 'history',
    ok: true,
    total: tickers.length,
    revenueBackfilled: revenueFilled,
    revenueMonths,
    profitBackfilled: profitFilled,
    profitQuarters,
    monthsPerRun: MAX_BACKFILL_MONTHS,
    quartersPerRun: MAX_BACKFILL_QUARTERS,
    note: 'P1: one round only; repeat via cron/admin for full history',
    durationMs: Date.now() - startedAt,
  }
}

async function runGeneratePhase(phase: GeneratePhaseId): Promise<Record<string, unknown>> {
  switch (phase) {
    case 'chips':
      return runGeneratePhaseChips()
    case 'market-data':
      return runGeneratePhaseMarketData()
    case 'history':
      return runGeneratePhaseHistory()
  }
}

async function handleGeneratePhase(phase: GeneratePhaseId): Promise<Response> {
  try {
    const body = await runGeneratePhase(phase)
    return json(body)
  } catch (e) {
    return json(
      {
        ok: false,
        phase,
        error: e instanceof Error ? e.message : String(e),
      },
      500,
    )
  }
}

/**
 * Cron entry: run chips → market-data → history while wall budget remains.
 * Stops early with `phasesSkipped` rather than risking 546/504 on cloud.
 */
async function handleGenerateAll(): Promise<Response> {
  const startedAt = Date.now()
  const deadline = startedAt + GENERATE_ALL_BUDGET_MS
  const phasesDone: GeneratePhaseId[] = []
  const phasesSkipped: GeneratePhaseId[] = []
  const phaseResults: Partial<Record<GeneratePhaseId, Record<string, unknown>>> = {}

  for (const phase of GENERATE_PHASE_IDS) {
    const remaining = deadline - Date.now()
    if (remaining < GENERATE_ALL_PHASE_RESERVE_MS) {
      phasesSkipped.push(phase)
      continue
    }
    try {
      const result = await runGeneratePhase(phase)
      phaseResults[phase] = result
      phasesDone.push(phase)
    } catch (e) {
      return json(
        {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          failedPhase: phase,
          phasesDone,
          phasesSkipped: GENERATE_PHASE_IDS.filter((p) => !phasesDone.includes(p) && p !== phase),
          phaseResults,
          durationMs: Date.now() - startedAt,
          budgetMs: GENERATE_ALL_BUDGET_MS,
        },
        500,
      )
    }
  }

  // Prefer chips metrics for top-level fields (schedule UI / old consumers).
  const chips = phaseResults.chips ?? {}
  const market = phaseResults['market-data'] ?? {}
  const history = phaseResults.history ?? {}

  const holdingsScope = (market.scopes as { holdings?: unknown } | undefined)?.holdings
    ?? (chips.scopes as { holdings?: unknown } | undefined)?.holdings
    ?? null

  const reportComplete = Boolean(
    holdingsScope &&
      (holdingsScope as { chipsComplete?: boolean }).chipsComplete &&
      (holdingsScope as { fundComplete?: boolean }).fundComplete,
  )

  return json({
    ok: true,
    ymd: (market.ymd as string | null | undefined) ?? (chips.ymd as string | null | undefined) ?? null,
    generated: chips.generated ?? 0,
    regenerated: chips.regenerated ?? false,
    chipsSkipped: chips.chipsSkipped ?? false,
    skipReason: chips.skipReason ?? null,
    total: chips.total ?? market.total ?? history.total ?? 0,
    historyDays: chips.historyDays ?? 0,
    dailySynced: market.dailySynced ?? 0,
    fundamentalSynced: market.fundamentalSynced ?? 0,
    revenueBackfilled: history.revenueBackfilled ?? 0,
    revenueMonths: history.revenueMonths ?? [],
    profitBackfilled: history.profitBackfilled ?? 0,
    profitQuarters: history.profitQuarters ?? [],
    t86Today: chips.t86Today ?? false,
    t86Revisions: chips.t86Revisions ?? 0,
    t86Frozen: chips.t86Frozen ?? false,
    scopes: {
      holdings: holdingsScope,
    },
    reportComplete,
    phasesDone,
    phasesSkipped,
    phaseResults,
    budgetMs: GENERATE_ALL_BUDGET_MS,
    durationMs: Date.now() - startedAt,
  })
}

/**
 * Manually urge monthly revenue reimbursement. Do not touch chip reports or write batch_run_log ——
 * Each column of that table represents "one round of post-market batches", and inserting manual operations will contaminate the interpretation of "how many points of data are available."
 * The single upper limit is MAX_BACKFILL_MONTHS months, `months` reports the actual number of months that were supplemented this time;
 * Returning an empty array means it has been filled and there is no need to run again.
 */
/**
 * Manually urge a quarterly profitability replenishment. Same as `handleBackfillRevenue`:
 * Do not touch the chip report, do not write batch_run_log (each column of that table represents the batch after one round).
 * The single limit is MAX_BACKFILL_QUARTERS quarter; returning an empty array means it has been filled and there is no need to run again.
 */
async function handleBackfillProfit(): Promise<Response> {
  const startedAt = Date.now()
  const tickers = await batchTwTickers()
  const profit = await backfillProfit(tickers, new Date())
  return json({
    ok: true,
    total: tickers.length,
    filled: profit.filled,
    quarters: profit.quarters,
    quartersPerRun: MAX_BACKFILL_QUARTERS,
    durationMs: Date.now() - startedAt,
  })
}

async function handleBackfillRevenue(): Promise<Response> {
  const startedAt = Date.now()
  const tickers = await batchTwTickers()
  const revenue = await backfillRevenue(tickers, new Date())
  return json({
    ok: true,
    total: tickers.length,
    filled: revenue.filled,
    months: revenue.months,
    monthsPerRun: MAX_BACKFILL_MONTHS,
    durationMs: Date.now() - startedAt,
  })
}

/**
 * Manual or scheduled triggering of total warp synchronization.
 *
 * 0.6.5-dev.2 Detached from `generate-all`, the reason is **trigger timing** rather than code location:
 * The cron of the after-hours batch is the Taiwan stock schedule (every 15 minutes, UTC 8-15 hours, Monday to Friday),
 * The US data has nothing to do with the Taiwan stock trading day - it does not run at all on weekends.
 * More directly, the `decideSkip` short circuit of `handleGenerateAll` will return directly after all the data is received.
 * The entire section after it will not be executed.
 *
 * What is being dismantled is the cron job, not the function: `source-probe` already has "the same function, different actions,
 * "Different schedule" precedent, opening an additional Edge Function is just one more object to be deployed and audited.
 */
async function handleSyncMacro(): Promise<Response> {
  const startedAt = Date.now()
  const macro = await syncMacro(new Date())
  return json({
    ok: true,
    synced: macro.synced,
    // A single boolean cannot distinguish between "the content has not changed" and "not a single sequence can be caught". That was exactly when the bug was checked in 0.6.5
    // That leaves only macroSynced: false to see. reason is the only clue that can be interpreted after the fact
    reason: macro.reason,
    scan: macro.scan ?? null,
    count: macro.count,
    asOf: macro.asOf,
    durationMs: Date.now() - startedAt,
  })
}

/**
 * Independent scheduling entrance for total market volume and legal person transaction amount (0.6.28).
 *
 * **Why is it an independent action instead of hanging into generate-all**: Same as §9 macro-daily, §10 fx-daily
 * The same reason - the `decideSkip` short circuit of `handleGenerateAll` will return directly after the individual stock information is available.
 * The entire section after it will not be executed. This information has nothing to do with the individual stock list and should not be tied to the completion status of individual stocks.
 *
 * The shift starts after 15:30: the trading amounts of the three major legal persons are not announced until about 15:00–15:30.
 * If you run too early, you will only get an empty response on a "non-trading day", and then record that day as filled and never look back.
 * ——This is why `planInstitutionalBackfill` only checks "whether it has been added" and not "has it been asked":
 * If you haven’t made it up, ask again in the next round. It’s better to ask one more time than to miss a day permanently.
 */
async function handleSyncMarket(): Promise<Response> {
  const startedAt = Date.now()
  const market = await syncMarket(new Date())
  return json({
    ok: true,
    synced: market.synced,
    skipped: market.reason === 'skipped',
    reason: market.reason,
    days: market.days,
    institutionalFilled: market.institutionalFilled,
    asOf: market.asOf,
    durationMs: Date.now() - startedAt,
  })
}

/**
 * The data source of "Data Fetch Status" in the administrator's backend.
 *
 * Get everything you need from the entire page at once. The reason is that it will turn into more than a dozen round trips on the front end to type them one by one.
 * And some of them (cron schedule, observation table) the front end does not have permission to read at all——
 * `batch_run_log` / `source_probe_log` has RLS enabled but deliberately does not have any policy.
 * The `cron` schema is also not among PostgREST's exposed schemas.
 * Instead of loosening those defense lines for a read-only backend, it is better to let the service role be read here and then spit out.
 *
 * ⚠️ The returned content is selected, **does not contain any key**: the schedule only takes jobname/schedule/action/
 * Target ref (see `admin_schedule_status` in schema.sql §11 for a more complete description).
 */
async function handleAdminStatus(): Promise<Response> {
  const startedAt = Date.now()
  const now = new Date()
  const todayYmd = taipeiYmd(now)

  // Each paragraph is independent of each other. If any paragraph fails, the entire page should not be blank. The missing paragraph is represented by null:
  // The items that will be thrown (rpc / readLastRun / direct table lookup) are each linked to .catch(() => null),
  // downloadJson and latestChipSources/storageCoverage themselves swallow exceptions and return null.
  // Last ~2 Taipei calendar days for probe experiment (yyyyMMdd)
  const ymdDash = dashDate(todayYmd)
  const d0 = new Date(`${ymdDash}T12:00:00+08:00`)
  d0.setDate(d0.getDate() - 1)
  const yestYmd = taipeiYmd(d0)

  const [schedules, manifest, macro, fx, lastRun, probe, probeTicks, chip, coverage, market] =
    await Promise.all([
      db.rpc('admin_schedule_status').then((r) => r.data ?? null).catch(() => null),
      downloadJson<{ ymd?: string; dataDate?: string; generatedAt?: string }>('manifest.json'),
      downloadJson<MacroFile>('macro/us.json'),
      downloadJson<FxFile>('fx/twd.json'),
      readLastRun(todayYmd).catch(() => null),
      db
        .from('source_probe_log')
        .select(
          'taipei_ymd, taipei_time, bwibbu_ok, bwibbu_date, bwibbu_rows, borrow_ok, borrow_date, borrow_rows, probed_at',
        )
        .order('id', { ascending: false })
        .limit(1)
        .then((r) => r.data?.[0] ?? null)
        .catch(() => null),
      db
        .from('source_probe_tick')
        .select(
          'taipei_ymd, taipei_time, source, hit, ok, data_ymd, fingerprint, rows, note, duration_ms, probed_at',
        )
        .in('taipei_ymd', [todayYmd, yestYmd])
        .order('id', { ascending: true })
        .limit(2000)
        .then((r) => r.data ?? [])
        .catch(() => [] as unknown[]),
      latestChipSources(),
      storageCoverage(),
      downloadJson<MarketFile>('market/daily.json'),
    ])

  return json({
    ok: true,
    asOf: now.toISOString(),
    todayYmd,
    schedules,
    manifest,
    chip,
    coverage,
    macro: macro
      ? {
          asOf: macro.asOf,
          checkedAt: macro.checkedAt ?? null,
          indicators: (macro.indicators ?? []).map((i) => ({
            id: i.id,
            label: i.label,
            unit: i.unit,
            latest: i.latest,
            previous: i.previous,
            // Calculated by the backend, the frontend no longer prepares its own calendar (the two constants will drift sooner or later)
            nextRelease: nextReleaseFor(i.id, i.latest?.period ?? null, now),
          })),
        }
      : null,
    fx: fx ? { asOf: fx.asOf, count: fx.currencies?.length ?? 0 } : null,
    market: marketStatus(market),
    batch: lastRun,
    probe,
    /** 0.7.3 multi-source probe experiment (hit/miss per 5-min slot) */
    probeExperiment: {
      mode: 'probe-only',
      labels: PROBE_SOURCE_LABELS,
      order: PROBE_SOURCE_ORDER,
      ticks: Array.isArray(probeTicks) ? probeTicks : [],
    },
    durationMs: Date.now() - startedAt,
  })
}

/**
 * The crawling status of all market data (0.6.32).
 *
 * The three gaps are numbered separately because they represent different problems:
 * - `missingInstitutional`: No legal entity amount throughout the day. The latest one or two days are normal (announced only at 15:00, supplemented daily),
 *   But if even the old days are missing, it means that the replenishment schedule is not running.
 * - `missingBuySell`: There is a difference and no buying/selling. This is the replenishment progress bar of 0.6.32,
 *   It will be reset to zero every 5 days in each round; once it reaches zero, it should not be increased.
 * - `missingCandle`: The days when the opening high and low are missing and the day K cannot be drawn.
 *
 * There is no determination of "delay or not" here - the determination rules are all left in the front-end timeline.ts (pure function, with tests).
 * The backend just spits out facts. Sooner or later, both sides will be inconsistent.
 */
function marketStatus(m: MarketFile | null) {
  if (!m) return null
  const days = Array.isArray(m.days) ? m.days : []
  const withInst = days.filter((d) => d?.institutional)
  return {
    schema: m.schema ?? null,
    asOf: m.asOf ?? null,
    days: days.length,
    /** The latest trading day (regardless of whether there is a legal person amount)*/
    latestDate: days[days.length - 1]?.date ?? null,
    /** The latest trading day with legal person amount**. One or two days difference from the previous item is a normal compensation time difference.*/
    latestInstitutionalDate: withInst[withInst.length - 1]?.date ?? null,
    missingInstitutional: days.length - withInst.length,
    missingBuySell: withInst.filter((d) => !d.institutional?.buy).length,
    missingCandle: days.filter((d) => d?.taiexOpen == null).length,
  }
}

/**
 * The data dates and capture times of the three chip sources in the latest report.
 *
 * Just point the manifest to **any file** of that day - `sources` is shared by the entire batch (written in the same round of batches),
 * Not per-ticker information. Picking the first file is much cheaper than downloading all 18 files back.
 */
async function latestChipSources(): Promise<unknown> {
  const manifest = await downloadJson<{ ymd?: string }>('manifest.json')
  const ymd = manifest?.ymd
  if (!ymd) return null
  const { data } = await db.storage.from(REPORTS_BUCKET).list(ymd, { limit: 1 })
  const first = data?.[0]?.name
  if (!first) return null
  const rep = await downloadJson<{ dataDate?: string; sources?: unknown; notes?: unknown }>(
    `${ymd}/${first}`,
  )
  const inner = (rep as { data?: { dataDate?: string; sources?: unknown; notes?: unknown } })?.data ?? rep
  return inner ? { ymd, dataDate: inner.dataDate ?? null, sources: inner.sources ?? null } : null
}

/**
 * The number of files in each Storage directory is used to calculate "how many files are there among the 18 files."
 *
 * Just count the quantity, do not download the content - download 18 JSONs file by file just to see the timestamp.
 * This will change the endpoint from 2 seconds to more than ten seconds, and the only thing on the screen is the numerator and denominator.
 */
async function storageCoverage(): Promise<Record<string, number>> {
  const dirs = ['daily', 'fundamental']
  const out: Record<string, number> = {}
  await Promise.all(
    dirs.map(async (d) => {
      const { data } = await db.storage.from(REPORTS_BUCKET).list(d, { limit: 1000 })
      out[d] = (data ?? []).filter((f) => f.name.endsWith('.json')).length
    }),
  )
  try {
    out.held = (await heldTwTickers()).length
  } catch {
    out.held = 0
  }
  return out
}

/**
 * Account list in the management background (0.6.19).
 *
 * **Why you must use Edge Function**: `auth.users` is not in the exposed schemas of PostgREST.
 * The front end cannot find the user's JWT no matter how you look it up; there is no profiles table for the project to map.
 * Only service role can be read, so read it here and then spit it out.
 *
 * ⚠️ The returned content is selected: only id/email/creation time/recent activities/whether you are an administrator.
 * **Do not return the full text of `app_metadata` or `user_metadata` - there may be other fields in there,
 * Always forwarding it means making future additions public.
 *
 * ⚠️ **`lastActiveAt` takes `updated_at`, not `last_sign_in_at`** (0.6.20 fix).
 * `last_sign_in_at` is only updated when "really logging in again", and accounts that rely on refresh tokens to survive
 * It will always stop at a very old time - actual test official area: a certain account `last_sign_in_at` stopped at 08-02 17:17,
 * But the `auth.sessions.refreshed_at` for the same account is 08-04 12:53, so the screen looks broken.
 * `updated_at` will be updated along with the session (the difference between actual measurement and `refreshed_at` is 0.02 seconds),
 * Moreover, `listUsers()` already returns it, so there is no need to check `auth.sessions`.
 */
async function handleAdminUsers(): Promise<Response> {
  const startedAt = Date.now()
  // perPage upper limit 1000. The number of accounts in this project is single digits, and paging has no meaning for it.
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) return json({ error: error.message }, 500)
  const users = (data?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email ?? '',
    createdAt: u.created_at ?? null,
    lastActiveAt: u.updated_at ?? null,
    admin: (u.app_metadata as Record<string, unknown> | undefined)?.role === 'admin',
  }))
  // New accounts are listed first, and administrators usually look for "the one who just registered"
  users.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return json({ ok: true, users, durationMs: Date.now() - startedAt })
}

/**
 * Assign or revoke administrator privileges (0.6.19).
 *
 * What is written is `app_metadata.role`, which is the same field that `assertAdmin` and data table RLS interpret.
 * **Must write `app_metadata` instead of `user_metadata`** - the latter can be changed by the user.
 * Using it as a basis for permissions means that anyone can turn themselves into an administrator.
 *
 * ⚠️ **After the change is completed, the account will not take effect until you log in again**: The permissions are baked in the issued JWT.
 * The old token will still carry the old identity until it expires. The front end must write this thing on the screen,
 * Otherwise, it will be regarded as "no response after pressing".
 *
 * ⚠️ **You are not allowed to cancel your own administrator privileges**: This is the only operation that will lock people out——
 * You may be the only administrator left in the entire site. After the recovery, you will not even be able to enter the backend, so you can only go back to the SQL Editor and make manual changes.
 */
async function handleAdminSetRole(req: Request, body: GenerateReportRequestBody): Promise<Response> {
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!userId) return json({ error: 'userId is required' }, 400)
  const makeAdmin = body.admin === true

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  const caller = await db.auth.getUser(token)
  if (!makeAdmin && caller.data.user?.id === userId) {
    return json({ error: '不能取消自己的管理員權限' }, 400)
  }

  const { data: target, error: readErr } = await db.auth.admin.getUserById(userId)
  if (readErr || !target?.user) return json({ error: 'User not found' }, 404)

  // Integrate the existing app_metadata, do not overwrite the entire package - there are also Supabase's own fields such as provider.
  const meta = { ...(target.user.app_metadata as Record<string, unknown>) }
  if (makeAdmin) meta.role = 'admin'
  else delete meta.role

  const { error } = await db.auth.admin.updateUserById(userId, { app_metadata: meta })
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, userId, admin: makeAdmin })
}

/** Trigger exchange rate synchronization manually or on a schedule. The reason for dismantling the schedule is the same as handleSyncMacro (see above), which is triggered by `fx-daily`*/
async function handleSyncFx(): Promise<Response> {
  const startedAt = Date.now()
  const fx = await syncFx(new Date())
  return json({
    ok: true,
    synced: fx.synced,
    count: fx.count,
    asOf: fx.asOf,
    durationMs: Date.now() - startedAt,
  })
}

/**
 * Admin-run job ids (0.6.49): nightly split into three phases so each HTTP call
 * gets its own cloud compute budget; plus the other cron-backed actions.
 */
const ADMIN_RUN_JOBS = [
  'generate-chips',
  'generate-market-data',
  'generate-history',
  'sync-market',
  'sync-macro',
  'sync-fx',
  'probe',
] as const
type AdminRunJob = (typeof ADMIN_RUN_JOBS)[number]

/** cron.job.jobname for each admin-run action — must match what admin_schedule_status joins on. */
const ADMIN_RUN_JOBNAME: Record<AdminRunJob, string> = {
  // All three phases roll into the same schedule row as the nightly cron.
  'generate-chips': 'stock-report-nightly',
  'generate-market-data': 'stock-report-nightly',
  'generate-history': 'stock-report-nightly',
  'sync-market': 'market-daily',
  'sync-macro': 'macro-daily',
  'sync-fx': 'fx-daily',
  probe: 'source-probe',
}

function isAdminRunJob(v: string): v is AdminRunJob {
  return (ADMIN_RUN_JOBS as readonly string[]).includes(v)
}

/** Best-effort insert into admin_run_log so the schedule table sees manual runs. */
async function logAdminRun(row: {
  jobname: string
  action: string
  started_at: string
  finished_at: string
  ok: boolean
  http_status: number
  duration_ms: number
  triggered_by: string | null
}): Promise<void> {
  try {
    await db.from('admin_run_log').insert(row)
  } catch {
    // Must not fail the batch just because the observation table is missing or broken.
  }
}

/**
 * Admin console: run one or more of the same handlers that cron hits with x-cron-secret.
 *
 * Why not re-use CRON_SECRET from the browser: that secret is in every cron.job.command and in
 * the Edge env; shipping it to the SPA would make the secret public. assertAdmin is the gate
 * the rest of the console already uses.
 *
 * Jobs run **sequentially** so phases do not race market/macro writers for Storage
 * bandwidth. `all` is ADMIN_RUN_JOBS order (nightly phases first, probe last).
 * Prefer separate admin-run jobs (one HTTP each) from the SPA; this loop is for
 * rare multi-job payloads and still runs handlers in-process.
 */
async function handleAdminRun(
  req: Request,
  body: GenerateReportRequestBody,
): Promise<Response> {
  const denied = await assertAdmin(req)
  if (denied) return denied

  let jobs: AdminRunJob[]
  if (body.jobs === 'all' || body.job === 'all') {
    jobs = [...ADMIN_RUN_JOBS]
  } else {
    const raw: unknown[] = Array.isArray(body.jobs)
      ? body.jobs
      : typeof body.job === 'string'
        ? [body.job]
        : []
    jobs = []
    for (const item of raw) {
      if (typeof item !== 'string' || !isAdminRunJob(item)) {
        return json(
          {
            error: `未知的 job：${String(item)}。可用：${ADMIN_RUN_JOBS.join(', ')} 或 all`,
          },
          400,
        )
      }
      if (!jobs.includes(item)) jobs.push(item)
    }
    if (jobs.length === 0) {
      return json(
        { error: `jobs 必填。可用：${ADMIN_RUN_JOBS.join(', ')} 或 all` },
        400,
      )
    }
  }

  // Who pressed the button — for admin_run_log.triggered_by (observation only).
  let triggeredBy: string | null = null
  try {
    const auth = req.headers.get('Authorization') ?? ''
    const token = auth.replace(/^Bearer\s+/i, '').trim()
    if (token) {
      const { data } = await db.auth.getUser(token)
      triggeredBy = data.user?.id ?? null
    }
  } catch {
    triggeredBy = null
  }

  const started = Date.now()
  const results: Record<
    string,
    { httpStatus: number; durationMs: number; body: unknown }
  > = {}

  for (const job of jobs) {
    const t0 = Date.now()
    const startedAt = new Date(t0).toISOString()
    let httpStatus = 500
    let parsed: unknown = null
    try {
      let resp: Response
      switch (job) {
        case 'generate-chips':
          resp = await handleGeneratePhase('chips')
          break
        case 'generate-market-data':
          resp = await handleGeneratePhase('market-data')
          break
        case 'generate-history':
          resp = await handleGeneratePhase('history')
          break
        case 'sync-market':
          resp = await handleSyncMarket()
          break
        case 'sync-macro':
          resp = await handleSyncMacro()
          break
        case 'sync-fx':
          resp = await handleSyncFx()
          break
        case 'probe':
          resp = await handleProbe()
          break
      }
      httpStatus = resp.status
      try {
        parsed = await resp.clone().json()
      } catch {
        parsed = null
      }
    } catch (e) {
      httpStatus = 500
      parsed = { error: e instanceof Error ? e.message : String(e) }
    }
    const durationMs = Date.now() - t0
    const finishedAt = new Date().toISOString()
    const ok = httpStatus < 400
    results[job] = { httpStatus, durationMs, body: parsed }
    // Record under the cron jobname so the schedule table merges this into lastRun / runsToday.
    await logAdminRun({
      jobname: ADMIN_RUN_JOBNAME[job],
      action: job,
      started_at: startedAt,
      finished_at: finishedAt,
      ok,
      http_status: httpStatus,
      duration_ms: durationMs,
      triggered_by: triggeredBy,
    })
  }

  const failed = jobs.filter((j) => results[j].httpStatus >= 400)
  return json({
    ok: failed.length === 0,
    jobs,
    results,
    failed,
    durationMs: Date.now() - started,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  let body: GenerateReportRequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (body.action === 'generate') {
    return handleGenerate(req, body)
  }

  if (body.action === 'warm') {
    return handleWarm(req, body)
  }

  if (body.action === 'generate-all') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleGenerateAll()
  }

  // Single nightly phase (cron secret). Prefer admin-run from the console.
  if (
    body.action === 'generate-chips' ||
    body.action === 'generate-market-data' ||
    body.action === 'generate-history'
  ) {
    const denied = assertCronSecret(req)
    if (denied) return denied
    const phase: GeneratePhaseId =
      body.action === 'generate-chips'
        ? 'chips'
        : body.action === 'generate-market-data'
          ? 'market-data'
          : 'history'
    return handleGeneratePhase(phase)
  }

  // Monthly revenue history replenishment: can write Storage and send requests to MOPS, and the control is the same as generate-all.
  // The night batch will run smoothly. This entrance is for those who "don't want to wait for the schedule and need to fill it up now."
  if (body.action === 'backfill-revenue') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleBackfillRevenue()
  }

  if (body.action === 'backfill-profit') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleBackfillProfit()
  }

  // General synchronization: it can write Storage and send requests to FRED, and the control is the same as generate-all.
  // Triggered by independent cron job `macro-daily` (two shifts per day, see schema.sql)
  if (body.action === 'sync-macro') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleSyncMacro()
  }

  // Total market volume and legal person transaction amount (0.6.28): Can write Storage and make requests to TWSE, and check the same as generate-all.
  // Triggered by standalone cron job `market-daily` (see schema.sql §11)
  if (body.action === 'sync-market') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleSyncMarket()
  }

  // Exchange rate synchronization: can write Storage and make requests to Yahoo, and the control is the same as generate-all.
  // Triggered by independent cron job `fx-daily` (two shifts per day, see schema.sql §10)
  if (body.action === 'sync-fx') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleSyncFx()
  }

  // Data source probe: only read and not write (except for its own observation table), but still go CRON_SECRET ——
  // It will send a request to TWSE. Exposing the endpoint undefended is equivalent to giving away a proxy tool.
  if (body.action === 'probe') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleProbe()
  }

  // Administrator backend: read-only summary. Gatekeeping uses user JWT + app_metadata.role, not CRON_SECRET
  // (That key cannot enter the front end, see the description of assertAdmin)
  if (body.action === 'admin-status') {
    const denied = await assertAdmin(req)
    if (denied) return denied
    return handleAdminStatus()
  }

  if (body.action === 'admin-users') {
    const denied = await assertAdmin(req)
    if (denied) return denied
    return handleAdminUsers()
  }

  if (body.action === 'admin-set-role') {
    const denied = await assertAdmin(req)
    if (denied) return denied
    return handleAdminSetRole(req, body)
  }

  // Manual batch trigger from the admin console (0.6.44-dev.2).
  // Same work as the cron jobs, but auth is assertAdmin — never expose CRON_SECRET to the browser.
  if (body.action === 'admin-run') {
    return handleAdminRun(req, body)
  }

  return json({ error: 'Unknown action' }, 400)
})
