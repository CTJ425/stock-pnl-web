/**
 * 盤後籌碼報告：呼叫 Supabase Edge Function `stock-report`。
 * 未設定 Supabase 時 isReportConfigured 為 false，UI 隱藏入口。
 */
import type { Market } from '../types/models'
import { isSupabaseConfigured, supabase } from './supabase'

/** 是否已設定 Supabase 網址與金鑰（未設定則整個盤後報告功能隱藏） */
export const isReportConfigured = isSupabaseConfigured

/** 前端帶入的持股脈絡（Edge Function 不重算，直接放進報告） */
export interface ReportHolding {
  qty: number
  avgCost: number
  price: number | null
  unrealized: number | null
  roi: number | null
}

export interface GenerateReportInput {
  market: Market
  ticker: string
  name: string
  holding?: ReportHolding | null
}

export interface ReportResponse {
  reportId: string
  generatedAt: string
  dataDate: string
  /** 結構化報告資料 */
  data: unknown
  /** 自包含 HTML 片段（含 scoped style），前端注入顯示並擷取成 PDF */
  html: string
}

export async function generateReport(input: GenerateReportInput): Promise<ReportResponse> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase 未設定')
  }
  const { data, error } = await supabase.functions.invoke<ReportResponse>('stock-report', {
    body: { action: 'generate', ...input },
  })
  if (error) {
    throw new Error(error.message || '產生報告失敗')
  }
  if (!data) {
    throw new Error('伺服器未回傳報告內容')
  }
  return data
}

// ---- Storage-first：讀取盤後排程預先產好的共用報告（reports bucket）----

const REPORTS_BUCKET = 'reports'

/** 從 reports bucket 讀一個 JSON 檔（公開 bucket，anon 可讀）；查無 / 失敗回 null */
async function downloadJson<T>(path: string): Promise<T | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.storage.from(REPORTS_BUCKET).download(path)
    if (error || !data) return null
    return JSON.parse(await data.text()) as T
  } catch {
    return null
  }
}

/**
 * 讀取盤後排程預產的共用報告（不含個人持股概況，由前端 applyHoldingOverlay 疊加）。
 * 先讀 manifest 取得最近交易日，再讀 {ymd}/{ticker}.json。查無回 null，呼叫端 fallback 即點即產。
 */
export async function fetchStoredReport(
  ticker: string,
): Promise<Pick<ReportResponse, 'generatedAt' | 'dataDate' | 'data' | 'html'> | null> {
  if (!isSupabaseConfigured || !supabase) return null
  const manifest = await downloadJson<{ ymd: string }>('manifest.json')
  if (!manifest?.ymd) return null
  const stored = await downloadJson<{
    dataDate: string
    generatedAt: string
    data: unknown
    html: string
  }>(`${manifest.ymd}/${ticker}.json`)
  if (!stored?.html) return null
  return {
    generatedAt: stored.generatedAt,
    dataDate: stored.dataDate,
    data: stored.data,
    html: stored.html,
  }
}

// ---- 前端疊加「持股概況」：共用報告不含個人持股，改由前端注入（markup 對齊 reportHtml.ts）----

function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}
function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtSignedMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const body = `NT$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
  return n > 0 ? `+${body}` : n < 0 ? `-${body}` : body
}
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${(n * 100).toFixed(2)}%`
}
/** 紅正綠負（台灣看盤慣例），與報告 scoped style 的 .up/.down/.flat 對齊 */
function sc(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return 'flat'
  return n > 0 ? 'up' : 'down'
}

/** 產生「持股概況」HTML 片段（沿用報告內建的 scoped .card 樣式，毋需額外 CSS） */
export function renderHoldingSection(h: ReportHolding): string {
  return `<h2>持股概況</h2>
  <div class="cards">
    <div class="card"><div class="k">持有股數</div><div class="v">${fmtInt(h.qty)}</div></div>
    <div class="card"><div class="k">平均成本</div><div class="v">${fmtPrice(h.avgCost)}</div></div>
    <div class="card"><div class="k">現價</div><div class="v">${fmtPrice(h.price)}</div></div>
    <div class="card"><div class="k">未實現損益</div><div class="v ${sc(h.unrealized)}">${fmtSignedMoney(h.unrealized)}</div></div>
    <div class="card"><div class="k">未實現報酬率</div><div class="v ${sc(h.roi)}">${fmtPct(h.roi)}</div></div>
  </div>
  `
}

/**
 * 把「持股概況」疊加到共用報告 HTML 中（插入到第一個 <h2>「三大法人」之前）。
 * 僅用於 Storage 取得的共用報告；即點即產的報告已含持股概況，不需疊加。
 */
export function applyHoldingOverlay(html: string, holding: ReportHolding | null): string {
  if (!holding) return html
  const section = renderHoldingSection(holding)
  const idx = html.indexOf('<h2>')
  if (idx < 0) return html + section
  return `${html.slice(0, idx)}${section}${html.slice(idx)}`
}
