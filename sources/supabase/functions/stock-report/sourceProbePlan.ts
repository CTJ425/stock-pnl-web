/**
 * Probe experiment (0.7.3): which sources to probe at a given Taipei clock time.
 *
 * Daily sources: every 5 minutes **inside** their window.
 * MOPS revenue / profit: only a few slots per day (not every 5 min).
 *
 * Pure functions — vitest imports this file; no Deno / network.
 */

export type ProbeSourceId =
  | 'bfi82u'
  | 't86'
  | 'bwibbu'
  | 'margin'
  | 'borrow'
  | 'mops_revenue'
  | 'mops_profit'

export const PROBE_SOURCE_LABELS: Record<ProbeSourceId, string> = {
  bfi82u: '全市場法人 BFI82U',
  t86: '個股法人 T86',
  bwibbu: '估值 BWIBBU',
  margin: '融資融券',
  borrow: '借券賣出',
  mops_revenue: '月營收彙整',
  mops_profit: '季報／獲利彙整',
}

/** Display order on the admin page */
export const PROBE_SOURCE_ORDER: ProbeSourceId[] = [
  'bfi82u',
  't86',
  'bwibbu',
  'margin',
  'borrow',
  'mops_revenue',
  'mops_profit',
]

/** [fromMin, toMin] inclusive, minutes from midnight Taipei */
type Window = { from: number; to: number }

const DAILY_WINDOWS: Record<
  Exclude<ProbeSourceId, 'mops_revenue' | 'mops_profit'>,
  Window
> = {
  bfi82u: { from: 15 * 60, to: 16 * 60 + 30 }, // 15:00–16:30
  t86: { from: 15 * 60 + 30, to: 17 * 60 + 30 }, // 15:30–17:30
  bwibbu: { from: 17 * 60 + 30, to: 22 * 60 }, // 17:30–22:00
  margin: { from: 20 * 60 + 30, to: 22 * 60 + 30 }, // 20:30–22:30
  borrow: { from: 20 * 60 + 30, to: 22 * 60 + 45 }, // 20:30–22:45
}

/** MOPS: only these HH:mm slots (aligned to every-5-minute cron) */
const MOPS_SLOTS = new Set(['12:00', '12:05', '21:00', '21:05'])

export function minutesFromHhmm(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

function inWindow(mins: number, w: Window): boolean {
  return mins >= w.from && mins <= w.to
}

/**
 * Sources to probe at this Taipei HH:mm on a weekday.
 * Weekends: empty (caller may still skip entirely).
 */
export function sourcesForTaipeiTime(hhmm: string, weekday: boolean): ProbeSourceId[] {
  if (!weekday) return []
  const mins = minutesFromHhmm(hhmm)
  if (mins == null) return []

  const out: ProbeSourceId[] = []
  for (const id of ['bfi82u', 't86', 'bwibbu', 'margin', 'borrow'] as const) {
    if (inWindow(mins, DAILY_WINDOWS[id])) out.push(id)
  }
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const slot = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  if (MOPS_SLOTS.has(slot)) {
    out.push('mops_revenue', 'mops_profit')
  }
  return out
}

/** UI helper: "15:00 沒中" / "15:05 中" */
export function formatProbeTickLabel(hhmm: string, hit: boolean): string {
  const compact = hhmm.replace(':', '')
  return `${compact} ${hit ? '中' : '沒中'}`
}

/** YYYYMMDD → ROC 7-digit date string used by BWIBBU (e.g. 20260811 → 1150811) */
export function ymdToRocYmd(ymd: string): string | null {
  if (!/^\d{8}$/.test(ymd)) return null
  const y = Number(ymd.slice(0, 4)) - 1911
  if (y < 1) return null
  return `${y}${ymd.slice(4)}`
}
