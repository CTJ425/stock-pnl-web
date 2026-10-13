/**
 * 成分股 tab (Task 200): what an ETF holds. Charts first (DESIGN.md): how concentrated it is, the
 * ten largest holdings, the asset mix; the full 50-row table sits one disclosure below. Only rendered
 * for codes in `ETF_HOLDINGS_SUPPORTED`.
 *
 * Every figure is the issuer's as published; nothing here recomputes a weight or a NAV. Weights
 * are not price moves, so they never take the market red / green.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { fetchEtfHoldings, type EtfHoldingsData } from '../../services/etfHoldingsProxy'
import { ChartLegend } from '../Charts/ChartLegend'
import {
  HOLDINGS_TOP_N,
  assetSegments,
  concentrationSegments,
  formatContractMonth,
  formatInt,
  formatPublishedAt,
  formatTradeDate,
  formatTwdFull,
  formatUnitsYi,
  formatWeight,
  formatYi,
  type AssetSegment,
  type ConcentrationSegment,
} from './etfHoldingsView'

interface EtfHoldingsTabProps {
  etf: string
  /** +1 on the page's 重新整理, to refetch. */
  reloadKey?: number
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'ok'; data: EtfHoldingsData }

/** Identity colours (DESIGN.md: never the market red / green for something that is not a move). */
const SEGMENT_COLOR: Record<ConcentrationSegment['key'], string> = {
  top1: 'var(--chart-c1)',
  next: 'var(--chart-c2)',
  rest: 'var(--chart-c3)',
  other: 'var(--ink-muted)',
}

const ASSET_COLOR: Record<AssetSegment['key'], string> = {
  stock: 'var(--chart-c1)',
  etf: 'var(--chart-c3)',
  bond: 'var(--chart-c4)',
  futures: 'var(--chart-c2)',
}

export function EtfHoldingsTab({ etf, reloadKey = 0 }: EtfHoldingsTabProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    fetchEtfHoldings(etf)
      .then((r) => {
        if (!alive) return
        // `invalid` is a file that exists but cannot be read — not the same as "not generated yet".
        setState(r.kind === 'ok' ? { kind: 'ok', data: r.data } : { kind: r.kind === 'invalid' ? 'invalid' : 'none' })
      })
      .catch(() => {
        if (alive) setState({ kind: 'error' })
      })
    return () => {
      alive = false
    }
  }, [etf, reloadKey])

  if (state.kind === 'loading') {
    return (
      <div className="empty-state" style={{ padding: 32 }}>
        <RefreshCw size={28} className="spin" />
        <div style={{ marginTop: 10 }}>正在讀取成分股…</div>
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="notice notice-error" role="alert">
        <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        讀取成分股失敗，請稍後按「重新整理」再試。
      </div>
    )
  }
  if (state.kind === 'invalid') {
    return (
      <div className="notice notice-error" role="alert">
        <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        成分股資料的格式和網頁對不上，暫時無法顯示。
      </div>
    )
  }
  if (state.kind === 'none') {
    return (
      <div className="empty-state" style={{ padding: 32 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>還沒有這檔 ETF 的成分股資料</div>
        <div className="hint" style={{ marginTop: 6 }}>排程每個交易日傍晚更新，稍後再回來看看。</div>
      </div>
    )
  }

  const { data } = state
  const day = data.days[0]
  const published = formatPublishedAt(day.publishedAt)
  const top = day.stocks.slice(0, HOLDINGS_TOP_N)
  const maxWeight = Math.max(...top.map((s) => s.weight), 0)
  const segments = concentrationSegments(day.stocks)
  const assetSegs = assetSegments(day.assets)

  return (
    <div className="etfh">
      <p className="hint etfh-source">
        資料日 {formatTradeDate(day.tradeDate)}・元大投信公布{published ? `（${published} 更新）` : ''}
        ，每個交易日約 16:00 更新。
        {data.sourceUrl && (
          <>
            {' '}
            <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer">
              元大官網原始頁面
            </a>
          </>
        )}
      </p>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>基金概況</h3>
          <span className="source-tag">{data.fundName}</span>
        </div>
        <div className="kpi-grid">
          <div className="glass kpi">
            <div className="kpi-label">基金資產總淨值</div>
            <div className="kpi-value" title={formatTwdFull(day.navTotal)}>
              {formatYi(day.navTotal)}
            </div>
            <div className="kpi-sub">{formatTwdFull(day.navTotal)}</div>
          </div>
          <div className="glass kpi">
            <div className="kpi-label">每單位淨值</div>
            <div className="kpi-value">{day.navPerUnit.toFixed(2)} 元</div>
            <div className="kpi-sub">基金總淨值除以在外流通單位數</div>
          </div>
          <div className="glass kpi">
            <div className="kpi-label">在外流通單位數</div>
            <div className="kpi-value" title={`${formatInt(day.unitsOutstanding)} 單位`}>
              {formatUnitsYi(day.unitsOutstanding)}
            </div>
            <div className="kpi-sub">{formatInt(day.unitsOutstanding)} 單位</div>
          </div>
        </div>
      </section>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>持股集中度</h3>
          <span className="source-tag">占基金規模的權重，共 {day.stocks.length} 檔</span>
        </div>
        <div
          className="etfh-stack"
          role="img"
          aria-label={`持股集中度：${segments.map((g) => `${g.label} ${formatWeight(g.weight)}`).join('、')}`}
        >
          {segments.map((g) => (
            <span
              key={g.key}
              className="etfh-seg"
              style={{ width: `${g.weight}%`, background: SEGMENT_COLOR[g.key] }}
              title={`${g.label} ${formatWeight(g.weight)}`}
            />
          ))}
        </div>
        {/* The figures live in the legend, not inside the bar: segment text could not keep contrast on every colour. */}
        <div className="etfh-legend">
          <ChartLegend
            items={segments.map((g) => ({ label: g.label, color: SEGMENT_COLOR[g.key], note: formatWeight(g.weight) }))}
          />
        </div>
      </section>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>前 {top.length} 大持股</h3>
          <span className="source-tag">權重，依大小排列</span>
        </div>
        <ol className="etfh-bars" aria-label={`前 ${top.length} 大持股權重`}>
          {top.map((s) => (
            <li key={s.code} className="etfh-bar-row">
              <span className="etfh-bar-name">
                {s.name} <span className="hint">{s.code}</span>
              </span>
              <span className="etfh-bar-track" aria-hidden="true">
                <span
                  className="etfh-bar-fill"
                  style={{ width: `${maxWeight > 0 ? (s.weight / maxWeight) * 100 : 0}%` }}
                />
              </span>
              <span className="etfh-bar-value">{formatWeight(s.weight)}</span>
            </li>
          ))}
        </ol>
        <details className="chart-more">
          <summary>看全部 {day.stocks.length} 檔明細（股數、權重）</summary>
          <div className="table-scroll">
            <table className="data-table etfh-stocks" aria-label="股票持股">
              <thead>
                <tr>
                  <th scope="col">股票</th>
                  <th scope="col" className="num etfh-shares">股數</th>
                  <th scope="col" className="num">權重</th>
                </tr>
              </thead>
              <tbody>
                {day.stocks.map((s) => (
                  <tr key={s.code}>
                    {/* No link: 個股分析 only opens held or watched stocks, so most rows would land elsewhere. */}
                    <td>
                      {s.name} <span className="hint">{s.code}</span>
                    </td>
                    <td className="num etfh-shares">{formatInt(s.shares)}</td>
                    <td className="num">{formatWeight(s.weight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>資產配置</h3>
          <span className="source-tag">單位：新台幣</span>
        </div>
        <div
          className="etfh-stack etfh-stack-assets"
          role="img"
          aria-label={`資產配置：${assetSegs.map((a) => `${a.label} ${formatYi(a.amount)}`).join('、')}`}
        >
          {assetSegs
            .filter((a) => a.widthPct > 0)
            .map((a) => (
              <span
                key={a.key}
                className="etfh-seg"
                style={{ width: `${a.widthPct}%`, background: ASSET_COLOR[a.key] }}
                title={`${a.label} ${formatTwdFull(a.amount)}`}
              />
            ))}
        </div>
        <div className="etfh-legend">
          <ChartLegend
            items={assetSegs.map((a) => ({
              label: a.label,
              color: ASSET_COLOR[a.key],
              note: formatYi(a.amount),
              hidden: a.amount === 0,
            }))}
          />
        </div>
      </section>

      {day.futures.length > 0 && (
        <section className="rpt-section">
          <div className="rpt-section-head">
            <h3>期貨部位</h3>
          </div>
          <div className="table-scroll">
            <table className="data-table etfh-futures" aria-label="期貨部位">
              <thead>
                <tr>
                  <th scope="col">商品</th>
                  <th scope="col" className="num">口數</th>
                  <th scope="col" className="num">權重</th>
                  <th scope="col" className="num">月份</th>
                </tr>
              </thead>
              <tbody>
                {day.futures.map((f) => (
                  <tr key={`${f.code}-${f.month}`}>
                    <td>
                      {f.name ?? f.code} <span className="hint">{f.code}</span>
                    </td>
                    <td className="num">{formatInt(f.contracts)}</td>
                    <td className="num">{formatWeight(f.weight)}</td>
                    <td className="num">{formatContractMonth(f.month)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="hint etfh-foot">
        權重是元大公布的各持股占基金規模{day.fundSize > 0 ? `（${formatYi(day.fundSize)}）` : ''}的比率，與上方總淨值略有不同。
        集中度各段是權重直接相加；「股票以外」是 100% 減去股票權重合計，含現金與期貨保證金等。
        資產配置長條只表示四項金額的相對大小，元大未公布占比。本站未重新計算任何權重。
      </p>
    </div>
  )
}
