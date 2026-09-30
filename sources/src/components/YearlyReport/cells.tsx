/**
 * The number cells shared by 年度收益 and 區間收益 (Task 176). Both tables print money the same way —
 * one fee-inclusive figure, a muted "—" where a row has no activity, the 未含費 sub-line only on the
 * deepest sell rows — so the rules live here instead of being restated per table.
 */
import type { Currency } from '../../types/models'
import { fmtMoney, fmtSignedMoney, fmtSignedPercent, pnlClass } from '../../utils/formatters'

/** Amount cell: main number (including fees and taxes) + side row (excluding fees), isomorphic to the average cost of the inventory overview*/
export function AmountCell({
  value,
  raw,
  currency,
  signed,
  rawLabel = '未含費',
  showRaw = false,
}: {
  value: number
  raw: number
  currency: Currency
  signed?: boolean
  rawLabel?: string
  /** Only the sell rows print the fee-exclusive line (see the file header). */
  showRaw?: boolean
}) {
  // When there is no corresponding entry or exit in the year (such as the three sell columns of "Buy Only" stocks), the whole box displays "—":
  // This is true only if both the fee-inclusive and the non-inclusive fees are 0 at the same time. A truly even sale will still have an uninclusive amount due to the fee difference, so there will be no misjudgment.
  const hasActivity = value !== 0 || raw !== 0
  if (!hasActivity) {
    return <td className="num" style={{ color: 'var(--ink-muted)', opacity: 0.5 }}>—</td>
  }
  return (
    <td className={signed ? `num ${pnlClass(value)}` : 'num'}>
      <div style={{ fontWeight: signed ? 600 : undefined }}>
        {signed ? fmtSignedMoney(value, currency) : fmtMoney(value, currency)}
      </div>
      {showRaw && (
        <div className="cell-sub">
          {rawLabel} {signed ? fmtSignedMoney(raw, currency) : fmtMoney(raw, currency)}
        </div>
      )}
    </td>
  )
}

/**
 * Return rate cell: realized profit and loss ÷ selling cost, the main row includes fees and the sub-row does not include fees (the same format as the three columns on the left).
 *
 * When the denominator is 0, give null instead of counting: the cost and profit and loss of "only buy" stocks are both 0 (0/0 = NaN),
 * "Oversold" means the cost is calculated at 0 but there is profit and loss (x/0 = Infinity) - neither of which is a percentage that can be displayed.
 */
export function RoiCell({
  realized,
  costBasis,
  raw,
  rawCostBasis,
  showRaw = false,
}: {
  realized: number
  costBasis: number
  raw: number
  rawCostBasis: number
  showRaw?: boolean
}) {
  const roi = costBasis !== 0 ? realized / costBasis : null
  const rawRoi = rawCostBasis !== 0 ? raw / rawCostBasis : null
  if (roi === null && rawRoi === null) {
    return <td className="num" style={{ color: 'var(--ink-muted)', opacity: 0.5 }}>—</td>
  }
  return (
    <td className={`num ${pnlClass(roi)}`}>
      <div style={{ fontWeight: 600 }}>{roi === null ? '—' : fmtSignedPercent(roi)}</div>
      {showRaw && <div className="cell-sub">未含費 {rawRoi === null ? '—' : fmtSignedPercent(rawRoi)}</div>}
    </td>
  )
}

/**
 * 手續費 and 交易稅 as two columns (2026-09-28, at the owner's request): the tax is the part of
 * `fees` backed out from the statutory rate, the brokerage fee is the rest. A zero prints the muted
 * dash (US stocks and buy-only rows pay no tax). TW figures print as whole dollars, USD with cents.
 */
export function FeeCells({ fees, feesTax, currency }: { fees: number; feesTax: number; currency: Currency }) {
  const brokerage = fees - feesTax
  return (
    <>
      {brokerage === 0 ? <MutedDashCell /> : <td className="num">{fmtMoney(brokerage, currency)}</td>}
      {feesTax === 0 ? <MutedDashCell /> : <td className="num">{fmtMoney(feesTax, currency)}</td>}
    </>
  )
}

/** Muted "—" placeholder, isomorphic to the empty-activity cells above (Task 166 EN-01 / DA-07). */
export function MutedDashCell() {
  return <td className="num" style={{ color: 'var(--ink-muted)', opacity: 0.5 }}>—</td>
}

/** Net dividend cell: a plain amount, already net of the withholding fee (price*qty − fee_tax); "—" when this row received none. */
export function DividendCell({ value, currency }: { value: number; currency: Currency }) {
  if (value === 0) return <MutedDashCell />
  return <td className="num">{fmtMoney(value, currency)}</td>
}

/**
 * Total return cell: 已實現損益 + 股利 (EN-01). Valid on any row whose scope owns the dividends it is
 * given — the yearly table's year rows, and 區間收益's per-ticker rows. Never on a sell-leg row:
 * dividends are booked per ticker, not per sale, so a leg row must render "—" instead (`MutedDashCell`),
 * or the same dividend is counted once per leg of that ticker.
 */
export function TotalReturnCell({ realized, dividends, currency }: { realized: number; dividends: number; currency: Currency }) {
  if (realized === 0 && dividends === 0) return <MutedDashCell />
  const total = realized + dividends
  return (
    <td className={`num ${pnlClass(total)}`} style={{ fontWeight: 600 }}>
      {fmtSignedMoney(total, currency)}
    </td>
  )
}

