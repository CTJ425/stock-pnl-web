/**
 * 新加入的股票在夜間批次跑到之前，日線與基本面都還不存在。
 * 這個服務讓前端在「Storage 查無」時補叫一次 Edge Function 產生，不必等到當晚 17:30。
 *
 * 呼叫紀律（這是額度安全的關鍵，別繞過）：
 * 1. **只在 Storage 真的查無時呼叫**，不可在每次掛載時無條件打。
 * 2. **同一個代號整個 session 只打一次**——`attempted` 記下已試過的代號，
 *    即使伺服器回「這檔沒有資料」（例如 ETF 沒有基本面）也不再重試。
 *    少了這條，一檔永遠拿不到資料的股票會讓使用者每切一次分頁就燒一次 invocation。
 * 3. 併發去重：`inflight` 讓同時觸發的多個元件共用同一個 promise。
 *
 * 伺服器端另有 heldTwTickers() 白名單與「已是最新就跳過」的條件把關，
 * 兩邊都做是刻意的：前端這層省的是 invocation，後端那層擋的是濫用。
 */
import { supabase } from './supabase'

export interface WarmResult {
  ok: boolean
  dailySynced: number
  fundamentalSynced: number
}

const FAILED: WarmResult = { ok: false, dailySynced: 0, fundamentalSynced: 0 }

const inflight = new Map<string, Promise<WarmResult>>()
const attempted = new Set<string>()

/** 測試用：清掉本模組的去重狀態 */
export function resetWarmState(): void {
  inflight.clear()
  attempted.clear()
}

/**
 * 替單一代號補產日線與基本面。
 * 同一代號在同一個 session 內只會真的送出一次請求；重複呼叫直接回上次的結果或失敗值。
 */
export async function warmStock(ticker: string): Promise<WarmResult> {
  if (!supabase) return FAILED

  const pending = inflight.get(ticker)
  if (pending) return pending
  if (attempted.has(ticker)) return FAILED

  attempted.add(ticker)

  const task = (async (): Promise<WarmResult> => {
    try {
      const { data, error } = await supabase.functions.invoke('stock-report', {
        body: { action: 'warm', ticker },
      })
      if (error || !data || typeof data !== 'object') return FAILED
      const d = data as Record<string, unknown>
      return {
        ok: d.ok === true,
        dailySynced: typeof d.dailySynced === 'number' ? d.dailySynced : 0,
        fundamentalSynced: typeof d.fundamentalSynced === 'number' ? d.fundamentalSynced : 0,
      }
    } catch {
      return FAILED
    } finally {
      inflight.delete(ticker)
    }
  })()

  inflight.set(ticker, task)
  return task
}
