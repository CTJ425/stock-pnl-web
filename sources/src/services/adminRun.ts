/**
 * Admin console: manually trigger the same batch jobs that pg_cron fires.
 *
 * Gate is the caller's JWT + `app_metadata.role === 'admin'` (see Edge `admin-run`).
 * **Not CRON_SECRET** — that key must never enter the browser.
 */
import { supabase } from './supabase'

/** Same ids the Edge `admin-run` handler accepts (mirrors cron actions). */
export const ADMIN_RUN_JOBS = [
  'generate-all',
  'sync-market',
  'sync-top-tickers',
  'sync-macro',
  'sync-fx',
  'probe',
] as const

export type AdminRunJob = (typeof ADMIN_RUN_JOBS)[number]

export interface AdminRunJobResult {
  httpStatus: number
  durationMs: number
  body: unknown
}

export interface AdminRunResult {
  ok: boolean
  jobs: AdminRunJob[]
  results: Partial<Record<AdminRunJob, AdminRunJobResult>>
  failed: AdminRunJob[]
  durationMs: number
}

/** UI labels for cron-backed jobs (Traditional Chinese). */
export const ADMIN_RUN_LABELS: Record<AdminRunJob, { title: string; cron: string; hint: string }> = {
  'generate-all': {
    title: '盤後個股批次',
    cron: 'stock-report-nightly',
    hint: '持股∪觀察∪Top30：T86 籌碼、日 K、基本面（16:00 起；可能較久）',
  },
  'sync-market': {
    title: '台股全市場',
    cron: 'market-daily',
    hint:
      '15:00 起：FMTQIK + MI_5MINS_HIST + BFI82U → market/daily.json（不含個股 T86）',
  },
  'sync-top-tickers': {
    title: '成交值 Top30 名單',
    cron: '（併 generate-all／可手動）',
    hint: 'STOCK_DAY_ALL 排行（含 ETF）→ meta/top_tickers.json；與 15:00 全市場分開',
  },
  'sync-macro': {
    title: '美總經',
    cron: 'macro-daily',
    hint: 'FRED 指標（macro/us.json）',
  },
  'sync-fx': {
    title: '匯率',
    cron: 'fx-daily',
    hint: '台幣對主要外幣日線（fx/twd.json）',
  },
  probe: {
    title: '資料源探測',
    cron: 'source-probe',
    hint: '估值 / 借券探測（寫 source_probe_log）',
  },
}

/**
 * Run one job, several jobs, or all five.
 * Returns `{ ok: false, error }` on transport / auth failure; on success returns the Edge payload.
 */
export async function runAdminJobs(
  jobs: AdminRunJob[] | 'all',
): Promise<{ ok: true; data: AdminRunResult } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase 未設定' }
  try {
    const body =
      jobs === 'all'
        ? { action: 'admin-run', jobs: 'all' as const }
        : { action: 'admin-run', jobs }
    const { data, error } = await supabase.functions.invoke('stock-report', { body })
    if (error) {
      const msg = await httpErrorMessage(error)
      return { ok: false, error: msg ?? error.message }
    }
    const res = data as Partial<AdminRunResult> & { error?: string }
    if (!res || typeof res !== 'object') return { ok: false, error: '無回應' }
    if (typeof res.error === 'string' && res.ok !== true) {
      return { ok: false, error: res.error }
    }
    return {
      ok: true,
      data: {
        ok: res.ok === true,
        jobs: Array.isArray(res.jobs) ? (res.jobs as AdminRunJob[]) : [],
        results: (res.results ?? {}) as AdminRunResult['results'],
        failed: Array.isArray(res.failed) ? (res.failed as AdminRunJob[]) : [],
        durationMs: typeof res.durationMs === 'number' ? res.durationMs : 0,
      },
    }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : '執行失敗' }
  }
}

async function httpErrorMessage(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: unknown })?.context
  if (!(ctx instanceof Response)) return null
  try {
    const body = (await ctx.clone().json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}
