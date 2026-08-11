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
  fmtTradeStreak,
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

/** Spark size in the 走勢 column —— the same as the market-wide matrix, so the two tables read alike. */
const SPARK_W = 100
const SPARK_H = 36

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
function ChipTrend({ nets, streak }: { nets: Array<number | null>; streak: number }) {
  // Gaps are dropped rather than zero-filled: a missing day is not a day of no trading, and joining across
  // it would draw a slope that never happened.
  const points = nets.filter((v): v is number => v !== null)
  if (points.length === 0) return <span className="hint">—</span>
  const last = points[points.length - 1]
  const color = last > 0 ? CHART_COLORS.up : last < 0 ? CHART_COLORS.down : CHART_COLORS.axis
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
      <span
        className={streak ? chipClass(streak) : 'hint'}
        style={{ whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: streak ? 600 : undefined }}
      >
        {fmtTradeStreak(streak)}
      </span>
      <SparkCell
        points={points}
        color={color}
        width={SPARK_W}
        height={SPARK_H}
        ariaLabel={`近 ${points.length} 個交易日的買賣超走勢`}
      />
    </div>
  )
}

export function ChipsTab({ report }: { report: ReportData }) {
  const { institutional, margin, borrow, history } = report
  const lastIndex = history.length - 1
  const [metric, setMetric] = useState<ChipMetric>('net')

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
                    <th>法人</th>
                    {instDays.map((d) => (
                      <th key={d.date} className="num">
                        {shortDate(d.date)}
                      </th>
                    ))}
                    <th className="num">{instDays.length} 日累計</th>
                    <th>走勢</th>
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map((r) => (
                    <tr key={r.key} className={r.key === 'total' ? 'row-total' : undefined}>
                      <td>{r.label}</td>
                      {r.lots.map((v, i) => (
                        <td
                          key={instDays[i].date}
                          /* Only the net is signed and coloured —— 買進／賣出 are gross and always positive. */
                          className={`num ${metric === 'net' ? chipClass(v) : ''}`}
                          style={metric === 'net' ? heatStyle(v, r.rowMax) : undefined}
                          title={
                            r.values[i] === null
                              ? undefined
                              : `${instDays[i].date} ${fmtInt(r.values[i])} 股`
                          }
                        >
                          {metric === 'net'
                            ? fmtLotsFromShares(r.values[i])
                            : fmtLotsPlain(r.values[i])}
                        </td>
                      ))}
                      <td
                        className={`num inst-matrix-cum ${metric === 'net' ? chipClass(r.cum) : ''}`}
                        title={r.cum === null ? undefined : `${fmtSigned(r.cum)} 股`}
                      >
                        {metric === 'net' ? fmtLotsFromShares(r.cum) : fmtLotsPlain(r.cum)}
                      </td>
                      <td>
                        <ChipTrend nets={r.nets} streak={r.streak} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              數字是<strong>約當張數</strong>（1 張 = 1000 股），滑鼠停在格子上可看確切股數。
              買賣超是買進減掉賣出，紅色代表法人當天買得比賣得多；底色深淺是該法人自己這幾天的相對強度。
              「連買連賣」算到最近交易日為止連續幾天同方向，看的一律是買賣超，不隨上方口徑改變。
            </p>
          </>
        )}
      </section>

      <section className="rpt-section">
        <h3>
          融資融券
          <SourceTag stamp={report.sources?.margin} />
        </h3>
        {margin === null ? (
          <p className="hint">
            今日融資融券尚未公布（約 21:00–22:00 才會有），稍晚的排程會自動補上。
            上方的三大法人不受影響 —— 它約 15:00–15:30 就公布了。
          </p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th></th>
                    <th className="num">買進</th>
                    <th className="num">賣出</th>
                    <th className="num">償還</th>
                    <th className="num">今日餘額</th>
                    <th className="num">較前日</th>
                    <th className="num">連增連減</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>融資</td>
                    <td className="num">{fmtInt(margin.marginBuy)}</td>
                    <td className="num">{fmtInt(margin.marginSell)}</td>
                    <td className="num">{fmtInt(margin.marginRedeem)}</td>
                    <td className="num">{fmtInt(margin.marginToday)}</td>
                    <td className={`num ${chipClass(margin.marginChange)}`}>{fmtSigned(margin.marginChange)}</td>
                    <td className={`num ${chipClass(marginStreak(history, 'marginChange', lastIndex))}`}>
                      {fmtBalanceStreak(marginStreak(history, 'marginChange', lastIndex))}
                    </td>
                  </tr>
                  <tr>
                    <td>融券</td>
                    <td className="num">{fmtInt(margin.shortBuy)}</td>
                    <td className="num">{fmtInt(margin.shortSell)}</td>
                    <td className="num">{fmtInt(margin.shortRedeem)}</td>
                    <td className="num">{fmtInt(margin.shortToday)}</td>
                    <td className={`num ${chipClass(margin.shortChange)}`}>{fmtSigned(margin.shortChange)}</td>
                    <td className={`num ${chipClass(marginStreak(history, 'shortChange', lastIndex))}`}>
                      {fmtBalanceStreak(marginStreak(history, 'shortChange', lastIndex))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="hint">
              這區的數字單位是張（1 張 = 1000 股），和上面法人的股數不同。
              融資是借錢買股票，餘額變多代表看多的人加碼；融券是借股票先賣，
              所以融券的「賣出」是放空、「買進」是回補。資券互抵 {fmtInt(margin.offset)} 張。
              {margin.source === 'openapi' && ' 今日改用備援來源，只有餘額、沒有買賣拆項。'}
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
