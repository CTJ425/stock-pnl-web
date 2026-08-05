/**
 * Capture and analyze TWSE fundamentals (valuation + monthly revenue + industry).
 *
 * Data source (actual measurement confirmed 2026-07-27, all are whole-market large stocks, no date parameters, single stocks are screened according to code names):
 * - Three valuation indicators: OpenAPI `exchangeReport/BWIBBU_ALL`
 *   English key {Date, Code, Name, PEratio, DividendYield, PBratio}, Date is Republic of China 7 code ('1150724').
 *   Losing stock PEratio is '' or '-' (normNum has been processed to null).
 * - Monthly revenue: OpenAPI `opendata/t187ap05_L`
 *   Chinese key; "data year and month" is the Republic of China 5 code ('11506'); the revenue unit is **thousand yuan**, and the increase or decrease rate is %;
 *   "Industry category" directly gives the Chinese name ('semiconductor industry').
 * - Basic company information: OpenAPI `opendata/t187ap03_L`
 *   "Industry" is a **two-digit code** ('24'), you need to check the INDUSTRY_NAMES comparison table.
 *
 * Industry source sequence: Chinese name of t187ap05_L (maintenance-free) → t187ap03_L code lookup table → original code.
 *
 * Unit trap: monthly revenue of 1,000 yuan, profit rate and increase or decrease rate %. Field names must always include units
 * (revenueThousandTwd / yoyPercent), following the twChips principle of "not letting units leave the slot".
 *
 * The parsing functions are all pure functions and do not touch the Internet, which is convenient for unit testing; HTTP crawling and caching are combined in index.ts.
 * The cabinet (TPEx) is not included in these three files. When checking for lack of materials, the caller will write a shortage note.
 */

import { normNum } from './twChips.ts'

export const BWIBBU_ALL_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL'
export const T187AP05_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'
export const T187AP03_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
/**
 * Profit analysis query summary table (starting from 0.6.5). Chinese key, Year of the Republic of China, only return to the latest season**, limited release,
 * Same family as t187ap05_L. Actual measurement on 2026-07-28: 1051 pens, 383KB.
 *
 * Choose it instead of the consolidated income statement `t187ap06_L_ci`: **ratios are officially calculated**
 * (Gross profit margin / operating profit rate / pre-tax net profit rate / after-tax net profit ratio), there is no need to parse five industry-specific profit and loss statements by yourself
 * Do the division again. PLAN.md §N2 The quarterly report was originally rejected on the grounds that "field parsing is cumbersome", but that reason does not hold true at this point.
 */
export const T187AP17_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap17_L'

/**
 * A structural version of the fundamental profile.
 * Front-end gatekeeping must use `>=` comparison (see src/services/fundamentalProxy.ts)——
 * Adding fields is a harmless addition to the old front-end. Using the equal sign will cause the entire paging to hang on the spot when the back-end is upgraded (0.4.1 incident).
 *
 * 2 = 0.6.5 Added `profitQuarters` (profitability ratios).
 */
export const FUNDAMENTAL_SCHEMA = 2

/** TWSE listed industry code → Chinese name (for t187ap03_L; t187ap05_L gives the name directly without looking up the table)*/
export const INDUSTRY_NAMES: Record<string, string> = {
  '01': '水泥工業',
  '02': '食品工業',
  '03': '塑膠工業',
  '04': '紡織纖維',
  '05': '電機機械',
  '06': '電器電纜',
  '08': '玻璃陶瓷',
  '09': '造紙工業',
  '10': '鋼鐵工業',
  '11': '橡膠工業',
  '12': '汽車工業',
  '14': '建材營造',
  '15': '航運業',
  '16': '觀光餐旅',
  '17': '金融保險',
  '18': '貿易百貨',
  '19': '綜合',
  '20': '其他',
  '21': '化學工業',
  '22': '生技醫療',
  '23': '油電燃氣',
  '24': '半導體業',
  '25': '電腦及週邊設備業',
  '26': '光電業',
  '27': '通信網路業',
  '28': '電子零組件業',
  '29': '電子通路業',
  '30': '資訊服務業',
  '31': '其他電子業',
}

/** Three indicators of valuation. Any missing value is represented by null (not pretended to be 0), and the loss-to-equity-to-earnings ratio is null.*/
export interface ValuationChip {
  peRatio: number | null
  dividendYieldPercent: number | null
  pbRatio: number | null
  /** The data date of the BWIBBU file is YYYY-MM-DD; if the parsing fails, it will be null*/
  dataDate: string | null
}

/** One month’s revenue. Enter the unit into the field name: Amount in thousand yuan, increase or decrease rate %*/
export interface RevenueMonth {
  /** 'YYYY-MM' */
  yearMonth: string
  revenueThousandTwd: number | null
  momPercent: number | null
  yoyPercent: number | null
  cumulativeYoyPercent: number | null
}

/**
 * Profitability ratio for one quarter. Units are always written into the field name (following twChips' principle of "not letting units leave the field").
 *
 * Name the Chinese field of t187ap17_L, and the user's usual way of speaking:
 *   Gross profit margin → grossMarginPercent "Gross profit margin (%)"
 *   Operating profit margin → operatingMarginPercent "Operating profit margin (%)"
 *   Net profit margin → pretaxMarginPercent "Net profit margin before tax (%)"
 *   Net profit margin after tax → netMarginPercent "Net profit margin after tax (%)"
 * The colloquial term "net profit margin" in Taiwan refers to both pre-tax and after-tax, so keep both, and write the name pre-tax/after-tax.
 * Do not use "net profit margin" as a field name that can be misunderstood.
 */
export interface ProfitQuarter {
  /** 'YYYY-Qn' */
  yearQuarter: string
  revenueMillionTwd: number | null
  grossMarginPercent: number | null
  operatingMarginPercent: number | null
  pretaxMarginPercent: number | null
  netMarginPercent: number | null
  /**
   * Basic earnings per share (yuan). Added in 0.6.28.
   *
   * **Only the MOPS quarterly report (recovery path) has this number** ——The nightly `t187ap17_L` is the profit and loss analysis table,
   * Only four ratios are given. Therefore, the new season will be implemented with `epsChecked: false` first and will be supplemented later.
   */
  epsTwd?: number | null
  /**
   * "We have already looked for EPS in the quarterly report."
   *
   * Need this flag instead of just looking at `epsTwd == null`: looked for it but there really is no EPS in that column,
   * and not found at all, both are null but the opposite is done - the former should not be caught again (otherwise every night
   * Grab the 1.6MB quarterly report once for free), the latter must be caught.
   */
  epsChecked?: boolean
}

/** The structure of fundamental/{ticker}.json in Storage*/
export interface FundamentalFile {
  schema: number
  ticker: string
  name: string
  /** The time we actually produced it ISO*/
  asOf: string
  /** The trading date of this batch is YYYY-MM-DD; the batch determines whether to rewrite based on this*/
  dataDate: string
  industry: string | null
  valuation: ValuationChip | null
  revenueUnit: '千元'
  /** From old to new, up to 12 months (self-accumulation in overwritten files)*/
  revenueMonths: RevenueMonth[]
  /**
   * History backfill "until which month has been found" (oldest **tried** month 'YYYY-MM').
   *
   * The reason for existence is to distinguish between two types of `revenueMonths`: missing moon: **not looking for it yet** vs **not even looking for it**.
   * Without this column, the ETF (not in t21sc03, which will never be filled) will fill the gap list
   * Always stick to the latest months, and real companies will never be able to get older information - 0.6.4-dev.1
   * For the dead knots actually measured after being deployed to the test area, see PROGRESS.md.
   *
   * If the old file does not have this column (undefined), it means that it has never been replenished, and it is regarded as all untried.
   */
  revenueBackfilledThrough?: string | null
  /**
   * The progress of quarterly profitability backfill has the same meaning as `revenueBackfilledThrough`:
   * "I've already looked for seasons newer than this one." ETFs rely on it to converge, otherwise the gap list would be stuck forever.
   *
   * If the old file does not have this column (undefined), it means that it has never been replenished, and it is regarded as all untried.
   */
  profitBackfilledThrough?: string | null
  /** The unit of profitability ratio. Same as revenueUnit: the unit does not leave the data*/
  profitUnit?: '%'
  /**
   * From oldest to newest, up to 12 seasons (= three years). Same as revenueMonths, which is "overwrite the self-accumulation in the file".
   *
   * t187ap17_L only goes back to the latest season, so it will take three years to fully grow - the same situation as the monthly revenue was at the beginning.
   * Backed by `twProfitHistory.ts` starting from 0.6.21 (`ajax_t163sb04` of MOPS, POST form, UTF-8),
   * The "Static URL 404, so no backfill" recorded at the time in 0.6.5 has been resolved by POST.
   * Old files without this column (undefined) are treated as empty arrays.
   */
  profitQuarters?: ProfitQuarter[]
  notes: string[]
}

/** Republic of China 7-code date '1150724' → '2026-07-24'; if the format does not match, return null*/
export function rocDate(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!/^\d{7}$/.test(s)) return null
  const year = Number(s.slice(0, 3)) + 1911
  return `${year}-${s.slice(3, 5)}-${s.slice(5, 7)}`
}

/** The year and month of the Republic of China 5 code '11506' → '2026-06'; if the format does not match, return null*/
export function rocYearMonth(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!/^\d{5}$/.test(s)) return null
  const year = Number(s.slice(0, 3)) + 1911
  return `${year}-${s.slice(3, 5)}`
}

/**
 * Republic of China year + quarter → 'YYYY-Qn'. Example: `'115'` + `'1'` → `'2026-Q1'`.
 * If either format does not match, null will be returned (only 1–4 are accepted).
 */
export function rocYearQuarter(year: unknown, quarter: unknown): string | null {
  const y = String(year ?? '').trim()
  const q = String(quarter ?? '').trim()
  if (!/^\d{2,3}$/.test(y) || !/^[1-4]$/.test(q)) return null
  return `${Number(y) + 1911}-Q${q}`
}

/** Get the estimate of a single code by BWIBBU_ALL. No return found*/
export function extractValuation(
  rows: Array<Record<string, string>> | null,
  ticker: string,
): ValuationChip | null {
  const row = (rows ?? []).find((r) => String(r.Code ?? '').trim() === ticker)
  if (!row) return null
  return {
    peRatio: normNum(row.PEratio),
    dividendYieldPercent: normNum(row.DividendYield),
    pbRatio: normNum(row.PBratio),
    dataDate: rocDate(row.Date),
  }
}

/** Get the latest monthly revenue of a single code number from t187ap05_L. If there is no check or the year and month parsing fails, null will be returned.*/
export function extractRevenue(
  rows: Array<Record<string, string>> | null,
  ticker: string,
): RevenueMonth | null {
  const row = (rows ?? []).find((r) => String(r['公司代號'] ?? '').trim() === ticker)
  if (!row) return null
  const yearMonth = rocYearMonth(row['資料年月'])
  if (!yearMonth) return null
  return {
    yearMonth,
    revenueThousandTwd: normNum(row['營業收入-當月營收']),
    momPercent: normNum(row['營業收入-上月比較增減(%)']),
    yoyPercent: normNum(row['營業收入-去年同月增減(%)']),
    cumulativeYoyPercent: normNum(row['累計營業收入-前期比較增減(%)']),
  }
}

/**
 * Get the latest quarter's profitability for a single ticker from t187ap17_L. If the search fails or the year and season analysis fails, null will be returned.
 *
 * The field name is explained in parentheses (for example: `Gross profit margin (%) (operating gross profit)/(operating income)`), which is the original endpoint.
 * Don't "organize it easily" - that is the key to look up the table. If you change it, you can't look it up.
 */
export function extractProfit(
  rows: Array<Record<string, string>> | null,
  ticker: string,
): ProfitQuarter | null {
  const row = (rows ?? []).find((r) => String(r['公司代號'] ?? '').trim() === ticker)
  if (!row) return null
  const yearQuarter = rocYearQuarter(row['年度'], row['季別'])
  if (!yearQuarter) return null
  return {
    yearQuarter,
    revenueMillionTwd: normNum(row['營業收入(百萬元)']),
    grossMarginPercent: normNum(row['毛利率(%)(營業毛利)/(營業收入)']),
    operatingMarginPercent: normNum(row['營業利益率(%)(營業利益)/(營業收入)']),
    pretaxMarginPercent: normNum(row['稅前純益率(%)(稅前純益)/(營業收入)']),
    netMarginPercent: normNum(row['稅後純益率(%)(稅後純益)/(營業收入)']),
    // There is no EPS in the profit analysis table. It is marked as "Not found yet" and is left to be supplemented in the quarterly report (see ProfitQuarter.epsChecked)
    epsTwd: null,
    epsChecked: false,
  }
}

/**
 * Industry category: t187ap05_L Chinese name is preferred, return t187ap03_L code lookup table, and then return the original code.
 * If both copies are found to be empty (over-the-counter stocks), null will be returned.
 */
export function extractIndustry(
  revenueRows: Array<Record<string, string>> | null,
  companyRows: Array<Record<string, string>> | null,
  ticker: string,
): string | null {
  const revRow = (revenueRows ?? []).find((r) => String(r['公司代號'] ?? '').trim() === ticker)
  const revName = String(revRow?.['產業別'] ?? '').trim()
  if (revName) return revName

  const compRow = (companyRows ?? []).find((r) => String(r['公司代號'] ?? '').trim() === ticker)
  const code = String(compRow?.['產業別'] ?? '').trim()
  if (!code) return null
  return INDUSTRY_NAMES[code] ?? code
}

/** revenueMonths upper limit. 12 months is enough to see the annual growth trend and control the payload size.*/
export const REVENUE_MONTHS_CAP = 12

/**
 * Set up fundamental/{ticker}.json to be written to Storage.
 *
 * The reason for deducting pure functions is actually stepped on: here is the **entirely reconstructed** object,
 * When 0.6.4-dev.2 added `revenueBackfilledThrough`, it was missed.
 * This means that the first round of batches on each trading day erases the replenishment progress and starts over again the next 12 months.
 * That bug is not visible in index.ts - it is neither covered by `tsc -b`
 * (Only src/ is accepted), and no tests can touch it. So the parts with judgment and field assembly are placed here.
 *
 * @param bwibbuLoaded Whether the valuation of the large tranche has been loaded in this round (not "whether this tranche has a valuation").
 *   Both will make valuation null, but only when the former is true can it be concluded that "this file is not covered".
 */
export function buildFundamentalFile(args: {
  ticker: string
  name: string
  dataDate: string
  asOf: string
  existing: FundamentalFile | null | undefined
  valuation: ValuationChip | null
  latestRevenue: RevenueMonth | null
  latestProfit: ProfitQuarter | null
  industry: string | null
  bwibbuLoaded: boolean
}): FundamentalFile {
  const { ticker, name, dataDate, asOf, existing, valuation, latestRevenue, industry } = args

  // Note points, see PLAN.md N6. **The amount of existing data must be taken into account** ——
  // After the OTC stocks are covered, they will have revenue but still no valuation, so the article "No fundamental information about the company can be found" can no longer be applied.
  // The same goes for profitability starting at 0.6.5: just because you didn’t catch it this round doesn’t mean you never did this round.
  const hasAnyHistory =
    (existing?.revenueMonths?.length ?? 0) > 0 || (existing?.profitQuarters?.length ?? 0) > 0
  const notes: string[] = []
  if (!valuation && !latestRevenue && !args.latestProfit && !industry && !hasAnyHistory) {
    // Neither ETFs nor listed stocks are included in these three TWSE filings (actually 0050 was found in all three).
    notes.push('查無公司基本面資料：ETF 與上櫃（TPEx）標的不在 TWSE 這三份資料中')
  } else if (!valuation && args.bwibbuLoaded) {
    notes.push('無估值資料：本益比等三項只涵蓋上市（TWSE）個股')
  }

  return {
    schema: FUNDAMENTAL_SCHEMA,
    ticker,
    name,
    asOf,
    dataDate,
    industry,
    valuation,
    revenueUnit: '千元',
    revenueMonths: mergeRevenueMonths(
      existing?.revenueMonths,
      latestRevenue ? [latestRevenue] : [],
    ),
    // ⚠️ During the entire reconstruction, every field "not determined by this input" must be explicitly brought over.
    //    Omissions are silent data loss. This column was missed once, see explanation above.
    revenueBackfilledThrough: existing?.revenueBackfilledThrough ?? null,
    // Same as above: 0.6.21 newly added progress recovery, missing the tape means erasing the progress every night and restarting the 12th season the next day.
    profitBackfilledThrough: existing?.profitBackfilledThrough ?? null,
    profitUnit: '%',
    profitQuarters: mergeProfitQuarters(
      existing?.profitQuarters,
      args.latestProfit ? [args.latestProfit] : [],
    ),
    notes,
  }
}

/**
 * Merge the new month into the existing sequence: remove duplicates by yearMonth, sort from old to new, cap 12.
 * The overwrite file relies on this to automatically accumulate monthly revenue history when it is rewritten every night (1 transaction in the first month, and increases to 12 transactions each month).
 *
 * `fillGapsOnly` determines who wins when the same month collides. The needs of the two callers are exactly opposite:
 * - **Latest month per night** (t187ap05_L, index.ts syncFundamental) overrides the default one.
 *   The monthly revenue will be corrected and reissued, and the correct one will be caught later.
 * - **History backfill** (MOPS t21sc03, index.ts backfillRevenue) requires `fillGapsOnly: true`.
 *   Backfilling is "filling the gap". If it is overwritten, an older crawl result will capture t187ap05_L
 *   After correction, the numbers will be covered up - filling in the history will contaminate the current situation, which is the most uneconomical exchange.
 */
export function mergeRevenueMonths(
  prev: RevenueMonth[] | null | undefined,
  incoming: RevenueMonth[] | null | undefined,
  opts: { fillGapsOnly?: boolean } = {},
): RevenueMonth[] {
  return mergePeriodSeries(prev, incoming, (m) => m.yearMonth, REVENUE_MONTHS_CAP, opts)
}

/**
 * profitQuarters upper limit. 12 seasons = three years, a complete business cycle can be seen.
 * Also aligned with the 12-month cap on revenueMonths.
 *
 * 0.6.21 Increased from 8 to 12: The nightly batch of `t187ap17_L` is a snapshot of the current season, and only one increase is made in a season.
 * It takes three years to accumulate it; and `twProfitHistory.ts` can be replenished in one go.
 * Eight seasons (two years) will start squeezing out 2025 data season by season after mid-2027.
 * One season's JSON is about 180 bytes, and 12 seasons is only 2 KB. There is no problem in terms of capacity.
 */
export const PROFIT_QUARTERS_CAP = 12

/**
 * Incorporate the new season into the existing sequence. The semantics are exactly the same as `mergeRevenueMonths`,
 * Just change the key to `yearQuarter` and the upper limit to 8.
 *
 * Currently there is only a "quarterly overwrite" caller (no history backfill), but `fillGapsOnly` is still retained -
 * Quarterly replenishment has just not been done yet, not that it will not be done (t187ap17_L will also only revert to the latest quarter).
 */
export function mergeProfitQuarters(
  prev: ProfitQuarter[] | null | undefined,
  incoming: ProfitQuarter[] | null | undefined,
  opts: { fillGapsOnly?: boolean } = {},
): ProfitQuarter[] {
  const merged = mergePeriodSeries(prev, incoming, (q) => q.yearQuarter, PROFIT_QUARTERS_CAP, opts)

  /*
    EPS is merged field by field rather than following the whole-record decision (0.6.28). It is the only field
    that **exists solely on the backfill path**, and a whole-record decision goes wrong in **both** directions:

    - `fillGapsOnly` (backfill): the existing quarter wins → the EPS the backfill just found is thrown away and
      can never land.
    - default overwrite (the nightly t187ap17_L): the new record has no EPS → every night wipes the EPS that was
      filled in.

    So the rule is the opposite of the ratios': **whoever consulted the quarterly report wins, whichever side of
    the merge they are on.**
  */
  const known = new Map<string, ProfitQuarter>()
  for (const q of [...(prev ?? []), ...(incoming ?? [])]) {
    if (q?.epsChecked) known.set(q.yearQuarter, q)
  }
  return merged.map((q) => {
    const src = known.get(q.yearQuarter)
    if (!src || q.epsChecked) return q
    return { ...q, epsTwd: src.epsTwd ?? null, epsChecked: true }
  })
}

/**
 * The above two share the same core: deduplication of keys by period, sorting from old to new, and cutting to cap.
 *
 * I extracted it because the rules of the two must always be consistent - if you write one copy for each,
 * On which day only one side is fixed (for example, "bad data is not mixed into the results" is only fixed on the monthly revenue side)
 * It will become two sets of behaviors, and this inconsistency is completely invisible from the calling end.
 *
 * The issue keys are all strings that can be compared in lexicographic order (`'2026-06'' / `'2026-Q1''), so the string size is directly compared.
 */
function mergePeriodSeries<T>(
  prev: T[] | null | undefined,
  incoming: T[] | null | undefined,
  keyOf: (item: T) => unknown,
  cap: number,
  opts: { fillGapsOnly?: boolean },
): T[] {
  const byKey = new Map<string, T>()
  const put = (item: T, skipExisting: boolean) => {
    if (!item) return
    const key = keyOf(item)
    if (typeof key !== 'string' || !key) return
    if (skipExisting && byKey.has(key)) return
    byKey.set(key, item)
  }
  for (const item of prev ?? []) put(item, false)
  for (const item of incoming ?? []) put(item, opts.fillGapsOnly === true)
  return [...byKey.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, item]) => item)
    .slice(-cap)
}
