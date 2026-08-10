/**
 * Admin console: manually trigger the same batch jobs that pg_cron fires.
 *
 * Gate is the caller's JWT + `app_metadata.role === 'admin'` (see Edge `admin-run`).
 * **Not CRON_SECRET** — that key must never enter the browser.
 *
 * Each job is invoked in its **own** Edge request. Packing several jobs into one
 * `admin-run` call (server-side sequential) used to hit the platform wall-clock /
 * idle timeout (~150s) and surface only the opaque
 * "Edge Function returned a non-2xx status code" (504 body is often not `{ error }`).
 */
import { supabase } from './supabase'

/**
 * Same ids the Edge `admin-run` handler accepts.
 * Nightly is three phases (0.6.49) so each call has its own cloud compute budget.
 */
export const ADMIN_RUN_JOBS = [
  'generate-chips',
  'generate-market-data',
  'generate-history',
  'sync-market',
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

/** Live progress while jobs run one-by-one (for progress bar / "stuck on which job?"). */
export interface AdminRunProgress {
  /** Full list for this run, fixed order. */
  jobs: AdminRunJob[]
  total: number
  /** 0-based index of the job currently starting / just finished. */
  index: number
  /** Job about to run, or just finished (see `phase`). */
  job: AdminRunJob
  phase: 'job-start' | 'job-done'
  /** Jobs that have finished (ok or fail). */
  completed: number
  results: Partial<Record<AdminRunJob, AdminRunJobResult>>
  failed: AdminRunJob[]
  /** Wall time since runAdminJobs started. */
  elapsedMs: number
}

export type AdminRunProgressHandler = (p: AdminRunProgress) => void

/** UI labels for cron-backed jobs (Traditional Chinese). */
export const ADMIN_RUN_LABELS: Record<AdminRunJob, { title: string; cron: string; hint: string }> = {
  'generate-chips': {
    title: '盤後 · 籌碼報告',
    cron: 'stock-report-nightly',
    hint: '全站淨持股台股：T86／融資借券、組報告上傳（較重；與下兩段分開打避免 546）',
  },
  'generate-market-data': {
    title: '盤後 · 日K／基本面',
    cron: 'stock-report-nightly',
    hint: 'syncDaily + 估值／產業等（不含 MOPS 長歷史）',
  },
  'generate-history': {
    title: '盤後 · 營收／獲利補齊',
    cron: 'stock-report-nightly',
    hint: '一輪月營收+季報補齊（P1；完整 12 個月／季靠多輪排程或再按）',
  },
  'sync-market': {
    title: '台股全市場',
    cron: 'market-daily',
    hint:
      '15:00–18:45 每 15 分：FMTQIK + BFI82U → market/daily.json；當日量能+法人買進齊了就短路不重打',
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
 * Run one job, several jobs, or all.
 * Returns `{ ok: false, error }` only when **every** job fails at the transport layer
 * before any result is collected; partial success still returns `ok: true` with
 * `data.ok` / `data.failed` describing per-job outcomes.
 *
 * Optional `onProgress` fires before/after each job so the UI can show a progress bar.
 */
export async function runAdminJobs(
  jobs: AdminRunJob[] | 'all',
  onProgress?: AdminRunProgressHandler,
): Promise<{ ok: true; data: AdminRunResult } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase 未設定' }

  const list: AdminRunJob[] =
    jobs === 'all' ? [...ADMIN_RUN_JOBS] : jobs.filter((j, i, a) => a.indexOf(j) === i)

  if (list.length === 0) {
    return { ok: false, error: `jobs 必填。可用：${ADMIN_RUN_JOBS.join(', ')} 或 all` }
  }

  const started = Date.now()
  const results: Partial<Record<AdminRunJob, AdminRunJobResult>> = {}
  const failed: AdminRunJob[] = []
  const transportErrors: string[] = []
  let transportFails = 0
  let completed = 0

  const emit = (
    phase: 'job-start' | 'job-done',
    index: number,
    job: AdminRunJob,
  ): void => {
    onProgress?.({
      jobs: list,
      total: list.length,
      index,
      job,
      phase,
      completed,
      results: { ...results },
      failed: [...failed],
      elapsedMs: Date.now() - started,
    })
  }

  try {
    for (let i = 0; i < list.length; i++) {
      const job = list[i]!
      emit('job-start', i, job)
      const one = await invokeOneJob(job)
      if (!one.ok) {
        transportFails++
        transportErrors.push(`${job}: ${one.error}`)
        failed.push(job)
        results[job] = {
          httpStatus: one.httpStatus ?? 0,
          durationMs: one.durationMs,
          body: { error: one.error },
        }
      } else {
        results[job] = one.result
        if (one.result.httpStatus >= 400) failed.push(job)
      }
      completed++
      emit('job-done', i, job)
    }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : '執行失敗' }
  }

  // Every job died at the HTTP layer (auth / timeout / network) — surface the first reason.
  if (transportFails === list.length && transportErrors.length > 0) {
    return { ok: false, error: transportErrors[0] ?? '執行失敗' }
  }

  return {
    ok: true,
    data: {
      ok: failed.length === 0,
      jobs: list,
      results,
      failed,
      durationMs: Date.now() - started,
    },
  }
}

type OneJobOk = {
  ok: true
  result: AdminRunJobResult
}
type OneJobErr = {
  ok: false
  error: string
  httpStatus?: number
  durationMs: number
}

async function invokeOneJob(job: AdminRunJob): Promise<OneJobOk | OneJobErr> {
  if (!supabase) return { ok: false, error: 'Supabase 未設定', durationMs: 0 }
  const t0 = Date.now()
  const { data, error } = await supabase.functions.invoke('stock-report', {
    body: { action: 'admin-run', jobs: [job] },
  })
  const durationMs = Date.now() - t0

  if (error) {
    const msg = await httpErrorMessage(error)
    const httpStatus = responseStatus(error)
    return {
      ok: false,
      error: msg ?? error.message,
      httpStatus: httpStatus ?? undefined,
      durationMs,
    }
  }

  const res = data as Partial<AdminRunResult> & { error?: string }
  if (!res || typeof res !== 'object') {
    return { ok: false, error: '無回應', durationMs }
  }
  // Auth / validation failures on the Edge still come back as non-2xx (handled above)
  // or as 200-shaped payloads with error (legacy / defensive).
  if (typeof res.error === 'string' && res.ok !== true && !res.results) {
    return { ok: false, error: res.error, durationMs }
  }

  const fromServer = res.results?.[job]
  if (fromServer && typeof fromServer.httpStatus === 'number') {
    return {
      ok: true,
      result: {
        httpStatus: fromServer.httpStatus,
        durationMs:
          typeof fromServer.durationMs === 'number' ? fromServer.durationMs : durationMs,
        body: fromServer.body,
      },
    }
  }

  // Server returned 200 without a per-job row — treat envelope as the body.
  return {
    ok: true,
    result: {
      httpStatus: res.ok === false ? 500 : 200,
      durationMs: typeof res.durationMs === 'number' ? res.durationMs : durationMs,
      body: res,
    },
  }
}

/**
 * Dig the real reason out of supabase-js FunctionsHttpError.
 * Non-2xx often only expose "Edge Function returned a non-2xx status code";
 * the useful text is in `error.context` (Response), and gateway timeouts may
 * not use `{ error: string }` at all.
 */
async function httpErrorMessage(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: unknown })?.context
  if (!(ctx instanceof Response)) return null
  const status = ctx.status
  const statusBit = status ? `HTTP ${status}` : null

  let detail: string | null = null
  try {
    const text = await ctx.clone().text()
    if (text) {
      try {
        const body = JSON.parse(text) as Record<string, unknown>
        if (typeof body.error === 'string') detail = body.error
        else if (typeof body.message === 'string') detail = body.message
        else if (typeof body.msg === 'string') detail = body.msg
        else detail = text.slice(0, 200)
      } catch {
        detail = text.slice(0, 200)
      }
    }
  } catch {
    detail = null
  }

  if (status === 504 || status === 546) {
    const hint =
      '逾時或算力不足（雲端 Edge 上限）。請逐段執行盤後三階段；若仍失敗，到「抓取狀況」確認是否已寫入'
    return detail ? `${statusBit}: ${detail} — ${hint}` : `${statusBit}: ${hint}`
  }

  if (statusBit && detail) return `${statusBit}: ${detail}`
  if (detail) return detail
  if (statusBit) return statusBit
  return null
}

function responseStatus(error: unknown): number | null {
  const ctx = (error as { context?: unknown })?.context
  if (ctx instanceof Response) return ctx.status
  return null
}
