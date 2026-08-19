/**
 * 損益試算 (what-if): "what if I had bought this ticker at X" calculator, sold at today's quote.
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
  const [buyPrice, setBuyPrice] = useState(
    currentPrice !== null && currentPrice > 0 ? String(currentPrice) : '',
  )
  const [qty, setQty] = useState('1000')

  const buyPriceNum = Number(buyPrice)
  const qtyNum = Number(qty)
  // Sell price is the current quote, not a third input — the tab answers "what if I had
  // bought at X, given today's price", not a fully independent buy/sell scenario.
  const priceNum = currentPrice ?? NaN

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
    price: priceNum,
    feeRate,
    minFee,
  })

  return (
    <div className="rpt-section">
      <div className="field-row">
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
      </div>

      {result ? (
        <div className="rpt-cards">
          <div className="rpt-card">
            <div className="k">成本（含買進手續費）</div>
            <div className="v">{fmtMoney(result.cost, 'TWD')}</div>
          </div>
          <div className="rpt-card">
            <div className="k">買進手續費</div>
            <div className="v">{fmtMoney(result.buyFee, 'TWD')}</div>
          </div>
          <div className="rpt-card">
            <div className="k">賣出手續費＋證交稅</div>
            <div className="v">{fmtMoney(result.sellFeeTax, 'TWD')}</div>
          </div>
          <div className="rpt-card">
            <div className="k">賣出可得</div>
            <div className="v">{fmtMoney(result.proceeds, 'TWD')}</div>
          </div>
          <div className="rpt-card">
            <div className="k">損益</div>
            <div className={`v ${pnlClass(result.pnl)}`}>{fmtSignedMoney(result.pnl, 'TWD')}</div>
          </div>
          <div className="rpt-card">
            <div className="k">報酬率</div>
            <div className={`v ${pnlClass(result.roi)}`}>{fmtPercent(result.roi)}</div>
          </div>
          <div className="rpt-card">
            <div className="k">回本價</div>
            <div className="v">{fmtMoney(result.breakEven, 'TWD', 2)}</div>
          </div>
        </div>
      ) : (
        <div className="hint">請輸入大於 0 的假想買進價與股數（並確認目前股價已取得）。</div>
      )}

      <p className="hint">此為試算工具，不會影響持股或任何損益報表。</p>
    </div>
  )
}
