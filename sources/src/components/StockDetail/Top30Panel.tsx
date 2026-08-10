/**
 * Trade-value Top 30 list (Storage meta/top_tickers.json).
 * Day switcher when both today and previous snapshot exist.
 */
import { useEffect, useState } from 'react'
import { Inbox, RefreshCw } from 'lucide-react'
import {
  fetchTopTickers,
  formatTopYmd,
  formatTradeValueYi,
  type TopTickersData,
  type TopTickersDayView,
} from '../../services/topTickersProxy'

interface Top30PanelProps {
  selectedTicker: string | null
  onSelect: (ticker: string, name: string) => void
}

export function Top30Panel({ selectedTicker, onSelect }: Top30PanelProps) {
  const [data, setData] = useState<TopTickersData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dayYmd, setDayYmd] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const d = await fetchTopTickers()
    setData(d)
    setDayYmd((prev) => {
      if (prev && d?.days.some((x) => x.ymd === prev)) return prev
      return d?.latest?.ymd ?? null
    })
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const day: TopTickersDayView | null =
    data?.days.find((d) => d.ymd === dayYmd) ?? data?.latest ?? null

  if (loading && !data) {
    return (
      <div className="glass empty-state">
        <div className="hint">正在讀取成交值 Top30…</div>
      </div>
    )
  }

  if (!day) {
    return (
      <div className="glass empty-state">
        <div className="empty-icon">
          <Inbox size={36} />
        </div>
        <div>尚無 Top30 名單。</div>
        <div className="hint" style={{ marginTop: 6 }}>
          盤後批次（16:00 起）會寫入 meta/top_tickers.json；週末或尚未跑批前會顯示最近一次（例如週一仍見週五）。
        </div>
        <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => void load()}>
          <RefreshCw size={14} />
          重新整理
        </button>
      </div>
    )
  }

  return (
    <div className="glass" style={{ padding: '12px 14px' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <strong style={{ fontSize: 14 }}>成交值 Top30</strong>
        <span className="hint">上市（含 ETF）· 官方證券代號</span>
        <button type="button" className="btn btn-sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spin' : undefined} />
          重新整理
        </button>
        {data && data.days.length > 1 && (
          <div className="subtabs" role="tablist" aria-label="Top30 資料日" style={{ marginLeft: 'auto' }}>
            {data.days.map((d) => (
              <button
                key={d.ymd}
                type="button"
                role="tab"
                aria-selected={d.ymd === day.ymd}
                className={`subtab${d.ymd === day.ymd ? ' active' : ''}`}
                onClick={() => setDayYmd(d.ymd)}
              >
                {formatTopYmd(d.ymd)}
                {d.ymd === data.latest?.ymd ? '（最新）' : '（前次）'}
              </button>
            ))}
          </div>
        )}
      </div>
      {data && data.days.length === 1 && (
        <div className="hint" style={{ marginBottom: 8 }}>
          資料日 {formatTopYmd(day.ymd)}
          {day.sourceDate ? ` · 來源日 ${day.sourceDate}` : ''}
        </div>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>#</th>
              <th>代號</th>
              <th>名稱</th>
              <th className="num">成交金額</th>
            </tr>
          </thead>
          <tbody>
            {day.tickers.map((t) => {
              const active = t.ticker === selectedTicker
              return (
                <tr
                  key={t.ticker}
                  className={active ? 'is-selected' : undefined}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(t.ticker, t.name)}
                >
                  <td className="num">{t.rank}</td>
                  <td>
                    <button
                      type="button"
                      className="linkish"
                      style={{
                        background: 'none',
                        border: 0,
                        padding: 0,
                        color: 'inherit',
                        fontWeight: active ? 700 : 500,
                        cursor: 'pointer',
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect(t.ticker, t.name)
                      }}
                    >
                      {t.ticker}
                    </button>
                  </td>
                  <td>{t.name}</td>
                  <td className="num">{formatTradeValueYi(t.tradeValue)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        點列開個股分析（與「其他台股」相同，無持股成本）。名單僅保留最近兩個寫入日。
      </p>
    </div>
  )
}
