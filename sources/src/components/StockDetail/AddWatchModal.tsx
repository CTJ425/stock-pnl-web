import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Modal } from '../Common/Modal'
import { WATCHLIST_MAX, addWatch } from '../../services/watchlistService'
import { getTwStockList, type TwStockRow } from '../../services/twMarketData'

interface AddWatchModalProps {
  watched: string[]
  onClose: () => void
  onAdded: () => void
}

export function AddWatchModal({ watched, onClose, onAdded }: AddWatchModalProps) {
  const [query, setQuery] = useState('')
  const [list, setList] = useState<TwStockRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    getTwStockList()
      .then(setList)
      .catch(() => setLoadError('台股清單載入失敗'))
  }, [])

  const q = query.trim().toLowerCase()
  const results = q
    ? list.filter(
        (row) =>
          !watched.includes(row.symbol) &&
          (row.symbol.toLowerCase().startsWith(q) || row.name.toLowerCase().includes(q)),
      )
    : []

  async function handleAdd(row: TwStockRow) {
    setAddError(null)
    try {
      await addWatch(row.symbol, row.name)
      onAdded()
      onClose()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal title="加入觀察" onClose={onClose}>
      <p>
        {watched.length}/{WATCHLIST_MAX}
      </p>
      <div className="search-box">
        <Search size={15} className="search-icon" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="輸入股票代號或名稱"
          aria-label="搜尋股票"
          className="search-input"
          autoFocus
        />
      </div>
      {addError && <p>{addError}</p>}
      {loadError && <p>{loadError}</p>}
      <ul className="watch-results">
        {results.map((row) => (
          <li key={row.symbol}>
            <button
              type="button"
              className="watch-result-item"
              aria-label={`加入 ${row.symbol} ${row.name}`}
              onClick={() => handleAdd(row)}
            >
              <span className="watch-result-symbol">{row.symbol}</span> <span className="watch-result-name">{row.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
