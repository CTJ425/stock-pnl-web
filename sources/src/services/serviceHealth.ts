/**
 * 服務狀態檢測，僅在使用者開啟服務狀態頁或按下重新檢測時執行；不介入 priceProxy 的抓價路徑。
 */
import { isSupabaseConfigured, supabase } from './supabase'
import { readTwListCacheMeta } from './twMarketData'
import { positionKey } from '../types/models'

export type HealthStatus = 'ok' | 'degraded' | 'down' | 'idle'
export type ComponentId = 'app' | 'storage' | 'auth' | 'database' | 'edge' | 'twQuote' | 'usQuote' | 'twList'

export interface ComponentResult {
  status: HealthStatus
  /** 往返毫秒；無測量時 undefined */
  ms?: number
  /** 補充說明（如「休市或無即時報價」「未設定 Supabase」） */
  note?: string
}

export interface HealthSample {
  at: string /* ISO */
  results: Record<ComponentId, ComponentResult>
}

export const DEGRADED_MS = 2000
export const HISTORY_LIMIT = 30
export const HISTORY_KEY = 'stock-pnl-web/health-history-v1'

export function classifyLatency(ms: number): HealthStatus {
  return ms > DEGRADED_MS ? 'degraded' : 'ok'
}

export function overallStatus(results: Record<ComponentId, ComponentResult>): HealthStatus {
  const statuses = Object.values(results).map((r) => r.status)
  if (statuses.includes('down')) return 'down'
  if (statuses.includes('degraded')) return 'degraded'
  return 'ok'
}

export function readHealthHistory(): HealthSample[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as HealthSample[]
  } catch {
    return []
  }
}

export function appendHealthSample(sample: HealthSample): HealthSample[] {
  const history = readHealthHistory()
  history.push(sample)
  if (history.length > HISTORY_LIMIT) {
    history.splice(0, history.length - HISTORY_LIMIT)
  }
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch {
    // ignore
  }
  return history
}

export async function runHealthCheck(appVersion: string): Promise<HealthSample> {
  const results: Partial<Record<ComponentId, ComponentResult>> = {}

  // app
  results.app = { status: 'ok', note: appVersion }

  // storage
  try {
    const probe = 'stock-pnl-web/health-probe'
    localStorage.setItem(probe, '1')
    localStorage.getItem(probe)
    localStorage.removeItem(probe)
    results.storage = { status: 'ok' }
  } catch {
    results.storage = { status: 'down', note: '瀏覽器儲存不可用（無痕模式或空間已滿）' }
  }

  // twList
  const twListMeta = readTwListCacheMeta()
  if (!twListMeta) {
    results.twList = { status: 'idle', note: '尚未載入' }
  } else {
    const ageMs = Date.now() - twListMeta.at
    const minutes = Math.floor(ageMs / 60000)
    if (ageMs > 30 * 60 * 1000) {
      results.twList = { status: 'idle', note: '快取已過期' }
    } else {
      results.twList = { status: 'ok', note: `${minutes} 分鐘前更新 · ${twListMeta.count} 檔` }
    }
  }

  // Network probes
  if (!isSupabaseConfigured || !supabase) {
    const note = '未設定 Supabase（本機模式）'
    results.auth = { status: 'idle', note }
    results.database = { status: 'idle', note }
    results.edge = { status: 'idle', note }
    results.twQuote = { status: 'idle', note }
    results.usQuote = { status: 'idle', note }
  } else {
    // 收斂到區域常數：閉包內無法沿用 import binding 的 non-null narrowing
    const sb = supabase

    const checkAuth = async (): Promise<ComponentResult> => {
      const start = performance.now()
      try {
        const { error } = await sb.auth.getSession()
        const ms = Math.round(performance.now() - start)
        if (error) return { status: 'down', note: error.message, ms }
        return { status: classifyLatency(ms), ms }
      } catch (err) {
        const ms = Math.round(performance.now() - start)
        return { status: 'down', note: err instanceof Error ? err.message : String(err), ms }
      }
    }

    const checkDb = async (): Promise<ComponentResult> => {
      const start = performance.now()
      try {
        const { error } = await sb.from('workspaces').select('id').limit(1)
        const ms = Math.round(performance.now() - start)
        if (error) return { status: 'down', note: error.message, ms }
        return { status: classifyLatency(ms), ms }
      } catch (err) {
        const ms = Math.round(performance.now() - start)
        return { status: 'down', note: err instanceof Error ? err.message : String(err), ms }
      }
    }

    const checkEdge = async (): Promise<{ edge: ComponentResult; twQuote: ComponentResult; usQuote: ComponentResult }> => {
      const start = performance.now()
      try {
        const { data, error } = await sb.functions.invoke('stock-price', {
          body: { action: 'prices', symbols: [{ market: 'TPE', ticker: '2330' }, { market: 'US', ticker: 'AAPL' }] },
        })
        const ms = Math.round(performance.now() - start)
        
        if (error || (data && data.error)) {
          const note = error?.message || data?.error || 'Edge Function 錯誤'
          return {
            edge: { status: 'down', note, ms },
            twQuote: { status: 'down', note: '無法透過 Edge Function 取得報價' },
            usQuote: { status: 'down', note: '無法透過 Edge Function 取得報價' },
          }
        }
        
        const edgeRes: ComponentResult = { status: classifyLatency(ms), ms }
        
        const twKey = positionKey('TPE', '2330')
        const twPrice = data?.prices?.[twKey]?.price
        const twQuote: ComponentResult = (Number.isFinite(twPrice) && twPrice > 0)
          ? { status: 'ok' }
          : { status: 'idle', note: '休市或無即時報價' }
          
        const usKey = positionKey('US', 'AAPL')
        const usPrice = data?.prices?.[usKey]?.price
        const usQuote: ComponentResult = (Number.isFinite(usPrice) && usPrice > 0)
          ? { status: 'ok' }
          : { status: 'idle', note: '休市或無即時報價' }
          
        return { edge: edgeRes, twQuote, usQuote }
      } catch (err) {
        const ms = Math.round(performance.now() - start)
        return {
          edge: { status: 'down', note: err instanceof Error ? err.message : String(err), ms },
          twQuote: { status: 'down', note: '無法透過 Edge Function 取得報價' },
          usQuote: { status: 'down', note: '無法透過 Edge Function 取得報價' },
        }
      }
    }

    const [authRes, dbRes, edgeCombined] = await Promise.all([checkAuth(), checkDb(), checkEdge()])
    results.auth = authRes
    results.database = dbRes
    results.edge = edgeCombined.edge
    results.twQuote = edgeCombined.twQuote
    results.usQuote = edgeCombined.usQuote
  }

  return {
    at: new Date().toISOString(),
    results: results as Record<ComponentId, ComponentResult>,
  }
}
