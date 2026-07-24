/**
 * 盤後籌碼報告彈窗：開啟即呼叫 Edge Function 產生報告，成功後注入其 HTML 並提供「下載 PDF」。
 * PDF 由前端 html2canvas+jsPDF 產生並下載給使用者。
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, RefreshCw } from 'lucide-react'
import { Modal } from '../Common/Modal'
import {
  generateReport,
  type ReportHolding,
  type ReportResponse,
} from '../../services/reportProxy'
import { generatePdfBlob, downloadBlob } from '../../services/reportPdf'

interface ReportModalProps {
  ticker: string
  name: string
  holding: ReportHolding | null
  onClose: () => void
}

export function ReportModal({ ticker, name, holding, onClose }: ReportModalProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [report, setReport] = useState<ReportResponse | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfNote, setPdfNote] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setStatus('loading')
    generateReport({ market: 'TPE', ticker, name, holding })
      .then((r) => {
        if (alive) {
          setReport(r)
          setStatus('ready')
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          setErrMsg(e instanceof Error ? e.message : '產生報告失敗')
          setStatus('error')
        }
      })
    return () => {
      alive = false
    }
    // holding 不列入依賴：開窗當下的持股脈絡即可，避免現價刷新導致重複產生
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, name])

  async function handleDownload() {
    if (!report || !bodyRef.current) return
    setPdfBusy(true)
    setPdfNote('')
    try {
      const blob = await generatePdfBlob(bodyRef.current)
      downloadBlob(blob, `盤後籌碼-${ticker}-${report.dataDate}.pdf`)
    } catch {
      setPdfNote('PDF 產生失敗，請再試一次。')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <Modal title={`${ticker} ${name}｜盤後籌碼`} onClose={onClose} wide>
      {status === 'loading' && (
        <div className="empty-state" style={{ padding: 32 }}>
          <RefreshCw size={28} className="spin" />
          <div style={{ marginTop: 10 }}>正在抓取盤後籌碼並產生報告…</div>
        </div>
      )}

      {status === 'error' && (
        <div className="notice notice-warn" role="alert">
          <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          {errMsg}
        </div>
      )}

      {status === 'ready' && report && (
        <>
          <div
            ref={bodyRef}
            // 內容由我方 Edge Function 產生並已轉義動態字串（見 supabase/functions/stock-report/reportHtml.ts）
            dangerouslySetInnerHTML={{ __html: report.html }}
          />
          {pdfNote && (
            <div className="hint" style={{ marginTop: 8 }}>
              {pdfNote}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" onClick={handleDownload} disabled={pdfBusy}>
              <Download size={14} className={pdfBusy ? 'spin' : undefined} />
              {pdfBusy ? '產生 PDF 中…' : '下載 PDF'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
