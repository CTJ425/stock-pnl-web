/**
 * Pure formatter for the Discord daily market summary (Task 165). Exact strings: spec §2.2.
 */
import type { DiscordEmbedField, DiscordPayload } from './discordWebhook.ts'
import type { CompletedClose } from './globalIndexClose.ts'
import type { MarketMarginTotals } from './marketMargin.ts'
import type { MarketDay, MarketInstitutional } from './twMarket.ts'

export type SummaryEdition = 'brief' | 'full'

export interface IndexLine {
  symbol: string
  label: string
  quote: CompletedClose | null
}

export interface FxLine {
  code: string
  latest: number | null
  prevClose: number | null
  decimals: number
}

export interface MacroPointLike {
  period: string
  value: number | null
  valueLow?: number | null
}

export interface MacroLine {
  label: string
  kind: string
  unit: string
  latest: MacroPointLike | null
  previous: MacroPointLike | null
}

export interface SummaryInput {
  edition: SummaryEdition
  /** 'YYYY-MM-DD', the Taipei trading date (equals `market.date`) */
  ymd: string
  /** ISO timestamp for `embed.timestamp` */
  generatedAt: string
  market: MarketDay
  indices: IndexLine[]
  usdTwd: FxLine | null
  /** Ignored for `brief`. */
  margin: MarketMarginTotals | null
  /** Ignored for `brief`. */
  macro: MacroLine[] | null
}

const FOOTER = '資料來源：證交所、Yahoo Finance、FRED｜僅供參考，非投資建議'
const WEEKDAY_CHARS = '日一二三四五六'

export function findMarketDay(file: { days?: MarketDay[] } | null, ymd: string): MarketDay | null {
  if (!file || !file.days) return null
  return file.days.find((d) => d.date === ymd) ?? null
}

/** Rounds to `decimals` and reads the sign off the rounded value (`-0` counts as none). */
function signOf(n: number, decimals: number): '' | '+' | '-' {
  const rounded = Number(n.toFixed(decimals))
  if (rounded > 0) return '+'
  if (rounded < 0) return '-'
  return ''
}

/** Absolute value, fixed decimals, thousands separators. */
function fmtAbs(n: number, decimals: number): string {
  return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtSigned(n: number, decimals: number): string {
  return signOf(n, decimals) + fmtAbs(n, decimals)
}

function fmtOrDash(n: number | null, decimals: number): string {
  return n == null ? '—' : fmtAbs(n, decimals)
}

function changeStr(n: number | null, decimals: number): string {
  return n == null ? '—' : fmtSigned(n, decimals)
}

/** At most two decimals, no trailing zeros. */
function trimmedNum(n: number): string {
  const rounded = Math.round(n * 100) / 100
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function weekdayChar(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return WEEKDAY_CHARS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

function titleDate(ymd: string): string {
  const [, m, d] = ymd.split('-')
  return `${m}/${d}`
}

function taiexBlock(market: MarketDay): string {
  if (market.taiex == null) return '尚未公布'
  const cp = market.changePoints
  let line1: string
  if (cp == null) {
    line1 = `加權 ${fmtAbs(market.taiex, 2)}`
  } else {
    const prevClose = market.taiex - cp
    const pct = prevClose === 0 ? 0 : (cp / prevClose) * 100
    const pctStr = `${signOf(pct, 2)}${fmtAbs(pct, 2)}%`
    if (cp === 0) {
      line1 = `加權 ${fmtAbs(market.taiex, 2)} 平盤 (${pctStr})`
    } else {
      const arrow = cp > 0 ? '▲' : '▼'
      line1 = `加權 ${fmtAbs(market.taiex, 2)} ${arrow}${fmtAbs(cp, 2)} (${pctStr})`
    }
  }
  const line2 = market.tradeValueTwd == null ? '成交 —' : `成交 ${fmtAbs(market.tradeValueTwd / 1e8, 1)} 億`
  return `${line1}\n${line2}`
}

function instAmount(v: number | null): string {
  return v == null ? '—' : `${fmtSigned(v / 1e8, 1)}億`
}

function institutionalBlock(inst: MarketInstitutional | null): string {
  if (!inst) return '尚未公布'
  const dealerSelf = inst.dealerSelfTwd
  const dealerHedge = inst.dealerHedgeTwd
  const dealer = dealerSelf == null && dealerHedge == null ? null : (dealerSelf ?? 0) + (dealerHedge ?? 0)
  return [
    `外資 ${instAmount(inst.foreignTwd)}`,
    `投信 ${instAmount(inst.trustTwd)}`,
    `自營 ${instAmount(dealer)}`,
    `合計 ${instAmount(inst.totalTwd)}`,
  ].join('\n')
}

function marginBlock(m: MarketMarginTotals | null): string {
  if (!m) return '尚未公布'
  const amtTodayB = m.marginAmountThousandTwd.today == null ? null : m.marginAmountThousandTwd.today / 100_000
  const amtChangeB = m.marginAmountThousandTwd.change == null ? null : m.marginAmountThousandTwd.change / 100_000
  return [
    `融資 ${fmtOrDash(m.marginLots.today, 0)} 張 (${changeStr(m.marginLots.change, 0)})`,
    `融資金額 ${fmtOrDash(amtTodayB, 1)} 億 (${amtChangeB == null ? '—' : fmtSigned(amtChangeB, 1)}億)`,
    `融券 ${fmtOrDash(m.shortLots.today, 0)} 張 (${changeStr(m.shortLots.change, 0)})`,
  ].join('\n')
}

function indexBlock(indices: IndexLine[]): string {
  return indices
    .map((i) => {
      if (!i.quote) return `${i.label} 暫無資料`
      const pct = i.quote.changePct == null ? '' : ` ${signOf(i.quote.changePct, 2)}${fmtAbs(i.quote.changePct, 2)}%`
      return `${i.label} ${fmtAbs(i.quote.close, 2)}${pct} ${i.quote.date}`
    })
    .join('\n')
}

function macroNumPart(v: MacroPointLike, kind: string): string {
  if (kind === 'rate' && v.valueLow != null && v.value != null) {
    return `${trimmedNum(v.valueLow)}–${trimmedNum(v.value)}`
  }
  return trimmedNum(v.value ?? 0)
}

function macroValueStr(v: MacroPointLike, unit: string, kind: string): string {
  const num = macroNumPart(v, kind)
  return unit === '%' ? `${num}${unit}` : `${num} ${unit}`
}

/** A point whose `value` is null counts as missing, never as 0 — even for kind `rate`. */
function macroMissing(v: MacroPointLike | null | undefined): boolean {
  return !v || v.value == null
}

function macroBlock(macro: MacroLine[] | null): string {
  if (!macro || macro.length === 0) return '暫無資料'
  return macro
    .map((m) => {
      if (macroMissing(m.latest)) return `${m.label} 暫無資料`
      const latestStr = macroValueStr(m.latest as MacroPointLike, m.unit, m.kind)
      const prevStr = macroMissing(m.previous) ? '—' : macroValueStr(m.previous as MacroPointLike, m.unit, m.kind)
      return `${m.label} ${prevStr} → ${latestStr}（${(m.latest as MacroPointLike).period}）`
    })
    .join('\n')
}

function fxBlock(fx: FxLine | null): string {
  if (!fx || fx.latest == null) return '暫無資料'
  const base = `USD/TWD ${fmtAbs(fx.latest, fx.decimals)}`
  if (fx.prevClose == null) return base
  return `${base} (${fmtSigned(fx.latest - fx.prevClose, fx.decimals)})`
}

export function buildSummaryPayload(input: SummaryInput): DiscordPayload {
  const { edition, ymd, generatedAt, market, indices, usdTwd, margin, macro } = input

  const fields: DiscordEmbedField[] = [{ name: '台股大盤', value: taiexBlock(market), inline: false }]
  fields.push({
    name: edition === 'brief' ? '三大法人（初步）' : '三大法人',
    value: institutionalBlock(market.institutional),
    inline: false,
  })
  if (edition === 'full') fields.push({ name: '融資融券', value: marginBlock(margin), inline: false })
  fields.push({ name: '國際指數（最近收盤）', value: indexBlock(indices), inline: false })
  if (edition === 'full') fields.push({ name: '美國總經', value: macroBlock(macro), inline: false })
  fields.push({ name: '匯率', value: fxBlock(usdTwd), inline: false })

  const title =
    edition === 'brief'
      ? `📊 台股盤後快報 ${titleDate(ymd)}(${weekdayChar(ymd)})`
      : `📋 台股盤後完整版 ${titleDate(ymd)}(${weekdayChar(ymd)})`

  const cp = market.changePoints
  const color = cp == null ? 0x8b8d98 : cp > 0 ? 0xe5484d : cp < 0 ? 0x30a46c : 0x8b8d98

  return {
    username: '盤後總結',
    embeds: [{ title, color, fields, footer: { text: FOOTER }, timestamp: generatedAt }],
    allowed_mentions: { parse: [] },
  }
}

export function buildTestPayload(generatedAt: string): DiscordPayload {
  return {
    username: '盤後總結',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: '🔔 Discord 連線測試',
        fields: [{ name: '狀態', value: '連線正常，每日總結會發送到這個頻道。', inline: false }],
        footer: { text: FOOTER },
        timestamp: generatedAt,
      },
    ],
  }
}
