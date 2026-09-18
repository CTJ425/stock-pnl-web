/**
 * Pure formatter for the Discord daily market summary (Task 165). Card layout: spec §2.8
 * (supersedes the single-embed/fields layout of §2.2); tables inside the cards: spec §2.9
 * (supersedes the §2.8 "Description" column only). `buildTestPayload` is unchanged.
 * Exact strings are pinned by discordSummary.test.ts.
 */
import type { DiscordEmbed, DiscordPayload } from './discordWebhook.ts'
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
  /** 'YYYY-MM-DD' of the quote `latest` belongs to (last point of `fx/twd.json`) */
  date: string | null
  /** ISO time `fx/twd.json` was produced */
  asOf: string | null
}

export interface MacroPointLike {
  period: string
  value: number | null
  valueLow?: number | null
}

export interface MacroLine {
  /** FRED series id (e.g. 'CPILFESL'); selects the short table label, spec §2.9 */
  id?: string
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
  /** ISO send time. Unused by the §2.8 card layout (no per-card timestamp); kept for callers and a future footer. */
  generatedAt: string
  market: MarketDay
  indices: IndexLine[]
  usdTwd: FxLine | null
  /** Ignored for `brief`. */
  margin: MarketMarginTotals | null
  /** Ignored for `brief`. */
  macro: MacroLine[] | null
  /** 'YYYY-MM-DD', the actual Taipei date the message is sent on — a block dated otherwise is flagged ⚠️ 非今日 */
  today: string
  /** ISO `asOf` of `market/daily.json` (last write), drives 盤後初步／完整 and the update stamp */
  marketAsOf: string | null
}

/** Used verbatim by `buildTestPayload`'s embed footer. */
const FOOTER = '資料來源：證交所、Yahoo Finance、FRED｜僅供參考，非投資建議'
/** Discord "small text" line under the heading, spec §2.8 envelope. */
const SOURCE_LINE = `-# ${FOOTER}`
const WEEKDAY_CHARS = '日一二三四五六'

const RED = 0xe5484d
const GREEN = 0x30a46c
const GREY = 0x8b8d98

/** Markdown special characters escaped in data-derived text (index labels), spec Revision 8. */
function escapeMd(s: string): string {
  return s.replace(/[\\*_~|`]/g, '\\$&')
}

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

function changeStr(n: number | null, decimals: number): string {
  return n == null ? '--' : fmtSigned(n, decimals)
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

/** 'YYYY-MM-DD' → 'MM/DD'. */
function titleDate(ymd: string): string {
  const [, m, d] = ymd.split('-')
  return `${m}/${d}`
}

/** A timestamp we can actually read — an unparseable `asOf` is treated as unknown, never printed as NaN. */
function isReadableTime(iso: string | null): iso is string {
  return typeof iso === 'string' && iso !== '' && !Number.isNaN(new Date(iso).getTime())
}

/** ISO timestamp → Taipei calendar date 'YYYY-MM-DD'. */
function taipeiDate(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000)
  const y = t.getUTCFullYear()
  const m = String(t.getUTCMonth() + 1).padStart(2, '0')
  const d = String(t.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** ISO timestamp → Taipei clock time 'HH:mm'. */
function taipeiTime(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000)
  const hh = String(t.getUTCHours()).padStart(2, '0')
  const mm = String(t.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * Data-freshness footer, spec §2.8 "Stamp". `dataDate` null (fx with no quote date) means no
 * footer at all — the caller relies on this rather than checking null itself.
 */
function stamp(dataDate: string | null, updatedAt: string | null, today: string): string | undefined {
  if (dataDate == null) return undefined
  if (dataDate !== today) return `⚠️ ${titleDate(dataDate)} 資料・非今日`
  if (!isReadableTime(updatedAt)) return `${titleDate(dataDate)} 資料`
  const updDate = taipeiDate(updatedAt)
  const updTime = taipeiTime(updatedAt)
  if (updDate === dataDate) return `${titleDate(dataDate)} ${updTime} 更新`
  return `${titleDate(dataDate)} 資料・${titleDate(updDate)} ${updTime} 更新`
}

function footerOf(text: string | undefined): { text: string } | undefined {
  return text == null ? undefined : { text }
}

interface CardBits {
  description: string
  color: number
  footerText?: string
}

function taiexCard(market: MarketDay, marketAsOf: string | null, today: string): CardBits {
  if (market.taiex == null) return { description: '尚未公布', color: GREY }
  const cp = market.changePoints
  let changeStr2: string
  let pctStr: string
  let mark = ''
  let sign: '' | '+' | '-' = ''
  if (cp == null) {
    changeStr2 = '--'
    pctStr = '--'
  } else {
    sign = signOf(cp, 2)
    const prevClose = market.taiex - cp
    const pct = prevClose === 0 ? 0 : (cp / prevClose) * 100
    changeStr2 = `**${fmtSigned(cp, 2)}**`
    pctStr = `**${fmtSigned(pct, 2)}%**`
    mark = sign === '+' ? '🔴' : sign === '-' ? '🟢' : '⚪'
  }
  const tradeStr = market.tradeValueTwd == null ? '--' : `**${fmtAbs(market.tradeValueTwd / 1e8, 1)}億**`
  const markSuffix = mark ? ` ${mark}` : ''
  const lines = [
    `加權指數 **${fmtAbs(market.taiex, 2)}**`,
    `漲跌點數 ${changeStr2}${markSuffix}`,
    `漲跌幅度 ${pctStr}${markSuffix}`,
    `成交金額 ${tradeStr}`,
  ]
  const color = sign === '+' ? RED : sign === '-' ? GREEN : GREY
  return { description: lines.join('\n'), color, footerText: stamp(market.date, marketAsOf, today) }
}

function instAmt(v: number | null): string {
  return v == null ? '--' : `**${fmtSigned(v / 1e8, 1)}**`
}

function instMark(v: number | null): string {
  if (v == null) return ''
  const s = signOf(v / 1e8, 1)
  return s === '+' ? '🔴' : s === '-' ? '🟢' : '⚪'
}

/** '' (unknown), '19:30 or later, or a later date' (完整), else 初步 — spec §2.8. */
function institutionalSuffix(marketDate: string, marketAsOf: string | null): string {
  if (!isReadableTime(marketAsOf)) return ''
  const asOfDate = taipeiDate(marketAsOf)
  if (asOfDate !== marketDate) return '・盤後完整'
  return taipeiTime(marketAsOf) >= '19:30' ? '・盤後完整' : '・盤後初步'
}

const INST_LABELS = ['外資', '投信', '自營', '合計'] as const

function institutionalCard(
  inst: MarketInstitutional | null,
  marketDate: string,
  marketAsOf: string | null,
  today: string,
): CardBits & { title: string } {
  const baseTitle = '🏦 三大法人'
  if (!inst) return { title: baseTitle, description: '尚未公布', color: GREY }
  const dealerSelf = inst.dealerSelfTwd
  const dealerHedge = inst.dealerHedgeTwd
  const dealer = dealerSelf == null && dealerHedge == null ? null : (dealerSelf ?? 0) + (dealerHedge ?? 0)
  const values = [inst.foreignTwd, inst.trustTwd, dealer, inst.totalTwd]
  const amtStrs = values.map(instAmt)
  const marks = values.map(instMark)
  const lines = INST_LABELS.map((label, i) => {
    const markSuffix = marks[i] ? ` ${marks[i]}` : ''
    return `${label} ${amtStrs[i]}${markSuffix}`
  })
  const roundedSign = inst.totalTwd == null ? '' : signOf(inst.totalTwd / 1e8, 1)
  const color = roundedSign === '+' ? RED : roundedSign === '-' ? GREEN : GREY
  return {
    title: `${baseTitle}${institutionalSuffix(marketDate, marketAsOf)}（億元）`,
    description: lines.join('\n'),
    color,
    footerText: stamp(marketDate, marketAsOf, today),
  }
}

function marginCard(m: MarketMarginTotals | null, today: string): Omit<CardBits, 'color'> {
  if (!m) return { description: '尚未公布' }
  const amtTodayB = m.marginAmountThousandTwd.today == null ? null : m.marginAmountThousandTwd.today / 100_000
  const amtChangeB = m.marginAmountThousandTwd.change == null ? null : m.marginAmountThousandTwd.change / 100_000
  const lots = (v: number | null) => (v == null ? '--' : `**${fmtAbs(v, 0)}**`)
  const amt = (v: number | null) => (v == null ? '--' : `**${fmtAbs(v, 1)}**`)
  const lines = [
    `融資 ${lots(m.marginLots.today)} 張（${changeStr(m.marginLots.change, 0)}）`,
    `融資金額 ${amt(amtTodayB)} 億（${changeStr(amtChangeB, 1)}）`,
    `融券 ${lots(m.shortLots.today)} 張（${changeStr(m.shortLots.change, 0)}）`,
  ]
  return { description: lines.join('\n'), footerText: stamp(m.date, null, today) }
}

function indexBlock(indices: IndexLine[]): { description: string; hasData: boolean } {
  if (indices.length === 0) return { description: '暫無資料', hasData: false }
  const withQuote = indices.filter((i): i is IndexLine & { quote: NonNullable<IndexLine['quote']> } => i.quote != null)
  // The footer already says each market's date is its own latest close; only a market whose
  // close date lags behind the newest one among the listed indices gets `（MM/DD）` appended.
  const newestDate = withQuote.length === 0 ? null : withQuote.map((i) => i.quote.date).reduce((a, b) => (a > b ? a : b))
  const lines: string[] = []
  for (const i of indices) {
    const label = escapeMd(i.label)
    if (!i.quote) {
      lines.push(`${label} 暫無資料`)
      continue
    }
    const closeStr = fmtAbs(i.quote.close, 2)
    let pctPart: string
    if (i.quote.changePct == null) {
      pctPart = '--'
    } else {
      const rounded = Number(i.quote.changePct.toFixed(2))
      const mark = rounded > 0 ? '🔴' : rounded < 0 ? '🟢' : '⚪'
      pctPart = `${fmtSigned(i.quote.changePct, 2)}% ${mark}`
    }
    const datePart = newestDate != null && i.quote.date !== newestDate ? `（${i.quote.date}）` : ''
    lines.push(`${label} **${closeStr}** ${pctPart}${datePart}`)
  }
  return { description: lines.join('\n'), hasData: true }
}

/** FRED series id → short table label, spec §2.9; falls back to the original label. */
const MACRO_SHORT_LABELS: Record<string, string> = {
  CPILFESL: '核心CPI',
  PPIFES: '核心PPI',
  PCEPILFE: '核心PCE',
  DFEDTARU: '聯邦利率',
  PAYEMS: '非農就業',
  UMCSENT: '消費信心',
}

function macroLabel(m: MacroLine): string {
  return (m.id != null && MACRO_SHORT_LABELS[m.id]) || m.label
}

/** 'YYYY-MM' → 'MM月'; 'YYYY-MM-DD' → 'MM/DD'; anything else is returned as-is. */
function macroPeriodStr(period: string): string {
  const parts = period.split('-')
  if (parts.length === 2) return `${parts[1]}月`
  if (parts.length === 3) return `${parts[1]}/${parts[2]}`
  return period
}

function macroNumPart(v: MacroPointLike, kind: string): string {
  if (kind === 'rate' && v.valueLow != null && v.value != null) {
    return `${trimmedNum(v.valueLow)}-${trimmedNum(v.value)}`
  }
  return trimmedNum(v.value ?? 0)
}

/** Units are appended directly with no space, spec §2.9 (`2.47%`, `21千人`, `49.5指數`). */
function macroValueStr(v: MacroPointLike, unit: string, kind: string): string {
  return `${macroNumPart(v, kind)}${unit}`
}

/** A point whose `value` is null counts as missing, never as 0 — even for kind `rate`. */
function macroMissing(v: MacroPointLike | null | undefined): boolean {
  return !v || v.value == null
}

function macroBlock(macro: MacroLine[] | null): { description: string; hasData: boolean } {
  if (!macro || macro.length === 0) return { description: '暫無資料', hasData: false }
  const lines: string[] = []
  for (const m of macro) {
    const label = macroLabel(m)
    if (macroMissing(m.latest)) {
      lines.push(`${label} 暫無資料`)
      continue
    }
    const latestStr = macroValueStr(m.latest as MacroPointLike, m.unit, m.kind)
    const period = macroPeriodStr((m.latest as MacroPointLike).period)
    let prevPart: string
    if (macroMissing(m.previous)) {
      prevPart = ''
    } else {
      const prevStr = macroValueStr(m.previous as MacroPointLike, m.unit, m.kind)
      // Same value both periods ⇒ 持平 rather than repeating it with a redundant 前值.
      prevPart = prevStr === latestStr ? '持平，' : `前值 ${prevStr}，`
    }
    lines.push(`${label} **${latestStr}**（${prevPart}${period}）`)
  }
  return { description: lines.join('\n'), hasData: true }
}

function fxCard(fx: FxLine | null, today: string): Omit<CardBits, 'color'> {
  if (!fx || fx.latest == null) return { description: '暫無資料' }
  const base = `USD/TWD **${fmtAbs(fx.latest, fx.decimals)}**`
  const line = fx.prevClose == null ? base : `${base} ${fmtSigned(fx.latest - fx.prevClose, fx.decimals)}`
  return { description: line, footerText: fx.date == null ? undefined : stamp(fx.date, fx.asOf, today) }
}

export function buildSummaryPayload(input: SummaryInput): DiscordPayload {
  const { edition, ymd, market, indices, usdTwd, margin, macro, today, marketAsOf } = input

  const headingText = edition === 'brief' ? '📊 台股盤後快報' : '📋 台股盤後完整版'
  const content = `## ${headingText} ${titleDate(ymd)}(${weekdayChar(ymd)})\n${SOURCE_LINE}`

  const embeds: DiscordEmbed[] = []

  const taiex = taiexCard(market, marketAsOf, today)
  embeds.push({ title: '🇹🇼 台股大盤', description: taiex.description, color: taiex.color, footer: footerOf(taiex.footerText) })

  const inst = institutionalCard(market.institutional, market.date, marketAsOf, today)
  embeds.push({ title: inst.title, description: inst.description, color: inst.color, footer: footerOf(inst.footerText) })

  if (edition === 'full') {
    const mg = marginCard(margin, today)
    embeds.push({ title: '🧾 融資融券', description: mg.description, color: GREY, footer: footerOf(mg.footerText) })
  }

  const idx = indexBlock(indices)
  embeds.push({
    title: '🌏 國際指數・最近收盤',
    description: idx.description,
    color: GREY,
    footer: idx.hasData ? { text: '各市場最近一個已收盤交易日' } : undefined,
  })

  if (edition === 'full') {
    const mc = macroBlock(macro)
    embeds.push({
      title: '🇺🇸 美國總經',
      description: mc.description,
      color: GREY,
      footer: mc.hasData ? { text: '括號內為資料期別' } : undefined,
    })
  }

  const fx = fxCard(usdTwd, today)
  embeds.push({ title: '💱 匯率', description: fx.description, color: GREY, footer: footerOf(fx.footerText) })

  return {
    username: '盤後總結',
    content,
    embeds,
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
