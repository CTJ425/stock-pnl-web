/**
 * The workspace's fee settings: the discount and how the broker hands it back (現折 / 月退).
 *
 * One form, two homes (2026-09-26 redesign): the dashboard opens it in place from the
 * 未實現淨損益 basis line, and the workspace menu opens it in a modal. Both write the same two
 * fields, and the dashboard derives its P&L basis from them (utils/pnlBasis), so there is no
 * second "basis" setting that could disagree with the fee rate.
 */
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import type { FeeRebate } from '../types/models'
import { COMMON_FEE_RATES, DEFAULT_FEE_RATE } from '../utils/fees'
import { describeTwFeeRate } from '../utils/feeRateHint'
import { basisLabel, formatFeeRatePct, pnlBasis } from '../utils/pnlBasis'
import { getFeeRate } from '../utils/settings'

const CUSTOM = 'custom'

function discountName(rate: number): string {
  if (rate === DEFAULT_FEE_RATE) return '不打折'
  if (rate === 0) return '免手續費'
  return `${Math.round((rate / DEFAULT_FEE_RATE) * 1000) / 100} 折`
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
}: {
  onClose: () => void
  /** Called after a save; `rateChanged` lets the caller offer to recalculate recorded fees. */
  onSaved?: (result: { rateChanged: boolean }) => void
  /** The modal already carries a title; the in-page panel needs its own. */
  showTitle?: boolean
}) {
  const { current, setWorkspaceFeeRate, setWorkspaceFeeRebate } = useWorkspace()
  const uid = useId()
  const savedRate = getFeeRate(current?.id)
  const savedRebate: FeeRebate = current?.fee_rebate ?? 'instant'
  const isCommon = COMMON_FEE_RATES.includes(savedRate)
  const [choice, setChoice] = useState<string>(isCommon ? String(savedRate) : CUSTOM)
  const [customInput, setCustomInput] = useState(isCommon ? '' : String(savedRate))
  const [rebate, setRebate] = useState<FeeRebate>(savedRebate)
  const [saving, setSaving] = useState(false)

  const rate = choice === CUSTOM ? parseFloat(customInput) : Number(choice)
  const rateValid = Number.isFinite(rate) && rate >= 0 && rate < 1
  const noDiscount = rateValid && rate >= DEFAULT_FEE_RATE
  const hint = choice === CUSTOM ? describeTwFeeRate(rate) : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!current || !rateValid || saving) return
    setSaving(true)
    const rateChanged = rate !== savedRate
    if (rateChanged) await setWorkspaceFeeRate(current.id, rate)
    if (rebate !== (current.fee_rebate ?? 'instant')) await setWorkspaceFeeRebate(current.id, rebate)
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
                {discountName(r)}（{formatFeeRatePct(r)}）
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
        </div>

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

        <div className="fee-settings-result" aria-live="polite">
          <h3>總覽的未實現淨損益會這樣算</h3>
          <p>{rateValid ? explain(rate, rebate) : '請輸入 0 到 1 之間的費率。'}</p>
          <p className="field-hint">這個算法跟著手續費設定走，不需要另外選。不含費用的數字在每檔股票的明細裡都看得到。</p>
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
