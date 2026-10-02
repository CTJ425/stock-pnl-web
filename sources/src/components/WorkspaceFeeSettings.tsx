/**
 * The workspace's fee settings: the discount and how the broker hands it back (現折 / 月退).
 *
 * One form, two homes (2026-09-26 redesign): the dashboard opens it in place from the
 * 未實現淨損益 basis line, and the workspace menu opens it in a modal. Both write the same
 * fields (plus the fee/tax flooring, BUG-088). Task 189 split the P&L basis off the rebate: the
 * rebate says what settlement charged (a broker publishes it), the sell-fee basis what the app
 * withholds on a sell (only the app shows it), and 元大 is 日退 yet withholds the posted rate.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useWorkspace } from '../context/WorkspaceContext'
import type { FeeRateSegment, FeeRebate, FeeRounding, SellFeeBasis } from '../types/models'
import { COMMON_FEE_RATES, DEFAULT_FEE_RATE } from '../utils/fees'
import { describeTwFeeRate, feeDiscountLabel } from '../utils/feeRateHint'
import {
  normalizeFeeRateHistory,
  rateOn,
  withFeeRateFrom,
  withoutFeeRateFrom,
} from '../utils/feeRateHistory'
import { defaultSellFeeBasis, formatFeeRatePct, pnlBasis } from '../utils/pnlBasis'
import { taipeiDateKey } from '../utils/taipeiDate'
import { getFeeRateHistory, getStoredFeeRate } from '../utils/settings'

const CUSTOM = 'custom'

/**
 * Which rebate a workspace gets before the user has ever chosen. A discount below the list price
 * is normally refunded monthly, so that is the default; at the list price there is nothing to
 * refund and 現折 is the honest description. See the effect in the form for when it re-applies.
 */
function defaultRebate(rate: number): FeeRebate {
  return Number.isFinite(rate) && rate < DEFAULT_FEE_RATE ? 'monthly' : 'instant'
}

/** How a broker app estimates unrealized P&L: the four settings a preset fills in. */
interface Method {
  rebate: FeeRebate
  sellBasis: SellFeeBasis
  rounding: FeeRounding
  dayTradeTax: boolean
}

/**
 * Brokers whose app was reconciled against this app to the dollar. A preset only fills the same four
 * fields the radios below write; nothing new is stored, and the choice shown is derived from them.
 * - 玉山: 月退 (official: 「於次月13日退回折讓金」, esunsec.com.tw/campaign/trade-fee); posted-rate sell,
 *   per-lot flooring (BUG-088) and the halved 當沖 tax on a lot bought today (BUG-087), all from its app.
 * - 元大: discount charged at settlement — its app keeps the recorded fee in cost (Task 189, PROD
 *   Ron的投資組合); posted-rate sell and whole-position flooring (BUG-088); full tax on a lot bought
 *   today (BUG-090).
 */
const BROKER_PRESETS: ReadonlyArray<{ key: string; label: string; method: Method }> = [
  { key: 'esun', label: '玉山', method: { rebate: 'monthly', sellBasis: 'list', rounding: 'lot', dayTradeTax: true } },
  { key: 'yuanta', label: '元大', method: { rebate: 'instant', sellBasis: 'list', rounding: 'position', dayTradeTax: false } },
]
const CUSTOM_BROKER = 'custom'

function matchPreset(m: Method): string | null {
  const hit = BROKER_PRESETS.find(
    (p) =>
      p.method.rebate === m.rebate &&
      p.method.sellBasis === m.sellBasis &&
      p.method.rounding === m.rounding &&
      p.method.dayTradeTax === m.dayTradeTax,
  )
  return hit?.key ?? null
}

/** The four choices in one line, e.g. 「月退・賣出用牌告預扣・每一批分開算・當天買的用當沖稅率」. */
function describeMethod(m: Method): string {
  return [
    m.rebate === 'monthly' ? '月退' : '現折／日退',
    m.sellBasis === 'list' ? '賣出用牌告預扣' : '賣出用折扣後預扣',
    m.rounding === 'lot' ? '每一批分開算' : '整筆一起算',
    m.dayTradeTax ? '當天買的用當沖稅率' : '當天買的用完整稅率',
  ].join('・')
}

/** The form's unsaved values, handed to the dashboard so its figures can be previewed before saving. */
export interface FeeDraft {
  rate: number
  rebate: FeeRebate
  rounding: FeeRounding
  /** BUG-090: whether a lot bought today is estimated at the halved 現股當沖 tax. */
  dayTradeTax: boolean
  /** Task 189: which rate the broker app withholds as the sell fee. */
  sellBasis: SellFeeBasis
}

function explain(rate: number, rebate: FeeRebate, sellBasis: SellFeeBasis): string {
  const basis = pnlBasis(rate, rebate, sellBasis)
  const list = formatFeeRatePct(DEFAULT_FEE_RATE)
  const sell =
    basis === 'list' || rate >= DEFAULT_FEE_RATE
      ? `台股用牌告 ${list} 預扣賣出手續費，再扣證交稅`
      : `台股用折扣後 ${formatFeeRatePct(rate)} 預扣賣出手續費，再扣證交稅`
  if (basis === 'list' && rebate === 'monthly') {
    return `${sell}；成本裡的買進手續費也用牌告 ${list} 算，因為月退在交割時先扣全額，券商 App 的成本就是這個數。`
  }
  return `${sell}；成本用你記錄的手續費。`
}

export function WorkspaceFeeSettings({
  onClose,
  onSaved,
  showTitle = true,
  onPreview,
  impact,
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
  /**
   * The figure the change moves, saved → previewed (the dashboard passes it). It sits in the action
   * bar, which stays on screen while the form scrolls, so the effect is visible at the moment of 儲存.
   */
  impact?: ReactNode
}) {
  const {
    current,
    setWorkspaceFeeRate,
    setWorkspaceFeeRateHistory,
    setWorkspaceFeeRebate,
    setWorkspaceFeeRounding,
    setWorkspaceDayTradeTaxEstimate,
    setWorkspaceSellFeeBasis,
  } = useWorkspace()
  const uid = useId()
  const today = useMemo(() => taipeiDateKey(new Date()), [])
  // The history as stored, and the draft the list edits. 「刪除」 and the base row's 「改」 used to
  // write straight to the database, although the panel promises that nothing applies until 儲存
  // and that 取消 restores the old settings — so a deleted period was gone for good the moment the
  // button was pressed, on a production workspace with no way back (BUG-108). Both now edit the
  // draft; `submit` writes it.
  const [savedHistory, setSavedHistory] = useState<FeeRateSegment[]>(() => getFeeRateHistory(current?.id))
  const [history, setHistory] = useState<FeeRateSegment[]>(savedHistory)
  useEffect(() => {
    const stored = getFeeRateHistory(current?.id)
    setSavedHistory(stored)
    setHistory(stored)
  }, [current?.id])
  // The rate before the first segment. Null means this workspace has never had one, which is the
  // only case where saving writes the base instead of opening a new period (see `submit`).
  const savedBase = getStoredFeeRate(current?.id) ?? current?.fee_rate ?? null
  // The base row's unsaved value (null = untouched); `base` is what the list and the maths use.
  const [baseDraft, setBaseDraft] = useState<number | null>(null)
  const base = baseDraft ?? savedBase
  const savedRate = rateOn(savedHistory, savedBase, today, DEFAULT_FEE_RATE)
  // Null means the user has never chosen, which is what lets the discount pick the default below.
  const savedRebate: FeeRebate | null = current?.fee_rebate ?? null
  // A stored value that is only what the default would have produced is not a decision the user
  // made, and must not pin the workspace to 現折 once a discount is negotiated later. Only a stored
  // value that disagrees with the default counts as chosen.
  const rebateChosen = savedRebate !== null && savedRebate !== defaultRebate(savedRate)
  const isCommon = COMMON_FEE_RATES.includes(savedRate)
  const [choice, setChoice] = useState<string>(isCommon ? String(savedRate) : CUSTOM)
  const [customInput, setCustomInput] = useState(isCommon ? '' : String(savedRate))
  const [from, setFrom] = useState(today)
  const [rebate, setRebate] = useState<FeeRebate>(savedRebate ?? defaultRebate(savedRate))
  const [rounding, setRounding] = useState<FeeRounding>(current?.fee_rounding ?? 'lot')
  // Task 189: null means never chosen. Such a workspace starts from the rule the dashboard used
  // before the split, so opening and saving the form does not move its figures.
  const savedSellBasis: SellFeeBasis | null = current?.sell_fee_basis ?? null
  const [sellBasis, setSellBasis] = useState<SellFeeBasis>(
    savedSellBasis ?? defaultSellFeeBasis(savedRate, current?.fee_rebate),
  )
  // A workspace that has saved either setting before keeps its sell basis put while the rebate
  // changes — they are separate facts now, and 元大 (日退, posted-rate sell) needs exactly that.
  const sellBasisChosen = savedSellBasis !== null || savedRebate !== null
  const sellManual = useRef(false)
  // The broker choice is derived from the four settings, never stored. A workspace that never saved
  // any of them shows no broker picked, so a default that happens to equal 玉山 is not presented as
  // the user's choice.
  const methodSaved =
    current?.fee_rebate != null ||
    current?.sell_fee_basis != null ||
    current?.fee_rounding != null ||
    current?.day_trade_tax_estimate != null
  const [methodTouched, setMethodTouched] = useState(false)
  const [customPicked, setCustomPicked] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  // BUG-090: null keeps the BUG-087 behaviour (玉山 halves the tax on a lot bought today).
  const [dayTradeTax, setDayTradeTax] = useState<boolean>(current?.day_trade_tax_estimate ?? true)
  const [saving, setSaving] = useState(false)
  // The base row's inline editor (null = not editing). Without it a workspace whose base is
  // already the discounted rate has no way to say "before that date I paid the list price":
  // saving the same rate from a date is not a change, so `normalizeFeeRateHistory` drops it.
  const [baseEdit, setBaseEdit] = useState<string | null>(null)
  // Once the user picks a side themselves, the discount stops choosing for them.
  const rebateManual = useRef(false)
  // Once the user picks a discount themselves, a history edit stops moving the select (see `followDraft`).
  const choiceManual = useRef(false)

  const method: Method = { rebate, sellBasis, rounding, dayTradeTax }
  const broker = customPicked ? CUSTOM_BROKER : !methodSaved && !methodTouched ? null : (matchPreset(method) ?? CUSTOM_BROKER)
  const showDetail = broker === CUSTOM_BROKER || detailOpen
  const onPreset = broker !== null && broker !== CUSTOM_BROKER

  const applyPreset = (m: Method) => {
    rebateManual.current = true
    sellManual.current = true
    setRebate(m.rebate)
    setSellBasis(m.sellBasis)
    setRounding(m.rounding)
    setDayTradeTax(m.dayTradeTax)
    setMethodTouched(true)
    setCustomPicked(false)
    setDetailOpen(false)
  }

  const rate = choice === CUSTOM ? parseFloat(customInput) : Number(choice)
  const rateValid = Number.isFinite(rate) && rate >= 0 && rate < 1
  const fromValid = /^\d{4}-\d{2}-\d{2}$/.test(from)
  const hint = choice === CUSTOM ? describeTwFeeRate(rate) : null
  // What this workspace charged on the chosen date, before this form's unsaved change.
  const rateBefore = fromValid ? rateOn(history, base, from, DEFAULT_FEE_RATE) : savedRate
  const futureFrom = fromValid && from > today

  useEffect(() => {
    // A negotiated discount is almost always handed back monthly (the broker bills the list price
    // and refunds the difference), and that is also the only setting under which the dashboard
    // agrees with the broker's app. So picking a discount defaults to 月退 and dropping back to the
    // list price defaults to 現折 — until the user touches the radios, or had already chosen once.
    // A broker preset (picked now or saved) is a choice too: changing the discount must not move
    // 玉山 or 元大 off its 月退／日退, at the list price included (the user, 2026-10-02).
    if (rebateManual.current || rebateChosen || onPreset || !rateValid) return
    setRebate(defaultRebate(rate))
  }, [rate, rateValid, rebateChosen, onPreset])

  useEffect(() => {
    // A workspace that never saved fee settings keeps the pre-Task-189 pairing until the user picks:
    // a discount refunded monthly withholds the posted rate, as 玉山 and 元大 both do.
    if (sellManual.current || sellBasisChosen || !rateValid) return
    setSellBasis(defaultSellFeeBasis(rate, rebate))
  }, [rate, rateValid, rebate, sellBasisChosen])

  useEffect(() => {
    // A future effective date changes nothing the dashboard shows today, so it previews the rate
    // still in force rather than one that has not started.
    const previewRate = futureFrom ? savedRate : rate
    onPreview?.(rateValid ? { rate: previewRate, rebate, rounding, dayTradeTax, sellBasis } : null)
  }, [onPreview, rate, rateValid, rebate, rounding, dayTradeTax, sellBasis, futureFrom, savedRate])
  // Closing the form (saved or not) ends the preview; the dashboard falls back to the saved values.
  useEffect(() => () => onPreview?.(null), [onPreview])

  /**
   * The select is "the discount from this date on". After a history edit, leaving it on the old
   * rate would make 儲存 see a change and open a new period from today — re-adding the very
   * discount just deleted. So until the user picks one, it follows the draft's rate for today.
   */
  const followDraft = (draft: FeeRateSegment[], draftBase: number | null) => {
    if (choiceManual.current) return
    const r = rateOn(draft, draftBase, today, DEFAULT_FEE_RATE)
    const common = COMMON_FEE_RATES.includes(r)
    setChoice(common ? String(r) : CUSTOM)
    setCustomInput(common ? '' : String(r))
  }

  const removeSegment = (segFrom: string) => {
    const next = withoutFeeRateFrom(history, base, segFrom)
    setHistory(next)
    followDraft(next, base)
  }

  /** Rewrites the rate that applied before the first segment (in the draft); see `baseEdit`. */
  const applyBase = () => {
    if (baseEdit === null) return
    const next = Number(baseEdit)
    if (!Number.isFinite(next) || next < 0 || next >= 1) return
    setBaseDraft(next)
    // A segment that merely repeats the new base is no longer a change of agreement. Re-normalise
    // against it so the list keeps saying only what actually changed.
    const normalized = normalizeFeeRateHistory(history, next)
    setHistory(normalized)
    setBaseEdit(null)
    followDraft(normalized, next)
  }

  const baseChanged = baseDraft !== null && baseDraft !== savedBase
  const historyChanged = JSON.stringify(history) !== JSON.stringify(savedHistory)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!current || !rateValid || !fromValid || saving) return
    setSaving(true)
    if (baseChanged) await setWorkspaceFeeRate(current.id, baseDraft)
    let nextHistory = history
    const rateChanged = rate !== rateBefore
    if (rateChanged) {
      if (base === null && history.length === 0 && from === today) {
        // Task 182: the workspace's first rate, saved with the date left alone, is not a change of
        // agreement — there is no earlier period for a segment to end. It becomes the base, so
        // every transaction already recorded is priced under it.
        await setWorkspaceFeeRate(current.id, rate)
      } else {
        // A date the user moved is a statement about an earlier period, even on a workspace that
        // has no rate yet: before it, the broker charged something else. Writing the list price as
        // the base says that explicitly, so the segment is not silently applied to the whole
        // ledger — which is what re-pricing every past trade at today's discount used to do.
        if (base === null && history.length === 0) {
          await setWorkspaceFeeRate(current.id, DEFAULT_FEE_RATE)
        }
        nextHistory = withFeeRateFrom(history, base ?? DEFAULT_FEE_RATE, from, rate)
      }
    }
    // A workspace that never had a rate and is saved at the list price is a decision too: without
    // a stored base it would read 「手續費折扣未設定」 on the dashboard for good.
    if (!rateChanged && base === null && nextHistory.length === 0) {
      await setWorkspaceFeeRate(current.id, rate)
    }
    if (JSON.stringify(nextHistory) !== JSON.stringify(savedHistory)) {
      await setWorkspaceFeeRateHistory(current.id, nextHistory)
    }
    if (rebate !== savedRebate) await setWorkspaceFeeRebate(current.id, rebate)
    if (rounding !== (current.fee_rounding ?? 'lot')) await setWorkspaceFeeRounding(current.id, rounding)
    if (dayTradeTax !== (current.day_trade_tax_estimate ?? true))
      await setWorkspaceDayTradeTaxEstimate(current.id, dayTradeTax)
    if (sellBasis !== savedSellBasis) await setWorkspaceSellFeeBasis(current.id, sellBasis)
    setSaving(false)
    // An edited history or base re-prices past periods just as a new rate does.
    onSaved?.({ rateChanged: rateChanged || historyChanged || baseChanged })
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
          <select
            id={`${uid}-rate`}
            value={choice}
            autoFocus
            onChange={(e) => {
              choiceManual.current = true
              setChoice(e.target.value)
            }}
          >
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
              onChange={(e) => {
                choiceManual.current = true
                setCustomInput(e.target.value)
              }}
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
                      onClick={() => removeSegment(seg.from)}
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
                    {baseEdit === null ? (
                      <>
                        <span className="fee-history-rate">
                          {feeDiscountLabel(base)}
                          <small>{formatFeeRatePct(base)}</small>
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={saving}
                          onClick={() => setBaseEdit(String(base))}
                        >
                          改
                        </button>
                      </>
                    ) : (
                      <>
                        <select
                          aria-label="更早之前的費率"
                          value={baseEdit}
                          onChange={(e) => setBaseEdit(e.target.value)}
                        >
                          {/* A base outside the list (a custom rate) would otherwise open the
                              editor on a blank selection, hiding what it is about to replace. */}
                          {(COMMON_FEE_RATES.includes(base) ? COMMON_FEE_RATES : [base, ...COMMON_FEE_RATES]).map((r) => (
                            <option key={r} value={String(r)}>
                              {feeDiscountLabel(r)}（{formatFeeRatePct(r)}）
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={saving}
                          onClick={applyBase}
                        >
                          確定
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={saving}
                          onClick={() => setBaseEdit(null)}
                        >
                          取消
                        </button>
                      </>
                    )}
                  </li>
                )}
              </ul>
              {(historyChanged || baseChanged) && (
                <span className="fee-rate-hint" role="status">
                  變更紀錄改過了，按「儲存」才會生效；按「取消」就恢復原本的紀錄。
                </span>
              )}
              <div className="field-hint">
                {history.length > 0 && '刪除一段，那段期間的交易就回到上一個折扣。'}
                最後一列是更早之前的費率，按「改」可以修正它——例如以前沒打折，就改成「不打折」。
              </div>
            </div>
          )}
        </div>

        <div className="fee-settings-methods">
          <fieldset className="fee-settings-broker">
            <legend>你的券商 App 怎麼算</legend>
            <div className="fee-broker-options">
              {BROKER_PRESETS.map((p) => (
                <label key={p.key} className="fee-broker-option">
                  <input
                    type="radio"
                    name={`${uid}-broker`}
                    value={p.key}
                    checked={broker === p.key}
                    onChange={() => applyPreset(p.method)}
                  />
                  {p.label}
                </label>
              ))}
              <label className="fee-broker-option">
                <input
                  type="radio"
                  name={`${uid}-broker`}
                  value={CUSTOM_BROKER}
                  checked={broker === CUSTOM_BROKER}
                  onChange={() => {
                    setCustomPicked(true)
                    setMethodTouched(true)
                  }}
                />
                其他券商／自訂
              </label>
            </div>
            {broker !== CUSTOM_BROKER && (
              <div className="fee-broker-summary">
                <p>
                  {broker === null && '還沒選券商，目前用：'}
                  {describeMethod(method)}
                </p>
                <button
                  type="button"
                  className="fee-detail-toggle"
                  aria-expanded={showDetail}
                  aria-controls={`${uid}-detail`}
                  onClick={() => setDetailOpen((v) => !v)}
                >
                  {showDetail ? '收起單項' : '改單項'}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </div>
            )}
            <div className="field-hint">
              玉山、元大是拿 App 逐檔對過的算法。其他券商選「自訂」，再拿 App 上一檔股票的未實現損益對一下。
            </div>
          </fieldset>

          {showDetail && (
            <div className="fee-settings-detail" id={`${uid}-detail`}>
              <fieldset className="fee-settings-rebate">
                <legend>折扣怎麼退給你</legend>
                <label className="fee-settings-radio">
                  <input
                    type="radio"
                    name={`${uid}-rebate`}
                    value="instant"
                    checked={rebate === 'instant'}
                    onChange={() => {
                      rebateManual.current = true
                      setMethodTouched(true)
                      setRebate('instant')
                    }}
                  />
                  <b>現折／日退</b>
                  <span>交割時就只扣折扣後的手續費。</span>
                </label>
                <label className="fee-settings-radio">
                  <input
                    type="radio"
                    name={`${uid}-rebate`}
                    value="monthly"
                    checked={rebate === 'monthly'}
                    onChange={() => {
                      rebateManual.current = true
                      setMethodTouched(true)
                      setRebate('monthly')
                    }}
                  />
                  <b>月退</b>
                  <span>
                    交割時先扣全額 {formatFeeRatePct(DEFAULT_FEE_RATE)}，下個月再退差額，例如玉山、永豐。券商 App
                    的成本會含全額手續費。
                  </span>
                </label>
                <div className="field-hint">看券商的手續費公告或交割明細：交割時扣的是全額就是月退。</div>
              </fieldset>

              <fieldset className="fee-settings-rebate">
                <legend>券商 App 預扣賣出手續費用哪個費率</legend>
                <label className="fee-settings-radio">
                  <input
                    type="radio"
                    name={`${uid}-sellbasis`}
                    value="list"
                    checked={sellBasis === 'list'}
                    onChange={() => {
                      sellManual.current = true
                      setMethodTouched(true)
                      setSellBasis('list')
                    }}
                  />
                  <b>牌告 {formatFeeRatePct(DEFAULT_FEE_RATE)}</b>
                  <span>不管折扣多少都用全額估，例如玉山、元大。</span>
                </label>
                <label className="fee-settings-radio">
                  <input
                    type="radio"
                    name={`${uid}-sellbasis`}
                    value="net"
                    checked={sellBasis === 'net'}
                    onChange={() => {
                      sellManual.current = true
                      setMethodTouched(true)
                      setSellBasis('net')
                    }}
                  />
                  <b>折扣後</b>
                  <span>用你的折扣費率估。</span>
                </label>
                <div className="field-hint">
                  券商通常不公告這一點，拿 App 上一檔股票的未實現損益對一下就知道。
                </div>
              </fieldset>

              <fieldset className="fee-settings-rebate">
                <legend>分批買進時，預扣的費用怎麼算</legend>
                <label className="fee-settings-radio">
                  <input
                    type="radio"
                    name={`${uid}-rounding`}
                    value="lot"
                    checked={rounding === 'lot'}
                    onChange={() => {
                      setMethodTouched(true)
                      setRounding('lot')
                    }}
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
                    onChange={() => {
                      setMethodTouched(true)
                      setRounding('position')
                    }}
                  />
                  <b>整筆一起算</b>
                  <span>同一檔股票合在一起算一次再捨去零頭，例如元大。</span>
                </label>
                <div className="field-hint">兩種算法每批最多差 1 元，選和你的券商 App 一樣的就好。</div>
              </fieldset>

              <fieldset className="fee-settings-rebate">
                <legend>今天剛買進的股票，證交稅怎麼估</legend>
                <label className="fee-settings-radio">
                  <input
                    type="radio"
                    name={`${uid}-daytradetax`}
                    value="half"
                    checked={dayTradeTax}
                    onChange={() => {
                      setMethodTouched(true)
                      setDayTradeTax(true)
                    }}
                  />
                  <b>當天用當沖稅率</b>
                  {/* BUG-097: §2-2 lowers the rate for 股票 only; an ETF day trade still pays 0.1%. */}
                  <span>當天買的股票先用當沖的 0.15% 估，隔天恢復 0.3%，例如玉山。ETF 當沖沒有降稅，一直是 0.1%。</span>
                </label>
                <label className="fee-settings-radio">
                  <input
                    type="radio"
                    name={`${uid}-daytradetax`}
                    value="full"
                    checked={!dayTradeTax}
                    onChange={() => {
                      setMethodTouched(true)
                      setDayTradeTax(false)
                    }}
                  />
                  <b>一律用完整稅率</b>
                  <span>不分買進日期都用 0.3%（ETF 0.1%），例如元大。</span>
                </label>
                <div className="field-hint">
                  只影響「牌告」那個口徑的預估，不影響已經成交的手續費。選錯會讓當天買進的股票看起來比券商 App 樂觀。
                </div>
              </fieldset>
            </div>
          )}
        </div>

        <div className="fee-settings-result" aria-live="polite">
          <h3>總覽的未實現淨損益會這樣算</h3>
          <p>{rateValid ? explain(rate, rebate, sellBasis) : '請輸入 0 到 1 之間的費率。'}</p>
          <p className="field-hint">三種算法的數字在每檔股票的明細裡都看得到。</p>
          {onPreview && (
            <p className="field-hint">總覽的數字會跟著這裡的選擇先預覽；按「儲存」才會生效，按「取消」就回到原本的設定。</p>
          )}
        </div>
      </div>
      <div className="fee-settings-actions">
        {impact && (
          <p className="fee-settings-impact" aria-live="polite">
            {impact}
          </p>
        )}
        <div className="fee-settings-buttons">
          <button type="submit" className="btn btn-primary" disabled={!rateValid || saving}>
            {saving ? '儲存中…' : '儲存'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </form>
  )
}
