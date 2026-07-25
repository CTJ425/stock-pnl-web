/**
 * 個股分析頁：由庫存總覽下鑽而來，內含「籌碼 / 技術面 / 我的持股」分頁籤。
 * 取代 v1 的彈窗 —— 字串模板做不出可互動圖表（見 docs/agent/PLAN.md §B）。
 *
 * 資料流：Storage-first 讀盤後排程預產的共用報告，查無再即點即產 fallback；
 * 個人持股由呼叫端以 props 帶入，共用報告本身不含個資。
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Download, RefreshCw } from 'lucide-react'
import {
  fetchStoredReport,
  generateReport,
  type ReportData,
  type ReportHolding,
} from '../../services/reportProxy'
import { downloadBlob, generatePdfBlob } from '../../services/reportPdf'
import { ChipsTab } from './ChipsTab'
import { HoldingTab } from './HoldingTab'
import { TechnicalTab } from './TechnicalTab'

export interface StockDetailTarget {
  ticker: string
  name: string
  holding: ReportHolding | null
}

interface StockDetailPageProps extends StockDetailTarget {
  onBack: () => void
}

type DetailTab = 'chips' | 'technical' | 'holding'

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'chips', label: '籌碼' },
  { id: 'technical', label: '技術面' },
  { id: 'holding', label: '我的持股' },
]

export function StockDetailPage({ ticker, name, holding, onBack }: StockDetailPageProps) {
  const [tab, setTab] = useState<DetailTab>('chips')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [report, setReport] = useState<ReportData | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfNote, setPdfNote] = useState('')
  const surfaceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setStatus('loading')
    setReport(null)
    ;(async () => {
      try {
        // Storage-first：盤後排程預產的共用報告（快、免打 TWSE）
        const stored = await fetchStoredReport(ticker)
        if (alive && stored) {
          setReport(stored)
          setStatus('ready')
          return
        }
        // fallback：未預產（不在清單 / 當日尚未產 / 舊格式）時即點即產
        const fresh = await generateReport({ market: 'TPE', ticker, name, holding })
        if (alive) {
          setReport(fresh)
          setStatus('ready')
        }
      } catch (e: unknown) {
        if (alive) {
          setErrMsg(e instanceof Error ? e.message : '產生報告失敗')
          setStatus('error')
        }
      }
    })()
    return () => {
      alive = false
    }
    // holding 不列入依賴：開頁當下的持股脈絡即可，避免現價刷新導致重複產生
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, name])

  async function handleDownload() {
    if (!surfaceRef.current) return
    setPdfBusy(true)
    setPdfNote('')
    try {
      const blob = await generatePdfBlob(surfaceRef.current)
      downloadBlob(blob, `盤後籌碼-${ticker}-${report?.dataDate ?? ''}.pdf`)
    } catch {
      setPdfNote('PDF 產生失敗，請再試一次。')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="section">
      <div className="detail-head">
        <button className="btn btn-sm" onClick={onBack}>
          <ArrowLeft size={14} />
          返回總覽
        </button>
        <div className="detail-title">
          <h2>
            {ticker} {name}
          </h2>
          {/* 資料日期與更新時間屬於「籌碼」報告本身，故顯示於報告表頭（也在 PDF 擷取範圍內），此處不重複 */}
          <span className="hint">個股分析</span>
        </div>
        {status === 'ready' && tab === 'chips' && (
          <button className="btn btn-sm" onClick={() => void handleDownload()} disabled={pdfBusy}>
            <Download size={14} className={pdfBusy ? 'spin' : undefined} />
            {pdfBusy ? '產生 PDF 中…' : '下載 PDF'}
          </button>
        )}
      </div>

      <nav className="subtabs" aria-label="個股分析分頁">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            className={tab === id ? 'subtab active' : 'subtab'}
            onClick={() => setTab(id)}
            aria-current={tab === id}
          >
            {label}
          </button>
        ))}
      </nav>

      {pdfNote && <div className="detail-note">{pdfNote}</div>}

      <div className="glass detail-body" ref={surfaceRef}>
        {tab === 'chips' && (
          <>
            {status === 'loading' && (
              <div className="empty-state" style={{ padding: 32 }}>
                <RefreshCw size={28} className="spin" />
                <div style={{ marginTop: 10 }}>正在讀取盤後籌碼…</div>
              </div>
            )}
            {status === 'error' && (
              <div className="notice notice-warn" role="alert">
                <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                {errMsg}
              </div>
            )}
            {status === 'ready' && report && <ChipsTab report={report} />}
          </>
        )}
        {tab === 'technical' && <TechnicalTab />}
        {tab === 'holding' && <HoldingTab holding={holding} />}
      </div>
    </div>
  )
}
