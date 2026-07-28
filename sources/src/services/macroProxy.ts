/**
 * 美國總經指標：讀取盤後排程預產、存於公開 `reports` bucket 的 `macro/us.json`。
 *
 * **與其他 proxy 的差別：這是全域單檔，不帶 ticker。** 全市場共用同一份，
 * 每檔股票看到的完全一樣（資料本身就與個股無關）。
 *
 * 此檔的型別是**網路介面契約**，須與 sources/supabase/functions/stock-report/usMacro.ts
 * 的 MacroFile 對齊。單位陷阱：三個物價指標是 **%**（年增率）、
 * 非農是 **千人**（較上月增減）、消費者信心是**指數值**。欄位 `unit` 已帶著單位，
 * 畫面一律讀它，不要在元件裡另外寫死。
 */
import { downloadReportsJson } from './reportsBucket'

export type MacroKind = 'yoy' | 'momThousands' | 'index'

export interface MacroPoint {
  /** 'YYYY-MM' */
  period: string
  value: number | null
}

export interface MacroIndicator {
  id: string
  label: string
  kind: MacroKind
  unit: string
  note: string
  latest: MacroPoint | null
  previous: MacroPoint | null
  /** 由舊到新，最多 12 期 */
  points: MacroPoint[]
}

export interface MacroData {
  /** 批次產出時間 ISO */
  asOf: string
  region: string
  indicators: MacroIndicator[]
}

/**
 * 前端認得的**最低**結構版本。必須用 `>=` 比對，理由同 fundamentalProxy：
 * 後端加欄位對舊前端是無害的加法，用等號會在後端升版時讓整個分頁當場全掛。
 */
export const MIN_MACRO_SCHEMA = 1

interface StoredMacro {
  schema?: number
  asOf?: string
  region?: unknown
  indicators?: unknown
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function normalizePoint(v: unknown): MacroPoint | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.period !== 'string' || !o.period) return null
  return { period: o.period, value: numOrNull(o.value) }
}

const KINDS: MacroKind[] = ['yoy', 'momThousands', 'index']

function normalizeIndicator(v: unknown): MacroIndicator | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) return null
  if (typeof o.label !== 'string' || !o.label) return null
  // 後端若新增了前端不認得的 kind，整筆丟掉勝過用錯的單位呈現
  const kind = KINDS.find((k) => k === o.kind)
  if (!kind) return null
  return {
    id: o.id,
    label: o.label,
    kind,
    unit: typeof o.unit === 'string' ? o.unit : '',
    note: typeof o.note === 'string' ? o.note : '',
    latest: normalizePoint(o.latest),
    previous: normalizePoint(o.previous),
    points: Array.isArray(o.points)
      ? o.points.map(normalizePoint).filter((p): p is MacroPoint => p !== null)
      : [],
  }
}

function isSupported(d: unknown): d is StoredMacro {
  if (!d || typeof d !== 'object') return false
  const f = d as StoredMacro
  return typeof f.schema === 'number' && f.schema >= MIN_MACRO_SCHEMA
}

/** 讀總經指標；查無 / 格式不符回 null（吞錯不拋，缺料不得拖垮個股分析頁） */
export async function fetchMacro(): Promise<MacroData | null> {
  const stored = await downloadReportsJson<StoredMacro>('macro/us.json')
  if (!isSupported(stored)) return null

  const indicators = Array.isArray(stored.indicators)
    ? stored.indicators.map(normalizeIndicator).filter((i): i is MacroIndicator => i !== null)
    : []
  if (indicators.length === 0) return null

  return {
    asOf: typeof stored.asOf === 'string' ? stored.asOf : '',
    region: typeof stored.region === 'string' ? stored.region : '美國',
    indicators,
  }
}
