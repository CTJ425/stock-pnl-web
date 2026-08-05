/**
 * Historical cover of quarterly profitability (MOPS consolidated income statement summary).
 *
 * ## Why is it needed?
 *
 * The `t187ap17_L` captured in batches every night is a snapshot of the current season, not a historical file - only 58 are returned in the actual test.
 * And there is only one season (Republic of China 115 Q2). So `profitQuarters` only grows one amount per quarter,
 * It would take three years to complete 12 seasons. This branch will replenish the past quarter at once, and the cost will be zero after the replenishment is completed.
 * (If the gap is empty, it will be returned directly without sending any external request), which has the same spirit as monthly revenue recovery.
 *
 * ## Data sources and traps (all actual measurements, 2026-08-04)
 *
 * `POST https://mopsov.twse.com.tw/mops/web/ajax_t163sb04`
 * body：`encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK={Market}&year={Republic of China Year}&season={01..04}`
 *
 * 1. ** is POST, not GET**, and it uses form encoding; the monthly revenue one t21sc03 is static GET, and they are different.
 * 2. **The encoding is UTF-8, not big5. ** t21sc03 is big5 (see twRevenueHistory header),
 *    This big5 solution will cause the whole copy to become garbled - it is especially easy to get confused when the two are put together for maintenance.
 * 3. **There are 7 tables and 6 industry-specific formats on one page** (30 columns for general industry, 22/23/18 columns for finance...),
 *    The field positions are completely different. Therefore, **always use header text to locate fields and do not hard-code indexes**.
 * 4. Response approximately 1.6 MB. It will be much smaller when the quarter is first declared (actually measured 115 Q2 is only 104 KB).
 *    That's normal, not a mistake.
 *
 * ## Algorithm and verification of ratio
 *
 * The four ratios are all "this item ÷ operating income × 100". **The answer has been checked with the official `t187ap17_L`**:
 * The four ratios of 1802 / 2303 / 2609 in the Republic of China 115 Q1 are all consistent bit by bit.
 * (Example: 1802 gross 19.23 / battalion 7.88 / front 6.44 / rear 5.71).
 *
 * ⚠️ **There is no concept of "gross profit" in the financial industry**, and the banking industry does not even have a single "operating income" column
 * (It is the two columns of net interest income + net profit and loss other than interest). If the item corresponding to the header cannot be found, null will be returned.
 * The screen displays "—". Forcing a denominator will only produce numbers that are not comparable to other industries.
 */

import { normNum } from './twChips.ts'
import type { ProfitQuarter } from './twFundamental.ts'

export const MOPS_T163_HOST = 'https://mopsov.twse.com.tw'
export const MOPS_T163_PATH = '/mops/web/ajax_t163sb04'

export type MopsMarket = 'sii' | 'otc'
export const T163_MARKETS: readonly MopsMarket[] = ['sii', 'otc']

/**
 * 'YYYY-Qn' → POST form string. If the year and quarter format does not match, null will be returned.
 * Let the caller skip it as if "this season does not exist" instead of making a request that is bound to fail.
 */
export function mopsProfitBody(market: MopsMarket, yearQuarter: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(yearQuarter ?? '').trim())
  if (!m) return null
  const rocYear = Number(m[1]) - 1911
  if (rocYear < 1) return null
  const season = `0${m[2]}`
  return `encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK=${market}&year=${rocYear}&season=${season}`
}

/* ── Header comparison ──────────────────────────────────────────
   同一個概念在不同產業別的表格裡叫不同名字，依序比對、取第一個命中的。
   順序有意義：先試最精確的名稱，再退到比較泛用的。
   ────────────────────────────────────────────────────────── */

/** Operating income (the denominator of the ratio). The banking industry does not have a single column, so it is not included - the entire industry group returns null*/
const H_REVENUE = ['營業收入', '淨收益', '收益', '收入']
const H_GROSS = ['營業毛利（毛損）淨額', '營業毛利（毛損）']
const H_OPERATING = ['營業利益（損失）', '營業利益']
const H_PRETAX = [
  '稅前淨利（淨損）',
  '繼續營業單位稅前淨利（淨損）',
  '繼續營業單位稅前純益（純損）',
  '繼續營業單位稅前損益',
]
const H_NET = ['本期淨利（淨損）', '本期稅後淨利（淨損）']
/**
 * Basic earnings per share (yuan). **Not a ratio, not divided by revenue** -- it's already an absolute amount per share.
 * Diluted EPS is not taken: What is comparable to the P/E ratio on the screen is basic EPS.
 */
const H_EPS = ['基本每股盈餘（元）', '基本每股盈餘', '基本每股盈餘(元)']

/** Go to tags, go to , trim. Tag names are case-insensitive (compare to twRevenueHistory's processing)*/
function cellsOf(row: string, tag: 'td' | 'th'): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(row)) !== null) {
    out.push(
      m[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .trim(),
    )
  }
  return out
}

/** Find the first hit field index in the header list; null is not returned (this industry does not have this concept)*/
function columnOf(headers: string[], names: readonly string[]): number | null {
  for (const n of names) {
    const i = headers.indexOf(n)
    if (i >= 0) return i
  }
  return null
}

/**
 * Parse one page of MOPS comprehensive income statement and return `Code → ProfitQuarter`.
 *
 * @param wanted Only keep these code names; the empty set represents the complete code (for testing)
 */
export function parseMopsProfit(
  html: string,
  yearQuarter: string,
  wanted: ReadonlySet<string>,
): Map<string, ProfitQuarter> {
  const out = new Map<string, ProfitQuarter>()
  const tables = String(html ?? '').match(/<table[^>]*>[\s\S]*?<\/table>/gi) ?? []

  for (const table of tables) {
    const headers = cellsOf(table, 'th')
    // The table used in the layout has no header, or the first column is not the company code - these are not the data tables we want.
    if (headers[0] !== '公司代號') continue

    const iRevenue = columnOf(headers, H_REVENUE)
    if (iRevenue === null) continue // 銀行業：沒有單一營收欄，整張表跳過
    const iGross = columnOf(headers, H_GROSS)
    const iOperating = columnOf(headers, H_OPERATING)
    const iPretax = columnOf(headers, H_PRETAX)
    const iNet = columnOf(headers, H_NET)
    const iEps = columnOf(headers, H_EPS)

    for (const row of table.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
      const cells = cellsOf(row, 'td')
      if (cells.length < headers.length) continue
      const ticker = cells[0]
      if (!/^\d{4,6}$/.test(ticker)) continue
      if (wanted.size > 0 && !wanted.has(ticker)) continue

      const revenue = normNum(cells[iRevenue])
      // The entire column is skipped when the denominator is 0 or missing: the calculated ratio will be Infinity or NaN, neither of which can be displayed.
      if (revenue === null || revenue === 0) continue

      const ratio = (i: number | null): number | null => {
        if (i === null) return null
        const v = normNum(cells[i])
        return v === null ? null : round2((v / revenue) * 100)
      }

      out.set(ticker, {
        yearQuarter,
        // The amount in this table is in thousand yuan, which is different from t187ap17_L's million yuan - save after conversion.
        // Otherwise, there will be two types of units mixed in the same column, and you can’t tell which one they are on the screen.
        revenueMillionTwd: round2(revenue / 1000),
        grossMarginPercent: ratio(iGross),
        operatingMarginPercent: ratio(iOperating),
        pretaxMarginPercent: ratio(iPretax),
        netMarginPercent: ratio(iNet),
        epsTwd: iEps === null ? null : normNum(cells[iEps]),
        // We've definitely seen this one: Even without the EPS column, there's no need to catch the same season again
        epsChecked: true,
      })
    }
  }
  return out
}

/** The ratio is taken to two decimal places, which is consistent with the accuracy of `t187ap17_L` (checked the answer, consistent bit by bit)*/
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export interface ProfitProgress {
  /** This season already exists*/
  quarters: Set<string>
  /**
   * I have, but haven't looked for the quarterly EPS** (0.6.28) in the quarterly report. There is no such gap for non-representation.
   *
   * Every night's `t187ap17_L` only gives four ratios, so the new season will be launched first with "with ratio and no EPS";
   * EPS is only available in the MOPS quarterly report, so it has to be supplemented by backfill.
   */
  needEps?: Set<string>
  /** The oldest **attempted** quarter; null means it has never been replenished*/
  through: string | null
}

/**
 * Which seasons should I catch this round?
 *
 * The judgment logic is exactly the same as `planRevenueBackfill`, and the reason is the same -
 * **The gap is not "Ji Bie that is not in the file", but "Ji Bie that has not been found yet". **
 * ETFs will never be on this list, and judging by the former will keep the latest quarters permanently on the to-be-caught list.
 * The entire batch of replenishment is stuck (0.6.4-dev.1 actually stepped on this deadlock in terms of monthly revenue).
 *
 * @returns from new to old; an empty array means there is nothing more to find. The caller should directly short-circuit and not send any requests.
 */
export function planProfitBackfill(
  have: Map<string, ProfitProgress>,
  wantQuarters: string[],
  maxQuarters: number,
): string[] {
  if (have.size === 0 || maxQuarters <= 0) return []
  const missing = new Set<string>()
  for (const { quarters, needEps, through } of have.values()) {
    for (const yq of wantQuarters) {
      /*
        EPS 缺口不受 `through` 限制（0.6.28）。
        through 記的是「比它更舊的都還沒問過」，而 EPS 缺口恰好出現在**最新**那幾季
        （夜間批次剛寫進來、還沒被回補碰過），正好在 through 的另一側 ——
        沿用同一條判斷的話，新一季的 EPS 永遠補不到。
        `epsChecked` 保證這不會變成無限重抓：問過一次就不再算缺口，即使那一季真的沒有 EPS。
      */
      if (needEps?.has(yq)) {
        missing.add(yq)
        continue
      }
      if (quarters.has(yq)) continue
      if (through && yq >= through) continue
      missing.add(yq)
    }
  }
  // Fill from new to old: The gaps left when the budget is exhausted are the oldest seasons, which have the lowest value to users.
  return [...missing].sort().reverse().slice(0, maxQuarters)
}

/** `through` after this round of running: the old value and the season actually tried in this round, whichever is the oldest*/
export function nextProfitThrough(
  prev: string | null | undefined,
  attempted: string[],
): string | null {
  const all = [...attempted, ...(prev ? [prev] : [])].filter(Boolean).sort()
  return all[0] ?? prev ?? null
}

/**
 * Count count **announced** seasons from "now" back, newest to oldest.
 *
 * Taiwan’s filing deadlines: Q1 → 5/15, Q2 → 8/14, Q3 → 11/14, Q4 (annual report) → 3/31 of the following year.
 * Here we always grab five days as a buffer - it won't hurt to grab a season that hasn't been announced yet (returning to an almost empty list),
 * But each round is a 1.6 MB request in vain.
 */
export function publishedQuarters(now: Date, count: number): string[] {
  // Taipei time (UTC+8 fixed offset, no daylight savings in Taiwan)
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const y = taipei.getUTCFullYear()
  const md = (taipei.getUTCMonth() + 1) * 100 + taipei.getUTCDate()

  // This year’s latest quarter “should have been announced”; it hasn’t even arrived yet and has been returned to last year’s Q4
  let latest: { y: number; q: number }
  if (md >= 1119) latest = { y, q: 3 }
  else if (md >= 819) latest = { y, q: 2 }
  else if (md >= 520) latest = { y, q: 1 }
  else if (md >= 405) latest = { y: y - 1, q: 4 }
  else latest = { y: y - 1, q: 3 }

  const out: string[] = []
  let { y: cy, q: cq } = latest
  for (let i = 0; i < Math.max(0, count); i++) {
    out.push(`${cy}-Q${cq}`)
    cq -= 1
    if (cq === 0) {
      cq = 4
      cy -= 1
    }
  }
  return out
}
