/**
 * TWSE 基本面（估值 + 月營收 + 產業別）抓取與解析。
 *
 * 資料來源（實測確認 2026-07-27，皆為 whole-market 大檔、無 date 參數，依代號篩單股）：
 * - 估值三指標：OpenAPI `exchangeReport/BWIBBU_ALL`
 *   英文鍵 { Date, Code, Name, PEratio, DividendYield, PBratio }，Date 為民國 7 碼（'1150724'）。
 *   虧損股 PEratio 為 '' 或 '-'（normNum 已處理成 null）。
 * - 月營收：OpenAPI `opendata/t187ap05_L`
 *   中文鍵；「資料年月」為民國 5 碼（'11506'）；營收單位是**千元**、增減率是 %；
 *   「產業別」直接給中文名稱（'半導體業'）。
 * - 公司基本資料：OpenAPI `opendata/t187ap03_L`
 *   「產業別」是**兩位數代碼**（'24'），需查 INDUSTRY_NAMES 對照表。
 *
 * 產業別來源順位：t187ap05_L 的中文名稱（免維護）→ t187ap03_L 代碼查表 → 原始代碼。
 *
 * 單位陷阱：月營收千元、殖利率與增減率 %。欄位名一律帶單位
 * （revenueThousandTwd / yoyPercent），沿用 twChips「不讓單位離開欄位」的準則。
 *
 * 解析函式皆為純函式、不觸網，便於單元測試；HTTP 抓取與快取在 index.ts 組合。
 * 上櫃 (TPEx) 不在這三份檔內，查無時由呼叫端寫入缺料註記。
 */

import { normNum } from './twChips.ts'

export const BWIBBU_ALL_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL'
export const T187AP05_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'
export const T187AP03_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'

/**
 * 基本面檔的結構版本。
 * 前端守門必須用 `>=` 比對（見 src/services/fundamentalProxy.ts）——
 * 加欄位對舊前端是無害的加法，用等號會在後端升版時讓整個分頁當場全掛（0.4.1 事故）。
 */
export const FUNDAMENTAL_SCHEMA = 1

/** TWSE 上市產業別代碼 → 中文名稱（t187ap03_L 用；t187ap05_L 直接給名稱不需查表） */
export const INDUSTRY_NAMES: Record<string, string> = {
  '01': '水泥工業',
  '02': '食品工業',
  '03': '塑膠工業',
  '04': '紡織纖維',
  '05': '電機機械',
  '06': '電器電纜',
  '08': '玻璃陶瓷',
  '09': '造紙工業',
  '10': '鋼鐵工業',
  '11': '橡膠工業',
  '12': '汽車工業',
  '14': '建材營造',
  '15': '航運業',
  '16': '觀光餐旅',
  '17': '金融保險',
  '18': '貿易百貨',
  '19': '綜合',
  '20': '其他',
  '21': '化學工業',
  '22': '生技醫療',
  '23': '油電燃氣',
  '24': '半導體業',
  '25': '電腦及週邊設備業',
  '26': '光電業',
  '27': '通信網路業',
  '28': '電子零組件業',
  '29': '電子通路業',
  '30': '資訊服務業',
  '31': '其他電子業',
}

/** 估值三指標。任一缺值以 null 表示（不以 0 冒充），虧損股本益比即為 null */
export interface ValuationChip {
  peRatio: number | null
  dividendYieldPercent: number | null
  pbRatio: number | null
  /** BWIBBU 檔的資料日 YYYY-MM-DD；解析失敗為 null */
  dataDate: string | null
}

/** 一個月份的營收。單位寫進欄位名：金額千元、增減率 % */
export interface RevenueMonth {
  /** 'YYYY-MM' */
  yearMonth: string
  revenueThousandTwd: number | null
  momPercent: number | null
  yoyPercent: number | null
  cumulativeYoyPercent: number | null
}

/** Storage 內 fundamental/{ticker}.json 的結構 */
export interface FundamentalFile {
  schema: number
  ticker: string
  name: string
  /** 我們實際產出它的時間 ISO */
  asOf: string
  /** 本次批次的交易日 YYYY-MM-DD；批次據此判斷要不要重寫 */
  dataDate: string
  industry: string | null
  valuation: ValuationChip | null
  revenueUnit: '千元'
  /** 由舊到新，最多 12 個月（覆寫制檔案內自累積） */
  revenueMonths: RevenueMonth[]
  notes: string[]
}

/** 民國 7 碼日期 '1150724' → '2026-07-24'；格式不符回 null */
export function rocDate(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!/^\d{7}$/.test(s)) return null
  const year = Number(s.slice(0, 3)) + 1911
  return `${year}-${s.slice(3, 5)}-${s.slice(5, 7)}`
}

/** 民國 5 碼年月 '11506' → '2026-06'；格式不符回 null */
export function rocYearMonth(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!/^\d{5}$/.test(s)) return null
  const year = Number(s.slice(0, 3)) + 1911
  return `${year}-${s.slice(3, 5)}`
}

/** 由 BWIBBU_ALL 取單一代號的估值。查無回 null */
export function extractValuation(
  rows: Array<Record<string, string>> | null,
  ticker: string,
): ValuationChip | null {
  const row = (rows ?? []).find((r) => String(r.Code ?? '').trim() === ticker)
  if (!row) return null
  return {
    peRatio: normNum(row.PEratio),
    dividendYieldPercent: normNum(row.DividendYield),
    pbRatio: normNum(row.PBratio),
    dataDate: rocDate(row.Date),
  }
}

/** 由 t187ap05_L 取單一代號的最新月營收。查無或年月解析失敗回 null */
export function extractRevenue(
  rows: Array<Record<string, string>> | null,
  ticker: string,
): RevenueMonth | null {
  const row = (rows ?? []).find((r) => String(r['公司代號'] ?? '').trim() === ticker)
  if (!row) return null
  const yearMonth = rocYearMonth(row['資料年月'])
  if (!yearMonth) return null
  return {
    yearMonth,
    revenueThousandTwd: normNum(row['營業收入-當月營收']),
    momPercent: normNum(row['營業收入-上月比較增減(%)']),
    yoyPercent: normNum(row['營業收入-去年同月增減(%)']),
    cumulativeYoyPercent: normNum(row['累計營業收入-前期比較增減(%)']),
  }
}

/**
 * 產業別：t187ap05_L 中文名稱優先，退 t187ap03_L 代碼查表，再退原始代碼。
 * 兩份都查無（上櫃股）回 null。
 */
export function extractIndustry(
  revenueRows: Array<Record<string, string>> | null,
  companyRows: Array<Record<string, string>> | null,
  ticker: string,
): string | null {
  const revRow = (revenueRows ?? []).find((r) => String(r['公司代號'] ?? '').trim() === ticker)
  const revName = String(revRow?.['產業別'] ?? '').trim()
  if (revName) return revName

  const compRow = (companyRows ?? []).find((r) => String(r['公司代號'] ?? '').trim() === ticker)
  const code = String(compRow?.['產業別'] ?? '').trim()
  if (!code) return null
  return INDUSTRY_NAMES[code] ?? code
}

/** revenueMonths 上限。12 個月足以看出年增趨勢，也控住 payload 大小 */
export const REVENUE_MONTHS_CAP = 12

/**
 * 把最新月份併入既有序列：依 yearMonth 去重（新值蓋舊值）、由舊到新排序、cap 12。
 * 覆寫制檔案靠這個在每晚重寫時自累積月營收史（首月 1 筆，逐月長到 12 筆）。
 */
export function mergeRevenueMonths(
  prev: RevenueMonth[] | null | undefined,
  latest: RevenueMonth | null,
): RevenueMonth[] {
  const byMonth = new Map<string, RevenueMonth>()
  for (const m of prev ?? []) {
    if (m && typeof m.yearMonth === 'string' && m.yearMonth) byMonth.set(m.yearMonth, m)
  }
  if (latest) byMonth.set(latest.yearMonth, latest)
  return [...byMonth.values()]
    .sort((a, b) => (a.yearMonth < b.yearMonth ? -1 : 1))
    .slice(-REVENUE_MONTHS_CAP)
}
