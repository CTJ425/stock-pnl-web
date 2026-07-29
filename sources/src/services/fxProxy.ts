/**
 * 台幣對主要外幣的匯率：讀取每日排程預產、存於公開 `reports` bucket 的 `fx/twd.json`。
 *
 * **與其他 proxy 的差別：這是全域單檔，不帶 ticker**（同 macroProxy）。
 *
 * 此檔的型別是**網路介面契約**，須與
 * sources/supabase/functions/stock-report/fxRates.ts 的 FxFile 對齊。
 *
 * 方向陷阱：`rate` 一律是「**1 單位外幣可換多少台幣**」（1 USD = 32.387 TWD）。
 * 反向由前端取倒數，資料裡不存第二份。
 */
import { downloadReportsJson } from './reportsBucket'

/** [日期 YYYY-MM-DD, 1 外幣可換多少台幣] */
export type FxPoint = [date: string, rate: number]

export interface FxCurrency {
  code: string
  name: string
  /** 顯示用小數位數，隨幣別量級不同（USD 3 位、KRW 5 位） */
  decimals: number
  /** 實際採用的 Yahoo 幣對，供稽核 */
  symbol: string
  latest: number | null
  prevClose: number | null
  /** 由舊到新，一年份 */
  points: FxPoint[]
}

export interface FxData {
  /** 批次產出時間 ISO */
  asOf: string
  base: string
  currencies: FxCurrency[]
}

/**
 * 前端認得的**最低**結構版本。必須用 `>=` 比對，理由同 macroProxy / fundamentalProxy：
 * 後端加欄位對舊前端是無害的加法，用等號會在後端升版時讓整個分頁當場全掛
 * （0.4.1 修過的線上故障）。
 */
export const MIN_FX_SCHEMA = 1

interface StoredFx {
  schema?: number
  asOf?: string
  base?: unknown
  currencies?: unknown
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 一格走勢點。壞掉的格子整筆丟掉，不補 0 —— 0 匯率會讓換算變成 Infinity */
function normalizePoint(v: unknown): FxPoint | null {
  if (!Array.isArray(v) || v.length < 2) return null
  const [date, rate] = v
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const r = numOrNull(rate)
  if (r === null || r <= 0) return null
  return [date, r]
}

function normalizeCurrency(v: unknown): FxCurrency | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.code !== 'string' || !o.code) return null
  if (typeof o.name !== 'string' || !o.name) return null

  const points = Array.isArray(o.points)
    ? o.points.map(normalizePoint).filter((p): p is FxPoint => p !== null)
    : []
  // 一格都沒有的幣別不放進畫面：卡片可以顯示現價，但點下去走勢圖是空的，
  // 那比直接不出現更糟（使用者會以為壞了）
  if (points.length === 0) return null

  const decimals = numOrNull(o.decimals)
  return {
    code: o.code,
    name: o.name,
    // 後端沒給或給了離譜的值時退回 4 位，不讓 toFixed() 拋 RangeError
    decimals: decimals !== null && decimals >= 0 && decimals <= 8 ? Math.round(decimals) : 4,
    symbol: typeof o.symbol === 'string' ? o.symbol : '',
    latest: numOrNull(o.latest),
    prevClose: numOrNull(o.prevClose),
    points,
  }
}

function isSupported(d: unknown): d is StoredFx {
  if (!d || typeof d !== 'object') return false
  const f = d as StoredFx
  return typeof f.schema === 'number' && f.schema >= MIN_FX_SCHEMA
}

/** 讀匯率；查無 / 格式不符回 null（吞錯不拋，缺料不得拖垮整頁） */
export async function fetchFx(): Promise<FxData | null> {
  const stored = await downloadReportsJson<StoredFx>('fx/twd.json')
  if (!isSupported(stored)) return null

  const currencies = Array.isArray(stored.currencies)
    ? stored.currencies.map(normalizeCurrency).filter((c): c is FxCurrency => c !== null)
    : []
  if (currencies.length === 0) return null

  return {
    asOf: typeof stored.asOf === 'string' ? stored.asOf : '',
    base: typeof stored.base === 'string' ? stored.base : 'TWD',
    currencies,
  }
}
