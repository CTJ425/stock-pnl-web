import { useEffect, useState, useMemo } from 'react'
import { Code2, ExternalLink, RefreshCw } from 'lucide-react'
import type {
  ComponentId,
  ComponentResult,
  HealthSample,
  HealthStatus,
} from '../../services/serviceHealth'
import {
  HISTORY_LIMIT,
  appendHealthSample,
  overallStatus,
  readHealthHistory,
  runHealthCheck,
} from '../../services/serviceHealth'
import { readPriceCache } from '../../services/priceProxy'
import { APP_VERSION } from '../../version'

/** 與 Dashboard 的「現價更新於」同格式：24 小時制、在地時區 */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-TW', { hour12: false })
}

const COMPONENT_LABELS: Record<ComponentId, string> = {
  app: '應用程式 (GitHub Pages)',
  storage: '本機資料儲存',
  auth: 'Supabase 身分驗證',
  database: '資料庫 (PostgreSQL + RLS)',
  edge: 'Edge Function (stock-price)',
  twQuote: '台股即時行情 (TWSE MIS)',
  usQuote: '美股報價 (Yahoo Finance)',
  twList: '台股清單 (TWSE/TPEx OpenAPI)',
}

const STATUS_TEXT: Record<HealthStatus, string> = {
  ok: '正常',
  degraded: '效能降級',
  down: '無法連線',
  idle: '未啟用',
}

const STATUS_BANNER_TEXT: Record<HealthStatus, string> = {
  ok: '所有系統運作正常',
  degraded: '部分系統效能降級',
  down: '部分系統無法連線',
  idle: '系統狀態未知',
}

/** 最近 HISTORY_LIMIT 次檢測，左舊右新；歷史不足時左側以空格補滿，條寬才不會跳動 */
function UptimeBar({ history, compId }: { history: HealthSample[]; compId: ComponentId }) {
  const cells = []
  const emptyCount = Math.max(0, HISTORY_LIMIT - history.length)

  for (let i = 0; i < emptyCount; i++) {
    cells.push(<div key={`empty-${i}`} className="uptime-cell empty" title="還沒有檢測紀錄" />)
  }

  for (const sample of history.slice(-HISTORY_LIMIT)) {
    const status = sample.results?.[compId]?.status ?? 'idle'
    cells.push(
      <div
        key={`sample-${sample.at}`}
        className={`uptime-cell ${status}`}
        title={`${fmtTime(sample.at)} · ${STATUS_TEXT[status]}`}
      />
    )
  }

  return <div className="uptime-bar">{cells}</div>
}

function ComponentRow({ id, result, history }: { id: ComponentId; result: ComponentResult | undefined; history: HealthSample[] }) {
  const status = result?.status ?? 'idle'
  const msText = result?.ms !== undefined ? ` ${result.ms}ms` : ''
  const note = result?.note
  
  return (
    <div className="status-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className={`status-dot ${status}`} />
          <span style={{ fontWeight: 500 }}>{COMPONENT_LABELS[id]}</span>
        </div>
        {note && <div style={{ fontSize: '12px', color: 'var(--ink-muted)', marginTop: '4px', paddingLeft: '16px' }}>{note}</div>}
        <UptimeBar history={history} compId={id} />
      </div>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap', marginLeft: '16px' }}>
        <span style={{ fontSize: '13px' }}>{STATUS_TEXT[status]}{msText}</span>
      </div>
    </div>
  )
}

export function ServiceStatusPage() {
  const [history, setHistory] = useState<HealthSample[]>([])
  const [checking, setChecking] = useState(false)
  
  useEffect(() => {
    setHistory(readHealthHistory())
    let mounted = true
    const initCheck = async () => {
      setChecking(true)
      const sample = await runHealthCheck(APP_VERSION)
      if (!mounted) return
      setHistory(appendHealthSample(sample))
      setChecking(false)
    }
    void initCheck()
    return () => { mounted = false }
  }, [])
  
  const handleCheck = async () => {
    if (checking) return
    setChecking(true)
    const sample = await runHealthCheck(APP_VERSION)
    setHistory(appendHealthSample(sample))
    setChecking(false)
  }
  
  const lastSample = history.length > 0 ? history[history.length - 1] : null
  const pageStatus = lastSample ? overallStatus(lastSample.results) : 'idle'
  const checkTime = lastSample ? fmtTime(lastSample.at) : '--:--:--'
  
  const cacheInfo = useMemo(() => {
    const cache = readPriceCache()
    const keys = Object.keys(cache)
    if (keys.length === 0) return '尚無快取報價'
    
    let edge = 0, twse = 0, cSource = 0, stale = 0
    let oldest = Number.MAX_SAFE_INTEGER
    
    for (const k of keys) {
      const q = cache[k]
      if (q.source === 'edge') edge++
      else if (q.source === 'twse') twse++
      else if (q.source === 'cache') cSource++
      if (q.stale) stale++
      
      const t = Date.parse(q.asOf)
      if (Number.isFinite(t) && t < oldest) {
        oldest = t
      }
    }
    
    const oldestStr = oldest !== Number.MAX_SAFE_INTEGER 
      ? new Date(oldest).toLocaleTimeString()
      : '--'
      
    return `報價快取共 ${keys.length} 筆（來源：Edge ${edge}、TWSE ${twse}、快取 ${cSource}）；過期 ${stale} 筆；最舊報價時間 ${oldestStr}`
  }, [history]) // re-evaluate when history updates (after check)
  
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', paddingBottom: 40 }}>
      <div className="section glass" style={{ padding: '24px' }}>
        <div className="section-title">
          <h2>關於本專案</h2>
        </div>
        <p style={{ color: 'var(--ink-secondary)', lineHeight: 1.6, marginBottom: '16px' }}>
          記錄台股與美股的買賣，自動算出你現在賺賠多少、每年實際入袋多少，手續費和稅都會一起算進去。
          由原本的 Google 試算表「股票小幫手」改寫而成。
        </p>
        <a 
          href="https://github.com/CTJ425/stock-pnl-web" 
          target="_blank" 
          rel="noreferrer"
          className="btn btn-sm"
          style={{ textDecoration: 'none' }}
        >
          <Code2 size={14} />
          GitHub Repository
          <ExternalLink size={14} style={{ marginLeft: 4, opacity: 0.7 }} />
        </a>
      </div>
      
      <div className="section glass" style={{ padding: '24px' }}>
        <div className="section-title">
          <h2>服務狀態</h2>
        </div>
        
        <div className={`status-banner ${pageStatus}`}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '15px', display: 'flex', alignItems: 'center' }}>
              <span className={`status-dot ${pageStatus}`} />
              {STATUS_BANNER_TEXT[pageStatus]}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--ink-muted)', marginTop: '4px', paddingLeft: '16px' }}>
              最後檢測 {checkTime}
            </div>
          </div>
          <button 
            className="btn btn-sm" 
            onClick={() => void handleCheck()} 
            disabled={checking}
          >
            <RefreshCw size={14} className={checking ? 'spin' : ''} />
            重新檢測
          </button>
        </div>
        
        {/* 條狀圖的說明只放一次：每個元件都放會蓋過狀態本身 */}
        <div className="uptime-hint">
          條狀圖是最近 {HISTORY_LIMIT} 次檢測，左邊較舊、右邊最新。
          只有開啟本頁或按「重新檢測」時才會檢測，紀錄存在你的瀏覽器裡。
        </div>

        <div className="status-group">
          <h3 style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--ink)' }}>前端</h3>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <ComponentRow id="app" result={lastSample?.results?.app} history={history} />
            <ComponentRow id="storage" result={lastSample?.results?.storage} history={history} />
          </div>
        </div>
        
        <div className="status-group">
          <h3 style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--ink)' }}>後端</h3>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <ComponentRow id="auth" result={lastSample?.results?.auth} history={history} />
            <ComponentRow id="database" result={lastSample?.results?.database} history={history} />
            <ComponentRow id="edge" result={lastSample?.results?.edge} history={history} />
          </div>
        </div>
        
        <div className="status-group">
          <h3 style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--ink)' }}>報價 API</h3>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <ComponentRow id="twQuote" result={lastSample?.results?.twQuote} history={history} />
            <ComponentRow id="usQuote" result={lastSample?.results?.usQuote} history={history} />
            <ComponentRow id="twList" result={lastSample?.results?.twList} history={history} />
          </div>
        </div>
        
        <div style={{ fontSize: '12px', color: 'var(--ink-muted)', textAlign: 'center', marginTop: '16px' }}>
          {cacheInfo}
        </div>
      </div>
    </div>
  )
}
