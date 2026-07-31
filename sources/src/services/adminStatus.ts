/**
 * 管理員後台「資料抓取狀況」的資料來源。
 *
 * 走 Edge Function 的 `admin-status`（唯讀彙總）而不是前端各自去撈，理由有二：
 * 1. 排程（`cron` schema）與觀測表（`batch_run_log` / `source_probe_log`）
 *    **前端沒有權限讀**，那些表開了 RLS 但刻意沒有任何 policy。
 *    為了一個唯讀後台去鬆綁那些防線並不划算。
 * 2. 整頁要十幾項資訊，逐項往返會很慢；後端一次撈完約 1 秒。
 *
 * 授權是 `functions.invoke` 自動帶上的使用者 JWT，後端再核 `app_metadata.role`。
 * **不是 CRON_SECRET** —— 那把密鑰不能進前端（進了就等於公開）。
 */
import { supabase } from './supabase'

/** 單一資料源的新鮮度（與 Edge Function 的 report.ts SourceStamp 對齊） */
export interface SourceStamp {
  date: string | null
  fetchedAt: string | null
}

export interface ScheduleRow {
  jobid: number
  jobname: string
  schedule: string
  active: boolean
  action: string | null
  /** 這個排程打的是哪一區。BUG-003 就是測試區的 cron 打到正式區，顯示出來才擋得住 */
  targetRef: string | null
  lastRun: string | null
  lastStatus: string | null
  runsToday: number
  failsToday: number
}

export interface AdminMacroIndicator {
  id: string
  label: string
  unit: string
  latest: { period: string; value: number | null } | null
  previous: { period: string; value: number | null } | null
}

export interface AdminStatus {
  asOf: string
  todayYmd: string
  schedules: ScheduleRow[]
  manifest: { ymd?: string; dataDate?: string; generatedAt?: string } | null
  chip: {
    ymd: string
    dataDate: string | null
    sources: {
      institutional: SourceStamp | null
      margin: SourceStamp | null
      borrow: SourceStamp | null
    } | null
  } | null
  /** 各 Storage 目錄的檔案數與持股檔數，用來算「N 檔裡到了幾檔」 */
  coverage: { daily?: number; fundamental?: number; news?: number; held?: number }
  macro: { asOf: string; checkedAt: string | null; indicators: AdminMacroIndicator[] } | null
  fx: { asOf: string; count: number } | null
  batch: { runsToday?: number; runSig?: string | null } | null
  probe: {
    taipei_ymd?: string
    taipei_time?: string
    bwibbu_ok?: boolean
    bwibbu_date?: string
    bwibbu_rows?: number
    borrow_ok?: boolean
    borrow_date?: string
    borrow_rows?: number
  } | null
  durationMs: number
}

/** 呼叫者是否為管理員（`app_metadata.role === 'admin'`）。
 *
 * `app_metadata` 只能由 service role / Dashboard 寫入，使用者改不了自己的 ——
 * 這是它比 email 適合當授權依據的原因（email 使用者可自行變更）。
 * **此判準必須與 Edge Function 的 `assertAdmin` 一致**，兩邊漂移就會出現
 * 「畫面看得到分頁但 API 回 403」這種難查的狀況。
 */
export async function isAdmin(): Promise<boolean> {
  if (!supabase) return false
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return false
    const meta = data.user.app_metadata as Record<string, unknown> | undefined
    return meta?.role === 'admin'
  } catch {
    return false
  }
}

/** 讀取後台彙總。查無 / 無權限回 null（吞錯不拋，比照其他 proxy） */
export async function fetchAdminStatus(): Promise<AdminStatus | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke('stock-report', {
      body: { action: 'admin-status' },
    })
    if (error || !data || (data as { ok?: boolean }).ok !== true) return null
    const d = data as Partial<AdminStatus>
    return {
      asOf: typeof d.asOf === 'string' ? d.asOf : '',
      todayYmd: typeof d.todayYmd === 'string' ? d.todayYmd : '',
      schedules: Array.isArray(d.schedules) ? d.schedules : [],
      manifest: d.manifest ?? null,
      chip: d.chip ?? null,
      coverage: d.coverage ?? {},
      macro: d.macro ?? null,
      fx: d.fx ?? null,
      batch: d.batch ?? null,
      probe: d.probe ?? null,
      durationMs: typeof d.durationMs === 'number' ? d.durationMs : 0,
    }
  } catch {
    return null
  }
}
