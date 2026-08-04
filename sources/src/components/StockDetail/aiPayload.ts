/**
 * AI Payload 與 Prompt 產生邏輯。
 *
 * 核心約束 (PLAN.md §M1.1)：
 * 1. 技術面由程式計算好 (TechnicalView.latest)，絕對不把 243 筆原始收盤價放進 payload。
 * 2. 單位必須寫進欄位標籤：三大法人為「股數」、融資融券為「張」。
 * 3. 嚴禁包含持股 (holding)、成本 (avgCost) 或未實現損益 (unrealized)。
 *
 * 兩個餵給模型時特別容易出錯、已用測試釘住的地方：
 * - `TechnicalView.latest.changePct` 是**小數比例**（0.0148 = +1.48%），
 *   直接接個 `%` 印出去會讓模型講出小 100 倍的漲跌幅。故此處欄位名為
 *   `changePctPercent`，值已乘 100。
 * - `ChipStreaks` 的正負號帶語意（正＝連買 / 連增，負＝連賣 / 連減），
 *   光給數字模型會把 -3 讀成「增加了 -3 天」。故 payload 附 `streakNote` 說明。
 */
import type { FundamentalData } from '../../services/fundamentalProxy'
import type { MacroData } from '../../services/macroProxy'
import type { NewsData } from '../../services/newsProxy'
import type { ReportData } from '../../services/reportProxy'
import type { RangeKey, TechnicalView } from './technicalView'
import { RANGE_LABELS } from './technicalView'
import { ANALYSIS_DEFAULT, ANALYSIS_LOCKED, resolvePrompt } from '../../services/aiPrompts'

/** 四捨五入到 n 位小數；null 照樣回 null（不要用 0 代替缺值） */
function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** 買進 / 賣出 / 買賣超三件組（單位：股數） */
interface LegShares {
  buyShares: number | null
  sellShares: number | null
  netShares: number | null
}

export interface AiPayload {
  ticker: string
  name: string
  /** 技術面資料涵蓋的區間（例：近 1 年） */
  periodLabel: string
  technical: {
    date: string
    close: number
    open: number
    high: number
    low: number
    /** 成交量，單位：股數 */
    volumeShares: number
    change: number | null
    /** 已換算為百分比數值：1.48 代表 +1.48% */
    changePctPercent: number | null
    ma5: number | null
    ma20: number | null
    ma60: number | null
    alignment: string | null
    k: number | null
    d: number | null
    rsi14: number | null
    macdHist: number | null
    /** 成交量相對 20 日均量的倍數：1.5 代表 1.5 倍 */
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
  /** 基本面（0.6.0-dev.4）。上櫃股與批次未跑到的代號皆為 hasData: false */
  fundamental: {
    hasData: boolean
    industry?: string | null
    valuation?: {
      peRatio: number | null
      dividendYieldPercent: number | null
      pbRatio: number | null
      dataDate: string | null
    }
    /** 月營收金額的單位；與籌碼的 unitInstitutional 同樣是「單位不離開 payload」 */
    revenueUnit?: '千元'
    /** 由新到舊，最多 12 個月 */
    revenueMonths?: Array<{
      yearMonth: string
      revenueThousandTwd: number | null
      momPercent: number | null
      yoyPercent: number | null
    }>
    /** 獲利能力比率的單位（0.6.5）。同樣是「單位不離開 payload」 */
    profitUnit?: '%'
    /** 由新到舊，最多 8 季 */
    profitQuarters?: Array<{
      yearQuarter: string
      grossMarginPercent: number | null
      operatingMarginPercent: number | null
      pretaxMarginPercent: number | null
      netMarginPercent: number | null
    }>
  }
  /**
   * 總體經濟背景（0.6.5，美國）。**與個股無關**，是共用的背景資料。
   * system prompt 有一條準則明令不得用它推導個股漲跌。
   */
  macro: {
    hasData: boolean
    region?: string
    indicators?: Array<{
      label: string
      /** 單位隨值走：'%' / '千人' / '指數' */
      unit: string
      period: string | null
      value: number | null
      previousValue: number | null
    }>
  }
  /** 消息面（0.6.0-dev.4）。只有標題，沒有內文——模型只能就標題字面判斷 */
  news: {
    hasData: boolean
    items?: Array<{
      /** YYYY-MM-DD；RSS 未附時間時為 null */
      date: string | null
      source: string | null
      title: string
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

/** 進 prompt 的新聞則數上限，與 Edge Function 端的 NEWS_MAX_ITEMS 對齊 */
const NEWS_ITEMS_IN_PROMPT = 10

/** ISO 時間 → YYYY-MM-DD；缺時間或解析失敗回 null */
function isoDateOnly(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function buildFundamentalBlock(f: FundamentalData | null): AiPayload['fundamental'] {
  // 有檔案但三項全空（上櫃股的缺料檔）等同沒資料，不要讓 prompt 印出一串「無」
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
      grossMarginPercent: round(q.grossMarginPercent),
      operatingMarginPercent: round(q.operatingMarginPercent),
      pretaxMarginPercent: round(q.pretaxMarginPercent),
      netMarginPercent: round(q.netMarginPercent),
    })),
  }
}

/**
 * 總經區塊。缺料時 hasData: false，prompt 會印替代文案而不是一串「無」。
 * 只送最新與前一期的值 —— 12 期序列對模型的邊際價值低，卻會顯著拉長每一輪的 token。
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

function buildNewsBlock(n: NewsData | null): AiPayload['news'] {
  if (!n || n.items.length === 0) return { hasData: false }
  return {
    hasData: true,
    items: n.items.slice(0, NEWS_ITEMS_IN_PROMPT).map((i) => ({
      date: isoDateOnly(i.publishedAt),
      source: i.source,
      title: i.title,
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
  news?: NewsData | null
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
    // ×100：latest.changePct 是小數比例，見檔頭說明
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
    news: buildNewsBlock(args.news ?? null),
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

/** 數字缺值時一律印「無」，不要印 0——0 在買賣超裡是「持平」，與「沒資料」是兩件事 */
function num(value: number | null): string {
  return value === null ? '無' : String(value)
}

/** 帶正負號輸出（連續天數與買賣超都要看得出方向） */
function signed(value: number | null): string {
  if (value === null) return '無'
  return value > 0 ? `+${value}` : String(value)
}

function legText(label: string, l: LegShares): string {
  return `  * ${label}：買進 ${num(l.buyShares)} 股 / 賣出 ${num(l.sellShares)} 股 / 買賣超 ${signed(l.netShares)} 股`
}

/**
 * 使用者採用的分批進出框架（0.6.9-dev.2，由使用者指定）。
 *
 * **這是給模型的「描述用語彙」，不是放寬準則 5 的許可。**
 * 模型可以用這些名詞說明目前數據落在哪個情境，但仍不得指定加碼比例、
 * 不得指定價位、不得說「現在該買 / 該賣」—— 分批百分比只是說明框架時的舉例。
 *
 * **馬丁格爾與另外三個性質不同，故單獨標註前提。** 金字塔、倒金字塔、非等距網格
 * 都是**有上限**的部位管理；馬丁格爾照定義是無上限的（虧損後加倍下注），
 * 它「最終只要一次反彈就解套」的說法成立於「標的不歸零且資金無限」——
 * 而真實帳戶兩個都不成立，連續下跌時所需資金呈指數成長。
 * prompt 強制模型每次提到它就講出這個前提，避免它被當成與其他三者等價的選項。
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
 * 組出送給模型的 system / user 兩段。
 *
 * `customAnalysis` 是管理員在後台改過的分析準則（0.6.19）。
 * **順序有意義**：可編輯段落 → 固定的安全規則 → 操作框架語彙。
 * 安全規則排在後面才蓋得住前面可能被改壞的內容，而框架語彙必須排在
 * 安全規則之後，否則「可以講分批加碼」讀起來會像是放寬了前一段的限制。
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

  const newsSection =
    p.news.hasData && p.news.items
      ? p.news.items
          .map((i) => `  * ${i.date ?? '日期不明'}（${i.source ?? '來源不明'}）：${i.title}`)
          .join('\n')
      : '（近期無可取得之新聞標題，請勿臆測消息面。）'

  const changePctText =
    p.technical.changePctPercent === null ? '無' : `${signed(p.technical.changePctPercent)}%`

  const user = `請為以下股票進行技術面、籌碼面、基本面、總體經濟與消息面的數據分析：

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

【近期新聞標題】（只有標題、沒有內文）
${newsSection}

請在完成數據分析後，固定於最後包含「建議操作」與「注意事項」兩小節。`

  return { system, user }
}
