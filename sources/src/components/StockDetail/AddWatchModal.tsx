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

const RESULT_CAP = 50

function kindRank(symbol: string): number {
  if (/^\d{4}$/.test(symbol)) return 0
  if (symbol.length === 5 || (symbol.length === 6 && symbol.startsWith('00'))) return 1
  return 2
}

function matchRank(row: TwStockRow, q: string): number {
  const symbol = row.symbol.toLowerCase()
  const name = row.name.toLowerCase()
  if (symbol === q) return 0
  if (symbol.startsWith(q)) return 1
  if (name === q) return 2
  if (name.startsWith(q)) return 3
  return 4
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
  const matches = q
    ? [...list]
        .filter(
          (row) =>
            !watched.includes(row.symbol) &&
            (row.symbol.toLowerCase().startsWith(q) || row.name.toLowerCase().includes(q)),
        )
        .sort((a, b) => {
          const kind = kindRank(a.symbol) - kindRank(b.symbol)
          if (kind !== 0) return kind
          const match = matchRank(a, q) - matchRank(b, q)
          if (match !== 0) return match
          return a.symbol.localeCompare(b.symbol)
        })
    : []
  const results = matches.slice(0, RESULT_CAP)

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
      {matches.length > RESULT_CAP && (
        <p className="watch-results-more">還有 {matches.length - RESULT_CAP} 筆，請輸入更完整的關鍵字</p>
      )}
    </Modal>
  )
}
