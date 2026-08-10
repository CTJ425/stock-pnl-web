/**
 * Capture and Analysis of U.S. Aggregate Economic Indicators (FRED).
 *
 * Why are these five items: What users want is "core CPI / core PPI / core non-agricultural employment / core PCE /
 * Core CCI/Core Consumer Confidence Index". The actual processing is as follows -
 *
 * - **"Core" only has a standard definition for CPI/PPI/PCE** (excluding food and energy), follow suit.
 * - **"Core non-agricultural employment" is not an existing concept**. What the market actually looks at is the **monthly increase in total non-farm employment**,
 *   Therefore, we adopt the monthly changes of `PAYEMS` and do not forcibly create a non-existent "core non-agricultural sector".
 * - **CCI and consumer confidence are the same thing**, and the only one that is free and still updated is the one from the University of Michigan.
 *   Conference Board's CCI is a paid resource; OECD version `CSCICP03USM665S` on FRED
 *   The actual measurement has been stopped (the last one is 2024-01). Therefore, they are combined into one item according to the user's decision.
 *
 * Data source (confirmed by actual measurement 2026-07-28):
 *   https://fred.stlouisfed.org/graph/fredgraph.csv?id={sequence}&cosd={starting day}
 *
 * Four practical measurement points:
 *  1. **No API key required**. FRED's REST API requires a key, but fredgraph's CSV export does not.
 *     This is why it was chosen over the official API: one less set of keys to keep.
 *  2. **Capture the original value without `transformation=pc1`**. The endpoint does support direct return to annual growth rate,
 *     However, the same original sequence can calculate the annual increase, monthly increase and exponential value at the same time, and the algorithm is a pure function and can be measured;
 *     If you leave it to the other party to convert, you have to capture each caliber once, and you lose the ability to check.
 *  3. **There will be null value columns** (for example: `1952-12,`). There are not observations every month in the early years.
 *     When parsing, "there is no value in this period" must be retained instead of skipping or padding with 0.
 *  4. **Cannot send twChips to the browser UA** (see `MACRO_UA`).
 *
 * Fetched by the Edge Function server side, it is not subject to browser CORS restrictions.
 * The analysis is a pure function and does not touch the network. Compare the division of labor of twChips.ts / twFundamental.ts.
 */

import { normNum } from './twChips.ts'
import { fingerprint } from './pollPlan.ts'

/**
 * Structured version of macro/us.json. Front-end gatekeeping uses `>=` (see src/services/macroProxy.ts).
 */
export const MACRO_SCHEMA = 1

/** The presentation caliber of the indicator. Determine how the `deriveIndicator` calculates the number to display from the original sequence*/
export type MacroKind = 'yoy' | 'momThousands' | 'index' | 'rate'

export interface MacroSeriesSpec {
  /** FRED serial code (upper bound for rate series)*/
  id: string
  /**
   * Optional second FRED id. Only used for `kind: 'rate'`: federal-funds target **lower** bound
   * (`DFEDTARL`) paired with `id` as upper (`DFEDTARU`).
   */
  idLow?: string
  label: string
  kind: MacroKind
  /** What is this indicator talking about? In plain English (it will be displayed directly on the screen)*/
  note: string
  /**
   * Months of history to pull from FRED. Monthly series use `MACRO_LOOKBACK_MONTHS`;
   * the FOMC target range needs a longer window so the last 12 *steps* (meetings) fit.
   */
  lookbackMonths?: number
}

/** Indicators. Order = screen order: three prices, FOMC rate, employment, confidence */
export const FRED_SERIES: readonly MacroSeriesSpec[] = [
  {
    id: 'CPILFESL',
    label: '核心 CPI',
    kind: 'yoy',
    note: '消費者物價，排除食品與能源後的年增率',
  },
  {
    id: 'PPIFES',
    label: '核心 PPI',
    kind: 'yoy',
    note: '生產者物價，排除食品與能源後的年增率',
  },
  {
    id: 'PCEPILFE',
    label: '核心 PCE',
    kind: 'yoy',
    note: '聯準會最看重的通膨指標，排除食品與能源',
  },
  {
    id: 'DFEDTARU',
    idLow: 'DFEDTARL',
    label: 'FOMC 目標利率',
    kind: 'rate',
    note: '每次 FOMC 會議的目標利率區間（含維持；非市場有效利率）',
    lookbackMonths: 60,
  },
  {
    id: 'PAYEMS',
    label: '非農就業 NFP',
    kind: 'momThousands',
    note: '非農業部門就業人數較上月增減（Nonfarm Payrolls）',
  },
  {
    id: 'UMCSENT',
    label: '消費者信心 UMCSENT',
    kind: 'index',
    note: '密西根大學消費者信心指數（U. of Michigan），數字越高越樂觀',
  },
]

/** Display units corresponding to each caliber. The unit does not leave the data (following twChips' guidelines)*/
export const MACRO_UNITS: Record<MacroKind, string> = {
  yoy: '%',
  momThousands: '千人',
  index: '指數',
  rate: '%',
}

/** Observations for one period. `value` is null, which means there is no data in that period (FRED will return an empty string)*/
export interface MacroPoint {
  /**
   * Monthly series: `'YYYY-MM'`. FOMC rate steps: `'YYYY-MM-DD'` (day the target range changed).
   */
  period: string
  value: number | null
  /** Lower bound of the target range; only set for `kind: 'rate'`. */
  valueLow?: number | null
}

export interface MacroIndicator {
  id: string
  label: string
  kind: MacroKind
  unit: string
  note: string
  /** The latest issue (converted to the caliber of kind); null if no data is available*/
  latest: MacroPoint | null
  /** The previous issue was used to see the direction. The same is the caliber after conversion.*/
  previous: MacroPoint | null
  /** From old to new, up to 12 issues, converted to kind caliber*/
  points: MacroPoint[]
}

/** The structure of macro/us.json in Storage. **Global single file, not per-ticker***/
export interface MacroFile {
  schema: number
  /**
   * **The time ISO when the data was last really changed** (not the time of the last execution).
   * It will not be moved when the content has not changed, so just because it is parked does not mean that the schedule is broken - that depends on `checkedAt`.
   */
  asOf: string
  /**
   * The last time I actually asked FRED for the time ISO. Separation from `asOf` is a fix in 0.6.11:
   * When the two are combined, "I asked about it today" and "I have new information today" are inseparable, which is the reason for a slow day.
   * The old file does not have this field, so it is optional.
   */
  checkedAt?: string
  /**
   * I have actually asked FRED several times today (Taipei Day). 0.6.15 enabled for adaptive scanning:
   * Scan intensively on the release day, but there must be an upper limit; it will automatically reset to zero across days (`ymd` will be recalculated if it is different).
   */
  scansToday?: { ymd: string; n: number }
  region: '美國'
  indicators: MacroIndicator[]
}

/**
 * True when the stored file is missing any series from the current catalog.
 * Used so decideMacroScan "satisfied" on an old 5-indicator file cannot skip forever
 * after FRED_SERIES grows (e.g. FOMC DFEDTARU in 0.6.44).
 */
export function macroCatalogIncomplete(
  existingIds: Iterable<string>,
  catalog: ReadonlyArray<{ id: string }> = FRED_SERIES,
): boolean {
  const have = new Set(existingIds)
  return catalog.some((s) => !have.has(s.id))
}

/** Show several trends*/
export const MACRO_POINTS = 12

/**
 * The annual growth rate needs to be based on the value 13 months ago, and the 12-period trend requires 24 months.
 * Add a month's buffer (the release gap of monthly data).
 */
export const MACRO_LOOKBACK_MONTHS = 26

/**
 * Open the FRED-specific User-Agent.
 *
 * ⚠️ **You cannot use the `UA`** of twChips.ts (that is the browser string, used by TWSE).
 * FRED's protection will directly reset the HTTP/2 connection for requests that claim to be a browser but are not.
 * (`INTERNAL_ERROR`, even the HTTP status code cannot be obtained), this is the first deployment of 0.6.5-dev.1
 * The entire batch cannot be caught, and the error is eaten by catch, leaving only `macroSynced: false` as a clue.
 *
 * Actual test (2026-07-28, tested twice each):
 *   ❌ `Mozilla/5.0 (Windows NT 10.0…Chrome/120…)` connection reset
 *   ❌ `stock-pnl-web/0.6.5`, `Deno`, empty UA as above
 *   ✅ `Deno/1.45.5`、`curl/8.5.0`、`python-requests/2.31.0`
 *   ✅ `stock-pnl-web (+https://github.com/CTJ425/stock-pnl-web)`
 *
 * Choose the last one: honestly stating who you are and attaching a contact address are the courtesy you should have for public information sources.
 * There is no need to bet on whether the format of Deno's default UA will change one day.
 */
export const MACRO_UA = 'stock-pnl-web (+https://github.com/CTJ425/stock-pnl-web)'

export function fredCsvUrl(id: string, since: string): string {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${since}`
}

/** Push back months months from "now" to YYYY-MM-01, for `cosd`*/
export function fredSinceDate(now: Date, months: number): string {
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - months
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}-01`
}

/**
 * FRED CSV → Sequence of observations from old to new.
 *
 * Format: The first column is the header (`observation_date,CPILFESL`), and each subsequent column is `YYYY-MM-DD,value`.
 * **Null value columns should be retained as `{ value: null }`** (actually measured UMCSENT had such columns as `1952-12,` in the early years)——
 * Skipping will cause the "previous period" to be misaligned, and adding 0 will cause the annual growth rate to be astronomical.
 */
export function parseFredCsv(csv: string): MacroPoint[] {
  const out: MacroPoint[] = []
  for (const line of String(csv ?? '').split(/\r?\n/)) {
    const m = /^(\d{4})-(\d{2})-\d{2}\s*,\s*(.*)$/.exec(line.trim())
    if (!m) continue // 表頭與空行
    out.push({ period: `${m[1]}-${m[2]}`, value: normNum(m[3]) })
  }
  return out
}

/**
 * Daily FRED series → points with full `YYYY-MM-DD` period (for FOMC target range).
 * Monthly series must keep using `parseFredCsv` (period = month).
 */
export function parseFredCsvDaily(csv: string): MacroPoint[] {
  const out: MacroPoint[] = []
  for (const line of String(csv ?? '').split(/\r?\n/)) {
    const m = /^(\d{4}-\d{2}-\d{2})\s*,\s*(.*)$/.exec(line.trim())
    if (!m) continue
    out.push({ period: m[1], value: normNum(m[2]) })
  }
  return out
}

/**
 * Merge upper + lower target series into **change-points only** (hike/cut days).
 *
 * Kept for unit tests. Production FOMC path uses `meetingRatePoints` so hold meetings
 * still appear (0.6.46-dev.2).
 */
export function collapseRateSteps(
  upper: readonly MacroPoint[],
  lower: readonly MacroPoint[],
): MacroPoint[] {
  const lowByDate = new Map<string, number | null>()
  for (const p of lower) lowByDate.set(p.period, p.value)

  const dates = new Set<string>()
  for (const p of upper) dates.add(p.period)
  for (const p of lower) dates.add(p.period)
  const sorted = [...dates].sort()

  const steps: MacroPoint[] = []
  let lastU: number | null = null
  let lastL: number | null = null
  const upByDate = new Map(upper.map((p) => [p.period, p.value]))

  for (const d of sorted) {
    const u = upByDate.has(d) ? upByDate.get(d)! : lastU
    const l = lowByDate.has(d) ? lowByDate.get(d)! : lastL
    if (u === null && l === null) continue
    if (u === lastU && l === lastL && steps.length > 0) continue
    // First row or a real change
    if (steps.length === 0 || u !== lastU || l !== lastL) {
      steps.push({
        period: d,
        value: u,
        valueLow: l,
      })
      lastU = u
      lastL = l
    }
  }
  return steps
}

/** 'YYYY-MM-DD' + N calendar days (UTC date arithmetic; FOMC periods are calendar dates). */
export function addUtcDays(ymd: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? '').trim())
  if (!m) return null
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`
}

function utcYmd(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}`
}

/**
 * One point per **FOMC meeting** (statement day), including holds.
 *
 * FRED `DFEDTARU/L` only *changes* on hike/cut days, so collapsing to steps hid every
 * hold meeting and left the UI stuck on the last move (e.g. 2025-12). Meeting dates come
 * from the official calendar (`RELEASE_CALENDAR.DFEDTARU`); levels still come from FRED.
 *
 * **Settle window**: FRED often updates the target the calendar day after the statement.
 * For meeting `M` we take the forward-filled range as-of `min(M + lookaheadDays, today)`.
 * `period` stays `M` (meeting day), not the FRED effective day.
 */
export function meetingRatePoints(
  upper: readonly MacroPoint[],
  lower: readonly MacroPoint[],
  meetingDates: readonly string[],
  now: Date,
  lookaheadDays = 3,
): MacroPoint[] {
  const upByDate = new Map<string, number | null>()
  for (const p of upper) upByDate.set(p.period, p.value)
  const lowByDate = new Map<string, number | null>()
  for (const p of lower) lowByDate.set(p.period, p.value)

  const allDates = [...new Set([...upByDate.keys(), ...lowByDate.keys()])].sort()
  if (allDates.length === 0) return []

  /** Forward-filled upper/lower as of `date` (last observation on or before that day). */
  function asOf(date: string): { u: number | null; l: number | null } {
    let u: number | null = null
    let l: number | null = null
    for (const d of allDates) {
      if (d > date) break
      if (upByDate.has(d)) u = upByDate.get(d) ?? null
      if (lowByDate.has(d)) l = lowByDate.get(d) ?? null
    }
    return { u, l }
  }

  const today = utcYmd(now)
  const meetings = [...new Set(meetingDates.map((d) => String(d ?? '').trim()))]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()

  const out: MacroPoint[] = []
  for (const M of meetings) {
    if (M > today) continue
    const settleRaw = addUtcDays(M, Math.max(0, lookaheadDays))
    if (!settleRaw) continue
    const settle = settleRaw > today ? today : settleRaw
    // Need some FRED history by settle day; skip meetings before the series starts.
    if (settle < allDates[0]) continue
    const { u, l } = asOf(settle)
    if (u === null && l === null) continue
    out.push({ period: M, value: u, valueLow: l })
  }
  return out
}

/**
 * Convert the original sequence to the caliber to be displayed by the indicator, and take the last MACRO_POINTS period.
 *
 * - `yoy`: Percentage compared to 12 months ago. If the base period has a missing value or is 0, the period is null (no hard calculation).
 * - `momThousands`: The difference from the previous issue (FRED’s PAYEMS was originally thousands).
 * - `index` / `rate`: The original value is copied (`rate` points should already be collapsed steps).
 *
 * Missing values ​​are always represented by null, and are not pretended to be 0 - "This month is 0" and "There is no data for this month"
 * Inflation and employment data are two very different things.
 */
export function deriveIndicator(spec: MacroSeriesSpec, raw: MacroPoint[]): MacroIndicator {
  const derived: MacroPoint[] = []
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i].value
    let value: number | null = null
    if (cur !== null) {
      if (spec.kind === 'index' || spec.kind === 'rate') {
        value = cur
      } else if (spec.kind === 'momThousands') {
        const prev = raw[i - 1]?.value
        if (prev !== null && prev !== undefined) value = round2(cur - prev)
      } else {
        const base = raw[i - 12]?.value
        if (base !== null && base !== undefined && base !== 0) {
          value = round2((cur / base - 1) * 100)
        }
      }
    }
    const point: MacroPoint = { period: raw[i].period, value }
    if (spec.kind === 'rate' && raw[i].valueLow !== undefined) {
      point.valueLow = raw[i].valueLow ?? null
    }
    derived.push(point)
  }

  // There may be a whole section at the end with no conversion result (the first 12 months of the sequence cannot calculate the annual increase), cut it off and then take the last N periods
  const usable = derived.filter((p) => p.value !== null).slice(-MACRO_POINTS)
  return {
    id: spec.id,
    label: spec.label,
    kind: spec.kind,
    unit: MACRO_UNITS[spec.kind],
    note: spec.note,
    latest: usable[usable.length - 1] ?? null,
    previous: usable[usable.length - 2] ?? null,
    points: usable,
  }
}

/** Two decimal places to avoid floating point tails (follow the approach of aiPayload)*/
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Content fingerprint of a set of metrics. `syncMacro` uses it to determine "whether the one captured this time is the same as the one in the file".
 *
 * **Why is it needed** (0.6.11 fix BUG-008): The original idempotent key is Taipei calendar day——
 * If you catch it today, skip it. But the purpose of macro-daily scheduling two shifts (13:00 / 15:00 UTC) is
 * "If the first shift fails to receive it, let the second shift make up for it", and when the first shift "successfully captures a piece of information that has not been updated",
 * Taipei's daily idempotence will cause the second shift not to send a request, so it will have to wait until the next day.
 * The core PCE on 2026-07-30 is just one day slower: BEA is released at 8:30 US Eastern, and FRED is imported even later.
 * The sequence caught at 13:00 is not as big as 2026-06.
 * After switching to content fingerprinting, "I asked about it today" and "I got something new today" can be distinguished.
 *
 * **To cover the entire period of points, not just the latest period**: FRED will go back and correct the historical value
 * (2026-04 and 2026-05 were changed at the same time in the 2026-07-30 vintage).
 * If only compared to latest, "the latest issue has not changed but previous issues have been revised" will be judged as unchanged and will never be updated.
 *
 * **Sort first**: Follow the lesson of `pollPlan.ts` - the order of sources is not guaranteed to be stable.
 * Directly counting fingerprints on the entire package will misjudge "the order has changed" as "the content has changed", making the comparison permanently invalid.
 * Here `parts` starts with `id`, and sorting `parts` is equivalent to sorting by `id`.
 */
export function macroFingerprint(indicators: readonly MacroIndicator[]): string {
  const parts = indicators
    .map((i) =>
      `${i.id}|${i.points
        .map((p) => {
          const low =
            p.valueLow !== undefined && p.valueLow !== null ? `/${p.valueLow}` : p.valueLow === null ? '/null' : ''
          return `${p.period}=${p.value ?? ''}${low}`
        })
        .join(',')}`,
    )
    .sort()
  return fingerprint(parts)
}
