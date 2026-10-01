/**
 * 股利 (Task 183): the year's cash dividends, under the yearly report.
 *
 * Three views of one dataset, in the order a statement reads: the totals close first
 * (配息總額 − 代扣費用 = 實收, then 總報酬 under a double rule), then the pictures, then the
 * payments themselves. Every figure in the pictures is **gross** — the caliber a broker app shows —
 * and the net sits beside it, because the user reconciles against the notice before their pocket.
 *
 * The section is rendered once per market. TW and US dividends are never added together: no FX
 * rate is known here and guessing one would break the only promise the report makes.
 */
import { useMemo, useState } from 'react'
import type { Currency } from '../../types/models'
import type { DividendReport } from '../../utils/dividendReport'
import { OTHER_KEY, buildDividendReport, chartScaleMax, dividendYears } from '../../utils/dividendReport'
import { fmtMoney, fmtQty, fmtSignedMoney, pnlClass } from '../../utils/formatters'
import { useWorkspace } from '../../context/WorkspaceContext'

const MONTH_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

/** `colorIndex` → the class that paints it; the folded bucket gets a neutral, never a fifth hue. */
function segClass(colorIndex: number): string {
  return colorIndex < 0 ? 'div-seg-other' : `div-seg-c${colorIndex + 1}`
}

/**
 * The same figure without its NT$ / US$ prefix. On a phone the ledger's second line carries 代扣 and
 * 實收 under a heading that already names the market, and two currency prefixes there are the ~50px
 * that pushed the row into a sideways scroll. The prefix stays everywhere it is the only thing
 * naming the currency.
 */
function plainMoney(value: number, currency: Currency): string {
  return fmtMoney(value, currency).replace(/(?:NT|US)\$/, '')
}

function perShareText(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function MonthlyChart({ report, scaleMax }: { report: DividendReport; scaleMax: number }) {
  const ticks = [scaleMax, (scaleMax * 2) / 3, scaleMax / 3, 0]
  return (
    <div className="div-chart">
      <div className="div-plot">
        <div className="div-y" aria-hidden="true">
          {ticks.map((value, i) => (
            <span key={value} style={{ top: `${(i / 3) * 100}%` }} className={i === 3 ? 'div-y-zero' : undefined}>
              {fmtQty(Math.round(value))}
            </span>
          ))}
        </div>
        <div className="div-bars">
          {report.months.map((month) => {
            const label =
              month.gross === 0
                ? `${month.month} 月 沒有配息`
                : `${month.month} 月 配息總額 ${fmtMoney(month.gross, report.currency)}：${month.segments
                    .map((s) => `${s.label} ${fmtMoney(s.gross, report.currency)}`)
                    .join('、')}`
            const isPeak = month.gross > 0 && month.gross === report.peakMonth
            return (
              <div key={month.month} className="div-month" tabIndex={0} role="img" aria-label={label}>
                {isPeak && (
                  <span
                    className="div-peak"
                    aria-hidden="true"
                    style={{ bottom: `calc(${(month.gross / scaleMax) * 100}% + 6px)` }}
                  >
                    {fmtQty(month.gross)}
                  </span>
                )}
                <div className="div-stack">
                  {month.segments.map((seg) => (
                    <b
                      key={seg.key}
                      className={`div-fill ${segClass(seg.colorIndex)}`}
                      style={{ height: `${(seg.gross / scaleMax) * 100}%` }}
                    />
                  ))}
                </div>
                {month.gross > 0 && (
                  <div className="div-tip" aria-hidden="true">
                    <b>{month.month} 月</b>
                    <dl>
                      {month.segments.map((seg) => (
                        <div key={seg.key} className="div-tip-row">
                          <dt>
                            <i className={segClass(seg.colorIndex)} />
                            <span>{seg.label}</span>
                          </dt>
                          <dd>{fmtMoney(seg.gross, report.currency)}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="div-tip-sum">
                      <span>合計</span>
                      <span>{fmtMoney(month.gross, report.currency)}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="div-base" aria-hidden="true" />
      </div>
      <div className="div-x" aria-hidden="true">
        {MONTH_LABELS.map((label, i) => (
          <span key={label} className={report.months[i].gross === 0 ? 'dim' : undefined}>
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

function ShareBlock({ report }: { report: DividendReport }) {
  return (
    <div>
      <div className="div-blk-head">
        <h3>個股占比</h3>
        <span>占配息總額，金額前 4 大</span>
      </div>
      <div className="div-share-bar" aria-hidden="true">
        {report.shares.map((share) => (
          <i key={share.key} className={segClass(share.colorIndex)} style={{ width: `${share.pct}%` }} />
        ))}
      </div>
      <ul className="div-share">
        {report.shares.map((share) => (
          <li key={share.key}>
            <i className={segClass(share.colorIndex)} aria-hidden="true" />
            <span className="div-share-name">
              {share.key === OTHER_KEY ? (
                share.name
              ) : (
                <>
                  <b>{share.ticker}</b>
                  {share.name}
                </>
              )}
            </span>
            <span className="div-share-pct">{share.pct.toFixed(1)}%</span>
            <span className="div-share-amt">{fmtMoney(share.gross, report.currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Ledger({ report }: { report: DividendReport }) {
  const { currency } = report
  return (
    <div className="div-ledger">
      <div className="div-blk-head">
        <h3>逐筆明細</h3>
        <span>{fmtQty(report.count)} 筆，依發放日由新到舊</span>
      </div>
      <div className="div-tbl-wrap">
        <table className="div-tbl">
          <thead>
            <tr>
              <th scope="col">發放日</th>
              <th scope="col">商品</th>
              <th scope="col">除息股數</th>
              <th scope="col">每股股利</th>
              <th scope="col">配息總額</th>
              <th scope="col">代扣費用</th>
              <th scope="col">實收</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => {
              const share = report.shares.find((s) => s.key === row.key)
              return (
                <tr key={row.txId}>
                  <td>{row.date}</td>
                  <td>
                    <span className="div-tk">
                      <i className={segClass(share ? share.colorIndex : -1)} aria-hidden="true" />
                      <b>{row.ticker}</b>
                      <span>{row.name}</span>
                    </span>
                  </td>
                  <td>{fmtQty(row.qty)}</td>
                  <td>{perShareText(row.perShare)}</td>
                  <td>{fmtMoney(row.gross, currency)}</td>
                  <td className="div-muted" data-plain={plainMoney(row.fee, currency)}>
                    <span className="div-cell-full">{fmtMoney(row.fee, currency)}</span>
                  </td>
                  <td data-plain={plainMoney(row.net, currency)}>
                    <span className="div-cell-full">{fmtMoney(row.net, currency)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>合計</td>
              <td />
              <td />
              <td />
              <td data-l="配息總額">{fmtMoney(report.gross, currency)}</td>
              <td data-l="代扣費用">{fmtMoney(report.fee, currency)}</td>
              <td data-l="實收">{fmtMoney(report.net, currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

export function DividendSection({ title, currency }: { title: string; currency: Currency }) {
  const { transactions, ledger } = useWorkspace()
  const years = useMemo(() => dividendYears(transactions, currency), [transactions, currency])
  const [picked, setPicked] = useState<number | null>(null)
  const year = picked !== null && years.includes(picked) ? picked : years[0]

  const report = useMemo(
    () => (year === undefined ? null : buildDividendReport(transactions, year, currency)),
    [transactions, year, currency],
  )

  // Nothing to say is said by saying nothing: a market with no dividend gets no empty block.
  if (!report || report.count === 0) return null

  const scaleMax = chartScaleMax(report.peakMonth)
  // 總報酬 is the year's realized P&L plus the dividends actually banked — the money really in hand.
  const yearly = ledger.yearly[year]
  const realized = yearly
    ? Object.values(yearly.tickers)
        .filter((t) => (currency === 'TWD' ? t.market === 'TPE' : t.market === 'US'))
        .reduce((sum, t) => sum + t.realized, 0)
    : 0

  return (
    <section className="section div-section" aria-label={`${title} 股利`}>
      <div className="div-head">
        <h2>股利</h2>
        <p className="div-note">
          {title}，{year} 年收到的現金股利，依發放日認列。金額為配息總額，未扣代扣費用。
        </p>
        {years.length > 1 && (
          <div className="seg div-years" role="group" aria-label="選擇年度">
            {years.map((y) => (
              <button key={y} type="button" aria-pressed={y === year} onClick={() => setPicked(y)}>
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="div-totals">
        <div className="div-tot">
          <h3>配息總額</h3>
          <div className="div-fig div-fig-lead">{fmtMoney(report.gross, currency)}</div>
          <p className="div-sub">
            {fmtQty(report.count)} 次配息 · {fmtQty(report.tickerCount)} 檔
          </p>
        </div>
        <div className="div-tot">
          <span className="div-op" aria-hidden="true">
            −
          </span>
          <h3>代扣費用</h3>
          <div className="div-fig">{fmtMoney(report.fee, currency)}</div>
          <p className="div-sub">二代健保、匯費等，依股利通知書</p>
        </div>
        <div className="div-tot">
          <span className="div-op" aria-hidden="true">
            =
          </span>
          <h3>實收</h3>
          <div className="div-fig">{fmtMoney(report.net, currency)}</div>
          <p className="div-sub">實際入帳金額</p>
        </div>
      </div>

      <div className="div-close">
        <span className="div-close-lbl">總報酬</span>
        <b className={`div-close-val ${pnlClass(realized + report.net)}`}>
          {fmtSignedMoney(realized + report.net, currency)}
        </b>
        <span className="div-close-terms">
          已實現損益 {fmtSignedMoney(realized, currency)} ＋ 股利實收 {fmtMoney(report.net, currency)}
        </span>
      </div>

      <div className="div-grid">
        <div>
          <div className="div-blk-head">
            <h3>每月配息</h3>
            <span>配息總額，依發放日</span>
          </div>
          <MonthlyChart report={report} scaleMax={scaleMax} />
        </div>
        <ShareBlock report={report} />
      </div>

      <Ledger report={report} />

      <ol className="stmt-notes div-notes">
        <li>
          <b>配息總額</b>是除息股數乘上每股股利，還沒扣任何費用；<b>實收</b>是扣掉代扣費用後真正入帳的錢。
        </li>
        <li>
          日期是<b>發放日</b>，也就是錢進戶頭那天，不是除息日。
        </li>
        <li>
          代扣費用照券商的股利通知書填，裡面通常是二代健保補充保費加匯費。單次配息總額不到 20,000
          元不用扣補充保費，所以只會看到匯費。
        </li>
        <li>
          <b>總報酬</b>是這一年的已實現損益加上股利實收，真正到手的錢。
        </li>
        <li>
          個股占比只畫金額<b>前 4 大</b>，其餘合併成灰色的「其他」，固定排在最後、不參與排名。
        </li>
        <li>股票股利不列在這裡 — 它只增加股數、攤低成本，沒有現金進來。</li>
      </ol>
    </section>
  )
}
