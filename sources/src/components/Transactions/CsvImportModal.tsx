/**
 * CSV 匯入（舊資料搬遷）：
 * 選擇檔案或貼上內容 → 逐列驗證與預覽 → 確認後批次寫入。
 * 支援舊 Google 試算表格式（TPE: 前綴、中文交易類型）與本應用匯出格式。
 */
import { useMemo, useRef, useState } from 'react'
import { FileUp, Upload } from 'lucide-react'
import type { NewTransaction } from '../../types/models'
import { MARKET_LABEL, TX_TYPE_LABEL } from '../../types/models'
import { parseTransactionsCsv } from '../../utils/csv'
import { Modal } from '../Common/Modal'

interface CsvImportModalProps {
  onClose: () => void
  onImport: (rows: NewTransaction[]) => Promise<void>
}

const PREVIEW_LIMIT = 8

export function CsvImportModal({ onClose, onImport }: CsvImportModalProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const parsed = useMemo(() => (text.trim() ? parseTransactionsCsv(text) : null), [text])

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setText(await file.text())
  }

  const confirm = async () => {
    if (!parsed || parsed.rows.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await onImport(parsed.rows)
      onClose()
    } catch (e) {
      setError(`匯入失敗：${e instanceof Error ? e.message : '請稍後再試'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="匯入 CSV（舊資料搬遷）" onClose={onClose} wide>
      <p style={{ marginTop: 0, color: 'var(--ink-secondary)', fontSize: 13 }}>
        支援舊 Google 試算表「個股交易紀錄」匯出的 CSV（台股代號 <code>TPE:2330</code> 會自動拆解、
        「買入 / 賣出」自動轉換），也支援本應用匯出的備份檔。
      </p>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <FileUp size={15} />
          選擇 CSV 檔案
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => void pickFile(e.target.files?.[0])}
        />
        <span className="hint" style={{ color: 'var(--ink-muted)', fontSize: 12 }}>
          或直接貼上 CSV 內容：
        </span>
      </div>

      <div className="field">
        <textarea
          rows={6}
          value={text}
          placeholder={'交易日期,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金\n2024/01/10,TPE:2330,台積電,買入,500,1000,712'}
          onChange={(e) => setText(e.target.value)}
          style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}
        />
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {parsed && (
        <>
          {parsed.errors.length > 0 && (
            <div className="notice notice-warn">
              {parsed.errors.length} 列無法匯入（將略過）：
              {parsed.errors.slice(0, 5).map((err) => (
                <div key={err.line} style={{ marginTop: 3 }}>
                  ・第 {err.line} 列：{err.message}
                </div>
              ))}
              {parsed.errors.length > 5 && <div style={{ marginTop: 3 }}>…（其餘 {parsed.errors.length - 5} 列）</div>}
            </div>
          )}

          {parsed.rows.length > 0 && (
            <>
              <div style={{ margin: '10px 0 8px', fontSize: 13, color: 'var(--ink-secondary)' }}>
                預覽（共 {parsed.rows.length} 筆有效交易
                {parsed.rows.length > PREVIEW_LIMIT && `，僅顯示前 ${PREVIEW_LIMIT} 筆`}）：
              </div>
              <div className="table-scroll" style={{ border: '1px solid var(--border)', borderRadius: 10 }}>
                <table className="data-table" style={{ minWidth: 560 }}>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>市場</th>
                      <th>代號</th>
                      <th>名稱</th>
                      <th>類型</th>
                      <th className="num">單價</th>
                      <th className="num">股數</th>
                      <th className="num">手續費 / 稅金</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, PREVIEW_LIMIT).map((row, i) => (
                      <tr key={i}>
                        <td>{row.tx_date}</td>
                        <td>{MARKET_LABEL[row.market]}</td>
                        <td>{row.ticker}</td>
                        <td>{row.name}</td>
                        <td>{TX_TYPE_LABEL[row.tx_type]}</td>
                        <td className="num">{row.price}</td>
                        <td className="num">{row.qty}</td>
                        <td className="num">{row.fee_tax}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="toolbar" style={{ marginTop: 14 }}>
            <div className="spacer" />
            <button className="btn" onClick={onClose}>
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || parsed.rows.length === 0}
              onClick={() => void confirm()}
            >
              <Upload size={15} />
              {busy ? '匯入中…' : `確認匯入 ${parsed.rows.length} 筆`}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
