/**
 * Per-user holdings aggregation and Discord card payload (Task 165 Phase 2).
 * Spec: docs/agent/specs/discord-holdings.md §2.3 / §2.4.
 */
import { computeLedger, estimateUnrealized, estimateUnrealizedShort, sellTaxRate, type Holding, type Ledger } from '../_shared/engine/pnlEngine.ts'
import type { Currency, Market, Transaction } from '../_shared/engine/models.ts'
import type { DiscordEmbed, DiscordPayload } from './discordWebhook.ts'
import type { HoldingQuote } from './holdingQuotes.ts'

// Re-stated from src/utils/fees.ts / src/utils/settings.ts (D6 keeps those files untouched;
// a drift test in edgeConstants.test.mjs asserts these stay equal to the web's exports).
export const DEFAULT_FEE_RATE = 0.001425
export const DEFAULT_MIN_FEE_WHOLE = 20
export const DEFAULT_MIN_FEE_ODD = 1

export interface WorkspaceInput {
  id: string
  fee_rate: number | null
  transactions: Transaction[]
}

export interface WorkspaceLedger {
  id: string
  feeRate: number
  ledger: Ledger
}

/** Same rule as `isValidFeeRate` in src/utils/feeSync.ts, re-stated because Edge cannot import src/. */
function isValidFeeRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1
}

/**
 * One ledger per workspace — never over the concatenated transactions, or a sell in one
 * workspace would consume a buy in another.
 */
export function buildLedgers(workspaces: WorkspaceInput[]): WorkspaceLedger[] {
  return workspaces.map((w) => ({
    id: w.id,
    feeRate: isValidFeeRate(w.fee_rate) ? w.fee_rate : DEFAULT_FEE_RATE,
    ledger: computeLedger(w.transactions),
  }))
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
}

export interface CurrencySummary {
  currency: Currency
  rows: HoldingRowOut[]
  marketValue: number | null
  cost: number
  unrealized: number | null
  unrealizedPct: number | null
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
      dayPnl,
    })
    return
  }
  existing.shares += shares
  existing.basis += basis
  existing.feeWeightSum += shares * legFeeRate
  existing.mktVal = existing.mktVal != null && mktVal != null ? existing.mktVal + mktVal : null
  existing.unrealized = existing.unrealized != null && unrealized != null ? existing.unrealized + unrealized : null
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
  const shortMarketValue = quotedShort.length === 0 ? null : sum(quotedShort.map((r) => r.mktVal as number))

  const dayPnlRows = rows.filter((r) => r.dayPnl != null)
  const dayPnl = dayPnlRows.length === 0 ? null : sum(dayPnlRows.map((r) => r.dayPnl as number))
  const dayDenom = sum(longRows.filter((r) => r.prevClose != null).map((r) => (r.prevClose as number) * r.shares))
  const dayPct = dayDenom === 0 || dayPnl == null ? null : (dayPnl / dayDenom) * 100

  const missingCount = rows.filter((r) => r.close == null).length
  const quoteYmds = rows.filter((r): r is HoldingRowOut & { quoteYmd: string } => r.quoteYmd != null).map((r) => r.quoteYmd)
  const newestQuoteYmd = quoteYmds.length === 0 ? null : quoteYmds.reduce((a, b) => (a > b ? a : b))

  return { currency, rows, marketValue, cost, unrealized, unrealizedPct, shortMarketValue, dayPnl, dayPct, realizedYtd, realizedToday, missingCount, newestQuoteYmd }
}

/**
 * Merges every workspace's holdings by position key + direction, quotes and all. No
 * currency conversion: TWD and USD are separate summaries.
 */
export function aggregateHoldings(ledgers: WorkspaceLedger[], quotes: Map<string, HoldingQuote | null>, ymd: string): HoldingsSummary {
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
        const unrealized = close != null ? estimateUnrealized(h, close, l.feeRate, minFee) : null
        const dayPnl = close != null && prevClose != null ? h.qty * (close - prevClose) : null
        mergeRow(map, h, 'LONG', h.qty, h.cost, close, prevClose, quoteYmd, mktVal, unrealized, dayPnl, l.feeRate)
      }
      if (h.shortQty > 0) {
        const minFee = minFeeFor(h.currency, h.shortQty)
        const mktVal = close != null ? close * h.shortQty : null
        const unrealized = close != null ? estimateUnrealizedShort(h, close, l.feeRate, minFee) : null
        const dayPnl = close != null && prevClose != null ? -h.shortQty * (close - prevClose) : null
        mergeRow(map, h, 'SHORT', h.shortQty, h.shortProceeds, close, prevClose, quoteYmd, mktVal, unrealized, dayPnl, l.feeRate)
      }
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

// ── payload ──────────────────────────────────────────────────────────────────────────

const RED = 0xe5484d
const GREEN = 0x30a46c
const GREY = 0x8b8d98
const WEEKDAY_CHARS = '日一二三四五六'
const BUDGET = 2800

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

/** `未實現合計 **<signed>**（<pct>）｜今日 <signed>` — spec Revision 8 §8.1. The percentage
 * parenthesis is omitted when unknown; an unknown amount prints `--` without bold. */
function totalLine(cur: CurrencySummary, decimals: number): string {
  const amt = cur.unrealized == null ? '--' : `**${fmtSigned(cur.unrealized, decimals)}**`
  const pct = cur.unrealizedPct == null ? '' : `（${pctSigned(cur.unrealizedPct)}）`
  const day = fmtSignedOrDash(cur.dayPnl, decimals)
  return `未實現合計 ${amt}${pct}｜今日 ${day}`
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
  return `**${label}**｜${qtyText(currency, r.shares)}｜均價 ${priceFmt(r.avgCost)}｜未實現 ${unrealizedText}`
}

/** Total line + blank line + one line per position, dropping whole positions from the end until
 * the description fits the 2,800-char budget (unchanged from earlier revisions). */
function buildDescription(total: string, rowText: string[]): string {
  let kept = rowText.length
  while (kept > 0) {
    const shown = rowText.slice(0, kept)
    const dropped = rowText.length - kept
    const body = dropped > 0 ? [...shown, `…另 ${dropped} 檔，完整明細請見網站`] : shown
    const desc = `${total}\n\n${body.join('\n')}`
    if (desc.length <= BUDGET || kept === 1) return desc
    kept--
  }
  return `${total}\n\n`
}

function footerText(missingCount: number): string {
  const base = '資料來源：Yahoo Finance｜以各工作區手續費率估算賣出成本'
  return missingCount > 0 ? `${base}｜${missingCount} 檔無報價，未計入合計` : base
}

function buildEmbed(cur: CurrencySummary, currency: Currency, ymd: string, generatedAt: string): DiscordEmbed {
  const decimals = currency === 'TWD' ? 0 : 2
  const title = currency === 'TWD' ? twdTitle(cur, ymd) : usdTitle(cur)
  const total = totalLine(cur, decimals)
  const rows = cur.rows.map((r) => rowLine(r, cur.newestQuoteYmd, currency, decimals))
  return {
    title,
    description: buildDescription(total, rows),
    color: colorFor(cur.unrealized, decimals),
    footer: { text: footerText(cur.missingCount) },
    timestamp: generatedAt,
  }
}

/** `null` when neither currency has a row to show — the caller logs `skipped / no-holdings`. */
export function buildHoldingsPayload(summary: HoldingsSummary, opts: { generatedAt: string; preview: boolean }): DiscordPayload | null {
  const embeds: DiscordEmbed[] = []
  if (summary.twd.rows.length > 0) embeds.push(buildEmbed(summary.twd, 'TWD', summary.ymd, opts.generatedAt))
  if (summary.usd.rows.length > 0) embeds.push(buildEmbed(summary.usd, 'USD', summary.ymd, opts.generatedAt))
  if (embeds.length === 0) return null

  const base = `📒 持股日報 ${titleDate(summary.ymd)}（${weekdayChar(summary.ymd)}）`
  return {
    username: '持股日報',
    content: opts.preview ? `【預覽】${base}` : base,
    allowed_mentions: { parse: [] },
    embeds,
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
