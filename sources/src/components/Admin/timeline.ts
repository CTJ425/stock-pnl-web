/**
 * 排程與探針同步狀態之解析與處理工具函式。
 */

export type SourceState = 'ok' | 'warn' | 'late' | 'idle'

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
 * 每一支排程實際抓取的範疇說明。
 *
 * 內容與 `sources/supabase/functions/stock-report/index.ts` 各 handler 比對。
 */
export const ACTION_SCOPE: Record<string, string> = {
  'generate-all':
    '（相容入口）依序 chips → market-data → history，單一 HTTP 有算力預算；線上 cron 自 0.7.2 改打 phase，避免 cloud 546',
  'generate-chips':
    '全站淨持股台股籌碼：T86／融資融券／借券、組報告上傳。由探針命中時自動觸發，不與日 K／歷史同請求',
  'generate-market-data':
    '持股日 K + 估值／產業等（syncDaily + syncFundamental）；由估值探針 bwibbu 命中觸發，並有 18:00 / 22:00 定時備援',
  'generate-history':
    '月營收+季報補齊；由 MOPS 探針槽點命中觸發，並有 12:30 / 21:30 定時備援',
  'sync-market':
    '全市場（非個股）：FMTQIK 成交量／值／筆數與加權收盤；MI_5MINS_HIST 加權開高低；' +
    'BFI82U 三大法人買賣超金額（外資／投信／自營，含買賣分開）。寫入 market/daily.json。由探針 bfi82u 監測觸發（15:00–16:30 / 19:30–20:15 雙時段）',
  probe: '全天候每 5 分鐘驅動資料源探測，在各時窗內偵測上游出表並聯動抓取（探測本身不寫報告）',
  'sync-macro':
    'FRED：核心 CPI / PPI / PCE、FOMC 目標利率區間（DFEDTARU/L）、非農就業、消費者信心，依日曆自適應掃描',
  'sync-fx': 'Yahoo 八個幣對：USD / JPY / EUR / CNY / HKD / GBP / AUD / KRW 對台幣，每日 11:00 / 17:00 同步',
  'backfill-revenue': '公開資訊觀測站的分月營收，補齊個股缺漏的月份',
}

/** 說明排程的抓取範圍；未認得的 action 回傳空字串 */
export function describeScope(action: string | null): string {
  return (action && ACTION_SCOPE[action]) || ''
}

/** 排程健康度狀態判斷 */
export function judgeCron(
  active: boolean,
  failsToday: number,
  lastRun: string | null,
): SourceState {
  if (!active) return 'late'
  if (failsToday > 0) return 'warn'
  if (!lastRun) return 'idle'
  return 'ok'
}

/**
 * cron 表達式 → 白話（並將 UTC 換成台北時間）。
 */
export const UNPARSED_CRON_PREFIX = '未解析的排程 '
export function describeCron(expr: string): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const lastMinute = (step: number) => (step > 0 && step < 60 ? 60 - step : 0)

  const w = /^\*\/(\d+)\s+(\d+)-(\d+)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (w) {
    const from = (Number(w[2]) + 8) % 24
    const to = (Number(w[3]) + 8) % 24
    return `週一至週五 ${p(from)}:00–${p(to)}:${p(lastMinute(Number(w[1])))} 每 ${w[1]} 分`
  }

  const dw = /^\*\/(\d+)\s+(\d+)-(\d+)\s+\*\s+\*\s+\*$/.exec(expr)
  if (dw) {
    const step = Number(dw[1])
    const from = (Number(dw[2]) + 8) % 24
    const toTotal = Number(dw[3]) + 8
    const end = `${p(toTotal % 24)}:${p(lastMinute(step))}`
    return `每日 ${p(from)}:00–${toTotal >= 24 ? '次日 ' : ''}${end} 每 ${step} 分`
  }

  const d = /^0\s+([\d,]+)\s+\*\s+\*\s+\*$/.exec(expr)
  if (d) {
    const hours = d[1]
      .split(',')
      .map((h) => `${String((Number(h) + 8) % 24).padStart(2, '0')}:00`)
      .join(' / ')
    return `每日 ${hours}`
  }

  const r = /^0\s+(\d+)-(\d+)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (r) {
    const from = Number(r[1])
    const to = Number(r[2])
    const hours: string[] = []
    for (let h = from; h <= to; h++) hours.push(`${String((h + 8) % 24).padStart(2, '0')}:00`)
    return `週一至週五 ${hours.join(' / ')}`
  }

  const s = /^(\d+(?:,\d+)+)\s+(\d+)-(\d+)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (s) {
    const mins = s[1].split(',').map(Number).sort((a, b) => a - b)
    const first = `${p((Number(s[2]) + 8) % 24)}:${p(mins[0])}`
    const last = `${p((Number(s[3]) + 8) % 24)}:${p(mins[mins.length - 1])}`
    return `週一至週五 ${first}–${last} 每 ${mins[1] - mins[0]} 分`
  }

  const sparse = /^(\d+(?:,\d+)+)\s+(\d+(?:,\d+)*)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (sparse) {
    const mins = sparse[1].split(',').map(Number)
    const hours = sparse[2].split(',').map(Number)
    const labels: string[] = []
    for (const h of hours) {
      for (const m of mins) {
        labels.push(`${p((h + 8) % 24)}:${p(m)}`)
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
