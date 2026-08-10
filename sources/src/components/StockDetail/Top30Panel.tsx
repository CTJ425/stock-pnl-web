/**
 * TOP30 list (Storage meta/top_tickers.json; ensure-top-tickers if empty).
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
  const [note, setNote] = useState<string | null>(null)

  const load = async (forceEnsure = false) => {
    setLoading(true)
    setNote(null)
    const d = await fetchTopTickers({ forceEnsure })
    setData(d)
    setDayYmd((prev) => {
      if (prev && d?.days.some((x) => x.ymd === prev)) return prev
      return d?.latest?.ymd ?? null
    })
    if (d?.fromEnsure) setNote('已向證交所補抓最新可取得的排行並寫入快取')
    setLoading(false)
  }

  useEffect(() => {
    void load(false)
  }, [])

  const day: TopTickersDayView | null =
    data?.days.find((d) => d.ymd === dayYmd) ?? data?.latest ?? null

  if (loading && !data) {
    return (
      <div className="glass empty-state">
        <div className="hint">正在讀取 TOP30…</div>
      </div>
    )
  }

  if (!day) {
    return (
      <div className="glass empty-state">
        <div className="empty-icon">
          <Inbox size={36} />
        </div>
        <div>尚無 TOP30 名單。</div>
        <div className="hint" style={{ marginTop: 6 }}>
          請確認已登入。將向證交所補抓最近交易日排行（寫入 Storage，之後批次會沿用）。
        </div>
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginTop: 12 }}
          onClick={() => void load(true)}
          disabled={loading}
        >
          <RefreshCw size={14} />
          補抓排行
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
        <strong style={{ fontSize: 14 }}>TOP30</strong>
        <span className="hint">上市成交金額 · 含 ETF · 官方證券代號</span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void load(true)}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? 'spin' : undefined} />
          重新整理
        </button>
        {data && data.days.length > 1 && (
          <div className="subtabs" role="tablist" aria-label="TOP30 資料日" style={{ marginLeft: 'auto' }}>
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
      {note && (
        <div className="hint" style={{ marginBottom: 8 }} role="status">
          {note}
        </div>
      )}
      {data && data.days.length === 1 && (
        <div className="hint" style={{ marginBottom: 8 }}>
          資料日 {formatTopYmd(day.ymd)}
          {day.sourceDate ? ` · 來源日 ${day.sourceDate}` : ''}
          （若僅一份，即最近一次成功寫入；週一未重跑前可能仍是上週五）
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
        點列開個股分析（與「其他台股」相同，無持股成本）。名單最多保留兩個寫入日。
      </p>
    </div>
  )
}
