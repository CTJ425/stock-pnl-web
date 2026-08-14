/**
 * The daily volume of Taiwan stocks **all markets** can match the trading amount of the three major legal entities (0.6.28).
 *
 * The difference with twChips is that the "scope" is not the "content": that chip is for a single stock, and this one is for the entire concentrated market.
 * total amount. The two cannot be mixed - the unit for buying and selling of individual stocks is **share**, and the unit for the whole market is **yuan** (amount).
 * Field names should always include units and follow the project guidelines.
 *
 * Two sources, with different reasons for choosing:
 *
 * 1. **Trading volume value**: `FMTQIK` (rwd version) with `date=YYYYMM01` will return **daily column** for the entire month,
 *    So history can be made up in one month at a time. The OpenAPI version only goes back to the latest one day, and it takes several months to update the history, so it is not used.
 * 2. **Trading amount of the three major legal persons**: `BFI82U` Only "single day" is the daily data (`type=month` returns the total of the whole month,
 *    not daily). Therefore, it requires one request per day and needs to be replenished in a budgetary manner like stock chips. It cannot be captured all at once.
 *
 * The date coverage range of the two is therefore inconsistent: the trading volume value will arrive first, and the legal person trading excess will be added day by day -
 * If `MarketDay.institutional` is null, it means "this day has not been filled yet", not "no legal person has entered or exited this day".
 */

/** Leave it open for a few trading days. About half a year, enough to see trends without making a single file of JSON too large (about 200 bytes per column per day)*/
export const MARKET_DAYS_CAP = 120

/** Each of the six units has an amount, and the units are all yuan. The three calibers of buying, selling, and buying and selling difference share this shape.*/
export interface MarketInstitutionalSide {
  /** Foreign capital and Mainland capital (excluding foreign self-operated operators)*/
  foreignTwd: number | null
  foreignDealerTwd: number | null
  trustTwd: number | null
  /** Proprietor (self-trading)*/
  dealerSelfTwd: number | null
  /** Proprietor (risk hedging)*/
  dealerHedgeTwd: number | null
  /** Officially disclosed total. **Not obtained by adding the first five items**, directly take the value of the endpoint*/
  totalTwd: number | null
}

/**
 * The amount of the three major legal persons. **The top six columns are the bid-ask difference** (positive means overbought, negative means oversold), maintaining the same position since 0.6.28.
 *
 * `buy` / `sell` are the buying and selling amounts added on 0.6.32 (BFI82U originally had these two columns, and previously only the difference was taken).
 * **These two items in the old data are null** - The days that were made up before 0.6.32 are only the difference, which can only be grown by making up for it day by day.
 * (See `planInstitutionalBackfill`). null means "it hasn't been caught yet", not "there was no trading that day".
 */
export interface MarketInstitutional extends MarketInstitutionalSide {
  buy: MarketInstitutionalSide | null
  sell: MarketInstitutionalSide | null
}

export interface MarketDay {
  /** 'YYYY-MM-DD' */
  date: string
  tradeVolumeShares: number | null
  tradeValueTwd: number | null
  transactions: number | null
  /** Volume-weighted stock price index (closing)*/
  taiex: number | null
  /** Price points*/
  changePoints: number | null
  /**
   * The opening high and low of the weighted index (0.6.30, used to draw K for the market day).
   *
   * **The source and the closing price are different**: FMTQIK only has the closing and rising and falling points, and the opening high and low must be in another direction.
   * `MI_5MINS_HIST` Take. Both are for one month at a time, so they are captured together in the same round, and then merged after they are captured.
   */
  taiexOpen: number | null
  taiexHigh: number | null
  taiexLow: number | null
  /** null=The legal person amount for this day has not been paid yet (see the stall description)*/
  institutional: MarketInstitutional | null
}

/** The structure of market/daily.json in Storage*/
export interface MarketFile {
  schema: number
  /** The time we actually produced it ISO*/
  asOf: string
  /** Oldest to newest, up to MARKET_DAYS_CAP*/
  days: MarketDay[]
}

/** 2: Legal person amount plus buy/sell (0.6.32). Front-end `MIN_MARKET_SCHEMA` still receives 1 - adding fields is not harmful to old readers*/
export const MARKET_SCHEMA = 2

/** Daily volume values ​​for the entire month. `date` is only meaningful for the year and month, and the day is fixed to 01*/
export function fmtqikMonthUrl(yyyymm: string): string | null {
  if (!/^\d{6}$/.test(yyyymm)) return null
  return `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${yyyymm}01&response=json`
}

/** The weighted index opened higher and closed lower throughout the month (0.6.30). `date` is the same as FMTQIK, only the year and month are meaningful*/
export function taiexHistMonthUrl(yyyymm: string): string | null {
  if (!/^\d{6}$/.test(yyyymm)) return null
  return `https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?date=${yyyymm}01&response=json`
}

/** The transaction amounts of the three major legal persons in a single day. **Only type=day is day by day** (see stall header)*/
export function bfi82uDayUrl(ymd: string): string | null {
  if (!/^\d{8}$/.test(ymd)) return null
  return `https://www.twse.com.tw/rwd/zh/fund/BFI82U?dayDate=${ymd}&type=day&response=json`
}

/** '1,234,567' → 1234567; '--' / empty string / non-number → null (do not use 0 to pretend to be a missing value)*/
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.replace(/,/g, '').trim()
  if (!s || !/^[+-]?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Republic of China '115/08/03' → AD '2026-08-03'; if the format does not match, return null*/
export function rocSlashDate(v: unknown): string | null {
  const m = String(v ?? '').match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/)
  if (!m) return null
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`
}

interface RwdTable {
  stat?: string
  fields?: string[]
  data?: unknown[][]
}

/**
 * Parsing FMTQIK's full month of responses.
 *
 * The field is positioned with **header text** instead of a hard-coded index. The reason is the same as twProfitHistory:
 * Misalignment during endpoint revision is much harder to spot than missing columns - the numbers are still there, but they all line up in the next column.
 */
export function parseFmtqik(json: unknown): MarketDay[] {
  const t = (json ?? {}) as RwdTable
  if (t.stat !== 'OK' || !Array.isArray(t.data) || !Array.isArray(t.fields)) return []
  const at = (name: string) => t.fields!.indexOf(name)
  const iDate = at('日期')
  const iVolume = at('成交股數')
  const iValue = at('成交金額')
  const iCount = at('成交筆數')
  const iIndex = at('發行量加權股價指數')
  const iChange = at('漲跌點數')
  if (iDate < 0) return []

  const out: MarketDay[] = []
  for (const row of t.data) {
    if (!Array.isArray(row)) continue
    const date = rocSlashDate(row[iDate])
    if (!date) continue
    out.push({
      date,
      tradeVolumeShares: iVolume < 0 ? null : num(row[iVolume]),
      tradeValueTwd: iValue < 0 ? null : num(row[iValue]),
      transactions: iCount < 0 ? null : num(row[iCount]),
      taiex: iIndex < 0 ? null : num(row[iIndex]),
      changePoints: iChange < 0 ? null : num(row[iChange]),
      taiexOpen: null,
      taiexHigh: null,
      taiexLow: null,
      institutional: null,
    })
  }
  return out
}

/**
 * Analyzing the full month response of MI_5MINS_HIST: the weighted index opened high and closed low (0.6.30).
 *
 * Only returns `date → open high and low`, deliberately not taking the closing price - FMTQIK already has that share,
 * Let both write in the same column once. One day they will be inconsistent and it will be impossible to tell which one is written.
 */
export function parseTaiexHist(json: unknown): Map<string, { open: number | null; high: number | null; low: number | null }> {
  const out = new Map<string, { open: number | null; high: number | null; low: number | null }>()
  const t = (json ?? {}) as RwdTable
  if (t.stat !== 'OK' || !Array.isArray(t.data) || !Array.isArray(t.fields)) return out
  const iDate = t.fields.indexOf('日期')
  const iOpen = t.fields.indexOf('開盤指數')
  const iHigh = t.fields.indexOf('最高指數')
  const iLow = t.fields.indexOf('最低指數')
  if (iDate < 0) return out

  for (const row of t.data) {
    if (!Array.isArray(row)) continue
    const date = rocSlashDate(row[iDate])
    if (!date) continue
    out.set(date, {
      open: iOpen < 0 ? null : num(row[iOpen]),
      high: iHigh < 0 ? null : num(row[iHigh]),
      low: iLow < 0 ? null : num(row[iLow]),
    })
  }
  return out
}

/**
 * Analyzing BFI82U’s single-day response. If there is no data (not on a trading day), null will be returned.
 *
 * Corresponding fields are represented by **unit name**, regardless of column order - the column order of this table has changed historically.
 * (The time when dealers split it into two columns: self-trading and hedging), the hard-coded index will be completely misaligned and look real.
 */
export function parseBfi82u(json: unknown): MarketInstitutional | null {
  const t = (json ?? {}) as RwdTable
  if (t.stat !== 'OK' || !Array.isArray(t.data) || !Array.isArray(t.fields)) return null
  const iName = t.fields.indexOf('單位名稱')
  const iNet = t.fields.indexOf('買賣差額')
  if (iName < 0 || iNet < 0) return null
  // Buy/Sell is taken at 0.6.32. Without these two columns, the endpoint still needs to be able to parse the difference - the difference is the lifeblood of the old picture
  const iBuy = t.fields.indexOf('買進金額')
  const iSell = t.fields.indexOf('賣出金額')

  const byName = new Map<string, { net: number | null; buy: number | null; sell: number | null }>()
  for (const row of t.data) {
    if (!Array.isArray(row)) continue
    const name = String(row[iName] ?? '').trim()
    if (!name) continue
    byName.set(name, {
      net: num(row[iNet]),
      buy: iBuy < 0 ? null : num(row[iBuy]),
      sell: iSell < 0 ? null : num(row[iSell]),
    })
  }
  if (byName.size === 0) return null

  /** The same group of unit names needs to be taken three times (difference/buy/sell), so the alias table is extracted and shared.*/
  const side = (of: 'net' | 'buy' | 'sell'): MarketInstitutionalSide => {
    const pick = (...names: string[]): number | null => {
      for (const n of names) {
        const v = byName.get(n)
        if (v !== undefined) return v[of]
      }
      return null
    }
    return {
      foreignTwd: pick('外資及陸資(不含外資自營商)', '外資及陸資'),
      foreignDealerTwd: pick('外資自營商'),
      trustTwd: pick('投信'),
      dealerSelfTwd: pick('自營商(自行買賣)', '自營商'),
      dealerHedgeTwd: pick('自營商(避險)'),
      totalTwd: pick('合計'),
    }
  }

  const buy = side('buy')
  const sell = side('sell')
  return {
    ...side('net'),
    // Give null if the whole group is not solved, instead of leaving an empty shell with six columns all null——
    // The replenishment judgment depends on "whether the buy is null". Empty shells will never retake that day.
    buy: buy.totalTwd === null ? null : buy,
    sell: sell.totalTwd === null ? null : sell,
  }
}

/**
 * Merge into a new date column: remove duplicates by date, from old to new, and cut to cap.
 *
 * **Existing values ​​will not be overwritten by a new copy without that item**: The coverage of the three sources is inherently out of sync——
 * The trading volume value will be re-captured throughout the month (without legal persons, without opening high and low), another branch will be opened for high and low, and one branch will be opened per day for legal persons.
 * If the entire transaction is overwritten, the completed legal person transaction will be washed out once every night——
 * It is the same problem and the same solution as EPS of mergeProfitQuarters.
 */
/**
 * And the legal person amount on the same day: the new whole group replaces the old one, but if `buy` / `sell` is missing, the old value is retained.
 *
 * Why keep it: If the endpoint does not spit out the buy/sell column temporarily when re-capturing one day, the entire set of overwrites will replace the completed ones.
 * The purchase and sale amount is washed to null, and it is put into covering again in the next round - an infinite loop of filling up and then losing, and losing and filling again.
 * This is the same principle as the function itself "the existing value will not be overwritten by a new copy without that item".
 */
export function mergeInstitutional(
  old: MarketInstitutional | null | undefined,
  next: MarketInstitutional | null | undefined,
): MarketInstitutional | null {
  if (!next) return old ?? null
  return {
    ...next,
    buy: next.buy ?? old?.buy ?? null,
    sell: next.sell ?? old?.sell ?? null,
  }
}

export function mergeMarketDays(
  prev: MarketDay[] | null | undefined,
  incoming: MarketDay[] | null | undefined,
  cap = MARKET_DAYS_CAP,
): MarketDay[] {
  const byDate = new Map<string, MarketDay>()
  for (const d of prev ?? []) if (d?.date) byDate.set(d.date, d)
  for (const d of incoming ?? []) {
    if (!d?.date) continue
    const old = byDate.get(d.date)
    byDate.set(d.date, {
      ...d,
      taiexOpen: d.taiexOpen ?? old?.taiexOpen ?? null,
      taiexHigh: d.taiexHigh ?? old?.taiexHigh ?? null,
      taiexLow: d.taiexLow ?? old?.taiexLow ?? null,
      institutional: mergeInstitutional(old?.institutional, d.institutional),
    })
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, d]) => d)
    .slice(-cap)
}

/**
 * Which days should the legal person amount be paid in this round (one request per day, so budget is required).
 *
 * From newer to older: The gap left when the budget is used up is the oldest days, which have the lowest value to users (the same as the consistent practice of backfilling).
 *
 * **"Missing" includes days with only difference and no buying amount** (0.6.32): Buying/selling is taken later,
 * 0.6.32 Only the difference was saved for the days made up before. If you still only look at `!institutional`, those days will never be recaptured,
 * Buys/Sells will stay at null until they are squeezed out by the cap - this means that this field will always be empty for historical data.
 * After changing to `buy`, the existing 120 days will be made up day by day according to the budget, and it will stop naturally after the make up.
 *
 * @returns 'YYYYMMDD', which can be fed directly to `bfi82uDayUrl`
 */
export function planInstitutionalBackfill(
  days: MarketDay[] | null | undefined,
  maxDays: number,
): string[] {
  if (maxDays <= 0) return []
  return (days ?? [])
    .filter((d) => d?.date && (!d.institutional || !d.institutional.buy))
    .map((d) => d.date.replace(/-/g, ''))
    .sort()
    .reverse()
    .slice(0, maxDays)
}

/**
 * True when the Taipei session day's market row is "frozen enough" that further market-daily
 * rounds should not hit TWSE (0.6.46-dev.9).
 *
 * Requires: day present, trade value, and institutional **buy** side (BFI82U with amounts).
 * History gaps for older days are not a reason to keep polling after today's session is done.
 *
 * @param sessionDate 'YYYY-MM-DD' (Taipei calendar day of the run)
 */
export function isMarketSessionReady(
  days: MarketDay[] | null | undefined,
  sessionDate: string,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return false
  const d = (days ?? []).find((x) => x?.date === sessionDate)
  if (!d) return false
  if (d.tradeValueTwd == null) return false
  if (!d.institutional?.buy) return false
  return true
}

/**
 * Which months to focus on: this month, plus **any months that are still missing a high or low** (0.6.30).
 *
 * Gap driven instead of just grabbing this month - the opening high and low was added at 0.6.30, and all the days saved before are gone.
 * And those months will never be touched again, and the K-lines will always only be the few of this month.
 * The situation is exactly the same as EPS (the existing data lacks a new field), so the same solution is used.
 *
 * The upper limit `maxMonths`: one request per month × two endpoints. If there is no limit, the first round will be for half a year.
 * From new to old, this function will only return to this month in each round after completion, and the cost will return to its original state.
 */
export function planMarketMonths(
  now: Date,
  have: MarketDay[] | null | undefined,
  maxMonths = 3,
): string[] {
  // The year and month in Taipei time (the batch is run in UTC, if you use UTC directly, the wrong month will be caught in the early morning of the first month)
  const taipei = new Date(now.getTime() + 8 * 3600 * 1000)
  const y = taipei.getUTCFullYear()
  const m = taipei.getUTCMonth() + 1
  const thisMonth = `${y}${String(m).padStart(2, '0')}`

  const months = new Set<string>([thisMonth])
  // When the file was still empty, I grabbed it together with the previous month, and the screen had a length from the beginning.
  if ((have?.length ?? 0) < 20) {
    const prev = new Date(Date.UTC(y, m - 2, 1))
    months.add(`${prev.getUTCFullYear()}${String(prev.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  for (const d of have ?? []) {
    /*
      ⚠️ `== null`, not `=== null`: days written before 0.6.30 **do not have this field at all**, so it reads
      back as undefined rather than null. Strict comparison would skip every old record —— measured exactly that:
      after deploying, the K chart had only this month's 2 candles and July's 22 days were never filled.
    */
    if (d?.date && d.taiexOpen == null) months.add(d.date.slice(0, 7).replace('-', ''))
  }
  return [...months].sort().reverse().slice(0, maxMonths)
}
