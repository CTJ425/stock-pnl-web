/**
 * TWSE TWT38U — foreign (and mainland China) investors' TOP 50 net buy / net sell (0.7.19).
 *
 * Fetches its own snapshot (no props) so mounting it into `TwMarketSection.tsx` costs one
 * import plus one JSX line in a file that is already ~800 lines.
 *
 * Quantities always show in 張 (lots). Odd-lot trading makes non-integer lots normal, so lots keep
 * one decimal instead of rounding to an integer.
 */
import { useEffect, useState } from 'react'
import { fetchForeignTop, type ForeignTopData, type ForeignTopItem } from '../../services/foreignTopProxy'
import { fmtUpdatedAt } from '../StockDetail/chipFormat'

type Tab = 'buy' | 'sell'

/** Shares → 張, one decimal, thousands separators. 1_234_000 shares → "1,234.0". */
function fmtLots(shares: number): string {
  return (shares / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function ForeignTopSection() {
  const [data, setData] = useState<ForeignTopData | null>(null)
  const [tab, setTab] = useState<Tab>('buy')
  const [limit, setLimit] = useState(10)

  useEffect(() => {
    void fetchForeignTop().then(setData)
  }, [])

  const allRows: ForeignTopItem[] = data ? (tab === 'buy' ? data.buyTop : data.sellTop) : []
  const rows = allRows.slice(0, limit)

  return (
    <div className="section glass" style={{ padding: '18px 20px', marginTop: 18 }}>
      <div className="rpt-section-head">
        <h3 className="head-tight">外資買賣超 TOP 50</h3>
        {data && <span className="source-tag section-stamp">資料更新於 {fmtUpdatedAt(data.asOf)}</span>}
        <div className="inst-metric-seg" role="group" aria-label="切換買超賣超">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'buy'}
            className="btn btn-sm"
            aria-pressed={tab === 'buy'}
            onClick={() => setTab('buy')}
          >
            買超 TOP 50
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'sell'}
            className="btn btn-sm"
            aria-pressed={tab === 'sell'}
            onClick={() => setTab('sell')}
          >
            賣超 TOP 50
          </button>
        </div>
        <label className="hint" style={{ marginLeft: 12 }}>
          顯示筆數{' '}
          <select
            aria-label="顯示筆數"
            className="btn btn-sm"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            <option value="10">10</option>
            <option value="30">30</option>
            <option value="50">50</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="hint" style={{ marginTop: 8 }}>
          尚無外資買賣超資料
        </p>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 12 }}>
            * 代表鉅額
          </p>
          <div className="table-scroll" style={{ marginTop: 6 }}>
            <table className="data-table" aria-label="外資買賣超 TOP 50">
              <thead>
                <tr>
                  <th>#</th>
                  <th>代號</th>
                  <th>名稱</th>
                  <th className="num">買賣超(張)</th>
                  <th className="num">買進</th>
                  <th className="num">賣出</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.ticker}>
                    <td>{i + 1}</td>
                    <td>{r.ticker}</td>
                    <td>{r.block ? `${r.name}*` : r.name}</td>
                    <td className="num">{fmtLots(r.net)}</td>
                    <td className="num">{fmtLots(r.buy)}</td>
                    <td className="num">{fmtLots(r.sell)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
