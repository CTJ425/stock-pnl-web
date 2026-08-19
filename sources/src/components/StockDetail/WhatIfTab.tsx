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

type Unit = '張' | '股'

interface WhatIfTabProps {
  ticker: string
  currentPrice: number | null
  /** Set for a held stock, null for a watched one. Fee-inclusive average cost. */
  avgCost: number | null
  /** Set for a held stock, null for a watched one. Shares currently held. */
  heldQty: number | null
}

export function WhatIfTab({ ticker, currentPrice, avgCost, heldQty }: WhatIfTabProps) {
  const { current } = useWorkspace()
  const hasQuote = currentPrice !== null && currentPrice > 0
  const isHeld = avgCost !== null

  const [buyPrice, setBuyPrice] = useState(
    isHeld ? avgCost.toFixed(2) : hasQuote ? String(currentPrice) : ''
  )
  const [unit, setUnit] = useState<Unit>(
    isHeld && heldQty !== null && heldQty % 1000 !== 0 ? '股' : '張'
  )
  const [qty, setQty] = useState(
    isHeld && heldQty !== null
      ? String(heldQty % 1000 === 0 ? heldQty / 1000 : heldQty)
      : '1'
  )
  // Sell price is now a real, visible input — the exit price used to be an invisible
  // assumption (silently the current quote), so the result read as a broken number.
  const [sellPrice, setSellPrice] = useState(hasQuote ? String(currentPrice) : '')

  const buyPriceNum = Number(buyPrice)
  const qtyNum = Number(qty)
  const sellPriceNum = Number(sellPrice)
  // The input is a sandbox and stays in whatever unit the user typed it in; only the
  // derived share count switches with the unit selector, so an in-place rewrite never
  // fights the user mid-typing (unlike TransactionForm, which does rewrite in place).
  const shares = unit === '張' ? qtyNum * 1000 : qtyNum

  // Scoped to the workspace like every other caller (AnalysisPage, DashboardPage,
  // TransactionForm): an unscoped read would price the estimate with the global rate
  // while the workspace has its own, and the difference would be invisible.
  const feeRate = getFeeRate(current?.id)
  // Whole-lot vs odd-lot minimum fee follows the entered qty, same rule as the transaction form.
  const minFeeUnit = shares > 0 && shares % 1000 === 0 ? 'whole' : 'odd'
  const minFee = getMinFee(minFeeUnit, current?.id)

  const result = whatIf({
    ticker,
    buyPrice: buyPriceNum,
    qty: shares,
    price: sellPriceNum,
    feeRate,
    minFee,
  })

  return (
    <div className="rpt-section">
      <div className="field-row whatif-sentence">
        <span>若我在</span>
        <div className="field">
          <label htmlFor="whatif-buy-price">買進價格</label>
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
        <div className="field">
          <label htmlFor="whatif-unit">單位</label>
          <select
            id="whatif-unit"
            className="narrow"
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
          >
            <option value="張">張</option>
            <option value="股">股</option>
          </select>
        </div>
        <span>，並在</span>
        <div className="field">
          <label htmlFor="whatif-sell-price">賣出價格</label>
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
          <div className="hint" data-testid="whatif-fees">
            含手續費與證交稅 -{fmtMoney(result.buyFee + result.sellFeeTax, 'TWD')}
          </div>
        </>
      ) : (
        <div className="hint">請輸入大於 0 的買進價格、股數與賣出價格。</div>
      )}

      {hasQuote && (
        <div className="hint">
          {isHeld
            ? `買進價預設為平均成本 ${avgCost.toFixed(2)}`
            : `買進價預設為現價 ${currentPrice}`}
        </div>
      )}
      <p className="hint">此為試算工具，不會影響持股或任何損益報表。</p>
    </div>
  )
}
