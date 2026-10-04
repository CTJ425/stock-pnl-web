/**
 * Per-user holdings aggregation and Discord card payload (Task 165 Phase 2).
 * Spec: docs/agent/specs/discord-holdings.md §2.3 / §2.4.
 */
import { computeLedger, estimateUnrealized, estimateUnrealizedShort, monthlyRebateCostUplift, sellTaxRate, type Holding, type Ledger } from '../_shared/engine/pnlEngine.ts'
import type { Currency, FeeRebate, FeeRounding, Market, SellFeeBasis, Transaction } from '../_shared/engine/models.ts'
import type { DiscordEmbed, DiscordPayload } from './discordWebhook.ts'
import type { HoldingQuote } from './holdingQuotes.ts'
import type { TwNames } from './twNames.ts'

// Re-stated from src/utils/fees.ts / src/utils/settings.ts (D6 keeps those files untouched;
// a drift test in edgeConstants.test.mjs asserts these stay equal to the web's exports).
export const DEFAULT_FEE_RATE = 0.001425
export const DEFAULT_MIN_FEE_WHOLE = 20
export const DEFAULT_MIN_FEE_ODD = 1

export interface WorkspaceInput {
  id: string
  /** Task 192: the card's section title. Absent / blank prints as 未命名工作區. */
  name?: string | null
  /** The rate before the first `fee_rate_history` segment; see `Workspace.fee_rate`. */
  fee_rate: number | null
  /** Ascending by `from`; see `FeeRateSegment` and `rateOn` below (Task 182). */
  fee_rate_history?: FeeRateSegment[] | null
  /** NULL / absent = 'instant' (現折), as on the dashboard. */
  fee_rebate?: FeeRebate | null
  /** NULL / absent = 'lot' (BUG-088), as on the dashboard. */
  fee_rounding?: FeeRounding | null
  /** NULL / absent = true (BUG-090), as on the dashboard: keeps the BUG-087 玉山 behaviour. */
  day_trade_tax_estimate?: boolean | null
  /** NULL / absent = the pre-Task-189 rule (`defaultSellFeeBasis`), as on the dashboard. */
  sell_fee_basis?: SellFeeBasis | null
  transactions: Transaction[]
}

/** 'list' = the TWD unrealized figure withholds the posted 0.1425% (a 月退 broker's app); 'net' = the workspace rate. */
export type PnlBasis = 'net' | 'list'

export interface WorkspaceLedger {
  id: string
  /** Task 192: from `WorkspaceInput.name`; hand-built test ledgers may leave it out. */
  name?: string
  feeRate: number
  rounding: FeeRounding
  basis: PnlBasis
  /** Task 189: the 券商 figure's cost carries the list-price buy fee (`listPriceCost`). */
  listCost: boolean
  /**
   * BUG-090: whether this workspace's broker estimates a lot bought today at the halved 現股當沖
   * tax. Per workspace, not per run — the two brokers in use disagree, so one run's `today` cannot
   * answer for all of them.
   */
  dayTradeTax: boolean
  ledger: Ledger
}

/** Same rule as `isValidFeeRate` in src/utils/feeSync.ts, re-stated because Edge cannot import src/. */
function isValidFeeRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1
}

/** One period of a workspace's fee rate; same shape as `FeeRateSegment` in src/types/models.ts. */
export interface FeeRateSegment {
  from: string
  rate: number
}

/**
 * Same rule as `rateOn` in src/utils/feeRateHistory.ts, re-stated because Edge cannot import src/
 * (a drift test in scripts/lib/edgeConstants.test.mjs compares the two implementations' answers).
 * The card reports what a sell made today would net, so its caller passes today's date — never a
 * lot's buy date.
 */
export function rateOn(
  history: FeeRateSegment[] | null | undefined,
  base: number | null | undefined,
  date: string,
  fallback: number,
): number {
  const baseRate = isValidFeeRate(base) ? base : fallback
  if (!Array.isArray(history) || history.length === 0) return baseRate
  let rate = baseRate
  for (const seg of history) {
    if (!seg || typeof seg.from !== 'string' || !isValidFeeRate(seg.rate) || seg.from > date) break
    rate = seg.rate
  }
  return rate
}

/**
 * One ledger per workspace — never over the concatenated transactions, or a sell in one
 * workspace would consume a buy in another.
 *
 * `today` (Task 182) is the run's Taipei calendar date, used to pick the fee rate in force now out
 * of the workspace's history. Omitted — as a hand-built test ledger leaves it — no segment has
 * started yet and the base `fee_rate` applies, which is the pre-Task-182 behaviour.
 */
export function buildLedgers(workspaces: WorkspaceInput[], today = ''): WorkspaceLedger[] {
  return workspaces.map((w) => {
    const feeRate = rateOn(w.fee_rate_history, w.fee_rate, today, DEFAULT_FEE_RATE)
    return {
      id: w.id,
      name: w.name ?? '',
      feeRate,
      rounding: w.fee_rounding === 'position' ? 'position' : 'lot',
      basis: pnlBasis(feeRate, w.fee_rebate, w.sell_fee_basis),
      listCost: listPriceCost(w.fee_rebate, w.sell_fee_basis),
      dayTradeTax: w.day_trade_tax_estimate ?? true,
      ledger: computeLedger(w.transactions),
    }
  })
}

/** Same rule as `listPriceCost` in src/utils/pnlBasis.ts, re-stated because Edge cannot import src/. */
export function listPriceCost(rebate: FeeRebate | null | undefined, sellFeeBasis: SellFeeBasis | null | undefined): boolean {
  return rebate === 'monthly' && sellFeeBasis != null
}

/** Same rule as `defaultSellFeeBasis` in src/utils/pnlBasis.ts, re-stated because Edge cannot import src/. */
export function defaultSellFeeBasis(feeRate: number, rebate: FeeRebate | null | undefined): PnlBasis {
  return rebate === 'monthly' && feeRate < DEFAULT_FEE_RATE ? 'list' : 'net'
}

/** Same rule as `pnlBasis` in src/utils/pnlBasis.ts, re-stated because Edge cannot import src/. */
export function pnlBasis(
  feeRate: number,
  rebate: FeeRebate | null | undefined,
  sellFeeBasis?: SellFeeBasis | null,
): PnlBasis {
  return sellFeeBasis ?? defaultSellFeeBasis(feeRate, rebate)
}

/** Every long or short key across every workspace, deduplicated. `ledger.holdings` is
 * already filtered to `qty > 0 || shortQty > 0`, so no further filtering is needed here. */
export function heldKeys(ledgers: WorkspaceLedger[]): Array<{ market: Market; ticker: string }> {
  const seen = new Map<string, { market: Market; ticker: string }>()
  for (const l of ledgers) {
    for (const h of l.ledger.holdings) {
      if (!seen.has(h.key)) seen.set(h.key, { market: h.market, ticker: h.ticker })
    }
  }
  return [...seen.values()]
}

export interface HoldingRowOut {
  key: string
  market: Market
  ticker: string
  name: string
  direction: 'LONG' | 'SHORT'
  shares: number
  basis: number
  close: number | null
  prevClose: number | null
  quoteYmd: string | null
  mktVal: number | null
  unrealized: number | null
  returnPct: number | null
  dayPnl: number | null
  dayPct: number | null
  avgCost: number
  breakEven: number | null
  realized: number
  /** 庫存總覽「券商」: unrealized at the posted 0.1425% rate, undiscounted (TWD only; USD null). */
  brokerUnrealized: number | null
}

export interface CurrencySummary {
  currency: Currency
  rows: HoldingRowOut[]
  marketValue: number | null
  cost: number
  unrealized: number | null
  unrealizedPct: number | null
  /** Σ quoted rows' `brokerUnrealized`; null for USD or when nothing is quoted. */
  brokerUnrealized: number | null
  shortMarketValue: number | null
  dayPnl: number | null
  dayPct: number | null
  realizedYtd: number
  realizedToday: number
  missingCount: number
  newestQuoteYmd: string | null
}

export interface HoldingsSummary {
  ymd: string
  twd: CurrencySummary
  usd: CurrencySummary
}

/** Task 192: one workspace's own summary, printed as its own section of the card. */
export interface WorkspaceSection {
  name: string
  summary: HoldingsSummary
}

/** Task 192: what the card prints — every workspace on its own, plus the merged total that the
 * headline line carries when there is more than one section. */
export interface HoldingsCard {
  ymd: string
  total: HoldingsSummary
  sections: WorkspaceSection[]
}

// ── aggregation ──────────────────────────────────────────────────────────────────────

/** Mutable accumulator for one (position key, direction) merged across workspaces. */
interface RowAcc {
  key: string
  market: Market
  ticker: string
  name: string
  direction: 'LONG' | 'SHORT'
  shares: number
  basis: number
  // Σ(leg shares × that leg's workspace fee rate); divided by `shares` to get the
  // share-weighted average fee rate a LONG row's break-even price is seeded from.
  feeWeightSum: number
  // Position.realized (cumulative, all years), attached once per key after the merge loop —
  // never accumulated leg by leg here.
  realized: number
  // Same key ⇒ same quote for every workspace holding it, so these are set once, from the
  // first leg seen, and never re-derived on merge.
  close: number | null
  prevClose: number | null
  quoteYmd: string | null
  mktVal: number | null
  unrealized: number | null
  brokerUnrealized: number | null
  dayPnl: number | null
}

function mergeRow(
  map: Map<string, RowAcc>,
  h: Holding,
  direction: 'LONG' | 'SHORT',
  shares: number,
  basis: number,
  close: number | null,
  prevClose: number | null,
  quoteYmd: string | null,
  mktVal: number | null,
  unrealized: number | null,
  brokerUnrealized: number | null,
  dayPnl: number | null,
  legFeeRate: number,
): void {
  const mapKey = `${h.key}:${direction}`
  const existing = map.get(mapKey)
  if (!existing) {
    map.set(mapKey, {
      key: h.key,
      market: h.market,
      ticker: h.ticker,
      name: h.name,
      direction,
      shares,
      basis,
      feeWeightSum: shares * legFeeRate,
      realized: 0,
      close,
      prevClose,
      quoteYmd,
      mktVal,
      unrealized,
      brokerUnrealized,
      dayPnl,
    })
    return
  }
  existing.shares += shares
  existing.basis += basis
  existing.feeWeightSum += shares * legFeeRate
  existing.mktVal = existing.mktVal != null && mktVal != null ? existing.mktVal + mktVal : null
  existing.unrealized = existing.unrealized != null && unrealized != null ? existing.unrealized + unrealized : null
  existing.brokerUnrealized =
    existing.brokerUnrealized != null && brokerUnrealized != null ? existing.brokerUnrealized + brokerUnrealized : null
  existing.dayPnl = existing.dayPnl != null && dayPnl != null ? existing.dayPnl + dayPnl : null
}

/** TWD whole-lot vs odd-lot minimum fee; USD has none. Applied per workspace leg, before merging. */
function minFeeFor(currency: Currency, legShares: number): number | undefined {
  if (currency !== 'TWD') return undefined
  return legShares >= 1000 ? DEFAULT_MIN_FEE_WHOLE : DEFAULT_MIN_FEE_ODD
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0)
}

/**
 * Lowest cent at which `estimateUnrealized` of a synthetic single-lot holding is ≥ 0 (spec
 * Revision 3: cannot drift from the 未實現 column since it reuses the same engine call). Seeds
 * from the closed form that inverts the linear fee/tax model, then walks up to the first cent
 * that passes and down while the cent below still passes, so floorSafe/minFee rounding can only
 * move the answer by a few cents either way.
 */
function computeBreakEven(ticker: string, market: Market, currency: Currency, shares: number, basis: number, feeRate: number): number | null {
  const avgCost = basis / shares
  const synthetic: Holding = {
    key: `${market}:${ticker}`,
    ticker,
    name: '',
    market,
    currency,
    // Task 166: dividends never enter a break-even price; the synthetic holding carries none.
    dividends: 0,
    qty: shares,
    cost: basis,
    rawCost: basis,
    buyCostTotal: basis,
    realized: 0,
    openLots: [],
    shortQty: 0,
    shortProceeds: 0,
    shortRawProceeds: 0,
    shortLots: [],
    avgCost,
    rawAvgCost: avgCost,
  }
  const minFee = minFeeFor(currency, shares)
  const passes = (cents: number): boolean => estimateUnrealized(synthetic, cents / 100, feeRate, minFee) >= 0

  const denom = 1 - feeRate - sellTaxRate(ticker)
  const seed = denom > 0 ? basis / (shares * denom) : avgCost
  let cents = Math.floor(seed * 100)
  let steps = 0
  // Cap: if 2,000 cents up never finds a passing price, refuse to return the last
  // (still non-breaking-even) cent as if it were the answer.
  while (!passes(cents) && steps < 2000) {
    cents++
    steps++
  }
  if (!passes(cents)) return null
  let downSteps = 0
  // Cap: mirrors the upward walk so a pathological fee/tax model can't loop forever.
  while (downSteps < 2000 && passes(cents - 1)) {
    cents--
    downSteps++
  }
  return cents / 100
}

/** Quoted LONG rows by mktVal desc, then unquoted LONG, then SHORT (quoted by mktVal desc,
 * then unquoted); ties by key ascending. */
function sortRows(rows: HoldingRowOut[]): HoldingRowOut[] {
  const bucket = (r: HoldingRowOut): 0 | 1 | 2 | 3 => {
    if (r.direction === 'LONG') return r.mktVal != null ? 0 : 1
    return r.mktVal != null ? 2 : 3
  }
  return [...rows].sort((a, b) => {
    const diff = bucket(a) - bucket(b)
    if (diff !== 0) return diff
    if ((bucket(a) === 0 || bucket(a) === 2) && a.mktVal != null && b.mktVal != null) {
      const mvDiff = b.mktVal - a.mktVal
      if (mvDiff !== 0) return mvDiff
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

function buildCurrencySummary(accs: RowAcc[], currency: Currency, realizedYtd: number, realizedToday: number): CurrencySummary {
  const rows = sortRows(
    accs.map((a) => ({
      key: a.key,
      market: a.market,
      ticker: a.ticker,
      name: a.name,
      direction: a.direction,
      shares: a.shares,
      basis: a.basis,
      close: a.close,
      prevClose: a.prevClose,
      quoteYmd: a.quoteYmd,
      mktVal: a.mktVal,
      unrealized: a.unrealized,
      returnPct: a.basis !== 0 && a.unrealized != null ? (a.unrealized / a.basis) * 100 : null,
      dayPnl: a.dayPnl,
      dayPct: a.close != null && a.prevClose != null && a.prevClose !== 0 ? ((a.close - a.prevClose) / a.prevClose) * 100 : null,
      avgCost: a.shares !== 0 ? a.basis / a.shares : 0,
      breakEven: a.direction === 'LONG' && a.shares > 0 ? computeBreakEven(a.ticker, a.market, currency, a.shares, a.basis, a.feeWeightSum / a.shares) : null,
      realized: a.realized,
      brokerUnrealized: a.brokerUnrealized,
    })),
  )

  const longRows = rows.filter((r) => r.direction === 'LONG')
  const quotedLong = longRows.filter((r) => r.mktVal != null)
  const quotedShort = rows.filter((r) => r.direction === 'SHORT' && r.mktVal != null)
  const quotedAll = rows.filter((r) => r.mktVal != null)

  const marketValue = longRows.length === 0 ? 0 : quotedLong.length === 0 ? null : sum(quotedLong.map((r) => r.mktVal as number))
  const cost = sum(quotedLong.map((r) => r.basis))
  const unrealized = quotedAll.length === 0 ? null : sum(quotedAll.map((r) => r.unrealized as number))
  const unrealizedPct = cost === 0 || unrealized == null ? null : (unrealized / cost) * 100
  const brokerUnrealized =
    currency !== 'TWD' || quotedAll.length === 0 ? null : sum(quotedAll.map((r) => r.brokerUnrealized as number))
  const shortMarketValue = quotedShort.length === 0 ? null : sum(quotedShort.map((r) => r.mktVal as number))

  const dayPnlRows = rows.filter((r) => r.dayPnl != null)
  const dayPnl = dayPnlRows.length === 0 ? null : sum(dayPnlRows.map((r) => r.dayPnl as number))
  const dayDenom = sum(longRows.filter((r) => r.prevClose != null).map((r) => (r.prevClose as number) * r.shares))
  const dayPct = dayDenom === 0 || dayPnl == null ? null : (dayPnl / dayDenom) * 100

  const missingCount = rows.filter((r) => r.close == null).length
  const quoteYmds = rows.filter((r): r is HoldingRowOut & { quoteYmd: string } => r.quoteYmd != null).map((r) => r.quoteYmd)
  const newestQuoteYmd = quoteYmds.length === 0 ? null : quoteYmds.reduce((a, b) => (a > b ? a : b))

  return { currency, rows, marketValue, cost, unrealized, unrealizedPct, brokerUnrealized, shortMarketValue, dayPnl, dayPct, realizedYtd, realizedToday, missingCount, newestQuoteYmd }
}

/**
 * Merges every workspace's holdings by position key + direction, quotes and all. No
 * currency conversion: TWD and USD are separate summaries.
 */
export function aggregateHoldings(
  ledgers: WorkspaceLedger[],
  quotes: Map<string, HoldingQuote | null>,
  ymd: string,
  /**
   * BUG-087: the run's Asia/Taipei **calendar** date, which is not always `ymd` — that one is the
   * market day, and on a weekend it points back at Friday. Only the 券商 figure uses it, to
   * withhold the halved 現股當沖 tax on a lot bought today the way the broker app does. Omitted
   * keeps every figure at the full rate.
   *
   * BUG-090: a workspace whose broker does not do this (`dayTradeTax: false`) ignores it, so this
   * argument is the run's date, not a decision — the decision is each ledger's own.
   */
  today?: string,
  /**
   * BUG-109: the exchanges' names for TW codes. A TW row is labelled with it, the transaction's own
   * name being the fallback for a code the lists do not carry. Omitted keeps the transaction names.
   */
  names?: TwNames,
): HoldingsSummary {
  const twdAcc = new Map<string, RowAcc>()
  const usdAcc = new Map<string, RowAcc>()
  // Position.realized is cumulative per key, not per leg, so it is summed here and attached
  // to the key's LONG row (or its SHORT row when there is no LONG row) after the merge loop.
  const realizedByKey = new Map<string, number>()

  for (const l of ledgers) {
    for (const h of l.ledger.holdings) {
      realizedByKey.set(h.key, (realizedByKey.get(h.key) ?? 0) + h.realized)

      const quote = quotes.get(h.key) ?? null
      const close = quote?.close ?? null
      const prevClose = quote?.prevClose ?? null
      const quoteYmd = quote?.ymd ?? null
      const map = h.currency === 'TWD' ? twdAcc : usdAcc

      if (h.qty > 0) {
        const minFee = minFeeFor(h.currency, h.qty)
        const mktVal = close != null ? close * h.qty : null
        // Task 182: `overrideFeeRate` is true for the same reason as src/utils/holdingRows.ts —
        // a sell made today is charged today's rate, not the rate each lot was bought under.
        const net = close != null ? estimateUnrealized(h, close, l.feeRate, minFee, true, l.rounding) : null
        // Same call as 庫存總覽's 券商 column (src/utils/holdingRows.ts): posted rate, lot rates overridden,
        // and under 月退 the list-price buy fee the app keeps in cost (Task 189).
        const uplift =
          l.listCost ? monthlyRebateCostUplift(h, DEFAULT_FEE_RATE, (q) => minFeeFor(h.currency, q)) : 0
        const brokerUnrealized =
          close != null && h.currency === 'TWD'
            ? Math.round(
                estimateUnrealized(h, close, DEFAULT_FEE_RATE, minFee, true, l.rounding, l.dayTradeTax ? today : undefined) -
                  uplift,
              )
            : null
        // Each workspace leg follows its own basis before merging (`rowUnrealized` in src/utils/pnlBasis.ts).
        const unrealized = l.basis === 'list' && brokerUnrealized != null ? brokerUnrealized : net
        const dayPnl = close != null && prevClose != null ? h.qty * (close - prevClose) : null
        mergeRow(map, h, 'LONG', h.qty, h.cost, close, prevClose, quoteYmd, mktVal, unrealized, brokerUnrealized, dayPnl, l.feeRate)
      }
      if (h.shortQty > 0) {
        const minFee = minFeeFor(h.currency, h.shortQty)
        const mktVal = close != null ? close * h.shortQty : null
        const net = close != null ? estimateUnrealizedShort(h, close, l.feeRate, minFee) : null
        const brokerUnrealized =
          close != null && h.currency === 'TWD' ? estimateUnrealizedShort(h, close, DEFAULT_FEE_RATE, minFee) : null
        const unrealized = l.basis === 'list' && brokerUnrealized != null ? brokerUnrealized : net
        const dayPnl = close != null && prevClose != null ? -h.shortQty * (close - prevClose) : null
        mergeRow(map, h, 'SHORT', h.shortQty, h.shortProceeds, close, prevClose, quoteYmd, mktVal, unrealized, brokerUnrealized, dayPnl, l.feeRate)
      }
    }
  }

  if (names) {
    for (const acc of twdAcc.values()) {
      if (acc.market === 'TPE') acc.name = names.get(acc.ticker.toUpperCase()) ?? acc.name
    }
  }

  for (const [key, total] of realizedByKey) {
    for (const map of [twdAcc, usdAcc]) {
      const long = map.get(`${key}:LONG`)
      if (long) {
        long.realized = total
        break
      }
      const short = map.get(`${key}:SHORT`)
      if (short) {
        short.realized = total
        break
      }
    }
  }

  const year = Number(ymd.slice(0, 4))
  let realizedTwd = 0
  let realizedUsd = 0
  let realizedTodayTwd = 0
  let realizedTodayUsd = 0
  for (const l of ledgers) {
    const y = l.ledger.yearly[year]
    realizedTwd += y?.realizedTw ?? 0
    realizedUsd += y?.realizedUs ?? 0
    if (!y) continue
    for (const yt of Object.values(y.tickers)) {
      for (const s of yt.sells) {
        if (s.date !== ymd) continue
        if (yt.currency === 'TWD') realizedTodayTwd += s.realized
        else realizedTodayUsd += s.realized
      }
    }
  }

  return {
    ymd,
    twd: buildCurrencySummary([...twdAcc.values()], 'TWD', realizedTwd, realizedTodayTwd),
    usd: buildCurrencySummary([...usdAcc.values()], 'USD', realizedUsd, realizedTodayUsd),
  }
}

/**
 * Task 192: `aggregateHoldings` once per workspace for the sections, and once over all of them for
 * the headline total. The engine is unchanged — a one-ledger call is exactly that workspace's card.
 */
export function aggregateCard(
  ledgers: WorkspaceLedger[],
  quotes: Map<string, HoldingQuote | null>,
  ymd: string,
  today?: string,
  names?: TwNames,
): HoldingsCard {
  return {
    ymd,
    total: aggregateHoldings(ledgers, quotes, ymd, today, names),
    sections: ledgers.map((l) => ({ name: l.name ?? '', summary: aggregateHoldings([l], quotes, ymd, today, names) })),
  }
}

// ── payload ──────────────────────────────────────────────────────────────────────────

const RED = 0xe5484d
const GREEN = 0x30a46c
const GREY = 0x8b8d98
const WEEKDAY_CHARS = '日一二三四五六'

// Task 166 (ED-06): Discord's hard cap on one payload's title + description + field name/values,
// summed across every embed — `discordSummary.ts` names the same number for the same reason.
const TOTAL_EMBED_LIMIT = 6000
// Headroom left per card for its title + footer text, outside the body budget below — both are
// short, fixed-shape strings (a date, a capped workspace name and a missing-quote count), so 200
// chars each is generous. Task 192: the remainder splits evenly between however many cards the
// message carries, and one card never gets more than the two-card share it had before.
const CARD_OVERHEAD = 200
const MAX_BUDGET = (TOTAL_EMBED_LIMIT - CARD_OVERHEAD * 2) / 2
// Discord's cap on embeds per message.
const EMBEDS_LIMIT = 10
// Task 192: a workspace name is user input; it is cut to this many characters in a card title.
const NAME_MAX = 40

function budgetFor(cards: number): number {
  return Math.min(MAX_BUDGET, Math.floor((TOTAL_EMBED_LIMIT - CARD_OVERHEAD * cards) / cards))
}

/** Markdown special characters escaped in data-derived text (stock names), spec Revision 8. */
function escapeMd(s: string): string {
  return s.replace(/[\\*_~|`]/g, '\\$&')
}

function signOf(n: number, decimals: number): '' | '+' | '-' {
  const rounded = Number(n.toFixed(decimals))
  if (rounded > 0) return '+'
  if (rounded < 0) return '-'
  return ''
}

function fmtAbs(n: number, decimals: number): string {
  return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtSigned(n: number, decimals: number): string {
  return signOf(n, decimals) + fmtAbs(n, decimals)
}

function fmtSignedOrDash(n: number | null, decimals: number): string {
  return n == null ? '--' : fmtSigned(n, decimals)
}

function pctSigned(n: number | null): string {
  return n == null ? '--' : `${fmtSigned(n, 2)}%`
}

/** Up to two decimals, trailing zeros trimmed, thousands separators — `toLocaleString` with a
 * `minimumFractionDigits` of 0 trims for us. */
function priceTwd(n: number | null): string {
  return n == null ? '--' : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function priceUsd(n: number | null): string {
  return n == null ? '--' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Up to four decimals, trailing zeros trimmed, thousands separators. */
function sharesStr(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

function titleDate(ymd: string): string {
  const [, m, d] = ymd.split('-')
  return `${m}/${d}`
}

function weekdayChar(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return WEEKDAY_CHARS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

function colorFor(unrealized: number | null, decimals: number): number {
  if (unrealized == null) return GREY
  const sign = signOf(unrealized, decimals)
  return sign === '+' ? RED : sign === '-' ? GREEN : GREY
}

function twdTitle(cur: CurrencySummary, ymd: string): string {
  if (cur.newestQuoteYmd == null) return '台股持股・無報價'
  if (cur.newestQuoteYmd < ymd) return `台股持股・⚠️ ${titleDate(cur.newestQuoteYmd)} 收盤・非今日`
  return `台股持股・${titleDate(cur.newestQuoteYmd)} 收盤`
}

function usdTitle(cur: CurrencySummary): string {
  if (cur.newestQuoteYmd == null) return '美股持股・無報價'
  return `美股持股・美東 ${titleDate(cur.newestQuoteYmd)} 收盤`
}

/** The 券商 figure is printed only when known and different from the net one once rounded —
 * the same rule 庫存總覽 uses, so a full-rate account never sees the same number twice. */
function brokerShown(broker: number | null, net: number | null, decimals: number): broker is number {
  return broker != null && (net == null || fmtSigned(broker, decimals) !== fmtSigned(net, decimals))
}

/** `未實現合計 **<signed>**（<pct>）｜券商 <signed>｜今日 <signed>` — spec Revision 8 §8.1. The
 * percentage parenthesis is omitted when unknown; an unknown amount prints `--` without bold. */
function totalLine(cur: CurrencySummary, decimals: number): string {
  const amt = cur.unrealized == null ? '--' : `**${fmtSigned(cur.unrealized, decimals)}**`
  const pct = cur.unrealizedPct == null ? '' : `（${pctSigned(cur.unrealizedPct)}）`
  const broker = brokerShown(cur.brokerUnrealized, cur.unrealized, decimals) ? `｜券商 ${fmtSigned(cur.brokerUnrealized!, decimals)}` : ''
  const day = fmtSignedOrDash(cur.dayPnl, decimals)
  return `未實現合計 ${amt}${pct}${broker}｜今日 ${day}`
}

/** TWD whole lots (`shares % 1000 === 0`) show as 張; everything else, and every USD row, as 股. */
function qtyText(currency: Currency, shares: number): string {
  if (currency === 'TWD' && shares % 1000 === 0) return `${sharesStr(shares / 1000)} 張`
  return `${sharesStr(shares)} 股`
}

/** One markdown line per position — spec Revision 8 §8.1, not truncated. */
function rowLine(r: HoldingRowOut, newestQuoteYmd: string | null, currency: Currency, decimals: number): string {
  const stale = r.quoteYmd != null && newestQuoteYmd != null && r.quoteYmd < newestQuoteYmd
  const rawLabel = `${stale ? '⚠️' : ''}${r.direction === 'SHORT' ? '空 ' : ''}${r.ticker} ${r.name}`
  const label = escapeMd(rawLabel)
  const priceFmt = currency === 'TWD' ? priceTwd : priceUsd
  const unrealizedText = r.unrealized == null ? '--' : `**${fmtSigned(r.unrealized, decimals)}**`
  const broker = brokerShown(r.brokerUnrealized, r.unrealized, decimals) ? `（券商 ${fmtSigned(r.brokerUnrealized!, decimals)}）` : ''
  return `**${label}**｜${qtyText(currency, r.shares)}｜均價 ${priceFmt(r.avgCost)}｜未實現 ${unrealizedText}${broker}`
}

/** Total line + blank line + one line per position, dropping whole positions from the end until
 * the description fits `budget` (2,800 chars for up to two cards, less with more — Task 192). */
function buildDescription(total: string, rowText: string[], budget: number): string {
  let kept = rowText.length
  while (kept > 0) {
    const shown = rowText.slice(0, kept)
    const dropped = rowText.length - kept
    const body = dropped > 0 ? [...shown, `…另 ${dropped} 檔，完整明細請見網站`] : shown
    const desc = `${total}\n\n${body.join('\n')}`
    if (desc.length <= budget || kept === 1) return desc
    kept--
  }
  return `${total}\n\n`
}

function footerText(missingCount: number, brokerLegend: boolean): string {
  let text = '資料來源：Yahoo Finance｜以各工作區手續費率估算賣出成本'
  if (missingCount > 0) text += `｜${missingCount} 檔無報價，未計入合計`
  if (brokerLegend) text += '｜券商＝牌告 0.1425% 未折讓'
  return text
}

/** Task 192: blank → 未命名工作區; longer than `NAME_MAX` → cut with an ellipsis; then escaped. */
function sectionName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '未命名工作區'
  const chars = [...trimmed]
  return escapeMd(chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join('')}…` : trimmed)
}

function buildEmbed(
  cur: CurrencySummary,
  currency: Currency,
  ymd: string,
  generatedAt: string,
  section: string,
  budget: number,
): DiscordEmbed {
  const decimals = currency === 'TWD' ? 0 : 2
  const title = `${section}｜${currency === 'TWD' ? twdTitle(cur, ymd) : usdTitle(cur)}`
  const total = totalLine(cur, decimals)
  const rows = cur.rows.map((r) => rowLine(r, cur.newestQuoteYmd, currency, decimals))
  const brokerLegend =
    brokerShown(cur.brokerUnrealized, cur.unrealized, decimals) ||
    cur.rows.some((r) => brokerShown(r.brokerUnrealized, r.unrealized, decimals))
  return {
    title,
    description: buildDescription(total, rows, budget),
    color: colorFor(cur.unrealized, decimals),
    footer: { text: footerText(cur.missingCount, brokerLegend) },
    timestamp: generatedAt,
  }
}

/**
 * Task 166 (ED-06) safety net: `buildDescription` already keeps each currency block within
 * `budgetFor(cards)`, and `budgetFor(n) * n <= TOTAL_EMBED_LIMIT` by construction, so this should
 * never fire in practice — but a future change to either constant must not be able to silently push
 * the cards' combined title + description + footer past what Discord accepts.
 */
function clampCurrencyBlocksTotal(embeds: DiscordEmbed[]): DiscordEmbed[] {
  const total = embeds.reduce((n, e) => n + e.title.length + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0), 0)
  const over = total - TOTAL_EMBED_LIMIT
  const last = embeds[embeds.length - 1]
  if (over <= 0 || !last?.description) return embeds
  const keep = Math.max(0, last.description.length - over)
  return embeds.map((e, i) => (i === embeds.length - 1 ? { ...e, description: e.description!.slice(0, keep) } : e))
}

function currenciesOf(summary: HoldingsSummary): Currency[] {
  const out: Currency[] = []
  if (summary.twd.rows.length > 0) out.push('TWD')
  if (summary.usd.rows.length > 0) out.push('USD')
  return out
}

/** Task 192 D2: `合計未實現 台股 **<signed>**（<pct>）｜美股 …` over every workspace, for a
 * message with more than one section; only the currencies that have rows. */
function grandTotalLine(total: HoldingsSummary): string {
  const parts = currenciesOf(total).map((c) => {
    const cur = c === 'TWD' ? total.twd : total.usd
    const decimals = c === 'TWD' ? 0 : 2
    const amt = cur.unrealized == null ? '--' : `**${fmtSigned(cur.unrealized, decimals)}**`
    const pct = cur.unrealizedPct == null ? '' : `（${pctSigned(cur.unrealizedPct)}）`
    return `${c === 'TWD' ? '台股' : '美股'} ${amt}${pct}`
  })
  return `合計未實現 ${parts.join('｜')}`
}

/**
 * Task 192: one card per workspace × currency that has rows, in workspace order, each titled with
 * the workspace name. More than `EMBEDS_LIMIT` cards: whole workspaces are kept while they fit in
 * nine, and the tenth card names how many were left out. `null` when no workspace has a row — the
 * caller logs `skipped / no-holdings`.
 */
export function buildHoldingsPayload(card: HoldingsCard, opts: { generatedAt: string; preview: boolean }): DiscordPayload | null {
  const sections = card.sections
    .map((s) => ({ name: sectionName(s.name), summary: s.summary, currencies: currenciesOf(s.summary) }))
    .filter((s) => s.currencies.length > 0)
  if (sections.length === 0) return null

  let shown = sections
  const all = sections.reduce((n, s) => n + s.currencies.length, 0)
  if (all > EMBEDS_LIMIT) {
    shown = []
    let used = 0
    for (const s of sections) {
      if (used + s.currencies.length > EMBEDS_LIMIT - 1) break
      shown.push(s)
      used += s.currencies.length
    }
  }
  const hidden = sections.length - shown.length
  const cards = shown.reduce((n, s) => n + s.currencies.length, 0) + (hidden > 0 ? 1 : 0)
  const budget = budgetFor(cards)

  const embeds: DiscordEmbed[] = []
  for (const s of shown) {
    for (const c of s.currencies) {
      const cur = c === 'TWD' ? s.summary.twd : s.summary.usd
      embeds.push(buildEmbed(cur, c, card.ymd, opts.generatedAt, s.name, budget))
    }
  }
  if (hidden > 0) {
    embeds.push({ title: `…另 ${hidden} 個工作區`, description: '完整明細請見網站', color: GREY, timestamp: opts.generatedAt })
  }

  const base = `📒 持股日報 ${titleDate(card.ymd)}（${weekdayChar(card.ymd)}）`
  const head = opts.preview ? `【預覽】${base}` : base
  return {
    username: '持股日報',
    content: sections.length > 1 ? `${head}\n${grandTotalLine(card.total)}` : head,
    allowed_mentions: { parse: [] },
    embeds: clampCurrencyBlocksTotal(embeds),
  }
}

/** Its own connection test — not `discordSummary.ts`'s `buildTestPayload`, whose text and
 * username describe the site-wide summary. */
export function buildHoldingsTestPayload(generatedAt: string): DiscordPayload {
  return {
    username: '持股日報',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: '🔔 Discord 連線測試',
        fields: [{ name: '狀態', value: '連線正常，持股日報會發送到這個頻道。', inline: false }],
        footer: { text: '資料來源：Yahoo Finance' },
        timestamp: generatedAt,
      },
    ],
  }
}
