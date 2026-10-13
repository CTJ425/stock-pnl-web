/**
 * 成分股 tab (Task 200): what an ETF holds, laid out in the issuer's own order — fund summary,
 * asset amounts, stock weights, futures. Only rendered for codes in `ETF_HOLDINGS_SUPPORTED`.
 *
 * Every figure is the issuer's as published; nothing here recomputes a weight or a NAV. Weights
 * are not price moves, so they never take the market red / green.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { fetchEtfHoldings, type EtfHoldingsData } from '../../services/etfHoldingsProxy'
import {
  HOLDINGS_TOP_N,
  formatContractMonth,
  formatInt,
  formatPublishedAt,
  formatTradeDate,
  formatTwdFull,
  formatUnitsYi,
  formatWeight,
  formatYi,
  visibleStocks,
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

const ASSET_ROWS = [
  ['stock', '股票'],
  ['etf', 'ETF'],
  ['bond', '債券'],
  ['futures', '期貨'],
] as const

export function EtfHoldingsTab({ etf, reloadKey = 0 }: EtfHoldingsTabProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    setExpanded(false)
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
  const shown = visibleStocks(day.stocks, expanded)

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
          <h3>資產金額</h3>
          <span className="source-tag">單位：新台幣</span>
        </div>
        <div className="table-scroll">
          <table className="data-table etfh-assets" aria-label="資產金額">
            <thead>
              <tr>
                <th scope="col">類別</th>
                <th scope="col" className="num">金額</th>
              </tr>
            </thead>
            <tbody>
              {ASSET_ROWS.map(([key, label]) => {
                const v = day.assets[key]
                return (
                  <tr key={key} className={v === 0 ? 'etfh-zero' : undefined}>
                    <td>{label}</td>
                    <td className="num" title={v === 0 ? undefined : formatTwdFull(v)}>
                      {formatYi(v)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>股票持股</h3>
          <span className="source-tag">共 {day.stocks.length} 檔，依權重排列</span>
        </div>
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
              {shown.map((s) => (
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
        {day.stocks.length > HOLDINGS_TOP_N && (
          <button
            type="button"
            className="btn btn-sm etfh-more"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? `只看前 ${HOLDINGS_TOP_N} 檔` : `顯示全部 ${day.stocks.length} 檔`}
          </button>
        )}
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
        權重是各持股占基金規模的比率，元大以基金規模{day.fundSize > 0 ? `（${formatYi(day.fundSize)}）` : ''}
        為分母，與上方總淨值略有不同；
        數字皆為元大公布值，本站未重新計算。
      </p>
    </div>
  )
}
