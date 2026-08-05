/**
 * AI Payload and Prompt generate logic.
 *
 * Core constraints (PLAN.md §M1.1):
 * 1. The technical side is calculated by the program (TechnicalView.latest), and the 243 original closing prices are never put into the payload.
 * 2. The unit must be written in the field label: "number of shares" for the three major legal entities, and "number of shares" for margin trading and securities lending.
 * 3. It is strictly prohibited to include holdings (holding), costs (avgCost) or unrealized gains and losses (unrealized).
 *
 * Two particularly error-prone areas when feeding the model have been pinned with testing:
 * - `TechnicalView.latest.changePct` is **decimal scale** (0.0148 = +1.48%),
 *   Printing it directly with `%` will make the model tell a 100 times smaller increase and decrease. Therefore, the field name here is
 *   `changePctPercent`, value multiplied by 100.
 * - The positive and negative signs of `ChipStreaks` have semantic meaning (positive = continuous buying/continuous increase, negative = continuous selling/continuous decrease),
 *   A mere numerical model would read -3 as "an additional -3 days". Therefore, the payload is accompanied by a `streakNote` description.
 */
import type { FundamentalData } from '../../services/fundamentalProxy'
import type { MacroData } from '../../services/macroProxy'
import type { ReportData } from '../../services/reportProxy'
import type { RangeKey, TechnicalView } from './technicalView'
import { RANGE_LABELS } from './technicalView'
import { ANALYSIS_DEFAULT, ANALYSIS_LOCKED, resolvePrompt } from '../../services/aiPrompts'

/** Round to n decimal places; null will still be returned (do not use 0 to replace missing values)*/
function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** Buy / sell / buy and sell super three-piece set (unit: number of shares)*/
interface LegShares {
  buyShares: number | null
  sellShares: number | null
  netShares: number | null
}

export interface AiPayload {
  ticker: string
  name: string
  /** The range covered by technical data (for example: the past 1 year)*/
  periodLabel: string
  technical: {
    date: string
    close: number
    open: number
    high: number
    low: number
    /** Trading volume, unit: number of shares*/
    volumeShares: number
    change: number | null
    /** Converted to a percentage value: 1.48 represents +1.48%*/
    changePctPercent: number | null
    ma5: number | null
    ma20: number | null
    ma60: number | null
    alignment: string | null
    k: number | null
    d: number | null
    rsi14: number | null
    macdHist: number | null
    /** The multiple of trading volume relative to the 20-day average volume: 1.5 means 1.5 times*/
    volRatioVs20DayAvg: number | null
    periodHighClose: number
    periodLowClose: number
  }
  chip: {
    hasReport: boolean
    unitInstitutional: '股'
    unitMargin: '張'
    dataDate?: string
    institutional?: {
      foreign: LegShares
      foreignDealer: LegShares
      trust: LegShares
      dealer: LegShares
      total: LegShares
    }
    margin?: {
      marginTodayLots: number | null
      marginChangeLots: number | null
      shortTodayLots: number | null
      shortChangeLots: number | null
    }
    streakNote?: string
    streaks?: {
      foreign: number
      trust: number
      dealer: number
      total: number
      margin: number
      short: number
    }
    history7Days?: Array<{
      date: string
      foreignNetShares: number | null
      trustNetShares: number | null
      dealerNetShares: number | null
      totalNetShares: number | null
      marginTodayLots: number | null
      shortTodayLots: number | null
    }>
    notes?: string[]
  }
  /** Fundamentals (0.6.0-dev.4). The codes for listed stocks and batches that have not been released are hasData: false*/
  fundamental: {
    hasData: boolean
    industry?: string | null
    valuation?: {
      peRatio: number | null
      dividendYieldPercent: number | null
      pbRatio: number | null
      dataDate: string | null
    }
    /** The unit of monthly revenue amount; the same as the unitInstitutional of chips, "the unit does not leave the payload"*/
    revenueUnit?: '千元'
    /** New to old, up to 12 months*/
    revenueMonths?: Array<{
      yearMonth: string
      revenueThousandTwd: number | null
      momPercent: number | null
      yoyPercent: number | null
    }>
    /** The unit of profitability ratio (0.6.5). The same is "the unit does not leave the payload"*/
    profitUnit?: '%'
    /** From new to old, up to 8 seasons*/
    profitQuarters?: Array<{
      yearQuarter: string
      epsTwd: number | null
      grossMarginPercent: number | null
      operatingMarginPercent: number | null
      pretaxMarginPercent: number | null
      netMarginPercent: number | null
    }>
  }
  /**
   * General economic context (0.6.5, United States). **Not related to individual stocks**, it is shared background information.
   * system prompt There is a rule that explicitly prohibits using it to deduce the rise and fall of individual stocks.
   */
  macro: {
    hasData: boolean
    region?: string
    indicators?: Array<{
      label: string
      /** The unit follows the value: '%' / 'thousands of people' / 'index'*/
      unit: string
      period: string | null
      value: number | null
      previousValue: number | null
    }>
  }
}

const STREAK_NOTE =
  '連續天數的正負號帶語意：法人為正數＝連續買超天數、負數＝連續賣超天數；' +
  '資券為正數＝餘額連續增加天數、負數＝連續減少天數；0＝昨日方向未延續。'

function leg(src: { buy: number | null; sell: number | null; net: number | null } | undefined): LegShares {
  return {
    buyShares: src?.buy ?? null,
    sellShares: src?.sell ?? null,
    netShares: src?.net ?? null,
  }
}

function buildFundamentalBlock(f: FundamentalData | null): AiPayload['fundamental'] {
  // There is a file but all three items are empty (the lack of information file for OTC stocks) means there is no data. Do not let the prompt print a string of "none"
  const hasAny =
    !!f &&
    (f.valuation !== null ||
      f.revenueMonths.length > 0 ||
      f.profitQuarters.length > 0 ||
      !!f.industry)
  if (!f || !hasAny) return { hasData: false }

  return {
    hasData: true,
    industry: f.industry,
    valuation: f.valuation
      ? {
          peRatio: f.valuation.peRatio,
          dividendYieldPercent: f.valuation.dividendYieldPercent,
          pbRatio: f.valuation.pbRatio,
          dataDate: f.valuation.dataDate,
        }
      : undefined,
    revenueUnit: '千元',
    revenueMonths: [...f.revenueMonths].reverse().map((m) => ({
      yearMonth: m.yearMonth,
      revenueThousandTwd: m.revenueThousandTwd,
      momPercent: round(m.momPercent),
      yoyPercent: round(m.yoyPercent),
    })),
    profitUnit: '%',
    profitQuarters: [...f.profitQuarters].reverse().map((q) => ({
      yearQuarter: q.yearQuarter,
      // EPS is sent together (0.6.28): The price-to-earnings ratio is in the same payload. Without EPS, the model cannot judge whether it is expensive or not.
      epsTwd: round(q.epsTwd),
      grossMarginPercent: round(q.grossMarginPercent),
      operatingMarginPercent: round(q.operatingMarginPercent),
      pretaxMarginPercent: round(q.pretaxMarginPercent),
      netMarginPercent: round(q.netMarginPercent),
    })),
  }
}

/**
 * General block. When there is a shortage of materials, hasData: false, the prompt will print the replacement copy instead of a string of "none".
 * Only the latest and previous period values ​​are sent - the 12-period sequence has low marginal value to the model, but will significantly lengthen the tokens in each round.
 */
function buildMacroBlock(m: MacroData | null): AiPayload['macro'] {
  if (!m || m.indicators.length === 0) return { hasData: false }
  return {
    hasData: true,
    region: m.region,
    indicators: m.indicators.map((i) => ({
      label: i.label,
      unit: i.unit,
      period: i.latest?.period ?? null,
      value: round(i.latest?.value ?? null),
      previousValue: round(i.previous?.value ?? null),
    })),
  }
}

export function buildAiPayload(args: {
  ticker: string
  name: string
  view: TechnicalView
  report: ReportData | null
  range: RangeKey
  fundamental?: FundamentalData | null
  macro?: MacroData | null
}): AiPayload {
  const { ticker, name, view, report, range } = args
  const latest = view.latest
  const closes = view.candles.map((c) => c.close)
  const periodHighClose = closes.length > 0 ? Math.max(...closes) : latest.close
  const periodLowClose = closes.length > 0 ? Math.min(...closes) : latest.close

  const technical = {
    date: latest.date,
    close: round(latest.close) as number,
    open: round(latest.open) as number,
    high: round(latest.high) as number,
    low: round(latest.low) as number,
    volumeShares: latest.volume,
    change: round(latest.change),
    // ×100: latest.changePct is a decimal ratio, see the file header description
    changePctPercent: round(latest.changePct === null ? null : latest.changePct * 100),
    ma5: round(latest.ma5),
    ma20: round(latest.ma20),
    ma60: round(latest.ma60),
    alignment: latest.alignment,
    k: round(latest.k),
    d: round(latest.d),
    rsi14: round(latest.rsi14),
    macdHist: round(latest.macdHist),
    volRatioVs20DayAvg: round(latest.volRatio),
    periodHighClose: round(periodHighClose) as number,
    periodLowClose: round(periodLowClose) as number,
  }

  const base = {
    ticker,
    name,
    periodLabel: RANGE_LABELS[range],
    technical,
    fundamental: buildFundamentalBlock(args.fundamental ?? null),
    macro: buildMacroBlock(args.macro ?? null),
  }

  if (!report) {
    return {
      ...base,
      chip: {
        hasReport: false,
        unitInstitutional: '股',
        unitMargin: '張',
      },
    }
  }

  const history7Days = report.history.slice(-7).map((h) => ({
    date: h.date,
    foreignNetShares: h.institutional?.foreign.net ?? null,
    trustNetShares: h.institutional?.trust.net ?? null,
    dealerNetShares: h.institutional?.dealer.net ?? null,
    totalNetShares: h.institutional?.total.net ?? null,
    marginTodayLots: h.margin?.marginToday ?? null,
    shortTodayLots: h.margin?.shortToday ?? null,
  }))

  return {
    ...base,
    chip: {
      hasReport: true,
      unitInstitutional: '股',
      unitMargin: '張',
      dataDate: report.dataDate,
      institutional: {
        foreign: leg(report.institutional?.foreign),
        foreignDealer: leg(report.institutional?.foreignDealer),
        trust: leg(report.institutional?.trust),
        dealer: leg(report.institutional?.dealer),
        total: leg(report.institutional?.total),
      },
      margin: {
        marginTodayLots: report.margin?.marginToday ?? null,
        marginChangeLots: report.margin?.marginChange ?? null,
        shortTodayLots: report.margin?.shortToday ?? null,
        shortChangeLots: report.margin?.shortChange ?? null,
      },
      streakNote: STREAK_NOTE,
      streaks: report.streaks
        ? {
            foreign: report.streaks.foreign,
            trust: report.streaks.trust,
            dealer: report.streaks.dealer,
            total: report.streaks.total,
            margin: report.streaks.margin,
            short: report.streaks.short,
          }
        : undefined,
      history7Days,
      notes: report.notes,
    },
  }
}

/** When the number is missing, always print "None", do not print 0 - 0 in the transaction super is "flat", and "no data" are two different things.*/
function num(value: number | null): string {
  return value === null ? '無' : String(value)
}

/** Output with positive and negative signs (the direction can be seen both for the number of consecutive days and the buying and selling super)*/
function signed(value: number | null): string {
  if (value === null) return '無'
  return value > 0 ? `+${value}` : String(value)
}

function legText(label: string, l: LegShares): string {
  return `  * ${label}：買進 ${num(l.buyShares)} 股 / 賣出 ${num(l.sellShares)} 股 / 買賣超 ${signed(l.netShares)} 股`
}

/**
 * The batching in and out framework adopted by the user (0.6.9-dev.2, specified by the user).
 *
 * **This is a "descriptive vocabulary" for the model, not a license to relax Guideline 5. **
 * The model can use these terms to explain which situation the current data falls in, but it is still not allowed to specify the overweight ratio,
 * You are not allowed to specify a price, you are not allowed to say "should you buy/sell now" - the tranche percentage is just an example to illustrate the framework.
 *
 * **Martinale has different properties from the other three, so the premise is marked separately. ** Pyramid, inverted pyramid, non-equidistant grid
 * They are all position management with an upper limit; Martingale by definition has no upper limit (double your bet after a loss),
 * Its statement that "it only takes one rebound to unwind in the end" is based on the fact that "the target does not return to zero and the funds are unlimited"——
 * However, neither of these is true for real accounts, and the funds required grow exponentially when there is a continuous decline.
 * prompt forces the model to state this premise every time it is mentioned, preventing it from being treated as an equivalent option to the other three.
 */
const STRATEGY_FRAMEWORKS = `【使用者採用的操作框架】

使用者的操作偏向「左側交易 / 分批進出」，常見以下四種框架。
你可以用這些名詞描述目前數據落在哪個情境，但**仍受準則 5 完全約束**。

- **金字塔建倉（Pyramiding / Scaling-in，下跌加碼）**：越跌買越多
  （例如分批 10% → 20% → 30% → 50%），目的是拉低平均成本。
- **倒金字塔停利（Scaling-out，上漲分批賣）**：越漲賣越多
  （例如 10% → 20% → 30% → 40% → 100%），目的是逐步鎖定利潤。
- **非等距網格（Asymmetric Grid Trading）**：把上述邏輯寫成程式規則、
  在不等距的價位分批進出，在加密貨幣與外匯市場的自動化交易中相當普及。
- **馬丁格爾變體（Martingale）**：源自博弈論的「虧損後加倍下注」。
  ⚠️ **這一項與前三項性質不同，必須特別處理**：它「只要一次反彈就能全數解套」的
  說法，成立前提是**標的不會歸零、而且資金無限**；真實帳戶兩者都不成立，
  且連續下跌時所需投入資金呈指數成長。**每次提到它，都必須同時說明這個前提**，
  不得把它描述成與前三項等價的選項。`

/**
 * Set the system / user sections sent to the model.
 *
 * `customAnalysis` is an analysis criterion modified by the administrator in the background (0.6.19).
 * **The order makes sense**: Editable paragraphs → Fixed security rules → Operating framework vocabulary.
 * Security rules must be placed at the back to cover content that may be modified in the front, and framework vocabulary must be placed at the end.
 * After the safety rules, otherwise "you can talk about adding weight in batches" will read like relaxing the restrictions in the previous paragraph.
 */
export function renderAiPrompt(
  p: AiPayload,
  customAnalysis?: string | null,
): { system: string; user: string } {
  const system = `${resolvePrompt(customAnalysis, ANALYSIS_DEFAULT)}

${ANALYSIS_LOCKED}

${STRATEGY_FRAMEWORKS}`

  const chipSection = p.chip.hasReport
    ? `- 資料日期：${p.chip.dataDate ?? '未知'}
- 三大法人（單位：股數）：
${legText('外資（不含外資自營商）', p.chip.institutional!.foreign)}
${legText('外資自營商', p.chip.institutional!.foreignDealer)}
${legText('投信', p.chip.institutional!.trust)}
${legText('自營商', p.chip.institutional!.dealer)}
${legText('三大法人合計', p.chip.institutional!.total)}
- 融資融券（單位：張）：
  * 融資今日餘額：${num(p.chip.margin?.marginTodayLots ?? null)} 張（較前日 ${signed(p.chip.margin?.marginChangeLots ?? null)} 張）
  * 融券今日餘額：${num(p.chip.margin?.shortTodayLots ?? null)} 張（較前日 ${signed(p.chip.margin?.shortChangeLots ?? null)} 張）
- 連續天數（${p.chip.streakNote}）：
  * 外資 ${signed(p.chip.streaks?.foreign ?? null)} 天、投信 ${signed(p.chip.streaks?.trust ?? null)} 天、自營商 ${signed(p.chip.streaks?.dealer ?? null)} 天、三大法人合計 ${signed(p.chip.streaks?.total ?? null)} 天
  * 融資餘額 ${signed(p.chip.streaks?.margin ?? null)} 天、融券餘額 ${signed(p.chip.streaks?.short ?? null)} 天
- 近 7 個交易日買賣超與餘額（三大法人單位：股數，資券單位：張）：
${p.chip
  .history7Days!.map(
    (h) =>
      `  * ${h.date}：外資 ${signed(h.foreignNetShares)} 股、投信 ${signed(h.trustNetShares)} 股、自營商 ${signed(h.dealerNetShares)} 股、合計 ${signed(h.totalNetShares)} 股、融資餘額 ${num(h.marginTodayLots)} 張、融券餘額 ${num(h.shortTodayLots)} 張`,
  )
  .join('\n')}
${p.chip.notes?.length ? `- 報告附註：${p.chip.notes.join('; ')}` : ''}`
    : '（籌碼資料暫時無法取得，請只就技術面說明，並提醒使用者籌碼資料尚未產生。）'

  const fundamentalSection = p.fundamental.hasData
    ? [
        `- 產業別：${p.fundamental.industry ?? '無'}`,
        p.fundamental.valuation
          ? `- 估值（資料日期 ${p.fundamental.valuation.dataDate ?? '未知'}）：本益比 ${num(
              p.fundamental.valuation.peRatio,
            )} / 殖利率 ${num(p.fundamental.valuation.dividendYieldPercent)}% / 股價淨值比 ${num(
              p.fundamental.valuation.pbRatio,
            )}`
          : '- 估值：無',
        p.fundamental.revenueMonths && p.fundamental.revenueMonths.length > 0
          ? `- 月營收（單位：千元，由新到舊）：\n${p.fundamental.revenueMonths
              .map(
                (m) =>
                  `  * ${m.yearMonth}：營收 ${num(m.revenueThousandTwd)} 千元（月增 ${signed(
                    m.momPercent,
                  )}% / 年增 ${signed(m.yoyPercent)}%）`,
              )
              .join('\n')}`
          : '- 月營收：無',
        p.fundamental.profitQuarters && p.fundamental.profitQuarters.length > 0
          ? `- 獲利能力（單位：%，由新到舊）：\n${p.fundamental.profitQuarters
              .map(
                (q) =>
                  `  * ${q.yearQuarter}：毛利率 ${num(q.grossMarginPercent)}% / 營益率 ${num(
                    q.operatingMarginPercent,
                  )}% / 稅前純益率 ${num(q.pretaxMarginPercent)}% / 稅後純益率 ${num(
                    q.netMarginPercent,
                  )}%`,
              )
              .join('\n')}`
          : '- 獲利能力：無',
      ].join('\n')
    : '（基本面資料暫時無法取得，可能為上櫃股票或批次尚未產生，請勿臆測任何基本面數據。）'

  const macroSection = p.macro.hasData && p.macro.indicators
    ? p.macro.indicators
        .map(
          (i) =>
            `  * ${i.label}（${i.period ?? '期別不明'}）：${num(i.value)} ${i.unit}（前期 ${num(
              i.previousValue,
            )} ${i.unit}）`,
        )
        .join('\n')
    : '（總體經濟資料暫時無法取得，請勿臆測總經數據。）'

  const changePctText =
    p.technical.changePctPercent === null ? '無' : `${signed(p.technical.changePctPercent)}%`

  const user = `請為以下股票進行技術面、籌碼面、基本面與總體經濟的數據分析：

【股票基本資訊】
代號：${p.ticker}
名稱：${p.name}

【技術面摘要】（資料日期 ${p.technical.date}）
- 最新收盤價：${p.technical.close}（開盤 ${p.technical.open} / 最高 ${p.technical.high} / 最低 ${p.technical.low}）
- 漲跌：${signed(p.technical.change)}（${changePctText}）
- 成交量：${p.technical.volumeShares} 股（為 20 日均量的 ${num(p.technical.volRatioVs20DayAvg)} 倍）
- 移動平均線：MA5（週線）${num(p.technical.ma5)} / MA20（月線）${num(p.technical.ma20)} / MA60（季線）${num(p.technical.ma60)}（排列狀態：${p.technical.alignment ?? '無'}）
- 技術指標：K ${num(p.technical.k)} / D ${num(p.technical.d)} / RSI14 ${num(p.technical.rsi14)} / MACD 柱 ${num(p.technical.macdHist)}
- ${p.periodLabel}區間極值：最高收盤 ${p.technical.periodHighClose} / 最低收盤 ${p.technical.periodLowClose}

【籌碼面摘要】
${chipSection}

【基本面摘要】
${fundamentalSection}

【總體經濟背景】（${p.macro.region ?? '美國'}，全市場共用，非本檔個股數據）
${macroSection}

請在完成數據分析後，固定於最後包含「建議操作」與「注意事項」兩小節。`

  return { system, user }
}
