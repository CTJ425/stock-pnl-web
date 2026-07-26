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

export function buildAiPayload(args: {
  ticker: string
  name: string
  view: TechnicalView
  report: ReportData | null
  range: RangeKey
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

  const base = { ticker, name, periodLabel: RANGE_LABELS[range], technical }

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
  const system = `你是一位專業且客觀的股市數據解讀助理。請依據使用者提供的結構化資料進行綜合簡明解讀。

解讀準則：
1. 必須全篇使用繁體中文，語言平實白話、句子簡短，分 3 至 5 個段落呈現。
2. 絕對不得列出任何數學公式或計算過程，避免使用艱深難懂的內行術語。
3. 僅得引用提供資料中的明確數據與指標，絕對不得自行計算、猜測或臆測未提供的任何數據。
4. 引用數字時必須沿用資料給定的單位（三大法人為股數、融資融券為張），不得自行換算。
5. 絕對不得提供任何買賣建議、操作訊號、目標價或投資決策引導。
6. 結尾必須單獨成段，附上固定聲明：「本解讀為數據資料之客觀摘要說明，不構成任何投資建議或買賣推薦。」`

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

  const changePctText =
    p.technical.changePctPercent === null ? '無' : `${signed(p.technical.changePctPercent)}%`

  const user = `請為以下股票進行技術面與籌碼面數據解讀：

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
${chipSection}`

  return { system, user }
}
