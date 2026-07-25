/**
 * 籌碼分頁：三大法人（買進 / 賣出 / 買賣超 / 約當張數 / 連買連賣）、7 日買賣超長條圖（可切換法人）、
 * 融資融券（買進 / 賣出 / 償還 / 今日餘額 / 較前日 / 連增連減）與 7 日餘額走勢。
 * 資料全部來自 Edge Function 回傳的結構化報告，此元件只負責呈現。
 */
import { useState } from 'react'
import type { ChipLeg, InstitutionalChip, ReportData } from '../../services/reportProxy'
import { BarSeriesChart } from '../Charts/BarSeriesChart'
import { LineSeriesChart } from '../Charts/LineSeriesChart'
import { CHART_COLORS } from '../Charts/chartColors'
import {
  chipClass,
  fmtBalanceStreak,
  fmtInt,
  fmtLotsFromShares,
  fmtSigned,
  fmtTradeStreak,
  fmtUpdatedAt,
  shortDate,
} from './chipFormat'

/** 三大法人各列：法人名稱、取 leg 的方法、對應的連買連賣 */
const INSTITUTIONS = [
  { key: 'foreign', label: '外資（不含自營）', pick: (i: InstitutionalChip) => i.foreign },
  { key: 'foreignDealer', label: '外資自營商', pick: (i: InstitutionalChip) => i.foreignDealer },
  { key: 'trust', label: '投信', pick: (i: InstitutionalChip) => i.trust },
  { key: 'dealer', label: '自營商', pick: (i: InstitutionalChip) => i.dealer },
  { key: 'total', label: '三大法人合計', pick: (i: InstitutionalChip) => i.total },
] as const

type InstitutionKey = (typeof INSTITUTIONS)[number]['key']

const EMPTY_LEG: ChipLeg = { buy: null, sell: null, net: null }

export function ChipsTab({ report }: { report: ReportData }) {
  const [series, setSeries] = useState<InstitutionKey>('total')
  const { institutional, margin, borrow, history, streaks } = report

  const active = INSTITUTIONS.find((r) => r.key === series) ?? INSTITUTIONS[4]
  const netPoints = history.map((d) => ({
    label: shortDate(d.date),
    value: d.institutional ? active.pick(d.institutional).net : null,
  }))
  const marginPoints = history.map((d) => ({
    label: shortDate(d.date),
    value: d.margin?.marginToday ?? null,
  }))
  const shortPoints = history.map((d) => ({
    label: shortDate(d.date),
    value: d.margin?.shortToday ?? null,
  }))

  return (
    <>
      {/* 報告表頭放在擷取範圍內，下載的 PDF 才看得出是哪支股票、哪一天、什麼時候產的 */}
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
        <h3>三大法人買賣超</h3>
        {institutional === null ? (
          <p className="hint">查無此股當日資料。</p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>法人</th>
                    <th className="num">買進（股）</th>
                    <th className="num">賣出（股）</th>
                    <th className="num">買賣超（股）</th>
                    <th className="num">約當張數</th>
                    <th className="num">連買連賣</th>
                  </tr>
                </thead>
                <tbody>
                  {INSTITUTIONS.map(({ key, label, pick }) => {
                    const leg = pick(institutional) ?? EMPTY_LEG
                    return (
                      <tr key={key} className={key === 'total' ? 'row-total' : undefined}>
                        <td>{label}</td>
                        <td className="num">{fmtInt(leg.buy)}</td>
                        <td className="num">{fmtInt(leg.sell)}</td>
                        <td className={`num ${chipClass(leg.net)}`}>{fmtSigned(leg.net)}</td>
                        <td className={`num ${chipClass(leg.net)}`}>{fmtLotsFromShares(leg.net)}</td>
                        <td className={`num ${chipClass(streaks[key])}`}>{fmtTradeStreak(streaks[key])}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint">
              買賣超是買進減掉賣出，紅色代表法人當天買得比賣得多。數字單位是股，1 張等於 1000 股。
            </p>
          </>
        )}
      </section>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>近 {history.length} 日買賣超</h3>
          <div className="chip-toggle" role="group" aria-label="選擇法人">
            {INSTITUTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={key === series ? 'chip-btn active' : 'chip-btn'}
                onClick={() => setSeries(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {history.length === 0 ? (
          <p className="hint">尚無歷史資料。</p>
        ) : (
          <BarSeriesChart
            points={netPoints}
            formatValue={(v) => `${fmtSigned(v)} 股（約 ${fmtLotsFromShares(v)} 張）`}
            ariaLabel={`${active.label}近 ${history.length} 日買賣超長條圖`}
          />
        )}
      </section>

      <section className="rpt-section">
        <h3>融資融券</h3>
        {margin === null ? (
          <p className="hint">查無此股當日資料。</p>
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
                    <td className={`num ${chipClass(streaks.margin)}`}>{fmtBalanceStreak(streaks.margin)}</td>
                  </tr>
                  <tr>
                    <td>融券</td>
                    <td className="num">{fmtInt(margin.shortBuy)}</td>
                    <td className="num">{fmtInt(margin.shortSell)}</td>
                    <td className="num">{fmtInt(margin.shortRedeem)}</td>
                    <td className="num">{fmtInt(margin.shortToday)}</td>
                    <td className={`num ${chipClass(margin.shortChange)}`}>{fmtSigned(margin.shortChange)}</td>
                    <td className={`num ${chipClass(streaks.short)}`}>{fmtBalanceStreak(streaks.short)}</td>
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
                points={marginPoints}
                color={CHART_COLORS.up}
                formatValue={(v) => `${fmtInt(v)} 張`}
                ariaLabel={`近 ${history.length} 日融資餘額走勢`}
              />
            </div>
            <div>
              <div className="chart-title">融券餘額（張）</div>
              <LineSeriesChart
                points={shortPoints}
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
          <h3>借券</h3>
          <p className="hint">
            借券賣出可用股數：{fmtInt(borrow.availableVolume)} 股。這是還能借出去賣的額度，不是已經被賣掉的量。
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
