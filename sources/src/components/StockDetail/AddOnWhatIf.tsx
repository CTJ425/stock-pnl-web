/**
 * 補進試算 (Task 197): one hypothetical add-on buy merged into the holding by moving-average
 * cost. Like the sell side it is a sandbox — nothing here is persisted or touches real P&L.
 *
 * The add-on price can be typed directly or derived from a % move off 現價 / 持有均價; the two
 * fields follow each other, and a derived price is snapped to a price an order can be placed at.
 */
import { useEffect, useState } from 'react'
import { whatIf, averageDown, sharesForTargetAvg, snapToTick } from './whatIf'
import type { AveragingBase } from './whatIf'
import { fmtMoney, fmtQty, fmtSignedMoney, fmtSignedPercent, pnlClass, roundPrice } from '../../utils/formatters'
import { getFeeRateOn, getMinFee } from '../../utils/settings'
import { taipeiDateKey } from '../../utils/taipeiDate'
import { useWorkspace } from '../../context/WorkspaceContext'

type Unit = '張' | '股'
type PctBase = 'current' | 'avg'

/** The merged position handed to 賣出試算 by 「用補進後部位試算賣出」. */
export interface CarriedPosition {
  rawAvgCost: number
  avgCost: number
  qty: number
  addPrice: number
  addShares: number
}

interface AddOnWhatIfProps {
  ticker: string
  currentPrice: number | null
  /** Fee-exclusive average traded price of the holding. */
  rawAvgCost: number
  /** Fee-inclusive average cost (庫存總覽's 均價); null when the caller does not have it. */
  avgCost: number | null
  heldQty: number
  onCarry: (position: CarriedPosition) => void
}

const PCT_CHIPS = [-3, -5, -10, -15]

/** A % as typed back into the field: two decimals at most, no trailing zeros. */
const pctText = (v: number) => String(Number(v.toFixed(2)))

export function AddOnWhatIf({ ticker, currentPrice, rawAvgCost, avgCost, heldQty, onCarry }: AddOnWhatIfProps) {
  const { current } = useWorkspace()
  const hasQuote = currentPrice !== null && currentPrice > 0

  const [price, setPrice] = useState('')
  const [pct, setPct] = useState('')
  // Which of the two linked fields the user typed last; the other one is derived from it.
  const [lastEdited, setLastEdited] = useState<'price' | 'pct'>('price')
  const [pctBase, setPctBase] = useState<PctBase>(hasQuote ? 'current' : 'avg')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState<Unit>('張')
  const [targetAvg, setTargetAvg] = useState('')

  // A different holding (stock or workspace) starts a fresh sandbox.
  useEffect(() => {
    setPrice('')
    setPct('')
    setLastEdited('price')
    setQty('')
    setTargetAvg('')
  }, [ticker, rawAvgCost, avgCost, heldQty])

  // Today's rate, scoped to the workspace (Task 182): the add-on is a trade made now.
  const feeRate = getFeeRateOn(taipeiDateKey(new Date()), current?.id)
  const minFeeFor = (n: number) => getMinFee(n > 0 && n % 1000 === 0 ? 'whole' : 'odd', current?.id)

  // The real holding as 庫存總覽 states it. Without a fee-inclusive cost from the caller the buy
  // fee is priced the way 賣出試算 does when it has none: workspace rate on the raw average.
  const base: AveragingBase = {
    qty: heldQty,
    rawCost: rawAvgCost * heldQty,
    cost:
      avgCost !== null
        ? avgCost * heldQty
        : (whatIf({ ticker, buyPrice: rawAvgCost, qty: heldQty, price: rawAvgCost, feeRate, minFee: minFeeFor(heldQty) })
            ?.cost ?? rawAvgCost * heldQty),
  }
  const avgBefore = base.cost / base.qty

  const pctBaseValue = pctBase === 'current' && hasQuote ? (currentPrice as number) : avgBefore
  const pctBaseLabel = pctBase === 'current' && hasQuote ? '現價' : '持有均價'

  // Derive the field the user did not type. A % move lands on a raw price first, then snaps to
  // the nearest order price; a typed price shows the exact % it is off the base.
  const pctNum = Number(pct)
  const rawFromPct = pct !== '' && Number.isFinite(pctNum) ? pctBaseValue * (1 + pctNum / 100) : null
  const snapped = rawFromPct !== null && rawFromPct > 0 ? snapToTick(rawFromPct, ticker) : null
  const priceText = lastEdited === 'pct' ? (snapped !== null ? snapped.toFixed(2) : '') : price
  const priceNum = Number(priceText)
  const priceOk = priceText !== '' && Number.isFinite(priceNum) && priceNum > 0
  const pctShown = lastEdited === 'pct' ? pct : priceOk ? pctText((priceNum / pctBaseValue - 1) * 100) : ''

  const priceError =
    lastEdited === 'pct'
      ? pct !== '' && snapped === null
        ? '換算後的價格必須大於 0'
        : null
      : price !== '' && !priceOk
        ? '請輸入大於 0 的價格'
        : null

  const qtyNum = Number(qty)
  const shares = unit === '張' ? qtyNum * 1000 : qtyNum
  const qtyOk = qty !== '' && Number.isFinite(qtyNum) && qtyNum > 0
  const qtyError = qty !== '' && !qtyOk ? '請輸入大於 0 的數量' : null

  const averaging =
    priceOk && qtyOk
      ? averageDown(base, { ticker, price: priceNum, qty: shares, feeRate, minFee: minFeeFor(shares) })
      : null

  // Same fee model as 賣出試算, so 回本價 here and there agree for the same position.
  const position = (rawAvg: number, qtyShares: number, totalFee: number, at: number) =>
    whatIf({ ticker, buyPrice: rawAvg, qty: qtyShares, price: at, feeRate, minFee: minFeeFor(qtyShares), buyFee: totalFee })
  const baseFee = base.cost - base.rawCost
  const breakEvenBefore = position(rawAvgCost, heldQty, baseFee, rawAvgCost)?.breakEven ?? null
  const pnlBefore = hasQuote ? (position(rawAvgCost, heldQty, baseFee, currentPrice as number)?.pnl ?? null) : null
  const after = averaging
    ? {
        breakEven:
          position(averaging.rawAvgCost, averaging.totalQty, averaging.totalCost - averaging.totalRawCost, averaging.rawAvgCost)
            ?.breakEven ?? null,
        pnl: hasQuote
          ? (position(
              averaging.rawAvgCost,
              averaging.totalQty,
              averaging.totalCost - averaging.totalRawCost,
              currentPrice as number,
            )?.pnl ?? null)
          : null,
      }
    : null

  const targetNum = Number(targetAvg)
  const targetSolve =
    targetAvg !== '' && priceOk
      ? sharesForTargetAvg(base, { ticker, price: priceNum, feeRate, minFeeFor }, targetNum, unit === '張' ? 1000 : 1)
      : null
  const amountText = (n: number) => (unit === '張' ? `${fmtQty(n / 1000)} 張` : `${fmtQty(n)} 股`)
  const targetText = (): string => {
    if (targetAvg === '') return '輸入想要的均價（含手續費），算出在補進價要補多少。'
    if (!(Number.isFinite(targetNum) && targetNum > 0)) return '請輸入大於 0 的均價'
    if (!priceOk) return '先填補進價，才能算要補多少。'
    if (!targetSolve) return ''
    if (targetSolve.kind === 'already') return '目前均價已經是這個數字，不需要補進。'
    if (targetSolve.kind === 'unreachable') {
      return `補進價 ${priceNum.toFixed(2)} 加上手續費後${targetNum < avgBefore ? '不低於' : '不高於'}目標，補再多也到不了。`
    }
    const r = averageDown(base, { ticker, price: priceNum, qty: targetSolve.qty, feeRate, minFee: minFeeFor(targetSolve.qty) })!
    return `在 ${priceNum.toFixed(2)} 補 ${amountText(targetSolve.qty)}，均價變成 ${r.avgCost.toFixed(2)}，需準備 ${fmtMoney(r.addCost, 'TWD')}。`
  }

  const typePrice = (v: string) => {
    setLastEdited('price')
    setPrice(v)
  }
  const typePct = (v: string) => {
    setLastEdited('pct')
    setPct(v)
  }
  // Switching base keeps whatever the user typed last and re-derives the other field.
  const changeBase = (b: PctBase) => {
    if (lastEdited === 'price') setPct('')
    setPctBase(b)
  }

  const avgDelta = averaging ? averaging.avgCost - avgBefore : 0

  return (
    <div className="addon">
      <section className="addon-inputs" aria-label="補進條件">
        <div className="addon-grid">
          <div className="field">
            <label htmlFor={`addon-price-${ticker}`}>補進價</label>
            <input
              id={`addon-price-${ticker}`}
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => typePrice(e.target.value)}
            />
            {priceError ? (
              <p className="field-error">{priceError}</p>
            ) : (
              lastEdited === 'pct' &&
              rawFromPct !== null &&
              snapped !== null &&
              roundPrice(rawFromPct) !== snapped && (
                <p className="addon-help" data-testid="addon-snap">
                  {pctBaseLabel} {pctShown}% 為 {Number(rawFromPct.toFixed(3))}，取最近可下單價位 {snapped.toFixed(2)}
                </p>
              )
            )}
          </div>

          <div className="field">
            <label htmlFor={`addon-pct-${ticker}`}>或用漲跌幅換算</label>
            <div className="addon-pct">
              <select aria-label="漲跌幅基準" value={pctBase} onChange={(e) => changeBase(e.target.value as PctBase)}>
                {hasQuote && <option value="current">相對現價</option>}
                <option value="avg">相對持有均價</option>
              </select>
              <input
                id={`addon-pct-${ticker}`}
                type="number"
                step="0.5"
                inputMode="decimal"
                value={pctShown}
                onChange={(e) => typePct(e.target.value)}
              />
              <span className="addon-unit">%</span>
            </div>
            <div className="addon-chips" role="group" aria-label="常用跌幅">
              {PCT_CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`addon-chip${lastEdited === 'pct' && pct === String(c) ? ' is-on' : ''}`}
                  aria-pressed={lastEdited === 'pct' && pct === String(c)}
                  onClick={() => typePct(String(c))}
                >
                  {c}%
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor={`addon-qty-${ticker}`}>補進數量</label>
            <div className="addon-qty">
              <input
                id={`addon-qty-${ticker}`}
                type="number"
                step="1"
                min="0"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
              <select aria-label="補進單位" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                <option value="張">張</option>
                <option value="股">股</option>
              </select>
            </div>
            {qtyError && <p className="field-error">{qtyError}</p>}
          </div>
        </div>

        <div className="addon-target" data-testid="addon-target">
          <label htmlFor={`addon-target-${ticker}`}>或依目標均價反推</label>
          <input
            id={`addon-target-${ticker}`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder={avgBefore.toFixed(2)}
            value={targetAvg}
            onChange={(e) => setTargetAvg(e.target.value)}
          />
          <p className="addon-target-answer" data-testid="addon-target-answer" aria-live="polite">
            {targetText()}
          </p>
          {targetSolve?.kind === 'ok' && (
            <button
              type="button"
              className="btn"
              onClick={() => setQty(String(unit === '張' ? targetSolve.qty / 1000 : targetSolve.qty))}
            >
              帶入 {amountText(targetSolve.qty)}
            </button>
          )}
        </div>
      </section>

      <section className="addon-result" aria-label="試算結果" aria-live="polite">
        <div className="addon-result-main">
          <div className="addon-k">補進後均價（含手續費）</div>
          <div className="addon-hero" data-testid="addon-avg-after">
            {averaging ? averaging.avgCost.toFixed(2) : '—'}
          </div>
          <div className="addon-s">
            {averaging
              ? `原 ${avgBefore.toFixed(2)} · ${avgDelta <= 0 ? '降低' : '提高'} ${Math.abs(avgDelta).toFixed(2)}（${fmtSignedPercent(
                  averaging.avgCost / avgBefore - 1,
                )}）`
              : `目前 ${avgBefore.toFixed(2)}，填入補進價與數量後計算`}
          </div>
        </div>
        <div className="addon-result-side">
          <div className="addon-k">需準備資金</div>
          <div className="addon-figure" data-testid="addon-cash">
            {averaging ? fmtMoney(averaging.addCost, 'TWD') : '—'}
          </div>
          <div className="addon-s">
            {averaging ? `價金 ${fmtQty(averaging.addAmount)} + 手續費 ${fmtQty(averaging.addFee)}` : '含今日費率手續費'}
          </div>
        </div>
        <div className="addon-result-side">
          <div className="addon-k">回本價</div>
          <div className="addon-figure" data-testid="addon-breakeven">
            {fmtMoney(after ? after.breakEven : breakEvenBefore, 'TWD', 2)}
          </div>
          <div className="addon-s">
            {after
              ? `原 ${fmtMoney(breakEvenBefore, 'TWD', 2)}${
                  hasQuote && after.breakEven !== null
                    ? ` · 距現價 ${fmtSignedPercent(after.breakEven / (currentPrice as number) - 1)}`
                    : ''
                }`
              : '目前持股'}
          </div>
        </div>
      </section>

      {averaging && (
        <div className="table-scroll">
          <table className="data-table addon-compare" data-testid="addon-compare">
            <caption>補進前後</caption>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col" className="num">補進前</th>
                <th scope="col" className="num">補進後</th>
                <th scope="col" className="num addon-col-delta">變化</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">持有股數</th>
                <td className="num">{fmtQty(heldQty)}</td>
                <td className="num">{fmtQty(averaging.totalQty)}</td>
                <td className="num addon-col-delta">+{fmtQty(averaging.totalQty - heldQty)}</td>
              </tr>
              <tr>
                <th scope="row">投入成本</th>
                <td className="num">{fmtMoney(base.cost, 'TWD')}</td>
                <td className="num" data-testid="addon-total-cost">{fmtMoney(averaging.totalCost, 'TWD')}</td>
                <td className="num addon-col-delta">+{fmtMoney(averaging.addCost, 'TWD')}</td>
              </tr>
              <tr>
                <th scope="row">均價（含手續費）</th>
                <td className="num">{avgBefore.toFixed(2)}</td>
                <td className="num">{averaging.avgCost.toFixed(2)}</td>
                <td className="num addon-col-delta">{fmtSignedMoney(avgDelta, 'TWD', 2)}</td>
              </tr>
              {pnlBefore !== null && after?.pnl != null && (
                <tr>
                  <th scope="row">以現價 {(currentPrice as number).toFixed(2)} 試算損益</th>
                  <td className={`num ${pnlClass(pnlBefore)}`}>{fmtSignedMoney(pnlBefore, 'TWD')}</td>
                  <td className={`num ${pnlClass(after.pnl)}`}>{fmtSignedMoney(after.pnl, 'TWD')}</td>
                  <td className="num addon-col-delta">{fmtSignedMoney(after.pnl - pnlBefore, 'TWD')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="addon-foot">
        <p className="hint">
          補進手續費依今日工作區費率計算；均價採移動平均（含買進手續費），與庫存總覽相同。此為試算，不影響持股與報表。
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!averaging}
          onClick={() =>
            averaging &&
            onCarry({
              rawAvgCost: averaging.rawAvgCost,
              avgCost: averaging.avgCost,
              qty: averaging.totalQty,
              addPrice: priceNum,
              addShares: shares,
            })
          }
        >
          用補進後部位試算賣出
        </button>
      </div>
    </div>
  )
}
