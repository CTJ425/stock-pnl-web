/**
 * What the 類股資金流向 card shows, worked out from the file: which days, which investor group,
 * the sorted rows with their semiconductor children, and the plain-language summary.
 * Kept apart from the component so the arithmetic is testable without a DOM.
 */
import type { SectorFlowDay, SectorFlowRow, SectorTopStock } from '../../services/sectorFlowProxy'
import { fmtBillion, fmtBillionSigned, toBillion } from '../../utils/formatters'

export type Metric = 'total' | 'foreign' | 'trust' | 'dealer'
export type Range = 'day' | 'week'

/** Trading days in the "近 5 日" window. */
export const WEEK_DAYS = 5

export const METRIC_LABEL: Record<Metric, string> = {
  total: '合計',
  foreign: '外資',
  trust: '投信',
  dealer: '自營商',
}

/** What each investor group did in the window, whichever one the screen is currently showing. */
export interface Groups {
  foreignTwd: number
  trustTwd: number
  dealerTwd: number
  totalTwd: number
}

export interface ViewRow {
  code: string
  name: string
  /** The figure for the chosen investor group (see `Metric`). */
  netTwd: number
  groups: Groups
  turnoverTwd: number
  /** Share of the market's turnover; null when the window has none. */
  turnoverShare: number | null
  /** The biggest movers behind the number, on the side the number points to. Newest day only. */
  movers: { side: 'buy' | 'sell'; stocks: SectorTopStock[] } | null
}

export interface ViewSector extends ViewRow {
  /** Semiconductor children, biggest first; empty for every other sector. */
  children: ViewRow[]
}

export interface FlowView {
  /** 'YYYY-MM-DD' of each day in the window, oldest first. */
  dates: string[]
  /** Every day in the window includes TPEx. */
  allOtc: boolean
  sectors: ViewSector[]
  /** Biggest |net| over every row shown, for scaling the bars. */
  scale: number
  /** The newest day's estimate against the official figure; null outside the single-day view. */
  reconciliation: { estimateTwd: number; officialTwd: number } | null
}

const pickGroup = (g: Groups, metric: Metric): number =>
  metric === 'total' ? g.totalTwd : metric === 'foreign' ? g.foreignTwd : metric === 'trust' ? g.trustTwd : g.dealerTwd

/** The last `range` days of the file, oldest first. */
export function windowOf(days: SectorFlowDay[], range: Range): SectorFlowDay[] {
  return days.slice(-(range === 'week' ? WEEK_DAYS : 1))
}

export function buildView(days: SectorFlowDay[], range: Range, metric: Metric): FlowView | null {
  const win = windowOf(days, range)
  if (win.length === 0) return null
  const newest = win[win.length - 1]
  const marketTurnover = win.reduce((s, d) => s + d.marketTurnoverTwd, 0)

  const sums = new Map<string, { row: SectorFlowRow; groups: Groups; turnover: number }>()
  for (const d of win) {
    for (const r of d.rows) {
      const cur = sums.get(r.code)
      if (cur) {
        cur.groups.foreignTwd += r.foreignTwd
        cur.groups.trustTwd += r.trustTwd
        cur.groups.dealerTwd += r.dealerTwd
        cur.groups.totalTwd += r.totalTwd
        cur.turnover += r.turnoverTwd
      } else {
        // `row` only supplies the fallback name and `parent`; the newest day's row is used for the rest.
        sums.set(r.code, {
          row: r,
          groups: {
            foreignTwd: r.foreignTwd,
            trustTwd: r.trustTwd,
            dealerTwd: r.dealerTwd,
            totalTwd: r.totalTwd,
          },
          turnover: r.turnoverTwd,
        })
      }
    }
  }
  const newestRows = new Map(newest.rows.map((r) => [r.code, r]))

  const toRow = (code: string): ViewRow => {
    const s = sums.get(code)!
    const latest = newestRows.get(code)
    const net = pickGroup(s.groups, metric)
    const side = net >= 0 ? 'buy' : 'sell'
    const stocks = range === 'day' && latest ? (side === 'buy' ? latest.topBuy : latest.topSell) : []
    return {
      code,
      name: latest?.name ?? s.row.name,
      netTwd: net,
      groups: s.groups,
      turnoverTwd: s.turnover,
      turnoverShare: marketTurnover > 0 ? s.turnover / marketTurnover : null,
      movers: stocks.length > 0 ? { side, stocks } : null,
    }
  }

  const byNetDesc = (a: ViewRow, b: ViewRow) => b.netTwd - a.netTwd || a.code.localeCompare(b.code)
  const childrenOf = new Map<string, ViewRow[]>()
  const parents: ViewRow[] = []
  for (const [code, { row }] of sums) {
    if (row.parent) {
      childrenOf.set(row.parent, [...(childrenOf.get(row.parent) ?? []), toRow(code)])
    } else {
      parents.push(toRow(code))
    }
  }
  const sectors: ViewSector[] = parents
    .sort(byNetDesc)
    .map((p) => ({ ...p, children: (childrenOf.get(p.code) ?? []).sort(byNetDesc) }))

  const scale = sectors.reduce(
    (m, s) => Math.max(m, Math.abs(s.netTwd), ...s.children.map((c) => Math.abs(c.netTwd))),
    0,
  )
  const official = newest.officialListedTotalTwd
  return {
    dates: win.map((d) => d.date),
    allOtc: win.every((d) => d.coverage.otc),
    sectors,
    scale,
    reconciliation:
      range === 'day' && metric === 'total' && official !== null
        ? { estimateTwd: newest.estimateListedTotalTwd, officialTwd: official }
        : null,
  }
}

const SEMICONDUCTOR_ORDER = ['24:design', '24:foundry', '24:osat', '24:other']

/** Sectors that are industries; ETFs and unclassified names are shown but never named in the headline. */
const isIndustry = (s: ViewRow) => s.code !== 'ETF' && s.code !== 'NA'

/**
 * 億 with a sign, one decimal. A figure that rounds to zero reads "0.0 億", never "-0.0 億": a
 * negative zero says "sold" about a sector nobody sold.
 */
export function signedBillion(twd: number): string {
  const b = toBillion(twd)
  return fmtBillionSigned(b !== null && Math.abs(b) < 0.05 ? 0 : b)
}

/** Net the way the screen colours it: a figure that shows as 0.0 is flat, not red or green. */
export function toneOf(twd: number): number {
  const b = toBillion(twd)
  return b !== null && Math.abs(b) < 0.05 ? 0 : twd
}

const signed = signedBillion

/** 'YYYY-MM-DD' → 'MM/DD' */
const md = (date: string) => date.slice(5).replace('-', '/')

/** "10/02" for one day, "09/26–10/02（5 個交易日）" for a window. */
export function windowLabel(dates: string[]): string {
  if (dates.length === 0) return ''
  if (dates.length === 1) return md(dates[0])
  return `${md(dates[0])}–${md(dates[dates.length - 1])}（${dates.length} 個交易日）`
}

/**
 * The answer in two plain sentences: who bought most, who sold most, and — because the question
 * that started this card was "IC 設計 or something else?" — what semiconductors did and how it
 * splits. null when there is nothing to say.
 */
export function summarize(view: FlowView, metric: Metric): string[] {
  const industries = view.sectors.filter(isIndustry)
  if (industries.length === 0) return []
  const who = metric === 'total' ? '法人合計' : METRIC_LABEL[metric]
  const top = industries[0]
  const bottom = industries[industries.length - 1]
  const lines: string[] = []

  const clauses: string[] = []
  if (top.netTwd > 0) clauses.push(`買超最多的是${top.name}（${signed(top.netTwd)}）`)
  if (bottom.netTwd < 0) clauses.push(`賣超最多的是${bottom.name}（${signed(bottom.netTwd)}）`)
  lines.push(
    clauses.length > 0
      ? `${windowLabel(view.dates)}　${who}${clauses.join('，')}。`
      : `${windowLabel(view.dates)}　${who}在各類股都沒有明顯買賣超。`,
  )

  const semi = view.sectors.find((s) => s.code === '24')
  if (semi && semi.children.length > 0) {
    // Value-chain order (design → fab → packaging → the rest), not by size: the sentence reads the same every day.
    const parts = [...semi.children]
      .sort((a, b) => SEMICONDUCTOR_ORDER.indexOf(a.code) - SEMICONDUCTOR_ORDER.indexOf(b.code))
      .map((c) => `${c.name} ${signed(c.netTwd)}`)
    lines.push(`半導體合計 ${signed(semi.netTwd)}（${parts.join('、')}）。`)
  }
  return lines
}

/** How far the estimate is from the official figure, as "差 −0.9%"; null when the official figure is ~0. */
export function reconciliationGap(r: { estimateTwd: number; officialTwd: number }): string | null {
  if (Math.abs(r.officialTwd) < 1e6) return null
  const pct = ((r.estimateTwd - r.officialTwd) / Math.abs(r.officialTwd)) * 100
  return `差 ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

/**
 * The investor group that moved most in the direction the total points to, as a short clause
 * ("外資賣超 77.3 億"); null when the total is flat or the groups cancel so that none leads.
 */
export function leadClause(g: Groups): string | null {
  if (g.totalTwd === 0) return null
  const sign = g.totalTwd > 0 ? 1 : -1
  const parts: Array<[string, number]> = [
    ['外資', g.foreignTwd],
    ['投信', g.trustTwd],
    ['自營商', g.dealerTwd],
  ]
  const lead = parts.filter(([, v]) => Math.sign(v) === sign).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]
  if (!lead || Math.abs(toBillion(lead[1]) ?? 0) < 0.05) return null
  return `${lead[0]}${sign > 0 ? '買超' : '賣超'} ${fmtBillion(toBillion(Math.abs(lead[1])))}`
}
