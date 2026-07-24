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
