/**
 * 管理觀察 panel: lists the user's watchlist and lets them search the full TW stock list
 * to add/remove entries. Purely presentational glue over `watchlistService` + `twMarketData`.
 */
import { useEffect, useState } from 'react'
import { WATCHLIST_MAX, addWatch, listWatchlist, removeWatch, type WatchItem } from '../../services/watchlistService'
import { getTwStockList, type TwStockRow } from '../../services/twMarketData'

export function WatchlistPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<WatchItem[]>([])
  const [stockList, setStockList] = useState<TwStockRow[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listWatchlist().then(setItems).catch((e) => setError(e instanceof Error ? e.message : String(e)))
    getTwStockList()
      .then(setStockList)
      .catch((e) => setListError(e instanceof Error ? e.message : String(e)))
  }, [])

  const isFull = items.length >= WATCHLIST_MAX
  const watched = new Set(items.map((i) => i.ticker))
  const q = query.trim()
  const results =
    q && !isFull
      ? stockList.filter(
          (r) => (r.symbol.toLowerCase().startsWith(q.toLowerCase()) || r.name.includes(q)) && !watched.has(r.symbol),
        )
      : []

  async function refresh() {
    setItems(await listWatchlist())
  }

  async function handleAdd(row: TwStockRow) {
    setError(null)
    try {
      await addWatch(row.symbol, row.name)
      await refresh()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleRemove(item: WatchItem) {
    setError(null)
    try {
      await removeWatch(item.ticker)
      await refresh()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="glass section">
      <div className="rpt-section-head">
        <h3>管理觀察</h3>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          關閉
        </button>
      </div>

      {error && <p className="hint">{error}</p>}

      {items.length === 0 ? (
        <p className="hint">還沒有觀察標的。</p>
      ) : (
        <table className="data-table">
          <tbody>
            {items.map((item) => (
              <tr key={item.ticker}>
                <td>
                  {item.ticker} {item.name}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleRemove(item)}
                    aria-label={`移除 ${item.ticker} ${item.name}`}
                  >
                    移除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div>
        <label htmlFor="watchlist-search">搜尋股票</label>
        <input
          id="watchlist-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={isFull}
        />
      </div>

      {isFull && <p className="hint">觀察清單最多只能有 {WATCHLIST_MAX} 檔股票，請先移除再加入。</p>}
      {listError && <p className="hint">{listError}</p>}

      {results.length > 0 && (
        <ul>
          {results.map((row) => (
            <li key={row.symbol}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => handleAdd(row)}
                aria-label={`加入 ${row.symbol} ${row.name}`}
              >
                {row.symbol} {row.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
