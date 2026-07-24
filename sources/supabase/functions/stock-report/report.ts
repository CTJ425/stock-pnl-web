/**
 * 報告資料模型組裝：把抓來的籌碼 + 前端帶入的持股脈絡（成本/損益）合成 ReportData。
 * 純資料層，不觸網、不碰 DB，便於單元測試。
 */
import type { InstitutionalChip, MarginChip, BorrowChip } from './twChips.ts'

/** 前端帶入的持股脈絡（皆為前端已算好的值，Worker 不重算） */
export interface HoldingContext {
  qty: number
  avgCost: number
  price: number | null
  unrealized: number | null
  roi: number | null
}

export interface ReportData {
  ticker: string
  name: string
  market: 'TPE'
  /** 資料所屬交易日 YYYY-MM-DD（來自 T86 解析到的日期） */
  dataDate: string
  /** 產生時間 ISO */
  generatedAt: string
  holding: HoldingContext | null
  institutional: InstitutionalChip | null
  margin: MarginChip | null
  borrow: BorrowChip | null
  /** 缺漏 / 降級說明（如上櫃暫不支援、某來源無回應） */
  notes: string[]
}

/** 台北時區（UTC+8）的 YYYYMMDD */
function taipeiYmd(d: Date): string {
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const y = t.getUTCFullYear()
  const m = String(t.getUTCMonth() + 1).padStart(2, '0')
  const day = String(t.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/**
 * 回推交易日候選（含當日往前數天），用於 rwd 端點嘗試；
 * 週末 / 假日 / 尚未收盤時前一候選會抓不到，改試更早的。
 */
export function tradingDateCandidates(now: Date, back = 7): string[] {
  const out: string[] = []
  for (let i = 0; i <= back; i++) {
    out.push(taipeiYmd(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)))
  }
  return out
}

/** YYYYMMDD → YYYY-MM-DD */
export function dashDate(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

export interface BuildReportParams {
  ticker: string
  name: string
  dataDateYmd: string
  holding: HoldingContext | null
  institutional: InstitutionalChip | null
  margin: MarginChip | null
  borrow: BorrowChip | null
  notes: string[]
  now?: Date
}

export function buildReport(p: BuildReportParams): ReportData {
  return {
    ticker: p.ticker,
    name: p.name,
    market: 'TPE',
    dataDate: dashDate(p.dataDateYmd),
    generatedAt: (p.now ?? new Date()).toISOString(),
    holding: p.holding,
    institutional: p.institutional,
    margin: p.margin,
    borrow: p.borrow,
    notes: p.notes,
  }
}
