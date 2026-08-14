/**
 * Chip page: the 三大法人 buy/sell matrix (法人 × 交易日, 0.7.6), margin trading, and the 7-day balance trend.
 * All data comes from the structured report returned by Edge Function, and this component is only responsible for presentation.
 *
 * 0.7.7 removed the 近 N 日買賣超 bar chart that used to sit under the table: once the matrix shows every
 * 法人 on every day at once, the chart was drawing the same numbers a second time.
 */
import { useState } from 'react'
import type {
  ChipLeg,
  InstitutionalChip,
  ReportData,
  SourceStamp,
} from '../../services/reportProxy'
import { LineSeriesChart } from '../Charts/LineSeriesChart'
import { CHART_COLORS } from '../Charts/chartColors'
import { SparkCell } from '../Charts/SparkCell'
import { streakAt } from './chipStreak'
import {
  chipClass,
  fmtBalanceStreak,
  fmtInt,
  fmtLotsFromShares,
  fmtLotsPlain,
  fmtSigned,
  fmtUpdatedAt,
  heatStyle,
  shortDate,
} from './chipFormat'

/**
 * The four components of the three major legal persons + total.
 * The total = the sum of the first four items (the official disclosure value of T86), so only the first four items are drawn when comparing side by side——
 * Drawing the total also equals to repeating the calculation for the same amount.
 */
const COMPONENTS = [
  { key: 'foreign', label: '外資（不含自營）', pick: (i: InstitutionalChip) => i.foreign },
  { key: 'foreignDealer', label: '外資自營商', pick: (i: InstitutionalChip) => i.foreignDealer },
  { key: 'trust', label: '投信', pick: (i: InstitutionalChip) => i.trust },
  { key: 'dealer', label: '自營商', pick: (i: InstitutionalChip) => i.dealer },
] as const

const TOTAL_ROW = {
  key: 'total',
  label: '三大法人合計',
  pick: (i: InstitutionalChip) => i.total,
} as const

const ROWS = [...COMPONENTS, TOTAL_ROW]

/**
 * Which leg the matrix cells show (0.7.6), mirroring the market-wide table on 總體經濟.
 *
 * 買進／賣出 used to be two permanent columns; the number anyone reads is the net. As a switch they cost
 * one control instead of two columns, which is what leaves room for seven day columns.
 */
type ChipMetric = 'net' | 'buy' | 'sell'

const METRICS: ReadonlyArray<{ id: ChipMetric; label: string }> = [
  { id: 'net', label: '買賣超' },
  { id: 'buy', label: '買進' },
  { id: 'sell', label: '賣出' },
]

type MarginMetric = 'summary' | 'trading' | 'redeem'

const MARGIN_METRICS: ReadonlyArray<{ id: MarginMetric; label: string }> = [
  { id: 'summary', label: '增減與餘額' },
  { id: 'trading', label: '買進與賣出' },
  { id: 'redeem', label: '償還明細' },
]

const TFOOT_SPARK_W = 76
const TFOOT_SPARK_H = 20

/**
 * Block-level data timestamp.
 *
 * Why each block is marked with one: The release times of the three data sources are very different (the three major legal persons are about 15:00–15:30,
 * (approximately 21:00–22:00 for margin trading and 21:00–22:30 for borrowing and lending), and batches are executed in stages——
 * The freshness of each block in the same report is inherently different, and giving only one time to the entire report would be misleading.
 */
function SourceTag({ stamp }: { stamp: SourceStamp | null | undefined }) {
  if (!stamp || (!stamp.date && !stamp.fetchedAt)) return null
  return (
    <span className="source-tag">
      {stamp.date && `資料日 ${stamp.date}`}
      {stamp.date && stamp.fetchedAt && ' · '}
      {stamp.fetchedAt && `更新於 ${fmtUpdatedAt(stamp.fetchedAt)}`}
    </span>
  )
}

/**
 * 走勢 column: 「連 N 買／連 N 賣」above the spark.
 *
 * The streak describes the **法人**, so it sits on that 法人's row —— it used to be a per-day column read off
 * whichever day the picker happened to be on.
 */


export function ChipsTab({ report }: { report: ReportData }) {
  const { institutional, margin, borrow, history } = report
  const lastIndex = history.length - 1
  const [metric, setMetric] = useState<ChipMetric>('net')
  const [marginMetric, setMarginMetric] = useState<MarginMetric>('summary')

  /*
    Columns of the matrix (0.7.6). Normally the 7-day history; when a report carries no history at all it
    falls back to the single latest day, which is what the day-picker version did in the same situation.
  */
  const instDays =
    history.length > 0
      ? history
      : institutional
        ? [{ date: report.dataDate, institutional }]
        : []
  const hasInst = instDays.some((d) => d.institutional)

  const marginDays =
    history.length > 0
      ? history
      : margin
        ? [{ date: report.dataDate, margin }]
        : []
  const hasMargin = marginDays.some((d) => d.margin !== null && d.margin !== undefined)

  // Margin series
  const marginChanges = marginDays.map((d) => d.margin?.marginChange ?? null)
  const marginTodays = marginDays.map((d) => d.margin?.marginToday ?? null)
  const shortChanges = marginDays.map((d) => d.margin?.shortChange ?? null)
  const shortTodays = marginDays.map((d) => d.margin?.shortToday ?? null)
  const offsets = marginDays.map((d) => d.margin?.offset ?? null)

  const marginBuys = marginDays.map((d) => d.margin?.marginBuy ?? null)
  const marginSells = marginDays.map((d) => d.margin?.marginSell ?? null)
  const shortBuys = marginDays.map((d) => d.margin?.shortBuy ?? null)
  const shortSells = marginDays.map((d) => d.margin?.shortSell ?? null)

  const marginRedeems = marginDays.map((d) => d.margin?.marginRedeem ?? null)
  const shortRedeems = marginDays.map((d) => d.margin?.shortRedeem ?? null)
  const marginLimits = marginDays.map((d) => d.margin?.marginLimit ?? null)
  const shortLimits = marginDays.map((d) => d.margin?.shortLimit ?? null)

  const maxMarginChange = Math.max(0, ...marginChanges.map((v) => (v === null ? 0 : Math.abs(v))))
  const maxShortChange = Math.max(0, ...shortChanges.map((v) => (v === null ? 0 : Math.abs(v))))

  const mStreak = marginStreak(history, 'marginChange', lastIndex)
  const sStreak = marginStreak(history, 'shortChange', lastIndex)

  const sumOf = (arr: Array<number | null>): number | null => {
    const nums = arr.filter((v): v is number => v !== null)
    return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0)
  }
  const latestOf = (arr: Array<number | null>): number | null => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] !== null && arr[i] !== undefined) return arr[i]
    }
    return null
  }

  const sparkColorOf = (arr: Array<number | null>): string => {
    const valid = arr.filter((v): v is number => v !== null)
    if (valid.length === 0) return CHART_COLORS.axis
    const last = valid[valid.length - 1]
    return last > 0 ? CHART_COLORS.up : last < 0 ? CHART_COLORS.down : CHART_COLORS.axis
  }

  /** Transactions of a certain column (legal person) in super sequence, from oldest to newest*/
  const netsOf = (pick: (i: InstitutionalChip) => ChipLeg): Array<number | null> =>
    history.map((d) => (d.institutional ? pick(d.institutional).net : null))

  /*
    One row per 法人 (0.7.6). Everything a row needs is computed here rather than inside the JSX: the day
    cells in lots, the row's own maximum for the tint, the N-day sum and the streak.

    Lots (張), not shares: a single stock's foreign net runs to eight digits in shares (+20,145,000), and
    seven of those side by side is a wall of digits. The exact share count is kept on each cell's `title`,
    so nothing is actually lost —— it just stops being the thing you have to read first.
  */
  const matrixRows = ROWS.map(({ key, label, pick }) => {
    const legs = instDays.map((d) => (d.institutional ? pick(d.institutional) : null))
    const values = legs.map((l) => (l === null ? null : (l[metric] ?? null)))
    const lots = values.map((v) => (v === null ? null : v / 1000))
    const rowMax = Math.max(0, ...lots.map((v) => (v === null ? 0 : Math.abs(v))))
    const known = values.filter((v): v is number => v !== null)
    // Streak and spark read the net regardless of which leg the cells show —— 「連 N 買」 is about direction,
    // and a gross buy leg has no direction to speak of.
    const nets = netsOf(pick)
    return {
      key,
      label,
      values,
      lots,
      rowMax,
      cum: known.length === 0 ? null : known.reduce((a, b) => a + b, 0),
      streak: streakAt(nets, nets.length - 1),
      nets,
    }
  })

  return (
    <>
      {/* The report header is inside the capture range so the downloaded PDF says which stock, which day and when it was produced */}
      <header className="rpt-head">
        <h2>
          {report.ticker} {report.name}｜盤後籌碼
        </h2>
        <div className="rpt-meta">
          資料日期 {report.dataDate}（最近交易日盤後）
          <span className="rpt-meta-sep">·</span>
          報告更新時間 {fmtUpdatedAt(report.generatedAt)}
        </div>
      </header>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>
            三大法人買賣超
            <SourceTag stamp={report.sources?.institutional} />
          </h3>
          <div className="inst-metric-seg" role="group" aria-label="切換金額口徑">
            {METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                className="btn btn-sm"
                aria-pressed={metric === m.id}
                onClick={() => setMetric(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {!hasInst ? (
          <p className="hint">查無此股當日資料。</p>
        ) : (
          <>
            {/*
              法人 × 日期 matrix (0.7.6), the same shape as 總體經濟 → 台股市場.

              It replaces 「一次看一天，用上面的日期鈕切換」: answering 「外資這幾天在買還是在賣」 used to mean
              clicking through up to seven days and remembering each number, and six of the seven days were
              one click away at all times. All of them are now on screen at once, so the day picker has
              nothing left to do and is gone.
            */}
            <div className="table-scroll">
              <table className="data-table inst-matrix" aria-label="三大法人買賣超矩陣">
                <thead>
                  <tr>
                    <th>日期</th>
                    {matrixRows.map((r) => (
                      <th
                        key={r.key}
                        className={`num ${r.key === 'total' ? 'col-total' : ''}`}
                      >
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...instDays].reverse().map((d, dRevIdx) => {
                    const originalIdx = instDays.length - 1 - dRevIdx
                    return (
                      <tr key={d.date}>
                        <td>{shortDate(d.date)}</td>
                        {matrixRows.map((r) => {
                          const v = r.lots[originalIdx]
                          const shareVal = r.values[originalIdx]
                          return (
                            <td
                              key={r.key}
                              /* Only the net is signed and coloured —— 買進／賣出 are gross and always positive. */
                              className={`num ${metric === 'net' ? chipClass(v) : ''} ${
                                r.key === 'total' ? 'col-total' : ''
                              }`}
                              style={metric === 'net' ? heatStyle(v, r.rowMax) : undefined}
                              title={
                                shareVal === null
                                  ? undefined
                                  : `${d.date} ${fmtInt(shareVal)} 股`
                              }
                            >
                              {metric === 'net'
                                ? fmtLotsFromShares(shareVal)
                                : fmtLotsPlain(shareVal)}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="tfoot-summary">
                    <td>{instDays.length} 日累計</td>
                    {matrixRows.map((r) => {
                      const s = r.streak
                      const isBuy = s > 0
                      const label = Math.abs(s) >= 2 ? `連 ${Math.abs(s)} ${isBuy ? '買' : '賣'}` : null
                      const validNets = r.nets.filter((v): v is number => v !== null)
                      const lastNet = validNets.length > 0 ? validNets[validNets.length - 1] : null
                      const sparkColor =
                        lastNet !== null && lastNet !== undefined
                          ? lastNet > 0
                            ? CHART_COLORS.up
                            : lastNet < 0
                              ? CHART_COLORS.down
                              : CHART_COLORS.axis
                          : CHART_COLORS.axis
                      return (
                        <td
                          key={r.key}
                          className={`num inst-matrix-cum ${metric === 'net' ? chipClass(r.cum) : ''} ${
                            r.key === 'total' ? 'col-total' : ''
                          }`}
                          title={r.cum === null ? undefined : `${fmtSigned(r.cum)} 股`}
                        >
                          <div>{metric === 'net' ? fmtLotsFromShares(r.cum) : fmtLotsPlain(r.cum)}</div>
                          <div className="tfoot-cum-trend">
                            <span
                              className={label ? chipClass(s) : 'hint'}
                              style={{ fontSize: 11, fontWeight: label ? 600 : undefined }}
                            >
                              {label ?? '—'}
                            </span>
                            <SparkCell
                              points={r.nets}
                              color={sparkColor}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel={`近 ${r.nets.length} 個交易日${r.label}買賣超走勢`}
                            />
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="hint">
              數字是<strong>約當張數</strong>（1 張 = 1000 股），滑鼠停在格子上可看確切股數。
              買賣超是買進減掉賣出，紅色代表法人當天買得比賣得多；底色深淺是該法人自己這幾天的相對強度。
              走勢圖讀取歷史交易日，走勢圖上方「連買連賣」算到最近交易日為止連續幾天同方向，看的一律是買賣超，不隨上方口徑改變。
            </p>
          </>
        )}
      </section>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>
            融資融券
            <SourceTag stamp={report.sources?.margin} />
          </h3>
          <div className="inst-metric-seg" role="group" aria-label="切換融資融券口徑">
            {MARGIN_METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                className="btn btn-sm"
                aria-pressed={marginMetric === m.id}
                onClick={() => setMarginMetric(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {!hasMargin ? (
          <p className="hint">
            今日融資融券尚未公布（約 21:00–22:00 才會有），稍晚的排程會自動補上。
            上方的三大法人不受影響 —— 它約 15:00–15:30 就公布了。
          </p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table inst-matrix" aria-label="融資融券矩陣">
                <thead>
                  {marginMetric === 'summary' && (
                    <tr>
                      <th>日期</th>
                      <th className="num">融資餘額（張）</th>
                      <th className="num">融資增減</th>
                      <th className="num">融券餘額（張）</th>
                      <th className="num">融券增減</th>
                      <th className="num">資券互抵</th>
                    </tr>
                  )}
                  {marginMetric === 'trading' && (
                    <tr>
                      <th>日期</th>
                      <th className="num">融資買進</th>
                      <th className="num">融資賣出</th>
                      <th className="num">融券買進（回補）</th>
                      <th className="num">融券賣出（放空）</th>
                      <th className="num">資券互抵</th>
                    </tr>
                  )}
                  {marginMetric === 'redeem' && (
                    <tr>
                      <th>日期</th>
                      <th className="num">融資現償</th>
                      <th className="num">融券券償</th>
                      <th className="num">融資限額</th>
                      <th className="num">融券限額</th>
                      <th className="num">資券互抵</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {[...marginDays].reverse().map((d) => {
                    const m = d.margin
                    return (
                      <tr key={d.date}>
                        <td>{shortDate(d.date)}</td>
                        {marginMetric === 'summary' && (
                          <>
                            <td className="num">{fmtInt(m?.marginToday)}</td>
                            <td
                              className={`num ${chipClass(m?.marginChange)}`}
                              style={heatStyle(m?.marginChange ?? null, maxMarginChange)}
                            >
                              {fmtSigned(m?.marginChange)}
                            </td>
                            <td className="num">{fmtInt(m?.shortToday)}</td>
                            <td
                              className={`num ${chipClass(m?.shortChange)}`}
                              style={heatStyle(m?.shortChange ?? null, maxShortChange)}
                            >
                              {fmtSigned(m?.shortChange)}
                            </td>
                            <td className="num">{fmtInt(m?.offset)}</td>
                          </>
                        )}
                        {marginMetric === 'trading' && (
                          <>
                            <td className="num">{fmtInt(m?.marginBuy)}</td>
                            <td className="num">{fmtInt(m?.marginSell)}</td>
                            <td className="num">{fmtInt(m?.shortBuy)}</td>
                            <td className="num">{fmtInt(m?.shortSell)}</td>
                            <td className="num">{fmtInt(m?.offset)}</td>
                          </>
                        )}
                        {marginMetric === 'redeem' && (
                          <>
                            <td className="num">{fmtInt(m?.marginRedeem)}</td>
                            <td className="num">{fmtInt(m?.shortRedeem)}</td>
                            <td className="num">{fmtInt(m?.marginLimit)}</td>
                            <td className="num">{fmtInt(m?.shortLimit)}</td>
                            <td className="num">{fmtInt(m?.offset)}</td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="tfoot-summary">
                    <td>{marginDays.length} 日統計</td>
                    {marginMetric === 'summary' && (
                      <>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(latestOf(marginTodays))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>餘額走勢</span>
                            <SparkCell
                              points={marginTodays}
                              color={CHART_COLORS.up}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="融資餘額走勢"
                            />
                          </div>
                        </td>
                        <td className={`num inst-matrix-cum ${chipClass(sumOf(marginChanges))}`}>
                          <div>{fmtSigned(sumOf(marginChanges))}</div>
                          <div className="tfoot-cum-trend">
                            <span
                              className={mStreak ? chipClass(mStreak) : 'hint'}
                              style={{ fontSize: 11, fontWeight: mStreak ? 600 : undefined }}
                            >
                              {fmtBalanceStreak(mStreak)}
                            </span>
                            <SparkCell
                              points={marginChanges}
                              color={sparkColorOf(marginChanges)}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="融資增減走勢"
                            />
                          </div>
                        </td>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(latestOf(shortTodays))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>餘額走勢</span>
                            <SparkCell
                              points={shortTodays}
                              color={CHART_COLORS.line}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="融券餘額走勢"
                            />
                          </div>
                        </td>
                        <td className={`num inst-matrix-cum ${chipClass(sumOf(shortChanges))}`}>
                          <div>{fmtSigned(sumOf(shortChanges))}</div>
                          <div className="tfoot-cum-trend">
                            <span
                              className={sStreak ? chipClass(sStreak) : 'hint'}
                              style={{ fontSize: 11, fontWeight: sStreak ? 600 : undefined }}
                            >
                              {fmtBalanceStreak(sStreak)}
                            </span>
                            <SparkCell
                              points={shortChanges}
                              color={sparkColorOf(shortChanges)}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="融券增減走勢"
                            />
                          </div>
                        </td>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(sumOf(offsets))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>互抵走勢</span>
                            <SparkCell
                              points={offsets}
                              color={CHART_COLORS.line}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="資券互抵走勢"
                            />
                          </div>
                        </td>
                      </>
                    )}
                    {marginMetric === 'trading' && (
                      <>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(sumOf(marginBuys))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>買進走勢</span>
                            <SparkCell
                              points={marginBuys}
                              color={CHART_COLORS.up}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="融資買進走勢"
                            />
                          </div>
                        </td>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(sumOf(marginSells))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>賣出走勢</span>
                            <SparkCell
                              points={marginSells}
                              color={CHART_COLORS.down}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="融資賣出走勢"
                            />
                          </div>
                        </td>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(sumOf(shortBuys))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>回補走勢</span>
                            <SparkCell
                              points={shortBuys}
                              color={CHART_COLORS.up}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="融券買進回補走勢"
                            />
                          </div>
                        </td>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(sumOf(shortSells))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>放空走勢</span>
                            <SparkCell
                              points={shortSells}
                              color={CHART_COLORS.down}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="融券賣出放空走勢"
                            />
                          </div>
                        </td>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(sumOf(offsets))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>互抵走勢</span>
                            <SparkCell
                              points={offsets}
                              color={CHART_COLORS.line}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="資券互抵走勢"
                            />
                          </div>
                        </td>
                      </>
                    )}
                    {marginMetric === 'redeem' && (
                      <>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(sumOf(marginRedeems))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>現償走勢</span>
                            <SparkCell
                              points={marginRedeems}
                              color={CHART_COLORS.line}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="融資現償走勢"
                            />
                          </div>
                        </td>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(sumOf(shortRedeems))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>券償走勢</span>
                            <SparkCell
                              points={shortRedeems}
                              color={CHART_COLORS.line}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="融券券償走勢"
                            />
                          </div>
                        </td>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(latestOf(marginLimits))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>最新限額</span>
                          </div>
                        </td>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(latestOf(shortLimits))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>最新限額</span>
                          </div>
                        </td>
                        <td className="num inst-matrix-cum">
                          <div>{fmtInt(sumOf(offsets))}</div>
                          <div className="tfoot-cum-trend">
                            <span className="hint" style={{ fontSize: 11 }}>互抵走勢</span>
                            <SparkCell
                              points={offsets}
                              color={CHART_COLORS.line}
                              width={TFOOT_SPARK_W}
                              height={TFOOT_SPARK_H}
                              ariaLabel="資券互抵走勢"
                            />
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="hint">
              這區的數字單位是張（1 張 = 1000 股），和上面法人的股數不同。
              融資是借錢買股票，餘額變多代表看多的人加碼；融券是借股票先賣，
              所以融券的「賣出」是放空、「買進」是回補。資券互抵為當日沖銷互抵張數。
              {margin?.source === 'openapi' && ' 今日改用備援來源，只有餘額、沒有買賣拆項。'}
            </p>
          </>
        )}
      </section>

      {history.length > 0 && margin !== null && (
        <section className="rpt-section">
          <h3>近 {history.length} 日餘額走勢</h3>
          <div className="chart-grid">
            <div>
              <div className="chart-title">融資餘額（張）</div>
              <LineSeriesChart
                points={history.map((d) => ({
                  label: shortDate(d.date),
                  value: d.margin?.marginToday ?? null,
                }))}
                color={CHART_COLORS.up}
                formatValue={(v) => `${fmtInt(v)} 張`}
                ariaLabel={`近 ${history.length} 日融資餘額走勢`}
              />
            </div>
            <div>
              <div className="chart-title">融券餘額（張）</div>
              <LineSeriesChart
                points={history.map((d) => ({
                  label: shortDate(d.date),
                  value: d.margin?.shortToday ?? null,
                }))}
                color={CHART_COLORS.line}
                formatValue={(v) => `${fmtInt(v)} 張`}
                ariaLabel={`近 ${history.length} 日融券餘額走勢`}
              />
            </div>
          </div>
          <p className="hint">兩張圖的縱軸各自獨立（融資量通常遠大於融券），不要直接比高低。</p>
        </section>
      )}

      {borrow && (
        <section className="rpt-section">
          <h3>
            借券
            <SourceTag stamp={report.sources?.borrow} />
          </h3>
          <p className="hint">
            借券賣出可用股數：{fmtInt(borrow.availableVolume)} 股。這是<strong>下一個交易日</strong>
            還能借出去賣的額度，不是已經被賣掉的量 —— 所以它的資料日會比上面的籌碼晚一天，不是錯誤。
          </p>
        </section>
      )}

      {report.notes.length > 0 && (
        <ul className="rpt-notes">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <p className="rpt-disclaimer">
        數據來源：臺灣證券交易所（TWSE）官方揭露，為最近交易日的盤後資料，不是即時的。
        本頁只彙整公開數據供參考，不是投資建議；實際請以官方揭露為準。
      </p>
    </>
  )
}

/** Continuous increases and consecutive decreases in financing/securities lending balance changes (share the same set of rules with legal persons)*/
function marginStreak(
  history: ReportData['history'],
  field: 'marginChange' | 'shortChange',
  endIndex: number,
): number {
  return streakAt(
    history.map((d) => d.margin?.[field] ?? null),
    endIndex,
  )
}
