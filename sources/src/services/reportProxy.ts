/**
 * After-hours stock report: Call Supabase Edge Function `stock-report`, or directly read the shared report of after-hours scheduled production.
 * When Supabase is not set, isReportConfigured is false and the UI entrance is hidden.
 *
 * This file is of type **Web Interface Contract** and must be consistent with sources/supabase/functions/stock-report/report.ts
 * ReportData (schema 2) is aligned; the server only returns structured data, and the screen is all drawn by React.
 */
import type { Market } from '../types/models'
import { downloadReportsJson } from './reportsBucket'
import { isSupabaseConfigured, supabase } from './supabase'

/** Whether the Supabase URL and key have been set (if not set, the entire after-hours reporting function will be hidden)*/
export const isReportConfigured = isSupabaseConfigured

/**
 * The **minimum** report structure version recognized by the frontend.
 *
 * It must be ">=" instead of "===": the server will upgrade the schema every time it adds a field to the report (2 → 3 adds sources),
 * The new fields are a harmless addition to the old front end. If you use the equal sign, once the backend is upgraded, **all** reports will be judged as not supported——
 * Storage-first returned null, and the click-and-click output lost "Format does not match", and the entire chip page failed on the spot.
 * This is exactly what happened in 0.4.0 (backend up to 3, frontend back to lock 2), so this is pinned as a test.
 */
export const MIN_REPORT_SCHEMA = 2

/** The shareholding context brought in by the front end (Edge Function does not recalculate and is directly put into the report)*/
export interface ReportHolding {
  qty: number
  avgCost: number
  price: number | null
  unrealized: number | null
  roi: number | null
}

/** Buy / sell / buy and sell super three-piece set; if the source is missing the split item, it will be null*/
export interface ChipLeg {
  buy: number | null
  sell: number | null
  net: number | null
}

/** Three major legal persons (unit: shares)*/
export interface InstitutionalChip {
  foreign: ChipLeg
  foreignDealer: ChipLeg
  trust: ChipLeg
  dealer: ChipLeg
  total: ChipLeg
}

/** Margin margin trading (unit: trading unit = Zhang). Securities lending buy=covering, sell=short selling*/
export interface MarginChip {
  marginBuy: number | null
  marginSell: number | null
  marginRedeem: number | null
  marginPrev: number | null
  marginToday: number | null
  marginChange: number | null
  marginLimit: number | null
  shortBuy: number | null
  shortSell: number | null
  shortRedeem: number | null
  shortPrev: number | null
  shortToday: number | null
  shortChange: number | null
  shortLimit: number | null
  offset: number | null
  /** 'openapi' is the backup source: only balance, no buy/sell split*/
  source: 'rwd' | 'openapi'
}

export interface BorrowChip {
  availableVolume: number | null
}

/** Chip snapshot of a single trading day*/
/**
 * Freshness from a single source (schema 3 onwards).
 * The release times of the three data sources are quite different, and the batches are executed in sections. The old and new blocks in the same report are inherently different——
 * Just looking at generatedAt for the entire report can lead to the illusion that every block is equally new.
 */
export interface SourceStamp {
  /** The date of the data itself is YYYY-MM-DD (the borrowing time is the "next trading day", which will be different from the data date of the chips)*/
  date: string | null
  /** The time we actually caught it ISO*/
  fetchedAt: string | null
}

export interface ReportSources {
  institutional: SourceStamp | null
  margin: SourceStamp | null
  borrow: SourceStamp | null
}

export interface ChipDay {
  date: string
  institutional: InstitutionalChip | null
  margin: MarginChip | null
}

/** Continuous buying and selling/continuous increasing and decreasing: Positive number = over-buying (increasing) for N consecutive days, negative number = over-selling (decreasing) for N consecutive days*/
export interface ChipStreaks {
  foreign: number
  foreignDealer: number
  trust: number
  dealer: number
  total: number
  margin: number
  short: number
}

export interface ReportData {
  schema: number
  ticker: string
  name: string
  market: 'TPE'
  dataDate: string
  generatedAt: string
  holding: ReportHolding | null
  institutional: InstitutionalChip | null
  margin: MarginChip | null
  borrow: BorrowChip | null
  /** Old to new, up to 7 trading days*/
  history: ChipDay[]
  streaks: ChipStreaks
  /** Available only from schema 3 onwards; schema 2 is reported as undefined and must be tolerated by the UI*/
  sources?: ReportSources
  notes: string[]
}

export interface GenerateReportInput {
  market: Market
  ticker: string
  name: string
  holding?: ReportHolding | null
}

interface GenerateReportResponse {
  reportId: string
  generatedAt: string
  dataDate: string
  data: ReportData
}

/** Report whether the structure is recognized by the front end (the old HTML format of schema 1 will always be regarded as a miss)*/
function isSupportedReport(d: unknown): d is ReportData {
  if (!d || typeof d !== 'object') return false
  const r = d as Partial<ReportData>
  return typeof r.schema === 'number' && r.schema >= MIN_REPORT_SCHEMA && Array.isArray(r.history)
}

/** Immediate delivery: fallback when delivery is not scheduled (not in the holding list/has not yet been delivered on the day), slower but available*/
export async function generateReport(input: GenerateReportInput): Promise<ReportData> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase 未設定')
  }
  const { data, error } = await supabase.functions.invoke<GenerateReportResponse>('stock-report', {
    body: { action: 'generate', ...input },
    timeout: 60_000, // on-demand report generation
  })
  if (error) {
    throw new Error(error.message || '產生報告失敗')
  }
  if (!isSupportedReport(data?.data)) {
    throw new Error('伺服器回傳的報告格式不符，請稍後再試')
  }
  return data.data
}

// ----Storage-first: Read the pre-generated shared reports (reports bucket) scheduled after reading the disk----

/**
 * Read the shared report of the after-hours scheduled production (excluding individual shareholdings, the shareholding profile is rendered by the front end).
 * First read the manifest to get the latest transaction date, and then read {ymd}/{ticker}.json.
 * If the result is not found or the format is not schema 2, null will be returned, and the caller's fallback will be generated immediately.
 */
export async function fetchStoredReport(ticker: string): Promise<ReportData | null> {
  if (!isSupabaseConfigured || !supabase) return null
  const manifest = await downloadReportsJson<{ ymd: string }>('manifest.json')
  if (!manifest?.ymd) return null
  const stored = await downloadReportsJson<{ data?: unknown }>(`${manifest.ymd}/${ticker}.json`)
  return isSupportedReport(stored?.data) ? stored.data : null
}
