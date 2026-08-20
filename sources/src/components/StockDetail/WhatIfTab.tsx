/**
 * 損益試算 (what-if): "what if I had bought this ticker at X and sold at Y" calculator.
 *
 * State lives only in this component — the inputs are deliberately not persisted to
 * localStorage, Supabase, or any store, so this tab never reflects or affects real
 * holdings / P&L reports. It is a sandbox, not a form.
 */
import { Fragment, useState } from 'react'
import { whatIf, sellLadder } from './whatIf'
import type { LadderRow } from './whatIf'
import { fmtMoney, fmtPercent, fmtQty, fmtSignedMoney, fmtSignedPercent, pnlClass } from '../../utils/formatters'
import { getFeeRate, getMinFee } from '../../utils/settings'
import { useWorkspace } from '../../context/WorkspaceContext'

type Unit = '張' | '股'

interface WhatIfTabProps {
  ticker: string
  currentPrice: number | null
  /** Set for a held stock, null for a watched one. Fee-exclusive average traded price. */
  rawAvgCost: number | null
  /** Set for a held stock, null for a watched one. Shares currently held. */
  heldQty: number | null
}

const LADDER_TAG: Record<string, string> = { current: '現價', breakEven: '回本', avgCost: '均價' }

export function WhatIfTab({ ticker, currentPrice, rawAvgCost, heldQty }: WhatIfTabProps) {
  const { current } = useWorkspace()
  const hasQuote = currentPrice !== null && currentPrice > 0
  const isHeld = rawAvgCost !== null

  const [buyPrice, setBuyPrice] = useState(
    isHeld ? rawAvgCost.toFixed(2) : hasQuote ? String(currentPrice) : ''
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
  // The ladder anchors on the holding average cost when there is one, never on the
  // sell-price input — it keeps its ±10% promise instead of jumping every time the user
  // types a sell price.
  const anchorsOnAvgCost = rawAvgCost !== null && rawAvgCost > 0
  // Snapped to the same 0.01 grid sellLadder uses for its rows, so the anchor row's
  // relative is exactly 0 instead of a sub-cent residual that renders as -0.00%.
  const anchor = anchorsOnAvgCost ? Math.round(rawAvgCost * 100) / 100 : (currentPrice ?? buyPriceNum)
  const ladder = sellLadder({ ...whatIfInput, price: anchor }, { currentPrice, avgCost: rawAvgCost })

  const heading = anchorsOnAvgCost ? '賣出階梯 · 持有均價 ±10%' : '賣出階梯 · 現價 ±10%'

  // Summary strip: one item per mark that actually exists, each priced by its own whatIf
  // call — never interpolated from a ladder row, since a mark can sit outside whichever
  // window the ladder happens to use.
  const markPnl = (price: number) => whatIf({ ...whatIfInput, price })?.pnl ?? 0
  const showMarks = result !== null && (hasQuote || anchorsOnAvgCost)
  const markItems = showMarks
    ? [
        ...(hasQuote
          ? [
              {
                kind: 'current' as const,
                label: '現價',
                price: currentPrice as number,
                relative: (currentPrice as number) / anchor - 1,
                pnl: markPnl(currentPrice as number),
              },
            ]
          : []),
        ...(anchorsOnAvgCost
          ? [
              {
                kind: 'avgCost' as const,
                label: '持有均價',
                price: anchor,
                relative: null,
                pnl: markPnl(anchor),
              },
            ]
          : []),
        {
          kind: 'breakEven' as const,
          label: '回本',
          price: result!.breakEven,
          relative: result!.breakEven / anchor - 1,
          pnl: markPnl(result!.breakEven),
        },
      ]
    : []

  const pick = (row: LadderRow) => setSellPrice(String(row.price))
  const pickPrice = (price: number) => setSellPrice(String(price))
  const onRowKeyDown = (row: LadderRow) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(row)
    }
  }

  return (
    <div className="rpt-section">
      {markItems.length > 0 && (
        <div className="whatif-marks" data-testid="whatif-marks">
          {markItems.map((item) => (
            <button
              key={item.kind}
              type="button"
              className={`whatif-mark whatif-mark--${item.kind}`}
              data-testid="whatif-mark"
              data-kind={item.kind}
              onClick={() => pickPrice(item.price)}
            >
              <span className="whatif-mark-label">{item.label}</span>
              <span className="whatif-mark-price">{fmtMoney(item.price, 'TWD', 2)}</span>
              <span className="whatif-mark-relative">
                {item.relative === null ? '—' : fmtSignedPercent(item.relative)}
              </span>
              <span className={`whatif-mark-pnl ${pnlClass(item.pnl)}`}>
                {fmtSignedMoney(item.pnl, 'TWD')}
              </span>
            </button>
          ))}
        </div>
      )}

      {ladder.length > 0 && (
        <>
          <h3>{heading}</h3>
          <div className="table-scroll">
            <table className="data-table whatif-ladder" data-testid="whatif-ladder">
              <thead>
                <tr>
                  <th>賣出價</th>
                  <th className="num">{anchorsOnAvgCost ? '相對均價' : '相對現價'}</th>
                  <th className="num">損益</th>
                  <th className="num">報酬率</th>
                  <th className="num">實收</th>
                </tr>
              </thead>
              <tbody>
                {ladder.map((row, i) => {
                  const showGap = i > 0 && ladder[i - 1].group !== row.group
                  return (
                    <Fragment key={row.price}>
                      {showGap && (
                        <tr className="whatif-ladder-gap" data-testid="whatif-ladder-gap">
                          <td colSpan={5}>現價附近</td>
                        </tr>
                      )}
                      <tr
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
                          {row.relative === 0 ? '—' : fmtSignedPercent(row.relative)}
                        </td>
                        <td className={`num ${pnlClass(row.pnl)}`}>{fmtSignedMoney(row.pnl, 'TWD')}</td>
                        <td className={`num ${pnlClass(row.roi)}`}>{fmtSignedPercent(row.roi)}</td>
                        <td className="num">{fmtMoney(row.proceeds, 'TWD')}</td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3>對帳單 · 自訂賣出價</h3>
      <div className="whatif-ledger">
        <div className="whatif-ledger-cell" />
        <div className="whatif-ledger-cell whatif-ledger-heading">買進 · 假設</div>
        <div className="whatif-ledger-cell whatif-ledger-heading">賣出 · 試算</div>

        <div className="whatif-ledger-cell" data-testid="whatif-ledger-key">價格</div>
        <div className="whatif-ledger-cell">
          <div className="field">
            <input
              type="number"
              step="0.01"
              min="0"
              aria-label="買進價格"
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
            />
          </div>
        </div>
        <div className="whatif-ledger-cell">
          <div className="field">
            <input
              type="number"
              step="0.01"
              min="0"
              aria-label="賣出價格"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
            />
          </div>
        </div>

        <div className="whatif-ledger-cell" data-testid="whatif-ledger-key">股數</div>
        <div className="whatif-ledger-cell">
          <div className="field-row">
            <div className="field">
              <input
                type="number"
                step="1"
                min="0"
                aria-label="股數"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="field">
              <select
                className="narrow"
                aria-label="單位"
                value={unit}
                onChange={(e) => setUnit(e.target.value as Unit)}
              >
                <option value="張">張</option>
                <option value="股">股</option>
              </select>
            </div>
          </div>
        </div>
        <div className="whatif-ledger-cell">{fmtQty(shares)} 股</div>

        <div className="whatif-ledger-cell" data-testid="whatif-ledger-key">價金</div>
        <div className="whatif-ledger-cell">{fmtMoney(buyPriceNum * shares, 'TWD')}</div>
        <div className="whatif-ledger-cell">{fmtMoney(sellPriceNum * shares, 'TWD')}</div>

        <div className="whatif-ledger-cell" data-testid="whatif-ledger-key">費用</div>
        <div className="whatif-ledger-cell">{fmtMoney(result?.buyFee ?? null, 'TWD')}</div>
        <div className="whatif-ledger-cell">{fmtMoney(result?.sellFeeTax ?? null, 'TWD')}</div>

        <div className="whatif-ledger-cell" data-testid="whatif-ledger-key">小計</div>
        <div className="whatif-ledger-cell">
          投入成本 <span data-testid="whatif-cost">{fmtMoney(result?.cost ?? null, 'TWD')}</span>
        </div>
        <div className="whatif-ledger-cell">
          實收 <span data-testid="whatif-proceeds">{fmtMoney(result?.proceeds ?? null, 'TWD')}</span>
        </div>
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

      {!result && <div className="hint">請輸入大於 0 的買進價格、股數與賣出價格。</div>}
      {result && (
        <div className="hint" data-testid="whatif-fees">
          含手續費與證交稅 -{fmtMoney(result.buyFee + result.sellFeeTax, 'TWD')}
        </div>
      )}

      {hasQuote && (
        <div className="hint">
          {isHeld
            ? `買進價預設為成交均價 ${rawAvgCost.toFixed(2)}（未含手續費）`
            : `買進價預設為現價 ${currentPrice}`}
        </div>
      )}
      <p className="hint">此為試算工具，不會影響持股或任何損益報表。</p>
    </div>
  )
}
