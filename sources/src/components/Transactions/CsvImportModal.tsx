/**
 * CSV import (old data migration):
 * Select files or paste content → Verify and preview column by column → Write in batches after confirmation.
 * Supports old Google spreadsheet formats (TPE: prefix, Chinese transaction type) and this application export format.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileUp, Upload } from 'lucide-react'
import type { NewTransaction, Transaction } from '../../types/models'
import { MARKET_LABEL, TX_TYPE_LABEL } from '../../types/models'
import { markDuplicateRows, parseTransactionsCsv, replaceScope } from '../../utils/csv'
import { Modal } from '../Common/Modal'

interface CsvImportModalProps {
  onClose: () => void
  /**
   * `replaceIds` are the existing transactions the caller must delete *after* writing `rows`
   * (see `handleImport`). Resolving `false` means the caller cancelled, so the modal stays open.
   */
  onImport: (rows: NewTransaction[], replaceIds: string[]) => Promise<boolean | void>
  /** Current workspace transactions, used to detect and flag duplicate rows (TX-01)*/
  existing: Transaction[]
}

/**
 * 合併 keeps the TX-01 behaviour: skip rows that already exist, judged by an exact field match.
 * 取代 deletes the CSV's whole date range first, which is the only mode that stays correct when
 * the broker's figures differ from what is stored (a fee off by NT$1 slips past the duplicate
 * check and doubles the ledger).
 */
type ImportMode = 'merge' | 'replace'

const PREVIEW_LIMIT = 8
/** Debounce for the paste textarea: parsing a large paste on every keystroke is wasted work*/
const PARSE_DEBOUNCE_MS = 250

export function CsvImportModal({ onClose, onImport, existing }: CsvImportModalProps) {
  const [text, setText] = useState('')
  const [debouncedText, setDebouncedText] = useState('')
  const [mode, setMode] = useState<ImportMode>('merge')
  const [includeDups, setIncludeDups] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedText(text), PARSE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [text])

  const parsed = useMemo(() => (debouncedText.trim() ? parseTransactionsCsv(debouncedText) : null), [debouncedText])

  const duplicateFlags = useMemo(
    () => (parsed ? markDuplicateRows(parsed.rows, existing) : []),
    [parsed, existing],
  )
  const dupCount = duplicateFlags.filter(Boolean).length
  const replace = useMemo(
    () => (parsed && mode === 'replace' ? replaceScope(parsed.rows, existing) : null),
    [parsed, existing, mode],
  )
  // 取代 writes the file whole; the duplicate check does not apply because the rows it would
  // have skipped are exactly the ones being deleted first.
  const importRows = useMemo(
    () =>
      parsed
        ? mode === 'replace'
          ? parsed.rows
          : parsed.rows.filter((_, i) => includeDups || !duplicateFlags[i])
        : [],
    [parsed, duplicateFlags, includeDups, mode],
  )

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setText(await file.text())
  }

  const confirm = async () => {
    if (importRows.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const done = await onImport(importRows, replace?.ids ?? [])
      if (done !== false) onClose()
    } catch (e) {
      setError(`匯入失敗：${e instanceof Error ? e.message : '請稍後再試'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="匯入 CSV（舊資料搬遷）" onClose={onClose} wide>
      <p style={{ marginTop: 0, color: 'var(--ink-secondary)', fontSize: 14 }}>
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
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
          aria-label="貼上 CSV 內容"
        />
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {parsed && parsed.rows.length > 0 && (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: '4px 0 0' }}>
          <legend style={{ padding: 0, fontSize: 13, color: 'var(--ink-secondary)' }}>匯入方式</legend>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="radio"
              name="csv-import-mode"
              checked={mode === 'merge'}
              onChange={() => setMode('merge')}
              style={{ marginTop: 3 }}
            />
            <span>
              只補上新的交易
              <span style={{ color: 'var(--ink-muted)' }}>（跳過和現有紀錄一模一樣的列）</span>
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 6, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="radio"
              name="csv-import-mode"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
              style={{ marginTop: 3 }}
            />
            <span>
              以這個檔案取代這段期間
              <span style={{ color: 'var(--ink-muted)' }}>
                （先刪掉這段期間的買賣紀錄，再整份寫入；同一個檔案重複匯入結果都一樣）
              </span>
            </span>
          </label>
        </fieldset>
      )}

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
              {replace && (
                <div className="notice notice-warn" style={{ marginTop: 10 }}>
                  {/* `.notice` lays its children out in a row, so both lines go in one child. */}
                  <div>
                    {replace.ids.length > 0
                      ? `將先刪除 ${replace.from} ～ ${replace.to} 之間現有的 ${replace.ids.length} 筆買進 / 賣出，再寫入這份檔案的 ${parsed.rows.length} 筆。`
                      : `這段期間（${replace.from} ～ ${replace.to}）目前沒有買賣紀錄，會直接寫入 ${parsed.rows.length} 筆。`}
                    <div style={{ marginTop: 3 }}>
                      現金股利與股票股利不會被刪除；這段期間以外的紀錄也不會動到。刪除後無法復原。
                    </div>
                  </div>
                </div>
              )}

              <div style={{ margin: '10px 0 8px', fontSize: 14, color: 'var(--ink-secondary)' }}>
                預覽（共 {parsed.rows.length} 筆有效交易
                {mode === 'merge' && dupCount > 0 && `，其中 ${dupCount} 筆與現有交易相同`}
                {parsed.rows.length > PREVIEW_LIMIT && `，僅顯示前 ${PREVIEW_LIMIT} 筆`}）：
              </div>
              <div className="table-scroll" style={{ border: '1px solid var(--border)', borderRadius: 0 }}>
                <table className="data-table" style={{ minWidth: 420 }}>
                  <thead>
                    <tr>
                      <th scope="col">日期</th>
                      <th scope="col">市場</th>
                      <th scope="col">代號</th>
                      <th scope="col">名稱</th>
                      <th scope="col">類型</th>
                      <th scope="col" className="num">單價</th>
                      <th scope="col" className="num">股數</th>
                      <th scope="col" className="num">手續費 / 稅金</th>
                      <th scope="col">狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, PREVIEW_LIMIT).map((row, i) => (
                      <tr
                        key={i}
                        style={mode === 'merge' && duplicateFlags[i] ? { color: 'var(--ink-muted)' } : undefined}
                      >
                        <td>{row.tx_date}</td>
                        <td>{MARKET_LABEL[row.market]}</td>
                        <td>{row.ticker}</td>
                        <td>{row.name}</td>
                        <td>{TX_TYPE_LABEL[row.tx_type]}</td>
                        <td className="num">{row.price}</td>
                        <td className="num">{row.qty}</td>
                        <td className="num">{row.fee_tax}</td>
                        <td>{mode === 'merge' && duplicateFlags[i] ? '重複' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mode === 'merge' && dupCount > 0 && (
                <label
                  htmlFor="csv-include-dups"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 13, cursor: 'pointer' }}
                >
                  <input
                    id="csv-include-dups"
                    type="checkbox"
                    checked={includeDups}
                    onChange={(e) => setIncludeDups(e.target.checked)}
                  />
                  仍要匯入與現有交易相同的 {dupCount} 筆
                </label>
              )}
            </>
          )}

          <div className="toolbar" style={{ marginTop: 14 }}>
            <div className="spacer" />
            <button className="btn" onClick={onClose}>
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || importRows.length === 0}
              onClick={() => void confirm()}
            >
              <Upload size={15} />
              {busy
                ? '匯入中…'
                : mode === 'replace'
                  ? `取代匯入 ${importRows.length} 筆`
                  : `確認匯入 ${importRows.length} 筆`}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
