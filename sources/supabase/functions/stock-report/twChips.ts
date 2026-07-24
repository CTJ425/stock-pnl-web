/**
 * TWSE 盤後籌碼抓取與解析。
 *
 * 資料來源（實測確認，皆為 whole-market 大檔，依 ticker 篩單股）：
 * - 三大法人個股買賣超：TWSE rwd `fund/T86`（需 date 參數，回 { fields, data, date }）
 * - 融資融券餘額：TWSE OpenAPI `exchangeReport/MI_MARGN`（最新交易日，物件陣列）
 * - 借券賣出可用股數：TWSE OpenAPI `SBL/TWT96U`（TWSE/GRETAI 兩組平行欄位）
 *
 * 解析函式皆為純函式、不觸網，便於單元測試；HTTP 抓取與 DB 快取在 index.ts 組合。
 * 上櫃(TPEx) 逐股端點 v1 暫不支援，查無資料時對應區塊標記缺漏。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const MI_MARGN_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN'
export const SBL_URL = 'https://openapi.twse.com.tw/v1/SBL/TWT96U'

export function t86Url(dateYYYYMMDD: string): string {
  return `https://www.twse.com.tw/rwd/zh/fund/T86?date=${dateYYYYMMDD}&selectType=ALLBUT0999&response=json`
}

/** 千分位字串轉數字；空字串 / 非數字回 null。保留正負號（買賣超可為負） */
export function normNum(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/,/g, '').trim()
  if (s === '' || s === '--') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export interface InstitutionalChip {
  /** 外陸資買賣超（不含外資自營商） */
  foreign: number | null
  /** 外資自營商買賣超 */
  foreignDealer: number | null
  /** 投信買賣超 */
  trust: number | null
  /** 自營商買賣超（自行 + 避險合計） */
  dealer: number | null
  /** 三大法人買賣超合計 */
  total: number | null
}

export interface MarginChip {
  marginToday: number | null
  marginPrev: number | null
  /** 融資餘額變化 = 今日 − 前日 */
  marginChange: number | null
  marginLimit: number | null
  shortToday: number | null
  shortPrev: number | null
  /** 融券餘額變化 = 今日 − 前日 */
  shortChange: number | null
  shortLimit: number | null
  /** 資券互抵 */
  offset: number | null
}

export interface BorrowChip {
  /** 借券賣出可用股數 */
  availableVolume: number | null
}

interface T86Response {
  stat?: string
  fields?: string[]
  data?: string[][]
  date?: string
  tables?: Array<{ fields?: string[]; data?: string[][] }>
}

/** 從 T86 回應中取出 fields/data（相容 top-level 與 tables[0] 兩種結構） */
function t86Table(resp: T86Response): { fields: string[]; data: string[][] } {
  if (Array.isArray(resp.fields) && Array.isArray(resp.data)) {
    return { fields: resp.fields, data: resp.data }
  }
  const t = resp.tables?.[0]
  if (t && Array.isArray(t.fields) && Array.isArray(t.data)) {
    return { fields: t.fields, data: t.data }
  }
  return { fields: [], data: [] }
}

/** T86 欄位名稱可能夾雜全形空白 / 尾隨空白，比對時正規化 */
function cleanHeader(s: string): string {
  return s.replace(/\s+/g, '')
}

export function extractInstitutional(resp: T86Response, ticker: string): InstitutionalChip | null {
  const { fields, data } = t86Table(resp)
  if (fields.length === 0 || data.length === 0) return null
  const idx = (name: string): number => fields.findIndex((f) => cleanHeader(f) === name)
  const codeIdx = idx('證券代號')
  if (codeIdx < 0) return null
  const row = data.find((r) => String(r[codeIdx]).trim() === ticker)
  if (!row) return null
  const at = (name: string): number | null => {
    const i = idx(name)
    return i >= 0 ? normNum(row[i]) : null
  }
  return {
    foreign: at('外陸資買賣超股數(不含外資自營商)'),
    foreignDealer: at('外資自營商買賣超股數'),
    trust: at('投信買賣超股數'),
    dealer: at('自營商買賣超股數'),
    total: at('三大法人買賣超股數'),
  }
}

type MarginRow = Record<string, string>

export function extractMargin(rows: MarginRow[], ticker: string): MarginChip | null {
  const row = rows.find((r) => String(r['股票代號']).trim() === ticker)
  if (!row) return null
  const marginToday = normNum(row['融資今日餘額'])
  const marginPrev = normNum(row['融資前日餘額'])
  const shortToday = normNum(row['融券今日餘額'])
  const shortPrev = normNum(row['融券前日餘額'])
  const diff = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : a - b
  return {
    marginToday,
    marginPrev,
    marginChange: diff(marginToday, marginPrev),
    marginLimit: normNum(row['融資限額']),
    shortToday,
    shortPrev,
    shortChange: diff(shortToday, shortPrev),
    shortLimit: normNum(row['融券限額']),
    offset: normNum(row['資券互抵']),
  }
}

interface SblRow {
  TWSECode?: string
  TWSEAvailableVolume?: string
  GRETAICode?: string
  GRETAIAvailableVolume?: string
}

export function extractBorrow(rows: SblRow[], ticker: string): BorrowChip | null {
  for (const r of rows) {
    if (String(r.TWSECode).trim() === ticker) return { availableVolume: normNum(r.TWSEAvailableVolume) }
    if (String(r.GRETAICode).trim() === ticker) return { availableVolume: normNum(r.GRETAIAvailableVolume) }
  }
  return null
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return (await res.json()) as T
}

export type T86ResponseShape = T86Response
