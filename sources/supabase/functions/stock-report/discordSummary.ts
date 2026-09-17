/**
 * Pure formatter for the Discord daily market summary (Task 165). Card layout: spec §2.8
 * (supersedes the single-embed/fields layout of §2.2). `buildTestPayload` is unchanged.
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
/** Ideographic space used to align card columns. */
const SP = '　'

const RED = 0xe5484d
const GREEN = 0x30a46c
const GREY = 0x8b8d98

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
  let changeLine: string
  let sign: '' | '+' | '-'
  if (cp == null) {
    sign = ''
    changeLine = '—'
  } else {
    sign = signOf(cp, 2)
    const prevClose = market.taiex - cp
    const pct = prevClose === 0 ? 0 : (cp / prevClose) * 100
    const pctStr = `${signOf(pct, 2)}${fmtAbs(pct, 2)}%`
    if (sign === '') {
      changeLine = `⚪ 平盤（${pctStr}）`
    } else {
      const emoji = sign === '+' ? '🔴' : '🟢'
      changeLine = `${emoji} ${sign}${fmtAbs(cp, 2)}（${pctStr}）`
    }
  }
  const tradeLine = market.tradeValueTwd == null ? `成交金額${SP}—` : `成交金額${SP}${fmtAbs(market.tradeValueTwd / 1e8, 1)} 億`
  const description = `加權指數${SP}**${fmtAbs(market.taiex, 2)}**\n漲跌${SP}${SP}${SP}${changeLine}\n${tradeLine}`
  const color = sign === '+' ? RED : sign === '-' ? GREEN : GREY
  return { description, color, footerText: stamp(market.date, marketAsOf, today) }
}

function instAmt(v: number | null): string {
  return v == null ? '—' : `${fmtSigned(v / 1e8, 1)} 億`
}

/** '' (unknown), '19:30 or later, or a later date' (完整), else 初步 — spec §2.8. */
function institutionalSuffix(marketDate: string, marketAsOf: string | null): string {
  if (!isReadableTime(marketAsOf)) return ''
  const asOfDate = taipeiDate(marketAsOf)
  if (asOfDate !== marketDate) return '・盤後完整'
  return taipeiTime(marketAsOf) >= '19:30' ? '・盤後完整' : '・盤後初步'
}

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
  const description = [
    `外資 ${instAmt(inst.foreignTwd)}｜投信 ${instAmt(inst.trustTwd)}`,
    `自營 ${instAmt(dealer)}｜**合計 ${instAmt(inst.totalTwd)}**`,
  ].join('\n')
  const roundedSign = inst.totalTwd == null ? '' : signOf(inst.totalTwd / 1e8, 1)
  const color = roundedSign === '+' ? RED : roundedSign === '-' ? GREEN : GREY
  return {
    title: `${baseTitle}${institutionalSuffix(marketDate, marketAsOf)}`,
    description,
    color,
    footerText: stamp(marketDate, marketAsOf, today),
  }
}

function marginCard(m: MarketMarginTotals | null, today: string): Omit<CardBits, 'color'> {
  if (!m) return { description: '尚未公布' }
  const amtTodayB = m.marginAmountThousandTwd.today == null ? null : m.marginAmountThousandTwd.today / 100_000
  const amtChangeB = m.marginAmountThousandTwd.change == null ? null : m.marginAmountThousandTwd.change / 100_000
  const description = [
    `融資餘額${SP}${fmtOrDash(m.marginLots.today, 0)} 張（${changeStr(m.marginLots.change, 0)}）`,
    `融資金額${SP}${fmtOrDash(amtTodayB, 1)} 億（${amtChangeB == null ? '—' : `${fmtSigned(amtChangeB, 1)} 億`}）`,
    `融券餘額${SP}${fmtOrDash(m.shortLots.today, 0)} 張（${changeStr(m.shortLots.change, 0)}）`,
  ].join('\n')
  return { description, footerText: stamp(m.date, null, today) }
}

function indexBlock(indices: IndexLine[]): { description: string; hasData: boolean } {
  if (indices.length === 0) return { description: '暫無資料', hasData: false }
  const description = indices
    .map((i) => {
      if (!i.quote) return `${i.label}${SP}暫無資料`
      let pctToken = ''
      if (i.quote.changePct != null) {
        const s = signOf(i.quote.changePct, 2)
        const emoji = s === '+' ? '🔴' : s === '-' ? '🟢' : '⚪'
        pctToken = `${SP}${emoji} ${s}${fmtAbs(i.quote.changePct, 2)}%`
      }
      return `${i.label}${SP}${fmtAbs(i.quote.close, 2)}${pctToken}${SP}${i.quote.date}`
    })
    .join('\n')
  return { description, hasData: true }
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

function macroBlock(macro: MacroLine[] | null): { description: string; hasData: boolean } {
  if (!macro || macro.length === 0) return { description: '暫無資料', hasData: false }
  const description = macro
    .map((m) => {
      if (macroMissing(m.latest)) return `${m.label}${SP}暫無資料`
      const latestStr = macroValueStr(m.latest as MacroPointLike, m.unit, m.kind)
      const prevStr = macroMissing(m.previous) ? '—' : macroValueStr(m.previous as MacroPointLike, m.unit, m.kind)
      return `${m.label}${SP}${prevStr} → **${latestStr}**（${(m.latest as MacroPointLike).period}）`
    })
    .join('\n')
  return { description, hasData: true }
}

function fxCard(fx: FxLine | null, today: string): Omit<CardBits, 'color'> {
  if (!fx || fx.latest == null) return { description: '暫無資料' }
  const base = `USD/TWD${SP}**${fmtAbs(fx.latest, fx.decimals)}**`
  const description = fx.prevClose == null ? base : `${base}（${fmtSigned(fx.latest - fx.prevClose, fx.decimals)}）`
  return { description, footerText: fx.date == null ? undefined : stamp(fx.date, fx.asOf, today) }
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
