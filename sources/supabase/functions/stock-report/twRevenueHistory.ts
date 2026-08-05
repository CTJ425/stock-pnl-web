/**
 * Monthly revenue "historical month" capture and analysis (Public Information Observation Station t21sc03).
 *
 * Why this branch is needed: Current `openapi.twse.com.tw/v1/opendata/t187ap05_L` (see twFundamental.ts)
 * **Only the latest month is returned, the endpoint does not take the year and month parameters**. The original design was to let fundamental/{ticker}.json accumulate itself every month
 * (mergeRevenueMonths), the cost is that the new bid only has 1 transaction in the first month, and it takes a whole year to reach 12 transactions.
 * This module has the ability to "capture the entire market in a specified year and month", allowing the gap to be filled in one go.
 *
 * Data source (actual measurement confirmed 2026-07-28):
 *   https://mopsov.twse.com.tw/nas/t21/sii/t21sc03_{Republic of China Year}_{Month}_0.html Listed ~450KB
 *   https://mopsov.twse.com.tw/nas/t21/otc/t21sc03_{Republic of China Year}_{Month}_0.html Listed on the counter ~390KB
 *
 * Three traps that were stepped on during actual testing. Be sure to read them before making any changes:
 *  1. **host is `mopsov` not `mops`**. The same path to `mops.twse.com.tw` has returned 404.
 *  2. **The encoding is big5**, not UTF-8 (the meta in HTML is written). The crawler needs to use
 *     `new TextDecoder('big5')` solution, if read directly as UTF-8, the entire text will become garbled.
 *  3. The tag in the **annual growth rate box is capitalized `<Td nowrap>`** (this is true for both listings and over-the-counter listings. It is suspected to be a manual error in the watch production program).
 *     Cell comparisons are always case-insensitive, otherwise one column will be missed and all subsequent displacements will be lost.
 *
 * Layout (the listing is exactly the same as the one on the counter, the actual measurement is 991 / 860, the code numbers are all 4 digits and the two sides do not overlap):
 *   <tr align=right><td align=center>2330</td><td align=left>台積電</td>
 *     <td>Revenue for the current month</td><td>Revenue for the previous month</td><td>Revenue for the previous month</td>
 *     <td>Comparison of increase and decrease in the previous month (%)</td><Td>Increase and decrease in the same month last year (%)</td>
 *     <td>Cumulative revenue of the current month</td><td>Cumulative revenue of last year</td><td>Comparative increase or decrease in the previous period (%)</td>
 *     <td>Remarks</td></tr>
 * The "Total" column for each industry category uses `<th...>Total</th>` instead of `<td>`,
 * Based on the condition that "the first cell must be a 4-digit number", it will be automatically eliminated and no additional detection is required.
 *
 * It is parsed as a pure function and does not touch the Internet. Compare the division of labor of twChips.ts / twFundamental.ts (HTTP is in index.ts).
 */

import { normNum } from './twChips.ts'
import type { RevenueMonth } from './twFundamental.ts'

/** ⚠️ It’s mopsov not mops, see stall trap 1*/
export const MOPS_HOST = 'https://mopsov.twse.com.tw'

/** t21sc03 is listed in two copies, with the same layout and no overlapping code names.*/
export type MopsMarket = 'sii' | 'otc'

export const MOPS_MARKETS: readonly MopsMarket[] = ['sii', 'otc']

/**
 * 'YYYY-MM' → t21sc03 URL.
 * Year of the Republic of China = AD − 1911; **The month is not filled with zeros** (the actual measured January is `t21sc03_115_1_0.html`, not `115_01`).
 * If the year and month formats do not match, null will be returned, allowing the caller to skip it as "this month does not exist" instead of grabbing a URL that must be 404.
 */
export function mopsRevenueUrl(market: MopsMarket, yearMonth: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(yearMonth ?? '').trim())
  if (!m) return null
  const rocYear = Number(m[1]) - 1911
  const month = Number(m[2])
  if (rocYear < 1 || month < 1 || month > 12) return null
  return `${MOPS_HOST}/nas/t21/${market}/t21sc03_${rocYear}_${month}_0.html`
}

/** Cell content of a column (remove labels, remove , trim)*/
function cellsOf(row: string): string[] {
  const out: string[] = []
  // Tag names td/th are always case insensitive - see stall trap 3
  const re = /<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(row)) !== null) {
    out.push(
      m[2]
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .trim(),
    )
  }
  return out
}

/** Code name format: The actual company code of t21sc03 is all 4-digit numbers.*/
const MOPS_CODE_RE = /^\d{4}$/

/**
 * Single Month t21sc03 HTML → Map<Company Code, RevenueMonth>.
 *
 * Only the codes in the `wanted` set are taken - there are nearly 1900 companies in the whole market. It is a waste of CPU to fully analyze the 5 holdings.
 * The CPU quota of Edge Function is the most important line in this process.
 * Passing in an empty collection is equivalent to "requiring none" and will return an empty Map (not "requiring all").
 */
export function parseMopsRevenue(
  html: string,
  yearMonth: string,
  wanted: Set<string>,
): Map<string, RevenueMonth> {
  const found = new Map<string, RevenueMonth>()
  if (!html || wanted.size === 0) return found

  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let row: RegExpExecArray | null
  while ((row = rowRe.exec(html)) !== null) {
    const cells = cellsOf(row[1])
    // The data column has a fixed number of 11 cells; the industry heading column does not match the number or first cell of the "Total" column.
    if (cells.length < 10) continue
    const code = cells[0]
    if (!MOPS_CODE_RE.test(code)) continue
    if (!wanted.has(code) || found.has(code)) continue

    found.set(code, {
      yearMonth,
      // normNum already handles thousandth commas, and notes that common '-' will fall into Number.isFinite false → null
      revenueThousandTwd: normNum(cells[2]),
      momPercent: normNum(cells[5]),
      yoyPercent: normNum(cells[6]),
      cumulativeYoyPercent: normNum(cells[9]),
    })
  }
  return found
}

/** The replenishment progress of a single target*/
export interface RevenueProgress {
  /** The existing months in this file*/
  months: Set<string>
  /** The oldest **tried** month; null means it has never been backfilled. See FundamentalFile.revenueBackfilledThrough*/
  through: string | null
}

/**
 * Which months should I catch this round?
 *
 * The pure function is extracted because it is the only place where there is judgment in the entire backfill path (the rest are the glue of fetch / upload).
 * However, index.ts is tied to Deno and Supabase client and cannot run in the test environment of this project.
 *
 * **Key point: The gap is not "the month that is not in the file", but "the month that has not been found yet". **
 * The difference between the two is fatal for ETF - it is not in t21sc03, `months` is always empty,
 * If judged by the former, it will always pin the latest months on the to-be-caught list, and the entire batch of replenishment will be stuck.
 * The same month is re-captured in each round but cannot be filled in (a deadlock that was measured after deploying the test area in 0.6.4-dev.1).
 * So only months older than `through` are considered gaps - `through` has been searched for all the above,
 * No means no, no need to ask again.
 *
 * @param wantMonths target month (output of publishedMonths)
 * @param maxMonths single upper limit, see index.ts MAX_BACKFILL_MONTHS
 * @returns from new to old; an empty array means there is nothing more to find. The caller should directly short-circuit and not send any external requests.
 */
export function planRevenueBackfill(
  have: Map<string, RevenueProgress>,
  wantMonths: string[],
  maxMonths: number,
): string[] {
  if (have.size === 0 || maxMonths <= 0) return []
  const missing = new Set<string>()
  for (const { months, through } of have.values()) {
    for (const ym of wantMonths) {
      if (months.has(ym)) continue
      // through I have searched for the above (inclusive), but if I can’t find it, it means there is no information for this month.
      if (through && ym >= through) continue
      missing.add(ym)
    }
  }
  // Fill in from new to old: When the budget is used up, the gaps left are the oldest months, which have the lowest value to users.
  return [...missing].sort().reverse().slice(0, maxMonths)
}

/** `through` after this round of running: the old value and the month actually tried in this round, whichever is oldest*/
export function nextBackfilledThrough(
  prev: string | null | undefined,
  attempted: string[],
): string | null {
  const all = [...attempted, ...(prev ? [prev] : [])].filter(Boolean).sort()
  return all[0] ?? prev ?? null
}

/**
 * Count count **announced** months from "now" back, newest to oldest.
 *
 * Monthly revenue is required to be announced before the 10th of the following month, so only the previous month’s figures are guaranteed to be visible before the 10th of the current month.
 * If you grab a month that hasn't been announced yet, you'll get a 404 or an empty table - it's not bad, but it will be a waste of an external request every round.
 * So I'd rather be conservative.
 */
export function publishedMonths(now: Date, count: number): string[] {
  // Taipei time (UTC+8 fixed offset, no daylight savings in Taiwan), consistent with taipeiYmd's approach
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const year = taipei.getUTCFullYear()
  const month = taipei.getUTCMonth() + 1 // 1-12
  const day = taipei.getUTCDate()

  // The latest "announced" month: after the 10th is the previous month, before the 10th is the previous month
  let offset = day >= 10 ? 1 : 2
  const out: string[] = []
  for (let i = 0; i < count; i++, offset++) {
    const total = year * 12 + (month - 1) - offset
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    out.push(`${y}-${String(m).padStart(2, '0')}`)
  }
  return out
}
