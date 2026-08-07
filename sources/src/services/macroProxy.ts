/**
 * U.S. General Economic Indicators: Read after-hours scheduled production and stored in `macro/us.json` in the public `reports` bucket.
 *
 * **Difference from other proxies: This is a global single file without ticker. ** The whole market shares the same copy.
 * What you see for each stock is exactly the same (the data itself has nothing to do with individual stocks).
 *
 * This file is of type **Web Interface Contract** and must be consistent with sources/supabase/functions/stock-report/usMacro.ts
 * MacroFile alignment. Unit trap: The three price indicators are **%** (annual growth rate),
 * Non-farm payrolls are **thousand people** (increase or decrease from the previous month), and consumer confidence is **index value**. The field `unit` already carries the unit,
 * The screen must read it, do not write it in the component.
 */
import { downloadReportsJson } from './reportsBucket'

export type MacroKind = 'yoy' | 'momThousands' | 'index' | 'rate'

export interface MacroPoint {
  /** Monthly: 'YYYY-MM'. FOMC rate steps: 'YYYY-MM-DD'. */
  period: string
  value: number | null
  /** Target-range lower bound; only for kind `rate`. */
  valueLow?: number | null
}

export interface MacroIndicator {
  id: string
  label: string
  kind: MacroKind
  unit: string
  note: string
  latest: MacroPoint | null
  previous: MacroPoint | null
  /** From old to new, up to 12 issues*/
  points: MacroPoint[]
}

export interface MacroData {
  /**
   * **The time ISO when the data was last changed** (not the time when the schedule was last executed).
   * FRED will sit still when it's not releasing new data, and that's normal - don't think of it as a health indicator.
   */
  asOf: string
  /**
   * The last time the scheduler actually asked FRED for the time ISO. Only available since 0.6.11, old files are empty strings.
   * With it, "it hasn't been released this month" can be distinguished from "the schedule is down".
   */
  checkedAt: string
  region: string
  indicators: MacroIndicator[]
}

/**
 * The **minimum** structural version recognized by the frontend. Must use `>=` for comparison, the reason is the same as fundamentalProxy:
 * Adding fields to the backend is a harmless addition to the old frontend. Using the equal sign will cause the entire paging to hang on the spot when the backend is upgraded.
 */
export const MIN_MACRO_SCHEMA = 1

interface StoredMacro {
  schema?: number
  asOf?: string
  checkedAt?: string
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
  const point: MacroPoint = { period: o.period, value: numOrNull(o.value) }
  if ('valueLow' in o) point.valueLow = numOrNull(o.valueLow)
  return point
}

const KINDS: MacroKind[] = ['yoy', 'momThousands', 'index', 'rate']

function normalizeIndicator(v: unknown): MacroIndicator | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) return null
  if (typeof o.label !== 'string' || !o.label) return null
  // If the backend adds a new kind that the frontend does not recognize, it is better to throw it away than to use the wrong unit.
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

/** Read the general economic indicators; find none/return null if the format does not match (don’t throw out if you swallow an error, and don’t bring down the individual stock analysis page if you don’t have enough information)*/
export async function fetchMacro(): Promise<MacroData | null> {
  const stored = await downloadReportsJson<StoredMacro>('macro/us.json')
  if (!isSupported(stored)) return null

  const indicators = Array.isArray(stored.indicators)
    ? stored.indicators.map(normalizeIndicator).filter((i): i is MacroIndicator => i !== null)
    : []
  if (indicators.length === 0) return null

  return {
    asOf: typeof stored.asOf === 'string' ? stored.asOf : '',
    // 0.6.11 The previously generated files do not have this field. Return an empty string and let the screen decide whether to display it.
    checkedAt: typeof stored.checkedAt === 'string' ? stored.checkedAt : '',
    region: typeof stored.region === 'string' ? stored.region : '美國',
    indicators,
  }
}
