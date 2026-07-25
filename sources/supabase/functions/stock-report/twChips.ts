/**
 * TWSE 盤後籌碼抓取與解析。
 *
 * 資料來源（實測確認，皆為 whole-market 大檔，依 ticker 篩單股）：
 * - 三大法人個股買賣超：TWSE rwd `fund/T86`（需 date 參數，回 { fields, data, date }）
 * - 融資融券（主）：TWSE rwd `marginTrading/MI_MARGN`（需 date 參數，含買進 / 賣出 / 償還）
 * - 融資融券（fallback）：TWSE OpenAPI `exchangeReport/MI_MARGN`（無 date，只有最新交易日餘額）
 * - 借券賣出可用股數：TWSE OpenAPI `SBL/TWT96U`（無 date，TWSE/GRETAI 兩組平行欄位）
 *
 * 單位陷阱：T86 的數字是「股數」，MI_MARGN 的數字是「交易單位（張）」。兩者不可混算，
 * UI 必須各自標示（見 docs/agent/SPEC.md 的 UI 文案準則）。
 *
 * 解析函式皆為純函式、不觸網，便於單元測試；HTTP 抓取與 DB 快取在 index.ts 組合。
 * 上櫃(TPEx) 逐股端點暫不支援，查無資料時對應區塊標記缺漏。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const MI_MARGN_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN'
export const SBL_URL = 'https://openapi.twse.com.tw/v1/SBL/TWT96U'

export function t86Url(dateYYYYMMDD: string): string {
  return `https://www.twse.com.tw/rwd/zh/fund/T86?date=${dateYYYYMMDD}&selectType=ALLBUT0999&response=json`
}

/** 帶 date 的融資融券逐股彙總（OpenAPI 版沒有 date 參數，做不出走勢圖） */
export function marginDatedUrl(dateYYYYMMDD: string): string {
  return `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${dateYYYYMMDD}&selectType=ALL&response=json`
}

/** 千分位字串轉數字；空字串 / 非數字回 null。保留正負號（買賣超可為負） */
export function normNum(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/,/g, '').trim()
  if (s === '' || s === '--') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** 買進 / 賣出 / 買賣超三件組。任一來源缺該拆項時以 null 表示（不以 0 冒充） */
export interface ChipLeg {
  buy: number | null
  sell: number | null
  /** 買賣超（買進 − 賣出）；優先採用官方揭露值 */
  net: number | null
}

const NULL_LEG: ChipLeg = { buy: null, sell: null, net: null }

/** a + b，兩者皆 null 時回 null（單邊有值時視為另一邊 0） */
function addNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null
  return (a ?? 0) + (b ?? 0)
}

function addLegs(a: ChipLeg, b: ChipLeg): ChipLeg {
  return {
    buy: addNullable(a.buy, b.buy),
    sell: addNullable(a.sell, b.sell),
    net: addNullable(a.net, b.net),
  }
}

/** 三大法人（單位：股）。各項含買進 / 賣出 / 買賣超 */
export interface InstitutionalChip {
  /** 外陸資（不含外資自營商） */
  foreign: ChipLeg
  /** 外資自營商 */
  foreignDealer: ChipLeg
  /** 投信 */
  trust: ChipLeg
  /** 自營商（自行買賣 + 避險，T86 未直接揭露買進 / 賣出，由兩組拆項相加） */
  dealer: ChipLeg
  /** 三大法人合計（T86 只揭露買賣超，買進 / 賣出由五個 leg 加總） */
  total: ChipLeg
}

/**
 * 融資融券（單位：交易單位＝張）。
 * 融券的 buy 是「回補」、sell 是「放空」，方向與融資相反。
 * `source` 為 'openapi' 時只有餘額，buy / sell / redeem 為 null。
 */
export interface MarginChip {
  marginBuy: number | null
  marginSell: number | null
  /** 融資現金償還 */
  marginRedeem: number | null
  marginPrev: number | null
  marginToday: number | null
  /** 融資餘額變化 = 今日 − 前日 */
  marginChange: number | null
  marginLimit: number | null
  /** 融券買進＝回補 */
  shortBuy: number | null
  /** 融券賣出＝放空 */
  shortSell: number | null
  /** 融券現券償還 */
  shortRedeem: number | null
  shortPrev: number | null
  shortToday: number | null
  /** 融券餘額變化 = 今日 − 前日 */
  shortChange: number | null
  shortLimit: number | null
  /** 資券互抵（張） */
  offset: number | null
  source: 'rwd' | 'openapi'
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

/**
 * T86 逐股三大法人。T86 欄位名稱不重複，故以名稱比對（比位置索引耐得住欄序調動）。
 * 官方只揭露自營商 / 三大法人的「買賣超」，其買進 / 賣出由拆項加總補齊。
 */
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
  const leg = (buy: string, sell: string, net: string): ChipLeg => ({
    buy: at(buy),
    sell: at(sell),
    net: at(net),
  })

  const foreign = leg(
    '外陸資買進股數(不含外資自營商)',
    '外陸資賣出股數(不含外資自營商)',
    '外陸資買賣超股數(不含外資自營商)',
  )
  const foreignDealer = leg('外資自營商買進股數', '外資自營商賣出股數', '外資自營商買賣超股數')
  const trust = leg('投信買進股數', '投信賣出股數', '投信買賣超股數')
  const dealerSelf = leg(
    '自營商買進股數(自行買賣)',
    '自營商賣出股數(自行買賣)',
    '自營商買賣超股數(自行買賣)',
  )
  const dealerHedge = leg('自營商買進股數(避險)', '自營商賣出股數(避險)', '自營商買賣超股數(避險)')
  const dealerSum = addLegs(dealerSelf, dealerHedge)
  // 自營商合計的買賣超以官方欄位為準，買進 / 賣出才用拆項加總
  const dealer: ChipLeg = {
    buy: dealerSum.buy,
    sell: dealerSum.sell,
    net: at('自營商買賣超股數') ?? dealerSum.net,
  }

  const legsSum = [foreign, foreignDealer, trust, dealerSelf, dealerHedge].reduce(addLegs, NULL_LEG)
  const total: ChipLeg = {
    buy: legsSum.buy,
    sell: legsSum.sell,
    net: at('三大法人買賣超股數') ?? legsSum.net,
  }

  return { foreign, foreignDealer, trust, dealer, total }
}

type MarginRow = Record<string, string>

const diff = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : a - b

/**
 * OpenAPI 版融資融券（fallback）：只有餘額，沒有買進 / 賣出 / 償還。
 * 僅適用「最新交易日」，做不出走勢圖，故只在 rwd 端點失敗時使用。
 */
export function extractMargin(rows: MarginRow[], ticker: string): MarginChip | null {
  const row = rows.find((r) => String(r['股票代號']).trim() === ticker)
  if (!row) return null
  const marginToday = normNum(row['融資今日餘額'])
  const marginPrev = normNum(row['融資前日餘額'])
  const shortToday = normNum(row['融券今日餘額'])
  const shortPrev = normNum(row['融券前日餘額'])
  return {
    marginBuy: null,
    marginSell: null,
    marginRedeem: null,
    marginPrev,
    marginToday,
    marginChange: diff(marginToday, marginPrev),
    marginLimit: normNum(row['融資限額']),
    shortBuy: null,
    shortSell: null,
    shortRedeem: null,
    shortPrev,
    shortToday,
    shortChange: diff(shortToday, shortPrev),
    shortLimit: normNum(row['融券限額']),
    offset: normNum(row['資券互抵']),
    source: 'openapi',
  }
}

export interface MarginDatedResponse {
  stat?: string
  date?: string
  tables?: Array<{ fields?: string[]; data?: string[][] }>
}

/**
 * rwd 版逐股融資融券表的欄位位置（實測 2026-07-22，共 16 欄）。
 * 「買進」「賣出」在同一列 fields 中各出現兩次（融資、融券各一組），
 * **必須以位置索引取值，用名稱比對會取到錯的那一組**。
 */
const MARGIN_IDX = {
  code: 0,
  marginBuy: 2,
  marginSell: 3,
  marginRedeem: 4,
  marginPrev: 5,
  marginToday: 6,
  marginLimit: 7,
  shortBuy: 8,
  shortSell: 9,
  shortRedeem: 10,
  shortPrev: 11,
  shortToday: 12,
  shortLimit: 13,
  offset: 14,
} as const

/** rwd 回應可能含多張表（大盤合計 / 逐股彙總）；逐股表的第一欄是「代號」 */
function marginTable(resp: MarginDatedResponse): { fields: string[]; data: string[][] } | null {
  for (const t of resp.tables ?? []) {
    const fields = t.fields ?? []
    const data = t.data ?? []
    // 欄序防護：不符即視為端點格式變動，呼叫端回退 OpenAPI fallback
    if (cleanHeader(fields[0] ?? '') === '代號' && fields.length >= 15 && data.length > 0) {
      return { fields, data }
    }
  }
  return null
}

export function extractMarginDated(resp: MarginDatedResponse, ticker: string): MarginChip | null {
  const table = marginTable(resp)
  if (!table) return null
  const row = table.data.find((r) => String(r[MARGIN_IDX.code]).trim() === ticker)
  if (!row) return null
  const at = (i: number): number | null => normNum(row[i])
  const marginToday = at(MARGIN_IDX.marginToday)
  const marginPrev = at(MARGIN_IDX.marginPrev)
  const shortToday = at(MARGIN_IDX.shortToday)
  const shortPrev = at(MARGIN_IDX.shortPrev)
  return {
    marginBuy: at(MARGIN_IDX.marginBuy),
    marginSell: at(MARGIN_IDX.marginSell),
    marginRedeem: at(MARGIN_IDX.marginRedeem),
    marginPrev,
    marginToday,
    marginChange: diff(marginToday, marginPrev),
    marginLimit: at(MARGIN_IDX.marginLimit),
    shortBuy: at(MARGIN_IDX.shortBuy),
    shortSell: at(MARGIN_IDX.shortSell),
    shortRedeem: at(MARGIN_IDX.shortRedeem),
    shortPrev,
    shortToday,
    shortChange: diff(shortToday, shortPrev),
    shortLimit: at(MARGIN_IDX.shortLimit),
    offset: at(MARGIN_IDX.offset),
    source: 'rwd',
  }
}

/** rwd 融資融券回應是否可用（供 index.ts 決定要不要快取 / 回退 fallback） */
export function marginDatedOk(resp: MarginDatedResponse): boolean {
  return marginTable(resp) !== null
}

interface SblRow {
  TWSECode?: string
  TWSEAvailableVolume?: string
  GRETAICode?: string
  GRETAIAvailableVolume?: string
}

/**
 * OpenAPI 版借券（fallback）。**回應沒有任何日期欄位**，無從得知是哪一天的資料 ——
 * 這正是改用下方 rwd 版的原因。
 *
 * 註：欄位名稱的 TWSECode / GRETAICode 有誤導性。實測兩者都是上市股票，
 * 只是官方原始報表是「兩欄並排」的版面，OpenAPI 照著切成兩組欄位而已，
 * 所以兩欄都要找。
 */
export function extractBorrow(rows: SblRow[], ticker: string): BorrowChip | null {
  for (const r of rows) {
    if (String(r.TWSECode).trim() === ticker) return { availableVolume: normNum(r.TWSEAvailableVolume) }
    if (String(r.GRETAICode).trim() === ticker) return { availableVolume: normNum(r.GRETAIAvailableVolume) }
  }
  return null
}

// ---- 借券（rwd 版，自帶日期）----

/**
 * 借券的 rwd 端點。`date` 參數**實測無效**（帶任何日期都回同一份最新資料），
 * 但 `title` 自帶日期（「115年07月27日 當日可借券賣出股數」），
 * 這就足以判斷拿到的是哪一天的資料 —— OpenAPI 版做不到這件事。
 *
 * ⚠️ 語意提醒：「當日可借券賣出股數」是**下一個交易日的額度**，不是已收盤那天的數字。
 * 實測最後交易日為 07/24（週五）時，title 顯示的是 07/27（週一）。
 * 因此它的日期本來就會與籌碼的資料日期不同，必須各自標示。
 */
export const BORROW_DATED_URL = 'https://www.twse.com.tw/rwd/zh/marginTrading/TWT96U?response=json'

export interface BorrowDatedResponse {
  stat?: string
  title?: string
  fields?: string[]
  data?: string[][]
}

/** 「115年07月27日 當日可借券賣出股數」→ `2026-07-27`；解析不出回 null */
export function parseRocTitleDate(title: string | null | undefined): string | null {
  const m = /(\d{2,3})年(\d{1,2})月(\d{1,2})日/.exec(String(title ?? ''))
  if (!m) return null
  const year = Number(m[1]) + 1911
  const p = (v: string) => v.padStart(2, '0')
  return `${year}-${p(m[2])}-${p(m[3])}`
}

/** rwd 的儲存格把代號包在 <a> 標籤裡，取純文字 */
function cellText(v: unknown): string {
  return String(v ?? '').replace(/<[^>]*>/g, '').trim()
}

export function borrowDatedOk(resp: BorrowDatedResponse): boolean {
  return (
    Array.isArray(resp?.data) &&
    resp.data.length > 0 &&
    parseRocTitleDate(resp.title) !== null
  )
}

/** rwd 借券的資料日期（＝下一個交易日）；解析不出回 null */
export function borrowDatedDate(resp: BorrowDatedResponse): string | null {
  return parseRocTitleDate(resp?.title)
}

/**
 * 由 rwd 借券表取單一代號。原始報表是「兩欄並排」的版面：
 * 每一列有 4 個儲存格 = 兩組（代號, 股數），故兩組都要找。
 */
export function extractBorrowDated(resp: BorrowDatedResponse, ticker: string): BorrowChip | null {
  for (const row of resp?.data ?? []) {
    for (let i = 0; i + 1 < row.length; i += 2) {
      if (cellText(row[i]) === ticker) return { availableVolume: normNum(row[i + 1]) }
    }
  }
  return null
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return (await res.json()) as T
}

export type T86ResponseShape = T86Response
