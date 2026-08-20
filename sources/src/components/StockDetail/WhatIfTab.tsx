/**
 * 損益試算 (what-if): "what if I had bought this ticker at X and sold at Y" calculator.
 *
 * State lives only in this component — the inputs are deliberately not persisted to
 * localStorage, Supabase, or any store, so this tab never reflects or affects real
 * holdings / P&L reports. It is a sandbox, not a form.
 */
import { useState } from 'react'
import { whatIf, sellLadder } from './whatIf'
import type { LadderRow } from './whatIf'
import { fmtMoney, fmtPercent, fmtQty, fmtSignedMoney, fmtSignedPercent, pnlClass } from '../../utils/formatters'
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

const LADDER_TAG: Record<string, string> = { current: '現價', breakEven: '回本' }

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

  const whatIfInput = {
    ticker,
    buyPrice: buyPriceNum,
    qty: shares,
    price: sellPriceNum,
    feeRate,
    minFee,
  }

  const result = whatIf(whatIfInput)
  // The ladder anchors on the live quote, never on the sell-price input, so it keeps its
  // 「現價 ±10%」 promise instead of jumping every time the user types a sell price.
  const anchor = currentPrice ?? buyPriceNum
  const ladder = sellLadder({ ...whatIfInput, price: anchor })

  const pick = (row: LadderRow) => setSellPrice(String(row.price))
  const onRowKeyDown = (row: LadderRow) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(row)
    }
  }

  return (
    <div className="rpt-section">
      {ladder.length > 0 && (
        <>
          <h3>賣出階梯 · 現價 ±10%</h3>
          <div className="table-scroll">
            <table className="data-table whatif-ladder" data-testid="whatif-ladder">
              <thead>
                <tr>
                  <th>賣出價</th>
                  <th className="num">相對現價</th>
                  <th className="num">損益</th>
                  <th className="num">報酬率</th>
                  <th className="num">實收</th>
                </tr>
              </thead>
              <tbody>
                {ladder.map((row) => (
                  <tr
                    key={row.price}
                    className={`whatif-ladder-row whatif-ladder-row--${row.kind}`}
                    data-testid="whatif-ladder-row"
                    data-kind={row.kind}
                    tabIndex={0}
                    onClick={() => pick(row)}
                    onKeyDown={onRowKeyDown(row)}
                  >
                    <td>
                      {fmtMoney(row.price, 'TWD', 2)}
                      {LADDER_TAG[row.kind] && (
                        <span className="whatif-ladder-tag">{LADDER_TAG[row.kind]}</span>
                      )}
                    </td>
                    <td className="num">
                      {row.kind === 'current' ? '—' : fmtSignedPercent(row.relative)}
                    </td>
                    <td className={`num ${pnlClass(row.pnl)}`}>{fmtSignedMoney(row.pnl, 'TWD')}</td>
                    <td className={`num ${pnlClass(row.roi)}`}>{fmtSignedPercent(row.roi)}</td>
                    <td className="num">{fmtMoney(row.proceeds, 'TWD')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3>對帳單 · 自訂賣出價</h3>
      <div className="whatif-ledger">
        <div className="whatif-ledger-col">
          <div className="whatif-ledger-heading">買進 · 假設</div>
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
          <div className="field-row">
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
          </div>
          <dl className="whatif-ledger-rows">
            <div>
              <dt>價金</dt>
              <dd>{fmtMoney(buyPriceNum * shares, 'TWD')}</dd>
            </div>
            <div>
              <dt>手續費</dt>
              <dd>{fmtMoney(result?.buyFee ?? null, 'TWD')}</dd>
            </div>
            <div>
              <dt>投入成本</dt>
              <dd data-testid="whatif-cost">{fmtMoney(result?.cost ?? null, 'TWD')}</dd>
            </div>
          </dl>
        </div>

        <div className="whatif-ledger-col">
          <div className="whatif-ledger-heading">賣出 · 試算</div>
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
          <dl className="whatif-ledger-rows">
            <div>
              <dt>股數</dt>
              <dd>{fmtQty(shares)}</dd>
            </div>
            <div>
              <dt>價金</dt>
              <dd>{fmtMoney(sellPriceNum * shares, 'TWD')}</dd>
            </div>
            <div>
              <dt>手續費 + 證交稅</dt>
              <dd>{fmtMoney(result?.sellFeeTax ?? null, 'TWD')}</dd>
            </div>
            <div>
              <dt>實收</dt>
              <dd data-testid="whatif-proceeds">{fmtMoney(result?.proceeds ?? null, 'TWD')}</dd>
            </div>
          </dl>
        </div>

        {result && (
          <div className="whatif-ledger-settle">
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
            <div>
              <div className="whatif-headline-label">回本價</div>
              <div className="whatif-headline-value" data-testid="whatif-breakeven">
                {fmtMoney(result.breakEven, 'TWD', 2)}
              </div>
            </div>
          </div>
        )}
      </div>

      {!result && <div className="hint">請輸入大於 0 的買進價格、股數與賣出價格。</div>}
      {result && (
        <div className="hint" data-testid="whatif-fees">
          含手續費與證交稅 -{fmtMoney(result.buyFee + result.sellFeeTax, 'TWD')}
        </div>
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
