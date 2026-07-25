/**
 * TWSE 基本面（EPS 與估值指標）抓取與解析。
 *
 * ⚠️ 基本面與籌碼是**完全不同性質**的資料，不可互推：
 * 籌碼是交易流量（誰買了幾股），EPS 是公司獲利 ÷ 股數。EPS 只能來自財報。
 *
 * 資料來源（皆為 whole-market 檔，實測確認，**皆無 date / 季別參數**，只回最新一期）：
 * - 財報（權威 EPS，每季更新）：`opendata/t187ap06_L_{suffix}` 綜合損益表
 *   **必須五個產業表全抓再合併** —— 實測 2891 中信金、2882 國泰金在 `_fh`，不在 `_ci`。
 * - 估值（每日更新）：`exchangeReport/BWIBBU_ALL`（本益比 / 殖利率 / 股價淨值比）
 *   該端點**沒有 EPS 欄位**；年化 EPS 由「收盤價 ÷ 本益比」反推
 *   （TWSE 的本益比定義為收盤價 ÷ 最近四季 EPS）。
 *
 * 解析函式皆為純函式、不觸網，便於單元測試；HTTP 抓取與 DB 快取在 index.ts 組合。
 * 上櫃(TPEx) 與 ETF 不在這些端點內，查無時回 null，由呼叫端與 UI 區分文案。
 */
import { normNum } from './twChips.ts'

export const BWIBBU_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL'
export const STOCK_DAY_AVG_URL =
  'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL'

/**
 * 綜合損益表的產業後綴。五表欄位名稱一致，差別只在收錄哪些公司。
 * `_basi`（金融業）實測抓取失敗，故不列入；缺它不影響上市主要標的。
 */
export const INCOME_SUFFIXES = ['ci', 'fh', 'ins', 'bd', 'mim'] as const
export type IncomeSuffix = (typeof INCOME_SUFFIXES)[number]

export function incomeStatementUrl(suffix: IncomeSuffix): string {
  return `https://openapi.twse.com.tw/v1/opendata/t187ap06_L_${suffix}`
}

/** 民國年 → 西元年。存進 DB 一律用西元，排序與顯示才不會出錯 */
export function rocYearToAd(roc: string | number | null | undefined): number | null {
  const n = normNum(roc)
  if (n === null) return null
  // 只接受合理的民國年範圍，避免誤把西元年再加 1911
  if (n < 1 || n > 300) return null
  return n + 1911
}

/**
 * 依台灣財報申報期限，推算「此刻應該已公布的最新一季」。
 * 用途：判斷 DB 裡是否已有該季 —— 有就完全不用抓那五個端點（每季只抓一次，不是每天）。
 *
 * 申報期限：Q1 5/15、Q2 8/14、Q3 11/14、年報(Q4) 隔年 3/31。
 * 實測驗證：2026-07-25 → 2026 Q1，與端點當時實際回傳的「115 年第 1 季」一致。
 */
export function expectedLatestQuarter(now: Date): { year: number; quarter: number } {
  const y = now.getFullYear()
  const md = (now.getMonth() + 1) * 100 + now.getDate() // 例：7/25 → 725
  if (md >= 1114) return { year: y, quarter: 3 }
  if (md >= 814) return { year: y, quarter: 2 }
  if (md >= 515) return { year: y, quarter: 1 }
  if (md >= 331) return { year: y - 1, quarter: 4 }
  return { year: y - 1, quarter: 3 }
}

/** 每日估值指標（單位：本益比與股價淨值比為倍數、殖利率為百分比數值） */
export interface ValuationChip {
  /** 本益比（倍）。TWSE 定義：收盤價 ÷ 最近四季每股盈餘 */
  peRatio: number | null
  /** 殖利率（%）。來源已是百分比數值，**不要再乘 100** */
  dividendYield: number | null
  /** 股價淨值比（倍） */
  pbRatio: number | null
  /** 收盤價（元），用於反推年化 EPS */
  closePrice: number | null
  /** 反推的最近四季每股盈餘（元）＝ 收盤價 ÷ 本益比。本益比極高時此值極不精確 */
  ttmEps: number | null
  /** 估值資料所屬日期 YYYY-MM-DD（來源為民國 1150724） */
  date: string | null
}

/** 單季財報（金額單位：千元） */
export interface FundamentalQuarter {
  /** 西元年 */
  year: number
  /** 1–4 */
  quarter: number
  /** 基本每股盈餘（元） */
  eps: number | null
  /** 營業收入（千元） */
  revenue: number | null
  /** 淨利（淨損）歸屬於母公司業主（千元） */
  netIncome: number | null
}

type Row = Record<string, unknown>

interface BwibbuRow {
  Date?: string
  Code?: string
  Name?: string
  PEratio?: string
  DividendYield?: string
  PBratio?: string
}

/** 民國 1150724 → 2026-07-24；格式不符回 null */
export function rocDateToDash(roc: string | null | undefined): string | null {
  const s = String(roc ?? '').trim()
  if (!/^\d{7}$/.test(s)) return null
  const year = rocYearToAd(s.slice(0, 3))
  if (year === null) return null
  return `${year}-${s.slice(3, 5)}-${s.slice(5, 7)}`
}

/**
 * 由 BWIBBU_ALL 取單一代號的估值指標。
 * closePrice 由呼叫端另外帶入（BWIBBU 本身沒有收盤價），以便反推年化 EPS。
 */
export function extractValuation(
  rows: BwibbuRow[],
  ticker: string,
  closePrice: number | null,
): ValuationChip | null {
  const row = rows.find((r) => String(r.Code ?? '').trim() === ticker)
  if (!row) return null
  const peRatio = normNum(row.PEratio)
  // 本益比為 0 或缺值時不可相除
  const ttmEps = peRatio !== null && peRatio > 0 && closePrice !== null ? closePrice / peRatio : null
  return {
    peRatio,
    dividendYield: normNum(row.DividendYield),
    pbRatio: normNum(row.PBratio),
    closePrice,
    ttmEps: ttmEps === null ? null : Math.round(ttmEps * 100) / 100,
    date: rocDateToDash(row.Date),
  }
}

/** 由 STOCK_DAY_AVG_ALL 取收盤價（`stock-price` 的 twlist 已在用同一份檔） */
export function extractClosePrice(rows: Row[], ticker: string): number | null {
  const row = rows.find((r) => String(r['Code'] ?? '').trim() === ticker)
  return row ? normNum(row['ClosingPrice']) : null
}

/**
 * 由綜合損益表取單一代號的單季財報。
 * 以**欄位名稱**比對：五表欄名一致且不重複，比位置索引耐得住欄序調動
 * （位置索引只在欄名重複時才必要，例如 rwd 的融資融券表）。
 */
export function extractIncome(rows: Row[], ticker: string): FundamentalQuarter | null {
  const row = rows.find((r) => String(r['公司代號'] ?? '').trim() === ticker)
  if (!row) return null
  const year = rocYearToAd(row['年度'] as string)
  const quarter = normNum(row['季別'])
  if (year === null || quarter === null || quarter < 1 || quarter > 4) return null
  return {
    year,
    quarter,
    eps: normNum(row['基本每股盈餘（元）']),
    revenue: normNum(row['營業收入']),
    netIncome: normNum(row['淨利（淨損）歸屬於母公司業主']),
  }
}

/** 財報回應是否可用（避免把錯誤頁面或空陣列寫進快取） */
export function incomeRowsOk(rows: unknown): rows is Row[] {
  return Array.isArray(rows) && rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null &&
    '公司代號' in (rows[0] as Row)
}

/**
 * ETF 沒有 EPS 與本益比 —— 它的價值來自持有的一籃子股票，不是自身獲利。
 * 沿用專案既有慣例：代號 `00` 開頭為 ETF（見 SPEC 的證交稅規則）。
 */
export function isEtfTicker(ticker: string): boolean {
  return ticker.startsWith('00')
}
