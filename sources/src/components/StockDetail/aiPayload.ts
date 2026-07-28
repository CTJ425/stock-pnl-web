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
import type { NewsData } from '../../services/newsProxy'
import type { ReportData } from '../../services/reportProxy'
import type { RangeKey, TechnicalView } from './technicalView'
import { RANGE_LABELS } from './technicalView'

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
  const hasAny = !!f && (f.valuation !== null || f.revenueMonths.length > 0 || !!f.industry)
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

export function renderAiPrompt(p: AiPayload): { system: string; user: string } {
  const system = `你是一位專業且客觀的股市數據分析助理。請依據使用者提供的結構化資料進行綜合簡明分析。

分析準則：
1. 必須全篇使用繁體中文，語言平實白話、句子簡短，先以 3 至 5 個段落分析數據，最後固定加上『建議操作』與『注意事項』兩個小節，小節標題須一字不差。
2. 絕對不得列出任何數學公式或計算過程，避免使用艱深難懂的內行術語。
3. 僅得引用提供資料中的明確數據與指標，絕對不得自行計算、猜測或臆測未提供的任何數據。
4. 引用數字時必須沿用資料給定的單位（三大法人為股數、融資融券為張、月營收為千元、殖利率與增減率為百分比），不得自行換算。
5. 『建議操作』僅得提出中性、條件式的觀察性參考（例如：若跌破月線可留意支撐是否守住），絕對不得給出明確的買進 / 賣出 / 加碼 / 出清指令，不得提供目標價、進出場價位或報酬預期。
6. 『注意事項』須指出資料中可見的風險訊號（例如量能異常、資券餘額變化、指標鈍化、均線糾結）與資料本身的侷限（例如籌碼資料缺漏時要說明）。
7. 新聞只提供標題，不含內文。僅得依標題字面判斷可能偏向利多或利空，絕對不得臆測、擴寫或引用標題以外的新聞內容；消息面的判讀只能以條件式觀察的形式併入『建議操作』與『注意事項』，不得單獨據以給出買賣指令。
8. 結尾必須單獨成段，附上固定聲明：「本分析為數據資料之客觀摘要說明，不構成任何投資建議或買賣推薦。」`

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
      ].join('\n')
    : '（基本面資料暫時無法取得，可能為上櫃股票或批次尚未產生，請勿臆測任何基本面數據。）'

  const newsSection =
    p.news.hasData && p.news.items
      ? p.news.items
          .map((i) => `  * ${i.date ?? '日期不明'}（${i.source ?? '來源不明'}）：${i.title}`)
          .join('\n')
      : '（近期無可取得之新聞標題，請勿臆測消息面。）'

  const changePctText =
    p.technical.changePctPercent === null ? '無' : `${signed(p.technical.changePctPercent)}%`

  const user = `請為以下股票進行技術面、籌碼面、基本面與消息面的數據分析：

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

【近期新聞標題】（只有標題、沒有內文）
${newsSection}

請在完成數據分析後，固定於最後包含「建議操作」與「注意事項」兩小節。`

  return { system, user }
}
