/**
 * 觀察中 section on 庫存總覽 — a watched stock is a first-class citizen, equal to a holding, so it
 * lives directly under 「Active 持股」 with the same section/table markup. See
 * docs/agent/specs/watchlist-ux-overhaul.md.
 */
import { useCallback, useEffect, useState } from 'react'
import { Inbox, Plus } from 'lucide-react'
import { WATCHLIST_MAX, listWatchlist, removeWatch, type WatchItem } from '../../services/watchlistService'
import { fetchPrices, type PriceMap } from '../../services/priceProxy'
import { fmtPrice, fmtSignedPercent, pnlClass } from '../../utils/formatters'
import { AddWatchModal } from './AddWatchModal'

export function WatchTab({
  onSelectTicker,
  onChanged,
}: {
  onSelectTicker: (ticker: string, name: string) => void
  onChanged?: () => void
}) {
  const [items, setItems] = useState<WatchItem[]>([])
  const [prices, setPrices] = useState<PriceMap>({})
  const [showAdd, setShowAdd] = useState(false)

  // Two independent failures, two independent catches. A broken watchlist must not take the rest
  // of 庫存總覽 down with it; and a pricing hiccup must degrade only the price cells to `—`,
  // never make a watchlist that loaded fine look empty.
  const load = useCallback(async () => {
    let list: WatchItem[] = []
    try {
      list = await listWatchlist()
    } catch {
      setItems([])
      setPrices({})
      return
    }
    setItems(list)

    if (list.length === 0) {
      setPrices({})
      return
    }
    try {
      setPrices(await fetchPrices(list.map((w) => ({ market: 'TPE' as const, ticker: w.ticker }))))
    } catch {
      setPrices({})
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Guards a double click: two concurrent removes are individually harmless, but their two
  // overlapping reloads can commit out of order and flash a stale price snapshot.
  const [removing, setRemoving] = useState<string | null>(null)

  const handleRemove = async (ticker: string) => {
    if (removing) return
    setRemoving(ticker)
    try {
      await removeWatch(ticker)
      await load()
      onChanged?.()
    } finally {
      setRemoving(null)
    }
  }

  const atMax = items.length >= WATCHLIST_MAX

  return (
    <div className="rpt-section">
      <div className="rpt-section-head">
        <h3>觀察中</h3>
        <div className="toolbar">
          <span className="hint">{`${items.length}/${WATCHLIST_MAX}`}</span>
          {atMax && <span className="hint">已達上限，請先移除其他標的</span>}
          <button
            className="btn btn-sm"
            onClick={() => setShowAdd(true)}
            disabled={atMax}
            title={atMax ? `觀察清單最多只能有 ${WATCHLIST_MAX} 檔股票` : undefined}
          >
            <Plus size={14} />
            加入觀察
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="glass empty-state">
          <div className="empty-icon">
            <Inbox size={36} />
          </div>
          <div>還沒有觀察標的。加入後會在這裡看到現價和漲跌。</div>
        </div>
      ) : (
        <div className="glass table-scroll">
          <table className="data-table">
            {/*
              The holdings table above carries 10 columns; this one has 5 and would otherwise
              spread them edge to edge, leaving ~500px of blank between 名稱 and 現價 and reading
              like a different product. Proportional widths keep the two tables visually related.
            */}
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '34%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>代號</th>
                <th>名稱</th>
                <th className="num">現價</th>
                <th className="num">漲跌</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const quote = prices[`TPE:${item.ticker}`]
                const pct =
                  quote && quote.prevClose !== null && quote.prevClose !== 0
                    ? (quote.price - quote.prevClose) / quote.prevClose
                    : null
                return (
                  <tr
                    key={item.ticker}
                    onClick={() => onSelectTicker(item.ticker, item.name)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{item.ticker}</td>
                    <td>{item.name}</td>
                    <td className="num">{quote ? fmtPrice(quote.price, 'TWD') : '—'}</td>
                    <td className={`num ${pnlClass(pct)}`}>{pct === null ? '—' : fmtSignedPercent(pct)}</td>
                    <td>
                      <button
                        className="btn btn-sm"
                        aria-label={`移除 ${item.ticker} ${item.name}`}
                        disabled={removing !== null}
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleRemove(item.ticker)
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddWatchModal
          watched={items.map((i) => i.ticker)}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            void load()
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}
