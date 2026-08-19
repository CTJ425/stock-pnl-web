/**
 * 損益試算 (what-if): "what if I had bought this ticker at X and sold at Y" calculator.
 *
 * State lives only in this component — the inputs are deliberately not persisted to
 * localStorage, Supabase, or any store, so this tab never reflects or affects real
 * holdings / P&L reports. It is a sandbox, not a form.
 */
import { useState } from 'react'
import { whatIf } from './whatIf'
import { fmtMoney, fmtPercent, fmtSignedMoney, pnlClass } from '../../utils/formatters'
import { getFeeRate, getMinFee } from '../../utils/settings'
import { useWorkspace } from '../../context/WorkspaceContext'

interface WhatIfTabProps {
  ticker: string
  currentPrice: number | null
}

export function WhatIfTab({ ticker, currentPrice }: WhatIfTabProps) {
  const { current } = useWorkspace()
  const hasQuote = currentPrice !== null && currentPrice > 0
  const [buyPrice, setBuyPrice] = useState(hasQuote ? String(currentPrice) : '')
  const [qty, setQty] = useState('1000')
  // Sell price is now a real, visible input — the exit price used to be an invisible
  // assumption (silently the current quote), so the result read as a broken number.
  const [sellPrice, setSellPrice] = useState(hasQuote ? String(currentPrice) : '')

  const buyPriceNum = Number(buyPrice)
  const qtyNum = Number(qty)
  const sellPriceNum = Number(sellPrice)

  // Scoped to the workspace like every other caller (AnalysisPage, DashboardPage,
  // TransactionForm): an unscoped read would price the estimate with the global rate
  // while the workspace has its own, and the difference would be invisible.
  const feeRate = getFeeRate(current?.id)
  // Whole-lot vs odd-lot minimum fee follows the entered qty, same rule as the transaction form.
  const minFeeUnit = qtyNum > 0 && qtyNum % 1000 === 0 ? 'whole' : 'odd'
  const minFee = getMinFee(minFeeUnit, current?.id)

  const result = whatIf({
    ticker,
    buyPrice: buyPriceNum,
    qty: qtyNum,
    price: sellPriceNum,
    feeRate,
    minFee,
  })

  return (
    <div className="rpt-section">
      <div className="field-row whatif-sentence">
        <span>若我在</span>
        <div className="field">
          <label htmlFor="whatif-buy-price">假想買進價</label>
          <input
            id="whatif-buy-price"
            type="number"
            step="0.01"
            min="0"
            value={buyPrice}
            onChange={(e) => setBuyPrice(e.target.value)}
          />
        </div>
        <span>買進</span>
        <div className="field">
          <label htmlFor="whatif-qty">股數</label>
          <input
            id="whatif-qty"
            type="number"
            step="1"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <span>股，並在</span>
        <div className="field">
          <label htmlFor="whatif-sell-price">賣出價</label>
          <input
            id="whatif-sell-price"
            type="number"
            step="0.01"
            min="0"
            value={sellPrice}
            onChange={(e) => setSellPrice(e.target.value)}
          />
        </div>
        <span>賣出</span>
      </div>
      {hasQuote && <div className="hint">預設：現價 {currentPrice}</div>}

      {result ? (
        <>
          <div className="whatif-headline">
            <div>
              <div className="whatif-headline-label">損益</div>
              <div
                className={`whatif-headline-value ${pnlClass(result.pnl)}`}
                data-testid="whatif-pnl"
              >
                {fmtSignedMoney(result.pnl, 'TWD')}
              </div>
            </div>
            <div>
              <div className="whatif-headline-label">報酬率</div>
              <div
                className={`whatif-headline-value ${pnlClass(result.roi)}`}
                data-testid="whatif-roi"
              >
                {fmtPercent(result.roi)}
              </div>
            </div>
          </div>
          <div className="hint" data-testid="whatif-detail">
            成本 {fmtMoney(result.cost, 'TWD')} · 賣出可得 {fmtMoney(result.proceeds, 'TWD')}
            <br />
            手續費 {fmtMoney(result.buyFee, 'TWD')}＋{fmtMoney(result.sellFeeTax, 'TWD')}（含證交稅） ·
            回本價 {fmtMoney(result.breakEven, 'TWD', 2)}
          </div>
        </>
      ) : (
        <div className="hint">請輸入大於 0 的假想買進價、股數與賣出價。</div>
      )}

      <p className="hint">此為試算工具，不會影響持股或任何損益報表。</p>
    </div>
  )
}
