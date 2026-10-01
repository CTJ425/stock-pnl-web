/**
 * The workspace's fee settings: the discount and how the broker hands it back (現折 / 月退).
 *
 * One form, two homes (2026-09-26 redesign): the dashboard opens it in place from the
 * 未實現淨損益 basis line, and the workspace menu opens it in a modal. Both write the same
 * fields (plus the fee/tax flooring, BUG-088), and the dashboard derives its P&L basis from
 * them (utils/pnlBasis), so there is no second "basis" setting that could disagree with the fee rate.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import type { FeeRateSegment, FeeRebate, FeeRounding } from '../types/models'
import { COMMON_FEE_RATES, DEFAULT_FEE_RATE } from '../utils/fees'
import { describeTwFeeRate, feeDiscountLabel } from '../utils/feeRateHint'
import { rateOn, withFeeRateFrom, withoutFeeRateFrom } from '../utils/feeRateHistory'
import { basisLabel, formatFeeRatePct, pnlBasis } from '../utils/pnlBasis'
import { taipeiDateKey } from '../utils/taipeiDate'
import { getFeeRateHistory, getStoredFeeRate } from '../utils/settings'

const CUSTOM = 'custom'

/** The form's unsaved values, handed to the dashboard so its figures can be previewed before saving. */
export interface FeeDraft {
  rate: number
  rebate: FeeRebate
  rounding: FeeRounding
}

function explain(rate: number, rebate: FeeRebate): string {
  const basis = pnlBasis(rate, rebate)
  if (rate >= DEFAULT_FEE_RATE) return `沒有折扣，台股用${basisLabel(basis, rate)}賣出手續費，再扣證交稅。`
  if (basis === 'list') {
    return `月退制的券商 App 會先用全額預扣，所以台股用${basisLabel(basis, rate)}賣出手續費，再扣證交稅，數字才對得上 App。`
  }
  return `現折的券商 App 用折扣後的費率預扣，所以台股用${basisLabel(basis, rate)}賣出手續費，再扣證交稅。`
}

export function WorkspaceFeeSettings({
  onClose,
  onSaved,
  showTitle = true,
  onPreview,
}: {
  onClose: () => void
  /** Called after a save; `rateChanged` lets the caller offer to recalculate recorded fees. */
  onSaved?: (result: { rateChanged: boolean }) => void
  /** The modal already carries a title; the in-page panel needs its own. */
  showTitle?: boolean
  /**
   * Called with the current, unsaved values on every change (null while the rate is invalid and on
   * close), so the dashboard can recompute its figures as a preview. Must be a stable function.
   */
  onPreview?: (draft: FeeDraft | null) => void
}) {
  const {
    current,
    setWorkspaceFeeRate,
    setWorkspaceFeeRateHistory,
    setWorkspaceFeeRebate,
    setWorkspaceFeeRounding,
  } = useWorkspace()
  const uid = useId()
  const today = useMemo(() => taipeiDateKey(new Date()), [])
  const [history, setHistory] = useState<FeeRateSegment[]>(() => getFeeRateHistory(current?.id))
  useEffect(() => {
    setHistory(getFeeRateHistory(current?.id))
  }, [current?.id])
  // The rate before the first segment. Null means this workspace has never had one, which is the
  // only case where saving writes the base instead of opening a new period (see `submit`).
  const base = getStoredFeeRate(current?.id) ?? current?.fee_rate ?? null
  const savedRate = rateOn(history, base, today, DEFAULT_FEE_RATE)
  const savedRebate: FeeRebate = current?.fee_rebate ?? 'instant'
  const isCommon = COMMON_FEE_RATES.includes(savedRate)
  const [choice, setChoice] = useState<string>(isCommon ? String(savedRate) : CUSTOM)
  const [customInput, setCustomInput] = useState(isCommon ? '' : String(savedRate))
  const [from, setFrom] = useState(today)
  const [rebate, setRebate] = useState<FeeRebate>(savedRebate)
  const [rounding, setRounding] = useState<FeeRounding>(current?.fee_rounding ?? 'lot')
  const [saving, setSaving] = useState(false)

  const rate = choice === CUSTOM ? parseFloat(customInput) : Number(choice)
  const rateValid = Number.isFinite(rate) && rate >= 0 && rate < 1
  const fromValid = /^\d{4}-\d{2}-\d{2}$/.test(from)
  const noDiscount = rateValid && rate >= DEFAULT_FEE_RATE
  const hint = choice === CUSTOM ? describeTwFeeRate(rate) : null
  // What this workspace charged on the chosen date, before this form's unsaved change.
  const rateBefore = fromValid ? rateOn(history, base, from, DEFAULT_FEE_RATE) : savedRate
  const futureFrom = fromValid && from > today

  useEffect(() => {
    // A future effective date changes nothing the dashboard shows today, so it previews the rate
    // still in force rather than one that has not started.
    const previewRate = futureFrom ? savedRate : rate
    onPreview?.(rateValid ? { rate: previewRate, rebate, rounding } : null)
  }, [onPreview, rate, rateValid, rebate, rounding, futureFrom, savedRate])
  // Closing the form (saved or not) ends the preview; the dashboard falls back to the saved values.
  useEffect(() => () => onPreview?.(null), [onPreview])

  const removeSegment = async (segFrom: string) => {
    if (!current || saving) return
    const next = withoutFeeRateFrom(history, base, segFrom)
    setHistory(next)
    setSaving(true)
    await setWorkspaceFeeRateHistory(current.id, next)
    setSaving(false)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!current || !rateValid || !fromValid || saving) return
    setSaving(true)
    const rateChanged = rate !== rateBefore
    if (rateChanged) {
      if (base === null && history.length === 0) {
        // Task 182: the workspace's first rate is not a change of agreement — there is no earlier
        // period for a segment to end. It becomes the base, so every transaction already recorded
        // is priced under it, whatever date the user picked here.
        await setWorkspaceFeeRate(current.id, rate)
      } else {
        const next = withFeeRateFrom(history, base, from, rate)
        setHistory(next)
        await setWorkspaceFeeRateHistory(current.id, next)
      }
    }
    if (rebate !== (current.fee_rebate ?? 'instant')) await setWorkspaceFeeRebate(current.id, rebate)
    if (rounding !== (current.fee_rounding ?? 'lot')) await setWorkspaceFeeRounding(current.id, rounding)
    setSaving(false)
    onSaved?.({ rateChanged })
    onClose()
  }

  return (
    <form
      className="fee-settings"
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      aria-labelledby={showTitle ? `${uid}-title` : undefined}
    >
      {showTitle && (
        <h2 id={`${uid}-title`} className="fee-settings-title">
          {current?.name ?? ''}的手續費設定
        </h2>
      )}
      <div className="fee-settings-grid">
        <div className="field">
          <label htmlFor={`${uid}-rate`}>手續費折扣</label>
          <select id={`${uid}-rate`} value={choice} autoFocus onChange={(e) => setChoice(e.target.value)}>
            {COMMON_FEE_RATES.map((r) => (
              <option key={r} value={String(r)}>
                {feeDiscountLabel(r)}（{formatFeeRatePct(r)}）
              </option>
            ))}
            <option value={CUSTOM}>自訂費率…</option>
          </select>
          {choice === CUSTOM && (
            <input
              id={`${uid}-custom`}
              aria-label="自訂手續費率"
              className="fee-settings-custom"
              type="number"
              step="any"
              min="0"
              max="0.99"
              value={customInput}
              placeholder="例如 0.0004275"
              onChange={(e) => setCustomInput(e.target.value)}
            />
          )}
          {hint?.discount && <span className="fee-rate-hint">{hint.discount}</span>}
          {hint?.warning && <span className="fee-rate-warning">{hint.warning}</span>}
          <div className="field-hint">和券商約定的電子下單折扣。新增交易會用它帶入手續費。</div>

          <label className="fee-settings-from-label" htmlFor={`${uid}-from`}>
            從哪天開始用這個折扣
          </label>
          <input
            id={`${uid}-from`}
            type="date"
            value={from}
            max="2999-12-31"
            onChange={(e) => setFrom(e.target.value)}
          />
          <div className="field-hint">
            這天（含）之後的交易用新折扣，之前的維持原本的，批次重算也不會動到它們。
            券商從月初才生效就填那天；要連舊交易一起改，把日期往前填。
          </div>
          {!fromValid && <span className="fee-rate-warning">請選一個日期。</span>}
          {futureFrom && (
            <span className="fee-rate-hint">還沒生效，總覽的數字要到 {from} 才會改用這個折扣。</span>
          )}

          {(history.length > 0 || base !== null) && (
            <div className="fee-history">
              <h3>費率變更紀錄</h3>
              <ul>
                {[...history].reverse().map((seg) => (
                  <li key={seg.from}>
                    <span className="fee-history-from">{seg.from} 起</span>
                    <span className="fee-history-rate">
                      {feeDiscountLabel(seg.rate)}
                      <small>{formatFeeRatePct(seg.rate)}</small>
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={saving}
                      onClick={() => void removeSegment(seg.from)}
                    >
                      刪除
                    </button>
                  </li>
                ))}
                {base !== null && (
                  <li className="fee-history-base">
                    <span className="fee-history-from">
                      {history.length > 0 ? `${history[0].from} 之前` : '一直以來'}
                    </span>
                    <span className="fee-history-rate">
                      {feeDiscountLabel(base)}
                      <small>{formatFeeRatePct(base)}</small>
                    </span>
                  </li>
                )}
              </ul>
              {history.length > 0 && (
                <div className="field-hint">刪除一段，那段期間的交易就回到上一個折扣。</div>
              )}
            </div>
          )}
        </div>

        <div className="fee-settings-methods">
          <fieldset className="fee-settings-rebate" disabled={noDiscount}>
            <legend>折扣怎麼退給你</legend>
            <label className="fee-settings-radio">
              <input
                type="radio"
                name={`${uid}-rebate`}
                value="instant"
                checked={rebate === 'instant'}
                onChange={() => setRebate('instant')}
              />
              <b>現折</b>
              <span>成交當下就用折扣後的費率收。</span>
            </label>
            <label className="fee-settings-radio">
              <input
                type="radio"
                name={`${uid}-rebate`}
                value="monthly"
                checked={rebate === 'monthly'}
                onChange={() => setRebate('monthly')}
              />
              <b>月退</b>
              <span>先收全額 {formatFeeRatePct(DEFAULT_FEE_RATE)}，之後再退差額。</span>
            </label>
          </fieldset>

          <fieldset className="fee-settings-rebate">
            <legend>分批買進時，預扣的費用怎麼算</legend>
            <label className="fee-settings-radio">
              <input
                type="radio"
                name={`${uid}-rounding`}
                value="lot"
                checked={rounding === 'lot'}
                onChange={() => setRounding('lot')}
              />
              <b>每一批分開算</b>
              <span>每批各自算手續費和證交稅再捨去零頭，例如玉山。</span>
            </label>
            <label className="fee-settings-radio">
              <input
                type="radio"
                name={`${uid}-rounding`}
                value="position"
                checked={rounding === 'position'}
                onChange={() => setRounding('position')}
              />
              <b>整筆一起算</b>
              <span>同一檔股票合在一起算一次再捨去零頭，例如元大。</span>
            </label>
            <div className="field-hint">兩種算法每批最多差 1 元，選和你的券商 App 一樣的就好。</div>
          </fieldset>
        </div>

        <div className="fee-settings-result" aria-live="polite">
          <h3>總覽的未實現淨損益會這樣算</h3>
          <p>{rateValid ? explain(rate, rebate) : '請輸入 0 到 1 之間的費率。'}</p>
          <p className="field-hint">這個算法跟著手續費設定走，不需要另外選。不含費用的數字在每檔股票的明細裡都看得到。</p>
          {onPreview && (
            <p className="field-hint">總覽的數字會跟著這裡的選擇先預覽；按「儲存」才會生效，按「取消」就回到原本的設定。</p>
          )}
        </div>
      </div>
      <div className="fee-settings-actions">
        <button type="submit" className="btn btn-primary" disabled={!rateValid || saving}>
          {saving ? '儲存中…' : '儲存'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          取消
        </button>
      </div>
    </form>
  )
}
