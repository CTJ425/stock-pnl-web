/**
 * 排程與探針同步狀態之解析與處理工具函式。
 */

/** 毫秒差 → '3h 40m' / '38s' / '19d 20h' */
export function humanAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/**
 * cron 表達式 → 白話（並將 UTC 換成台北時間）。
 */
export const UNPARSED_CRON_PREFIX = '未解析的排程 '
/** Cron expressions are stored in UTC; Taiwan is UTC+8 year-round (no DST since 1979). */
const TAIPEI_UTC_OFFSET_HOURS = 8
export function describeCron(expr: string): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const lastMinute = (step: number) => (step > 0 && step < 60 ? 60 - step : 0)

  const w = /^\*\/(\d+)\s+(\d+)-(\d+)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (w) {
    const from = (Number(w[2]) + TAIPEI_UTC_OFFSET_HOURS) % 24
    const to = (Number(w[3]) + TAIPEI_UTC_OFFSET_HOURS) % 24
    return `週一至週五 ${p(from)}:00–${p(to)}:${p(lastMinute(Number(w[1])))} 每 ${w[1]} 分`
  }

  const dw = /^\*\/(\d+)\s+(\d+)-(\d+)\s+\*\s+\*\s+\*$/.exec(expr)
  if (dw) {
    const step = Number(dw[1])
    const from = (Number(dw[2]) + TAIPEI_UTC_OFFSET_HOURS) % 24
    const toTotal = Number(dw[3]) + TAIPEI_UTC_OFFSET_HOURS
    const end = `${p(toTotal % 24)}:${p(lastMinute(step))}`
    return `每日 ${p(from)}:00–${toTotal >= 24 ? '次日 ' : ''}${end} 每 ${step} 分`
  }

  const d = /^0\s+([\d,]+)\s+\*\s+\*\s+\*$/.exec(expr)
  if (d) {
    const hours = d[1]
      .split(',')
      .map((h) => `${String((Number(h) + TAIPEI_UTC_OFFSET_HOURS) % 24).padStart(2, '0')}:00`)
      .join(' / ')
    return `每日 ${hours}`
  }

  const r = /^0\s+(\d+)-(\d+)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (r) {
    const from = Number(r[1])
    const to = Number(r[2])
    const hours: string[] = []
    for (let h = from; h <= to; h++) hours.push(`${String((h + TAIPEI_UTC_OFFSET_HOURS) % 24).padStart(2, '0')}:00`)
    return `週一至週五 ${hours.join(' / ')}`
  }

  const s = /^(\d+(?:,\d+)+)\s+(\d+)-(\d+)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (s) {
    const mins = s[1].split(',').map(Number).sort((a, b) => a - b)
    const first = `${p((Number(s[2]) + TAIPEI_UTC_OFFSET_HOURS) % 24)}:${p(mins[0])}`
    const last = `${p((Number(s[3]) + TAIPEI_UTC_OFFSET_HOURS) % 24)}:${p(mins[mins.length - 1])}`
    return `週一至週五 ${first}–${last} 每 ${mins[1] - mins[0]} 分`
  }

  const sparse = /^(\d+(?:,\d+)+)\s+(\d+(?:,\d+)*)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (sparse) {
    const mins = sparse[1].split(',').map(Number)
    const hours = sparse[2].split(',').map(Number)
    const labels: string[] = []
    for (const h of hours) {
      for (const m of mins) {
        labels.push(`${p((h + TAIPEI_UTC_OFFSET_HOURS) % 24)}:${p(m)}`)
      }
    }
    return `週一至週五 ${labels.join(' / ')}`
  }
  return `${UNPARSED_CRON_PREFIX}${expr}`
}

/* ─────────────────────────────────────────────────────────────
   探針同步時序：把 source_probe_tick 的散列整成「一源一列」。
   ───────────────────────────────────────────────────────────── */

/** One probe result at one 5-minute slot. */
export interface ProbeTick {
  time: string
  hit: boolean
  ok: boolean
  dataYmd: string | null
  fingerprint: string | null
  rows: number | null
  note: string
  durationMs: number | null
}

/** One source's whole day. `firstHit` is null when the window never turned green. */
export interface ProbeSeries {
  source: string
  label: string
  ticks: ProbeTick[]
  hits: number
  firstHit: string | null
}

export interface ProbeDay {
  ymd: string
  series: ProbeSeries[]
}

/** The raw row shape as it arrives from the Edge Function (every field optional). */
export interface RawProbeTick {
  taipei_ymd?: string
  taipei_time?: string
  source?: string
  hit?: boolean
  ok?: boolean
  data_ymd?: string | null
  fingerprint?: string | null
  rows?: number | null
  note?: string | null
  duration_ms?: number | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Group raw ticks into days (newest first) × sources (in `order`).
 */
export function groupProbeTicks(
  raw: RawProbeTick[],
  order: string[],
  labels: Record<string, string>,
): ProbeDay[] {
  const byDay = new Map<string, Map<string, Map<string, ProbeTick>>>()

  for (const r of raw) {
    const ymd = str(r?.taipei_ymd)
    const source = str(r?.source)
    const time = str(r?.taipei_time)
    if (!ymd || !source || !time) continue

    if (!byDay.has(ymd)) byDay.set(ymd, new Map())
    const bySource = byDay.get(ymd)!
    if (!bySource.has(source)) bySource.set(source, new Map())
    bySource.get(source)!.set(time, {
      time,
      hit: r.hit === true,
      ok: r.ok === true,
      dataYmd: str(r?.data_ymd),
      fingerprint: str(r?.fingerprint),
      rows: int(r?.rows),
      note: str(r?.note) ?? '',
      durationMs: int(r?.duration_ms),
    })
  }

  return [...byDay.keys()]
    .sort()
    .reverse()
    .map((ymd) => {
      const bySource = byDay.get(ymd)!
      return {
        ymd,
        series: order.map((source) => {
          const ticks = [...(bySource.get(source)?.values() ?? [])].sort((a, b) =>
            a.time.localeCompare(b.time),
          )
          return {
            source,
            label: labels[source] ?? source,
            ticks,
            hits: ticks.filter((t) => t.hit).length,
            firstHit: ticks.find((t) => t.hit)?.time ?? null,
          }
        }),
      }
    })
}
