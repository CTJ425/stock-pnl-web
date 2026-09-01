/**
 * Stock split conversion wizard modal:
 * - Select an existing ticker with BUY transactions
 * - Configure split type (Forward 1拆N or Reverse N併1), ratio, and optional cutoff date
 * - Live preview before & after total quantity, average cost, invariant total cost, and affected transactions
 * - Batch update transactions via updateTransaction
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Scissors, Sparkles } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { Modal } from '../Common/Modal'
import type { Market, Transaction } from '../../types/models'
import { MARKET_LABEL, marketCurrency, positionKey } from '../../types/models'
import { displayStockName } from '../../services/usStockNames'
import { fmtMoney, fmtPrice, fmtQty } from '../../utils/formatters'
import { calculateFee, inferFeeRate } from '../../utils/fees'
import { getFeeRate, getMinFee } from '../../utils/settings'

export interface StockSplitModalProps {
  onClose: () => void
  onSuccess?: (msg: string) => void
}

export type SplitType = 'forward' | 'reverse'

interface PreviewItem {
  tx: Transaction
  oldQty: number
  newQty: number
  oldPrice: number
  newPrice: number
  oldFeeTax: number
  feeTax: number
  feeRate: number
  feeAutoFilled: boolean
}

export function StockSplitModal({ onClose, onSuccess }: StockSplitModalProps) {
  const { transactions, updateTransaction, current } = useWorkspace()

  // Effective fee rate and min fee for the workspace
  const workspaceFeeRate = current?.fee_rate ?? getFeeRate(current?.id)
  const minFees = {
    whole: getMinFee('whole', current?.id),
    odd: getMinFee('odd', current?.id),
  }

  // Extract all distinct tickers with BUY transactions
  const buyTickers = useMemo(() => {
    const map = new Map<string, { market: Market; ticker: string; name: string }>()
    for (const tx of transactions) {
      if (tx.tx_type === 'BUY') {
        const key = positionKey(tx.market, tx.ticker)
        if (!map.has(key)) {
          map.set(key, { market: tx.market, ticker: tx.ticker, name: tx.name })
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      return (
        a.market.localeCompare(b.market) ||
        a.ticker.localeCompare(b.ticker)
      )
    })
  }, [transactions])

  const [selectedKey, setSelectedKey] = useState<string>(() => {
    return buyTickers.length > 0 ? positionKey(buyTickers[0].market, buyTickers[0].ticker) : ''
  })
  const [splitType, setSplitType] = useState<SplitType>('forward')
  const [ratioStr, setRatioStr] = useState<string>('2')
  const [cutoffDate, setCutoffDate] = useState<string>('')
  const [autoFillZeroFee, setAutoFillZeroFee] = useState<boolean>(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedTickerInfo = useMemo(() => {
    if (!selectedKey) return null
    return buyTickers.find((t) => positionKey(t.market, t.ticker) === selectedKey) ?? null
  }, [selectedKey, buyTickers])

  const ratio = parseFloat(ratioStr)
  const isValidRatio = !Number.isNaN(ratio) && ratio > 0

  // Filter matching BUY transactions
  const matchingTxs = useMemo(() => {
    if (!selectedKey) return []
    const [market, ticker] = selectedKey.split(':')
    return transactions
      .filter(
        (tx) =>
          tx.market === market &&
          tx.ticker === ticker &&
          tx.tx_type === 'BUY' &&
          (!cutoffDate || tx.tx_date <= cutoffDate),
      )
      .sort((a, b) => a.tx_date.localeCompare(b.tx_date) || a.created_at.localeCompare(b.created_at))
  }, [transactions, selectedKey, cutoffDate])

  const hasZeroFeeTx = useMemo(() => matchingTxs.some((tx) => tx.fee_tax === 0), [matchingTxs])

  // Build live preview items
  const previewItems: PreviewItem[] = useMemo(() => {
    if (!isValidRatio || matchingTxs.length === 0) return []
    return matchingTxs.map((tx) => {
      let newQty: number
      let newPrice: number
      if (splitType === 'forward') {
        newQty = Math.round(tx.qty * ratio)
        newPrice = Number((tx.price / ratio).toFixed(4))
      } else {
        newQty = Math.round(tx.qty / ratio)
        newPrice = Number((tx.price * ratio).toFixed(4))
      }

      // Prioritize the transaction's own explicit rate; if zero fee, use workspace rate for auto-fill; else infer from historical fee
      const effectiveRate =
        tx.fee_rate ?? (tx.fee_tax === 0 ? workspaceFeeRate : inferFeeRate(tx, workspaceFeeRate, minFees))
      let feeTax = tx.fee_tax
      let feeAutoFilled = false

      if (tx.fee_tax === 0 && autoFillZeroFee) {
        const estFee = calculateFee({
          market: tx.market,
          txType: 'BUY',
          price: newPrice,
          qty: newQty,
          feeRate: effectiveRate,
          minFee: tx.market === 'TPE' ? (newQty >= 1000 ? minFees.whole : minFees.odd) : undefined,
        })
        if (estFee > 0) {
          feeTax = estFee
          feeAutoFilled = true
        }
      }

      return {
        tx,
        oldQty: tx.qty,
        newQty,
        oldPrice: tx.price,
        newPrice,
        oldFeeTax: tx.fee_tax,
        feeTax,
        feeRate: feeAutoFilled ? effectiveRate : (tx.fee_tax === 0 ? 0 : effectiveRate),
        feeAutoFilled,
      }
    })
  }, [matchingTxs, isValidRatio, splitType, ratio, autoFillZeroFee, workspaceFeeRate, minFees.whole, minFees.odd])

  // Aggregate stats
  const currency = selectedTickerInfo ? marketCurrency(selectedTickerInfo.market) : 'TWD'
  const totalQtyBefore = matchingTxs.reduce((s, tx) => s + tx.qty, 0)
  const totalGrossBefore = matchingTxs.reduce((s, tx) => s + tx.price * tx.qty, 0)
  const totalCostBefore = matchingTxs.reduce((s, tx) => s + tx.price * tx.qty + tx.fee_tax, 0)
  const avgPriceBefore = totalQtyBefore > 0 ? totalGrossBefore / totalQtyBefore : 0

  const totalQtyAfter = previewItems.reduce((s, item) => s + item.newQty, 0)
  const totalGrossAfter = previewItems.reduce((s, item) => s + item.newPrice * item.newQty, 0)
  const totalCostAfter = previewItems.reduce((s, item) => s + item.newPrice * item.newQty + item.feeTax, 0)
  const avgPriceAfter = totalQtyAfter > 0 ? totalGrossAfter / totalQtyAfter : 0

  const handleConfirm = async () => {
    if (busy || previewItems.length === 0 || !isValidRatio) return
    setBusy(true)
    setError(null)
    try {
      for (const item of previewItems) {
        await updateTransaction(item.tx.id, {
          tx_date: item.tx.tx_date,
          market: item.tx.market,
          ticker: item.tx.ticker,
          name: item.tx.name,
          tx_type: item.tx.tx_type,
          price: item.newPrice,
          qty: item.newQty,
          fee_tax: item.feeTax,
          tx_nature: item.tx.tx_nature,
          fee_rate: item.feeRate,
        })
      }
      const stockDisplayName = selectedTickerInfo
        ? `${selectedTickerInfo.ticker} ${displayStockName(selectedTickerInfo.market, selectedTickerInfo.ticker, selectedTickerInfo.name)}`
        : ''
      const msg = `✂️ 已成功完成 ${stockDisplayName} 的股票分割換算，共更新 ${previewItems.length} 筆買入紀錄。`
      if (onSuccess) {
        onSuccess(msg)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '分割換算更新失敗，請稍後再試')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="股票分割換算精靈" onClose={onClose} wide disableBackdropClose>
      <div className="field-hint" style={{ marginBottom: 14 }}>
        當持有股票發生分割（如 1 拆 N）或反向分割（併股 N 併 1）時，本精靈可自動依比例批次換算歷史買入紀錄的「股數」與「單價」，並保持總投入成本與手續費不變。
      </div>

      {error && (
        <div className="notice notice-error" style={{ marginBottom: 14 }} role="alert">
          <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          {error}
        </div>
      )}

      {buyTickers.length === 0 ? (
        <div className="empty-state" style={{ padding: '28px 0' }}>
          <AlertTriangle size={28} style={{ marginBottom: 8 }} />
          <div>目前沒有任何買入交易紀錄，無法進行分割換算。</div>
        </div>
      ) : (
        <div className="split-wizard-form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Step 1 & Step 2: Configuration inputs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
              background: 'var(--surface-subtle, rgba(255, 255, 255, 0.03))',
              padding: 14,
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}
          >
            {/* Step 1: Select Ticker */}
            <div className="field">
              <label htmlFor="split-ticker-select" className="field-label" style={{ fontWeight: 600 }}>
                1. 選擇標的
              </label>
              <select
                id="split-ticker-select"
                className="input"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                aria-label="選擇換算標的"
              >
                {buyTickers.map((t) => {
                  const k = positionKey(t.market, t.ticker)
                  const displayName = displayStockName(t.market, t.ticker, t.name)
                  return (
                    <option key={k} value={k}>
                      [{MARKET_LABEL[t.market]}] {t.ticker} {displayName}
                    </option>
                  )
                })}
              </select>
            </div>

            {/* Step 2: Split Type */}
            <div className="field">
              <label htmlFor="split-type-select" className="field-label" style={{ fontWeight: 600 }}>
                2. 分割類型
              </label>
              <select
                id="split-type-select"
                className="input"
                value={splitType}
                onChange={(e) => setSplitType(e.target.value as SplitType)}
                aria-label="分割類型"
              >
                <option value="forward">1 拆 N（股票分割 / Forward Split）</option>
                <option value="reverse">N 併 1（反向分割 / Reverse Split）</option>
              </select>
            </div>

            {/* Step 2: Ratio */}
            <div className="field">
              <label htmlFor="split-ratio-input" className="field-label" style={{ fontWeight: 600 }}>
                3. 分割比例 (N)
              </label>
              <input
                id="split-ratio-input"
                type="number"
                step="any"
                min="0.0001"
                className="input"
                value={ratioStr}
                onChange={(e) => setRatioStr(e.target.value)}
                placeholder="例如 24 或 10"
                aria-label="分割比例"
              />
            </div>

            {/* Step 2: Cutoff Date */}
            <div className="field">
              <label htmlFor="split-cutoff-date" className="field-label" style={{ fontWeight: 600 }}>
                4. 基準截止日（選填）
              </label>
              <input
                id="split-cutoff-date"
                type="date"
                className="input"
                value={cutoffDate}
                onChange={(e) => setCutoffDate(e.target.value)}
                aria-label="基準截止日"
              />
            </div>
          </div>

          {/* Step 2 note & Smart fee option */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="field-hint" style={{ fontSize: 12 }}>
              💡 基準截止日留空表示換算該標的所有歷史買入紀錄；若指定日期，則僅換算該日期（含）之前的買入筆數。
            </div>
            {hasZeroFeeTx && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  padding: '8px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <Sparkles size={14} style={{ color: 'var(--accent, #38bdf8)', flexShrink: 0 }} />
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={autoFillZeroFee}
                    onChange={(e) => setAutoFillZeroFee(e.target.checked)}
                    aria-label="智慧補算手續費"
                  />
                  <span>
                    <strong>智慧補算手續費</strong>：偵測到部分買入紀錄手續費為 0，自動依目前設定費率（
                    {(workspaceFeeRate * 100).toFixed(4).replace(/\.?0+$/, '')}%）補算買進手續費，讓換算後總成本與券商 APP 一致。
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* Step 3: Live Preview Card */}
          {matchingTxs.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 0' }}>
              <div>在指定條件下找不到符合的買入紀錄。</div>
            </div>
          ) : !isValidRatio ? (
            <div className="notice notice-warn">請輸入大於 0 的有效分割比例數字。</div>
          ) : (
            <>
              <div
                className="split-preview-card"
                style={{
                  background: 'var(--surface-card, rgba(255, 255, 255, 0.05))',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 14,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Scissors size={16} />
                  換算前後數據預覽（共 {previewItems.length} 筆買入紀錄）
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 12,
                    marginBottom: 14,
                  }}
                >
                  <div className="metric" style={{ background: 'var(--surface-subtle)', padding: 10, borderRadius: 6 }}>
                    <div className="kpi-label">總買入股數</div>
                    <div className="kpi-value" style={{ fontSize: 16 }}>
                      {fmtQty(totalQtyBefore)} →{' '}
                      <span style={{ color: 'var(--accent, #38bdf8)', fontWeight: 700 }}>
                        {fmtQty(totalQtyAfter)}
                      </span>{' '}
                      股
                    </div>
                  </div>

                  <div className="metric" style={{ background: 'var(--surface-subtle)', padding: 10, borderRadius: 6 }}>
                    <div className="kpi-label">平均買進單價</div>
                    <div className="kpi-value" style={{ fontSize: 16 }}>
                      {fmtPrice(avgPriceBefore, currency)} →{' '}
                      <span style={{ color: 'var(--accent, #38bdf8)', fontWeight: 700 }}>
                        {fmtPrice(avgPriceAfter, currency)}
                      </span>
                    </div>
                  </div>

                  <div className="metric" style={{ background: 'var(--surface-subtle)', padding: 10, borderRadius: 6 }}>
                    <div className="kpi-label">總投入成本</div>
                    <div className="kpi-value" style={{ fontSize: 16 }}>
                      {totalCostBefore !== totalCostAfter ? (
                        <>
                          {fmtMoney(totalCostBefore, currency)} →{' '}
                          <span style={{ color: 'var(--accent, #38bdf8)', fontWeight: 700 }}>
                            {fmtMoney(totalCostAfter, currency)}
                          </span>
                        </>
                      ) : (
                        fmtMoney(totalCostBefore, currency)
                      )}
                    </div>
                    <div className="kpi-sub" style={{ color: 'var(--ink-muted)', fontSize: 11 }}>
                      {totalCostBefore !== totalCostAfter ? '含智慧補算之手續費' : '成本保持恆定不變'}
                    </div>
                  </div>
                </div>

                {/* Table of affected transactions */}
                <div className="table-scroll" style={{ maxHeight: '35vh', overflowY: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>交易日期</th>
                        <th>代號 / 名稱</th>
                        <th className="num">原股數 → 換算後股數</th>
                        <th className="num">原單價 → 換算後單價</th>
                        <th className="num">買進手續費</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewItems.map((item) => (
                        <tr key={item.tx.id}>
                          <td>{item.tx.tx_date}</td>
                          <td>
                            {item.tx.ticker}{' '}
                            <span style={{ opacity: 0.75, fontSize: 12 }}>
                              {displayStockName(item.tx.market, item.tx.ticker, item.tx.name)}
                            </span>
                          </td>
                          <td className="num">
                            {fmtQty(item.oldQty)} →{' '}
                            <strong style={{ color: 'var(--accent, #38bdf8)' }}>{fmtQty(item.newQty)}</strong>
                          </td>
                          <td className="num">
                            {fmtPrice(item.oldPrice, currency)} →{' '}
                            <strong style={{ color: 'var(--accent, #38bdf8)' }}>
                              {fmtPrice(item.newPrice, currency)}
                            </strong>
                          </td>
                          <td className="num">
                            {item.feeAutoFilled ? (
                              <span>
                                <span style={{ textDecoration: 'line-through', opacity: 0.6, marginRight: 4 }}>
                                  {fmtMoney(item.oldFeeTax, currency)}
                                </span>
                                →{' '}
                                <strong style={{ color: 'var(--accent, #38bdf8)' }}>
                                  {fmtMoney(item.feeTax, currency)}
                                </strong>
                              </span>
                            ) : (
                              fmtMoney(item.feeTax, currency)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Step 4: Confirm button */}
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
                disabled={busy || previewItems.length === 0 || !isValidRatio}
                onClick={() => void handleConfirm()}
              >
                <CheckCircle2 size={16} />
                {busy ? '正在批次更新中…' : `確認套用分割換算（更新 ${previewItems.length} 筆紀錄）`}
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
