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
  // 15:00 起，不是 20:30：借券的命中條件是「title 日期翻到下一個交易日」（見 borrowHit），
  // 而沒人知道它幾點翻。窗若從 20:30 才開，翻日發生在那之前就只會看到一整排「中」——
  // 那正是 0.7.3 首版的毛病。寧可多探幾輪，也不要量到一個永遠為真的答案。
  borrow: { from: 15 * 60, to: 22 * 60 + 45 }, // 15:00–22:45
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

/**
 * 借券 TWT96U 是否已經換日。
 *
 * `title` 自帶的日期在盤中就是**當天**（「115年08月11日 當日可借券賣出股數」），
 * 收盤後才翻成下一個交易日的額度。只看「端點有沒有資料」永遠是有，
 * 所以命中必須定義成「日期已經走過今天」。
 */
export function borrowHit(dateIso: string | null, todayYmd: string): boolean {
  if (!dateIso || !/^\d{8}$/.test(todayYmd)) return false
  return dateIso.replace(/-/g, '') > todayYmd
}

/**
 * MOPS 彙整表（t187ap05_L 月營收 / t187ap17_L 季報）自報的出表日期，民國 7 碼。
 *
 * 這兩份是「整份重出」的快照——實測整份 1082 / 336 筆共用同一個出表日期，
 * 因此取第一列即可。端點恆有資料，出表日期是唯一能分辨新舊的欄位。
 */
export function mopsIssueRocYmd(rows: unknown): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const v = (rows[0] as Record<string, unknown> | null)?.['出表日期']
  return typeof v === 'string' && /^\d{7}$/.test(v.trim()) ? v.trim() : null
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
