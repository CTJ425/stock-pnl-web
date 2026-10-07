/**
 * 損益試算 (what-if): "what if I had bought this ticker at X and sold at Y" calculator.
 *
 * State lives only in this component — the inputs are deliberately not persisted to
 * localStorage, Supabase, or any store, so this tab never reflects or affects real
 * holdings / P&L reports. It is a sandbox, not a form.
 */
import { Fragment, useEffect, useState } from 'react'
import { whatIf, sellLadder, averageDown, sharesForTargetAvg } from './whatIf'
import type { AveragingBase, LadderRow } from './whatIf'
import {
  fmtMoney,
  fmtPercent,
  fmtQty,
  fmtSignedMoney,
  fmtSignedPercent,
  pnlClass,
  roundPrice,
} from '../../utils/formatters'
import { getFeeRateOn, getMinFee } from '../../utils/settings'
import { taipeiDateKey } from '../../utils/taipeiDate'
import { useWorkspace } from '../../context/WorkspaceContext'
import { rowActivateProps } from '../../hooks/rowActivateProps'

type Unit = '張' | '股'

interface WhatIfTabProps {
  ticker: string
  currentPrice: number | null
  /** Set for a held stock, null for a watched one. Fee-exclusive average traded price. */
  rawAvgCost: number | null
  /** Set for a held stock, null for a watched one. Fee-inclusive average cost (庫存總覽's own cost basis). */
  avgCost?: number | null
  /** Set for a held stock, null for a watched one. Shares currently held. */
  heldQty: number | null
}

const LADDER_TAG: Record<string, string> = { current: '現價', breakEven: '回本', avgCost: '均價' }

/**
 * A horizontal price axis with one marker per price (現價 / 持有均價 / 回本 / 賣出). The stretch between
 * 回本 and the sell price is tinted by the result's sign, which is the whole question of this tab.
 * HTML, not SVG: the labels must stay at text size however narrow the phone is.
 */
function PriceScale({
  points,
  breakEven,
  sellPnl,
}: {
  points: Array<{ kind: string; label: string; price: number }>
  breakEven: number | null
  sellPnl: number | null
}) {
  const prices = points.map((p) => p.price)
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const pad = (hi - lo || hi * 0.02 || 1) * 0.08
  const pos = (v: number) => ((v - (lo - pad)) / (hi - lo + pad * 2)) * 100
  const sell = points.find((p) => p.kind === 'sell')
  return (
    <div className="whatif-scale" data-testid="whatif-scale" aria-hidden="true">
      <div className="whatif-scale-track">
        {sell && breakEven !== null && (
          <span
            className={`whatif-scale-span ${sellPnl !== null && sellPnl < 0 ? 'is-loss' : 'is-gain'}`}
            style={{ left: `${Math.min(pos(sell.price), pos(breakEven))}%`, width: `${Math.abs(pos(sell.price) - pos(breakEven))}%` }}
          />
        )}
        {[...points].sort((a, b) => a.price - b.price).map((p, i) => (
          <span
            key={p.kind}
            className={`whatif-scale-mark whatif-scale-mark--${p.kind} ${i % 2 ? 'is-below' : 'is-above'}${
              pos(p.price) < 15 ? ' at-start' : pos(p.price) > 85 ? ' at-end' : ''
            }`}
            style={{ left: `${pos(p.price)}%` }}
          >
            <b>{p.label}</b> {p.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        ))}
      </div>
    </div>
  )
}

export function WhatIfTab({ ticker, currentPrice, rawAvgCost, avgCost = null, heldQty }: WhatIfTabProps) {
  const { current } = useWorkspace()
  const hasQuote = currentPrice !== null && currentPrice > 0
  const isHeld = rawAvgCost !== null
  // The real fee this holding actually paid is only known when the caller also has
  // avgCost (庫存總覽's fee-inclusive cost basis) — some callers (and older test
  // fixtures) only pass rawAvgCost, so this stays a separate, narrower condition.
  const hasRealCost = rawAvgCost !== null && rawAvgCost > 0 && avgCost !== null

  const [buyPrice, setBuyPrice] = useState(
    isHeld ? roundPrice(rawAvgCost).toFixed(2) : hasQuote ? String(currentPrice) : ''
  )
  // Once the user edits the buy price, the simulation switches from "exact cost basis"
  // to "the holding's real fee rate applied to whatever price is typed" (contract B).
  const [buyPriceEdited, setBuyPriceEdited] = useState(false)
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
  // 攤平試算 (held stocks only): one hypothetical add-on buy merged into the holding.
  const [addPrice, setAddPrice] = useState('')
  const [addQty, setAddQty] = useState('')
  const [addUnit, setAddUnit] = useState<Unit>('張')
  const [targetAvg, setTargetAvg] = useState('')

  // The same ticker can be held in different workspaces with different cost bases.
  // Switching workspace changes these props without remounting the component, so the
  // buy price / qty / unit must re-seed the same way a fresh mount would — a later user
  // edit still sticks because this only fires when the holding identity itself changes.
  useEffect(() => {
    setBuyPrice(isHeld ? roundPrice(rawAvgCost).toFixed(2) : hasQuote ? String(currentPrice) : '')
    setBuyPriceEdited(false)
    setUnit(isHeld && heldQty !== null && heldQty % 1000 !== 0 ? '股' : '張')
    setQty(isHeld && heldQty !== null ? String(heldQty % 1000 === 0 ? heldQty / 1000 : heldQty) : '1')
    setAddPrice('')
    setAddQty('')
    setTargetAvg('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, rawAvgCost, avgCost, heldQty])

  // A watched stock has no holding to seed from, and its quote arrives after this tab mounted (a
  // selection change reads null until the new stock's own quote lands — Task 193 M4). Fill the inputs
  // that are still empty when the quote first appears. Only the false → true edge of `hasQuote` fires
  // this, so a polled price that merely moves never touches a number the user is looking at.
  useEffect(() => {
    if (!hasQuote) return
    setSellPrice((p) => (p === '' ? String(currentPrice) : p))
    if (!isHeld) setBuyPrice((p) => (p === '' && !buyPriceEdited ? String(currentPrice) : p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasQuote, ticker])

  // Scoped to the workspace like every other caller (AnalysisPage, DashboardPage,
  // TransactionForm): an unscoped read would price the estimate with the global rate
  // while the workspace has its own, and the difference would be invisible.
  // Today's rate (Task 182): the what-if asks what a trade made now would cost.
  const feeRate = getFeeRateOn(taipeiDateKey(new Date()), current?.id)
  // Whole-lot vs odd-lot minimum fee follows the share count, same rule as the transaction form.
  const minFeeFor = (n: number) => getMinFee(n > 0 && n % 1000 === 0 ? 'whole' : 'odd', current?.id)

  // 攤平試算 (Task 197). The base is the real holding as 庫存總覽 states it — never the
  // sandbox buy price above, which is locked while an add-on is entered.
  const canAverage = rawAvgCost !== null && rawAvgCost > 0 && heldQty !== null && heldQty > 0
  const basePosition: AveragingBase | null = canAverage
    ? hasRealCost
      ? { qty: heldQty, cost: avgCost * heldQty, rawCost: rawAvgCost * heldQty }
      : {
          qty: heldQty,
          rawCost: rawAvgCost * heldQty,
          // No fee-inclusive cost from the caller: price the buy fee the same way the
          // sandbox does when it has none (workspace rate on the raw average).
          cost:
            whatIf({ ticker, buyPrice: rawAvgCost, qty: heldQty, price: rawAvgCost, feeRate, minFee: minFeeFor(heldQty) })
              ?.cost ?? rawAvgCost * heldQty,
        }
    : null
  const addPriceNum = Number(addPrice)
  const addQtyNum = Number(addQty)
  const addShares = addUnit === '張' ? addQtyNum * 1000 : addQtyNum
  // Empty is a valid "no add-on" state; only a typed, unusable value is an error.
  const addPriceError = addPrice === '' || (Number.isFinite(addPriceNum) && addPriceNum > 0) ? null : '請輸入大於 0 的價格'
  const addQtyError = addQty === '' || (Number.isFinite(addQtyNum) && addQtyNum > 0) ? null : '請輸入大於 0 的股數'
  const averaging =
    basePosition && addPrice !== '' && addQty !== '' && !addPriceError && !addQtyError
      ? averageDown(basePosition, { ticker, price: addPriceNum, qty: addShares, feeRate, minFee: minFeeFor(addShares) })
      : null
  const targetNum = Number(targetAvg)
  const targetSolve =
    basePosition && targetAvg !== '' && addPrice !== '' && !addPriceError
      ? sharesForTargetAvg(basePosition, { ticker, price: addPriceNum, feeRate, minFeeFor }, targetNum, addUnit === '張' ? 1000 : 1)
      : null

  const buyPriceNum = averaging ? (rawAvgCost as number) : Number(buyPrice)
  const qtyNum = Number(qty)
  const sellPriceNum = Number(sellPrice)
  // The input is a sandbox and stays in whatever unit the user typed it in; only the
  // derived share count switches with the unit selector, so an in-place rewrite never
  // fights the user mid-typing (unlike TransactionForm, which does rewrite in place).
  const baseShares = averaging ? (heldQty as number) : unit === '張' ? qtyNum * 1000 : qtyNum
  const shares = averaging ? averaging.totalQty : baseShares

  // Per-field validation (DT-07): one message under the field that is actually wrong, instead
  // of a single generic sentence below the whole form. `whatIf`/`sellLadder` still gate on all
  // three together — these are only what gets displayed, not a second source of truth.
  const buyPriceError = Number.isFinite(buyPriceNum) && buyPriceNum > 0 ? null : '請輸入大於 0 的價格'
  const qtyError = Number.isFinite(baseShares) && baseShares > 0 ? null : '請輸入大於 0 的股數'
  const sellPriceError = Number.isFinite(sellPriceNum) && sellPriceNum > 0 ? null : '請輸入大於 0 的價格'

  const minFee = minFeeFor(shares)

  // Buy price untouched on a held stock with a known real cost: use the exact unrounded
  // rawAvgCost and the fee actually embedded in avgCost, so 投入成本 lands on exactly
  // shares * avgCost. Once edited, fall back to the holding's real fee *rate* applied to
  // whatever the user typed — never the workspace's configured rate.
  const effectiveBuyPrice = hasRealCost && !buyPriceEdited ? rawAvgCost : buyPriceNum
  const buyFeeOverride = hasRealCost
    ? buyPriceEdited
      ? Math.round(buyPriceNum * baseShares * ((avgCost - rawAvgCost) / rawAvgCost))
      : (avgCost - rawAvgCost) * baseShares
    : undefined

  // With an add-on, the sell side prices the merged position: its raw average, its total
  // shares, and every buy fee paid (the holding's own plus the add-on's).
  const whatIfInput = averaging
    ? {
        ticker,
        buyPrice: averaging.rawAvgCost,
        qty: averaging.totalQty,
        price: sellPriceNum,
        feeRate,
        minFee,
        buyFee: averaging.totalCost - averaging.totalRawCost,
      }
    : {
        ticker,
        buyPrice: effectiveBuyPrice,
        qty: shares,
        price: sellPriceNum,
        feeRate,
        minFee,
        buyFee: buyFeeOverride,
      }

  const result = whatIf(whatIfInput)
  // The real holding alone, priced the same way — the "before" of the 攤平 comparison.
  const baseFee = basePosition ? basePosition.cost - basePosition.rawCost : 0
  const baseBuyFee = averaging ? baseFee : (result?.buyFee ?? null)
  const beforeAt = (price: number) =>
    basePosition
      ? whatIf({
          ticker,
          buyPrice: basePosition.rawCost / basePosition.qty,
          qty: basePosition.qty,
          price,
          feeRate,
          minFee: minFeeFor(basePosition.qty),
          buyFee: baseFee,
        })
      : null
  const compare =
    averaging && basePosition
      ? {
          avgBefore: basePosition.cost / basePosition.qty,
          avgAfter: averaging.avgCost,
          breakEvenBefore: beforeAt(rawAvgCost as number)?.breakEven ?? null,
          breakEvenAfter: whatIf({ ...whatIfInput, price: averaging.rawAvgCost })?.breakEven ?? null,
          pnlBefore: hasQuote ? (beforeAt(currentPrice as number)?.pnl ?? null) : null,
          pnlAfter: hasQuote ? (whatIf({ ...whatIfInput, price: currentPrice as number })?.pnl ?? null) : null,
        }
      : null

  // The ladder anchors on the holding average cost when there is one, never on the
  // sell-price input — it keeps its ±10% promise instead of jumping every time the user
  // types a sell price. With an add-on it is the merged position's average.
  const anchorsOnAvgCost = rawAvgCost !== null && rawAvgCost > 0
  const markAvgCost = averaging ? averaging.rawAvgCost : rawAvgCost
  // Snapped to the same 0.01 grid sellLadder uses for its rows, so the anchor row's
  // relative is exactly 0 instead of a sub-cent residual that renders as -0.00%.
  const anchor = anchorsOnAvgCost ? roundPrice(markAvgCost as number) : (currentPrice ?? buyPriceNum)
  const ladder = sellLadder({ ...whatIfInput, price: anchor }, { currentPrice, avgCost: markAvgCost })

  const heading = anchorsOnAvgCost
    ? `賣出階梯 · ${averaging ? '補進後均價' : '持有均價'} ±10%`
    : '賣出階梯 · 現價 ±10%'

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
                label: averaging ? '補進後均價' : '持有均價',
                price: anchor,
                relative: null,
                pnl: markPnl(anchor),
              },
            ]
          : []),
        // Task 166 (EN-07): breakEven is null when the solver does not converge — show no mark
        // rather than a price that is not actually break-even.
        ...(result!.breakEven !== null
          ? [
              {
                kind: 'breakEven' as const,
                label: '回本',
                price: result!.breakEven,
                relative: result!.breakEven / anchor - 1,
                pnl: markPnl(result!.breakEven),
              },
            ]
          : []),
      ]
    : []

  // Price scale (2026-09-27): the marks and the typed sell price on one axis, so "how far is my
  // price from break-even" is a distance on screen before it is a number in the table.
  const scalePoints = [
    ...markItems.map((m) => ({ kind: m.kind as string, label: m.label, price: m.price })),
    ...(result !== null && Number.isFinite(sellPriceNum) && sellPriceNum > 0
      ? [{ kind: 'sell', label: '賣出', price: sellPriceNum }]
      : []),
  ]
  const breakEvenPrice = markItems.find((m) => m.kind === 'breakEven')?.price ?? null

  // 反推 answer, in words: the target never edits the add-on by itself — a button does,
  // so a typed 補進股數 is never overwritten behind the user's back.
  const targetText = (): string => {
    if (targetAvg === '') return '輸入想要的均價，算出在補進價要補多少。'
    if (!(Number.isFinite(targetNum) && targetNum > 0)) return '請輸入大於 0 的均價'
    if (addPrice === '' || addPriceError) return '先填補進價，才能算要補多少。'
    if (!targetSolve || !basePosition) return ''
    if (targetSolve.kind === 'already') return '目前均價已經是這個數字，不需要補進。'
    const lowering = targetNum < basePosition.cost / basePosition.qty
    if (targetSolve.kind === 'unreachable') {
      return `補進價 ${fmtMoney(addPriceNum, 'TWD', 2)} 加上手續費後${lowering ? '不低於' : '不高於'}目標，補再多也到不了。`
    }
    const after = averageDown(basePosition, {
      ticker,
      price: addPriceNum,
      qty: targetSolve.qty,
      feeRate,
      minFee: minFeeFor(targetSolve.qty),
    })!
    const amount = addUnit === '張' ? `${fmtQty(targetSolve.qty / 1000)} 張` : `${fmtQty(targetSolve.qty)} 股`
    return `在 ${fmtMoney(addPriceNum, 'TWD', 2)} 補 ${amount}，均價變成 ${fmtMoney(after.avgCost, 'TWD', 2)}，需準備 ${fmtMoney(after.addCost, 'TWD')}。`
  }

  const pick = (row: LadderRow) => setSellPrice(String(row.price))
  const pickPrice = (price: number) => setSellPrice(String(price))

  return (
    <div className="rpt-section">
      {scalePoints.length > 1 && (
        <PriceScale points={scalePoints} breakEven={breakEvenPrice} sellPnl={result?.pnl ?? null} />
      )}
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
          <p className="hint">僅供試算參考，非交易所公告之漲跌停價</p>
          <div className="table-scroll">
            <table className="data-table whatif-ladder" data-testid="whatif-ladder">
              <thead>
                <tr>
                  <th scope="col">賣出價</th>
                  <th scope="col" className="num">{anchorsOnAvgCost ? '相對均價' : '相對現價'}</th>
                  <th scope="col" className="num">損益</th>
                  <th scope="col" className="num">報酬率</th>
                  <th scope="col" className="num">實收</th>
                </tr>
              </thead>
              <tbody>
                {ladder.map((row, i) => {
                  const showGap = i > 0 && ladder[i - 1].group !== row.group
                  const rowLabel = `賣出價 ${fmtMoney(row.price, 'TWD', 2)}${
                    LADDER_TAG[row.kind] ? `（${LADDER_TAG[row.kind]}）` : ''
                  }`
                  const activateRow = rowActivateProps(() => pick(row), rowLabel)
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
                        {...activateRow}
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

      <h3>對帳單 · {canAverage ? '補進與賣出' : '自訂賣出價'}</h3>
      <div className={`whatif-ledger${canAverage ? ' whatif-ledger--avg' : ''}`}>
        <div className="whatif-ledger-cell is-key" />
        <div className="whatif-ledger-cell whatif-ledger-heading">{canAverage ? '現有持股' : '買進 · 假設'}</div>
        {canAverage && <div className="whatif-ledger-cell whatif-ledger-heading col-add">補進 · 假設</div>}
        {canAverage && <div className="whatif-ledger-cell whatif-ledger-heading col-total">合計</div>}
        <div className="whatif-ledger-cell whatif-ledger-heading col-sell">賣出 · 試算</div>

        <div className="whatif-ledger-cell is-key" data-testid="whatif-ledger-key">價格</div>
        <div className="whatif-ledger-cell">
          <div className="whatif-ledger-sublabel">
            {isHeld ? (averaging ? '成交均價（未含費）· 鎖定' : '成交均價（未含費）') : '買進價'}
          </div>
          <div className="field">
            <input
              type="number"
              step="0.01"
              min="0"
              aria-label="買進價格"
              value={averaging ? roundPrice(rawAvgCost as number).toFixed(2) : buyPrice}
              disabled={averaging !== null}
              title={averaging ? '補進試算以實際持股計算；清空補進欄即可再修改' : undefined}
              onChange={(e) => {
                setBuyPriceEdited(true)
                setBuyPrice(e.target.value)
              }}
            />
            {!averaging && buyPriceError && <p className="field-error">{buyPriceError}</p>}
          </div>
        </div>
        {canAverage && (
          <div className="whatif-ledger-cell col-add">
            <div className="whatif-ledger-sublabel">補進價</div>
            <div className="field">
              <input
                type="number"
                step="0.01"
                min="0"
                aria-label="補進價格"
                value={addPrice}
                onChange={(e) => setAddPrice(e.target.value)}
              />
              {addPriceError && <p className="field-error">{addPriceError}</p>}
            </div>
          </div>
        )}
        {canAverage && (
          <div className="whatif-ledger-cell col-total">
            <div className="whatif-ledger-sublabel">平均（未含費）</div>
            {averaging ? fmtMoney(averaging.rawAvgCost, 'TWD', 2) : '—'}
          </div>
        )}
        <div className="whatif-ledger-cell col-sell">
          {hasQuote && (
            <div className="whatif-ledger-sublabel">現價 {(currentPrice as number).toFixed(2)}</div>
          )}
          <div className="field">
            <input
              type="number"
              step="0.01"
              min="0"
              aria-label="賣出價格"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
            />
            {sellPriceError && <p className="field-error">{sellPriceError}</p>}
          </div>
        </div>

        <div className="whatif-ledger-cell is-key" data-testid="whatif-ledger-key">股數</div>
        <div className="whatif-ledger-cell">
          <div className="field-row">
            <div className="field">
              <input
                type="number"
                step="1"
                min="0"
                aria-label="股數"
                value={averaging ? String(unit === '張' ? baseShares / 1000 : baseShares) : qty}
                disabled={averaging !== null}
                onChange={(e) => setQty(e.target.value)}
              />
              {!averaging && qtyError && <p className="field-error">{qtyError}</p>}
            </div>
            <div className="field">
              <select
                className="narrow"
                aria-label="單位"
                value={unit}
                disabled={averaging !== null}
                onChange={(e) => setUnit(e.target.value as Unit)}
              >
                <option value="張">張</option>
                <option value="股">股</option>
              </select>
            </div>
          </div>
        </div>
        {canAverage && (
          <div className="whatif-ledger-cell col-add">
            <div className="field-row">
              <div className="field">
                <input
                  type="number"
                  step="1"
                  min="0"
                  aria-label="補進股數"
                  value={addQty}
                  onChange={(e) => setAddQty(e.target.value)}
                />
                {addQtyError && <p className="field-error">{addQtyError}</p>}
              </div>
              <div className="field">
                <select
                  className="narrow"
                  aria-label="補進單位"
                  value={addUnit}
                  onChange={(e) => setAddUnit(e.target.value as Unit)}
                >
                  <option value="張">張</option>
                  <option value="股">股</option>
                </select>
              </div>
            </div>
          </div>
        )}
        {canAverage && (
          <div className="whatif-ledger-cell col-total" data-testid="whatif-total-qty">
            {averaging ? `${fmtQty(averaging.totalQty)} 股` : '—'}
          </div>
        )}
        <div className="whatif-ledger-cell col-sell">{fmtQty(shares)} 股</div>

        <div className="whatif-ledger-cell is-key" data-testid="whatif-ledger-key">價金</div>
        <div className="whatif-ledger-cell">{fmtMoney(buyPriceNum * baseShares, 'TWD')}</div>
        {canAverage && (
          <div className="whatif-ledger-cell col-add">{averaging ? fmtMoney(averaging.addAmount, 'TWD') : '—'}</div>
        )}
        {canAverage && (
          <div className="whatif-ledger-cell col-total">
            {averaging ? fmtMoney(averaging.totalRawCost, 'TWD') : '—'}
          </div>
        )}
        <div className="whatif-ledger-cell col-sell">{fmtMoney(sellPriceNum * shares, 'TWD')}</div>

        <div className="whatif-ledger-cell is-key" data-testid="whatif-ledger-key">費用</div>
        <div className="whatif-ledger-cell">
          <div className="whatif-ledger-sublabel">{isHeld ? '實付手續費' : '手續費'}</div>
          {fmtMoney(baseBuyFee, 'TWD')}
        </div>
        {canAverage && (
          <div className="whatif-ledger-cell col-add">
            <div className="whatif-ledger-sublabel">手續費（今日費率）</div>
            {averaging ? fmtMoney(averaging.addFee, 'TWD') : '—'}
          </div>
        )}
        {canAverage && (
          <div className="whatif-ledger-cell col-total">
            {averaging ? fmtMoney(averaging.totalCost - averaging.totalRawCost, 'TWD') : '—'}
          </div>
        )}
        <div className="whatif-ledger-cell col-sell">{fmtMoney(result?.sellFeeTax ?? null, 'TWD')}</div>

        <div className="whatif-ledger-cell is-key is-last" data-testid="whatif-ledger-key">小計</div>
        <div className="whatif-ledger-cell is-last">
          投入成本{' '}
          <span data-testid="whatif-cost">
            {fmtMoney(averaging && basePosition ? basePosition.cost : (result?.cost ?? null), 'TWD')}
          </span>
        </div>
        {canAverage && (
          <div className="whatif-ledger-cell col-add is-last">
            需準備 <span data-testid="whatif-add-cost">{averaging ? fmtMoney(averaging.addCost, 'TWD') : '—'}</span>
          </div>
        )}
        {canAverage && (
          <div className="whatif-ledger-cell col-total is-last">
            投入成本{' '}
            <span data-testid="whatif-total-cost">{averaging ? fmtMoney(averaging.totalCost, 'TWD') : '—'}</span>
          </div>
        )}
        <div className="whatif-ledger-cell col-sell is-last">
          實收 <span data-testid="whatif-proceeds">{fmtMoney(result?.proceeds ?? null, 'TWD')}</span>
        </div>
      </div>

      {canAverage && (
        <div className="whatif-target" data-testid="whatif-target">
          <div className="field whatif-target-field">
            <label htmlFor={`whatif-target-${ticker}`}>目標均價（含手續費）</label>
            <input
              id={`whatif-target-${ticker}`}
              type="number"
              step="0.01"
              min="0"
              value={targetAvg}
              placeholder={basePosition ? roundPrice(basePosition.cost / basePosition.qty).toFixed(2) : undefined}
              onChange={(e) => setTargetAvg(e.target.value)}
            />
          </div>
          <p className="whatif-target-answer" data-testid="whatif-target-answer" aria-live="polite">
            {targetText()}
          </p>
          {targetSolve?.kind === 'ok' && (
            <button
              type="button"
              className="btn"
              onClick={() => setAddQty(String(addUnit === '張' ? targetSolve.qty / 1000 : targetSolve.qty))}
            >
              帶入補進股數
            </button>
          )}
        </div>
      )}

      {compare && (
        <div className="table-scroll">
          <table className="data-table whatif-compare" data-testid="whatif-compare">
            <caption>補進前後</caption>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col" className="num">補進前</th>
                <th scope="col" className="num">補進後</th>
                <th scope="col" className="num">變化</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">均價（含手續費）</th>
                <td className="num">{fmtMoney(compare.avgBefore, 'TWD', 2)}</td>
                <td className="num" data-testid="whatif-avg-after">{fmtMoney(compare.avgAfter, 'TWD', 2)}</td>
                <td className="num">
                  {fmtSignedMoney(compare.avgAfter - compare.avgBefore, 'TWD', 2)}（
                  {fmtSignedPercent(compare.avgAfter / compare.avgBefore - 1)}）
                </td>
              </tr>
              <tr>
                <th scope="row">回本價</th>
                <td className="num">{fmtMoney(compare.breakEvenBefore, 'TWD', 2)}</td>
                <td className="num">{fmtMoney(compare.breakEvenAfter, 'TWD', 2)}</td>
                <td className="num">
                  {compare.breakEvenBefore !== null && compare.breakEvenAfter !== null
                    ? fmtSignedMoney(compare.breakEvenAfter - compare.breakEvenBefore, 'TWD', 2)
                    : '—'}
                </td>
              </tr>
              {compare.pnlBefore !== null && compare.pnlAfter !== null && (
                <tr>
                  <th scope="row">以現價試算損益</th>
                  <td className={`num ${pnlClass(compare.pnlBefore)}`}>{fmtSignedMoney(compare.pnlBefore, 'TWD')}</td>
                  <td className={`num ${pnlClass(compare.pnlAfter)}`}>{fmtSignedMoney(compare.pnlAfter, 'TWD')}</td>
                  <td className="num">{fmtSignedMoney(compare.pnlAfter - compare.pnlBefore, 'TWD')}</td>
                </tr>
              )}
              <tr>
                <th scope="row">持有股數</th>
                <td className="num">{fmtQty(basePosition!.qty)}</td>
                <td className="num">{fmtQty(averaging!.totalQty)}</td>
                <td className="num">+{fmtQty(averaging!.totalQty - basePosition!.qty)}</td>
              </tr>
              <tr>
                <th scope="row">投入成本</th>
                <td className="num">{fmtMoney(basePosition!.cost, 'TWD')}</td>
                <td className="num">{fmtMoney(averaging!.totalCost, 'TWD')}</td>
                <td className="num">+{fmtMoney(averaging!.addCost, 'TWD')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

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

      {result && (
        <div className="hint" data-testid="whatif-fees">
          含手續費與證交稅 -{fmtMoney(result.buyFee + result.sellFeeTax, 'TWD')}
        </div>
      )}

      {hasQuote && (
        <div className="hint">
          {isHeld
            ? hasRealCost
              ? '買進價＝持股買進金額 ÷ 股數（未含手續費）；手續費採實際持股平均費用。持股歸零後重新起算。'
              : `買進價預設為成交均價 ${roundPrice(rawAvgCost).toFixed(2)}（未含手續費）`
            : `買進價預設為現價 ${currentPrice}`}
        </div>
      )}
      {averaging && (
        <p className="hint">
          補進手續費依今日工作區費率計算；均價採移動平均（含買進手續費），與庫存總覽相同。補進時現有持股以實際成本計算。
        </p>
      )}
      <p className="hint">此為試算工具，不會影響持股或任何損益報表。</p>
    </div>
  )
}
