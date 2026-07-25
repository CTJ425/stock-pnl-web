/**
 * 報告資料模型組裝：把抓來的籌碼 + 前端帶入的持股脈絡（成本/損益）合成 ReportData。
 * 純資料層，不觸網、不碰 DB，便於單元測試。
 *
 * schema 2（v0.3.7-dev.3 起）：伺服器只回結構化資料，不再產生 HTML；
 * 內嵌最多 7 個交易日的 history 供前端自繪走勢圖。
 * schema 3（v0.3.7-dev.5 起）：新增 fundamentals（財報 EPS 與估值指標）。
 * 前端接受 schema >= 2，fundamentals 視為選填 —— 基本面是加法，
 * 不該讓一份仍然有效的籌碼報告因為缺它而被判為未命中。
 */
import type { ChipLeg, InstitutionalChip, MarginChip, BorrowChip } from './twChips.ts'
import type { FundamentalQuarter, ValuationChip } from './twFundamentals.ts'

/** 報告結構版本 */
export const REPORT_SCHEMA = 3

/** 前端帶入的持股脈絡（皆為前端已算好的值，Worker 不重算） */
export interface HoldingContext {
  qty: number
  avgCost: number
  price: number | null
  unrealized: number | null
  roi: number | null
}

/** 單一交易日的籌碼快照 */
export interface ChipDay {
  /** 資料所屬交易日 YYYY-MM-DD */
  date: string
  institutional: InstitutionalChip | null
  margin: MarginChip | null
}

/** 連買連賣 / 連增連減：正數＝連續 N 天買超（增加），負數＝連續 N 天賣超（減少），0＝中斷 */
export interface ChipStreaks {
  foreign: number
  foreignDealer: number
  trust: number
  dealer: number
  total: number
  /** 融資餘額連增連減 */
  margin: number
  /** 融券餘額連增連減 */
  short: number
}

/**
 * 基本面。與籌碼的更新頻率不同（財報每季、估值每日），故兩個日期各自標明，不可共用。
 * ETF 與上櫃查無資料時整個 fundamentals 為 null，由前端區分文案。
 */
export interface Fundamentals {
  /** 每日估值指標（本益比 / 殖利率 / 股價淨值比 / 反推年化 EPS） */
  valuation: ValuationChip | null
  /** 單季財報，由舊到新。官方端點只回最新一期，歷史靠 stock_fundamentals 累積 */
  quarters: FundamentalQuarter[]
  /** true 表示此代號是 ETF，本質上沒有 EPS，UI 須用專屬文案而非籠統的「查無」 */
  isEtf: boolean
}

export interface ReportData {
  schema: typeof REPORT_SCHEMA
  ticker: string
  name: string
  market: 'TPE'
  /** 最新交易日 YYYY-MM-DD（= history 最後一筆） */
  dataDate: string
  /** 產生時間 ISO */
  generatedAt: string
  holding: HoldingContext | null
  /** 最新交易日的三大法人（= history 最後一筆，方便前端直接取用） */
  institutional: InstitutionalChip | null
  /** 最新交易日的融資融券 */
  margin: MarginChip | null
  /** 借券（來源無 date 參數，僅最新交易日） */
  borrow: BorrowChip | null
  /** 由舊到新，最多 7 個交易日 */
  history: ChipDay[]
  streaks: ChipStreaks
  /** 基本面（schema 3 起）。查無時為 null */
  fundamentals: Fundamentals | null
  /** 缺漏 / 降級說明（如上櫃暫不支援、歷史資料回補中） */
  notes: string[]
}

/** 台北時區（UTC+8）的 YYYYMMDD */
function taipeiYmd(d: Date): string {
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const y = t.getUTCFullYear()
  const m = String(t.getUTCMonth() + 1).padStart(2, '0')
  const day = String(t.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/**
 * 回推交易日候選（含當日往前數天，由新到舊），用於 rwd 端點嘗試；
 * 週末 / 假日 / 尚未收盤時前一候選會抓不到，改試更早的。
 */
export function tradingDateCandidates(now: Date, back = 7): string[] {
  const out: string[] = []
  for (let i = 0; i <= back; i++) {
    out.push(taipeiYmd(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)))
  }
  return out
}

/**
 * 週六 / 週日必定非交易日，先剔除可省下白抓的外部請求（假日仍需實抓才知道）。
 * 直接以 YYYYMMDD 當 UTC 日期算星期，不受執行環境時區影響。
 */
export function isWeekendYmd(ymd: string): boolean {
  const dow = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay()
  return dow === 0 || dow === 6
}

/** YYYYMMDD → YYYY-MM-DD */
export function dashDate(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

/**
 * 由「由舊到新」的序列算連續天數：
 * 從最新一筆往回數同號的連續筆數，遇 0 或 null（當日無資料）即中斷。
 * 回傳值帶正負號（+3 = 連 3 買 / 連 3 增；-2 = 連 2 賣 / 連 2 減）。
 */
export function computeStreak(series: Array<number | null>): number {
  const last = series[series.length - 1]
  if (last === null || last === undefined || last === 0) return 0
  const sign = last > 0 ? 1 : -1
  let n = 0
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i]
    if (v === null || v === undefined || v === 0) break
    if (Math.sign(v) !== sign) break
    n++
  }
  return sign * n
}

/** 取 history 中某條買賣超序列（由舊到新） */
function netSeries(
  history: ChipDay[],
  pick: (i: InstitutionalChip) => ChipLeg,
): Array<number | null> {
  return history.map((d) => (d.institutional ? pick(d.institutional).net : null))
}

export function computeStreaks(history: ChipDay[]): ChipStreaks {
  return {
    foreign: computeStreak(netSeries(history, (i) => i.foreign)),
    foreignDealer: computeStreak(netSeries(history, (i) => i.foreignDealer)),
    trust: computeStreak(netSeries(history, (i) => i.trust)),
    dealer: computeStreak(netSeries(history, (i) => i.dealer)),
    total: computeStreak(netSeries(history, (i) => i.total)),
    margin: computeStreak(history.map((d) => d.margin?.marginChange ?? null)),
    short: computeStreak(history.map((d) => d.margin?.shortChange ?? null)),
  }
}

export interface BuildReportParams {
  ticker: string
  name: string
  dataDateYmd: string
  holding: HoldingContext | null
  /** 由舊到新的交易日序列（最後一筆＝最新交易日） */
  history: ChipDay[]
  borrow: BorrowChip | null
  fundamentals?: Fundamentals | null
  notes: string[]
  now?: Date
}

export function buildReport(p: BuildReportParams): ReportData {
  const latest = p.history[p.history.length - 1] ?? null
  return {
    schema: REPORT_SCHEMA,
    ticker: p.ticker,
    name: p.name,
    market: 'TPE',
    dataDate: dashDate(p.dataDateYmd),
    generatedAt: (p.now ?? new Date()).toISOString(),
    holding: p.holding,
    institutional: latest?.institutional ?? null,
    margin: latest?.margin ?? null,
    borrow: p.borrow,
    history: p.history,
    streaks: computeStreaks(p.history),
    fundamentals: p.fundamentals ?? null,
    notes: p.notes,
  }
}
