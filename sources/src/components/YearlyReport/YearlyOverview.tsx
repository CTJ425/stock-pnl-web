/**
 * 年度收益 charts (2026-09-27 statement redesign): the page opens with pictures, the ledger follows.
 *
 * - 每年賺賠: one bar per year (已實現損益 + 股利), red above / green below the zero line. Clicking a
 *   bar picks the year for the list beside it.
 * - 各檔貢獻: the picked year's stocks as a diverging bar list, largest gain first.
 * - 累計已實現損益: running total after every sell, oldest first — whether the account is compounding
 *   or giving gains back is a slope, not a number.
 *
 * One currency at a time: TWD and USD never share an axis (no FX here), so a two-market account gets
 * a 台股 / 美股 switch instead of a mixed chart.
 */
import { useMemo, useState } from 'react'
import { BarSeriesChart } from '../Charts/BarSeriesChart'
import { LineSeriesChart } from '../Charts/LineSeriesChart'
import { CHART_COLORS } from '../Charts/chartColors'
import type { Currency } from '../../types/models'
import type { Ledger } from '../../utils/pnlEngine'
import { displayStockName } from '../../services/usStockNames'
import { fmtSignedMoney, pnlClass } from '../../utils/formatters'

interface YearBar {
  year: number
  value: number
  tickers: Array<{ key: string; ticker: string; name: string; value: number; dividend: boolean }>
}

function yearBars(ledger: Ledger, currency: Currency): YearBar[] {
  const out: YearBar[] = []
  for (const year of ledger.years) {
    const tickers: YearBar['tickers'] = []
    let value = 0
    for (const yt of Object.values(ledger.yearly[year].tickers)) {
      if (yt.currency !== currency) continue
      const v = yt.realized + yt.dividends
      if (yt.sells.length === 0 && yt.dividends === 0) continue
      value += v
      tickers.push({
        key: yt.key,
        ticker: yt.ticker,
        name: displayStockName(yt.market, yt.ticker, yt.name),
        value: v,
        dividend: yt.sells.length === 0 && yt.dividends !== 0,
      })
    }
    if (tickers.length === 0) continue
    tickers.sort((a, b) => b.value - a.value)
    out.push({ year, value, tickers })
  }
  return out
}

function cumulativeSells(ledger: Ledger, currency: Currency) {
  const sells = ledger.years.flatMap((year) =>
    Object.values(ledger.yearly[year].tickers)
      .filter((yt) => yt.currency === currency)
      .flatMap((yt) => yt.sells),
  )
  sells.sort((a, b) => a.date.localeCompare(b.date) || a.legId.localeCompare(b.legId))
  let total = 0
  return sells.map((s) => {
    total += s.realized
    return { label: s.date.slice(2).replace(/-/g, '/'), value: total }
  })
}

export function YearlyOverview({ ledger }: { ledger: Ledger }) {
  const tw = useMemo(() => yearBars(ledger, 'TWD'), [ledger])
  const us = useMemo(() => yearBars(ledger, 'USD'), [ledger])
  const both = tw.length > 0 && us.length > 0
  const [currency, setCurrency] = useState<Currency>(tw.length > 0 ? 'TWD' : 'USD')
  const bars = currency === 'TWD' ? tw : us
  const [picked, setPicked] = useState<number | null>(null)
  const cumulative = useMemo(() => cumulativeSells(ledger, currency), [ledger, currency])

  if (bars.length === 0) return null
  const pickedIndex = picked !== null && picked < bars.length ? picked : bars.length - 1
  const year = bars[pickedIndex]
  const maxAbs = Math.max(...year.tickers.map((t) => Math.abs(t.value)), 1)
  const fmt = (v: number) => fmtSignedMoney(v, currency)

  return (
    <div className="yr-overview">
      {both && (
        <div className="yr-ccy seg" role="group" aria-label="圖表幣別">
          {(['TWD', 'USD'] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={currency === c}
              onClick={() => {
                setCurrency(c)
                setPicked(null)
              }}
            >
              {c === 'TWD' ? '台股' : '美股'}
            </button>
          ))}
        </div>
      )}
      <div className="yr-grid">
        <div>
          <div className="yr-head">
            <h2>每年賺賠</h2>
            <span className="yr-note">已實現損益＋股利・點柱子看那一年</span>
          </div>
          <BarSeriesChart
            labels={bars.map((b) => `${b.year}年`)}
            series={[{ name: '已實現＋股利', values: bars.map((b) => b.value) }]}
            height={220}
            formatValue={fmt}
            ariaLabel={`${currency === 'TWD' ? '台股' : '美股'}每年已實現損益加股利`}
            selectedIndex={pickedIndex}
            onSelect={setPicked}
          />
        </div>
        <div>
          <div className="yr-head">
            <h2>{year.year} 年各檔貢獻</h2>
            <span className="yr-note">由賺到賠排</span>
          </div>
          <ul className="yr-contrib" aria-label={`${year.year} 年各檔已實現損益`}>
            {year.tickers.map((t) => (
              <li key={t.key}>
                <span className="yr-contrib-name">
                  <b>{t.ticker}</b> {t.name}
                  {t.dividend && <span className="yr-contrib-tag">股利</span>}
                </span>
                <span className="yr-contrib-track" aria-hidden="true">
                  <i
                    className={t.value >= 0 ? 'pos' : 'neg'}
                    style={{ width: `${(Math.abs(t.value) / maxAbs) * 50}%` }}
                  />
                </span>
                <span className={`yr-contrib-value ${pnlClass(t.value)}`}>{fmt(t.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {cumulative.length > 1 && (
        <div className="yr-cum">
          <div className="yr-head">
            <h2>累計已實現損益</h2>
            <span className="yr-note">每一筆賣出後的累計，不含股利</span>
          </div>
          <LineSeriesChart
            points={cumulative}
            color={CHART_COLORS.line}
            height={200}
            formatValue={fmt}
            ariaLabel={`${currency === 'TWD' ? '台股' : '美股'}累計已實現損益`}
          />
        </div>
      )}
    </div>
  )
}
