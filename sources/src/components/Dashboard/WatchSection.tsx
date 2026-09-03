/**
 * 觀察股票 section on 庫存總覽 (Dashboard):
 * - Independent block positioned under Active 持股.
 * - Supports toggling between Minimalist Cards view (Scheme 3) and Table list view.
 * - View mode preference is persisted in localStorage.
 * - Clicking a stock card or table row triggers navigation to its individual stock analysis.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Inbox, LayoutGrid, List, Plus } from 'lucide-react'
import { WATCHLIST_MAX, listWatchlist, removeWatch, type WatchItem } from '../../services/watchlistService'
import { fetchPrices, type PriceMap } from '../../services/priceProxy'
import { fmtPrice, fmtSignedPercent, pnlClass } from '../../utils/formatters'
import { getStockCategory } from '../../utils/stockCategory'
import { groupWatchItems } from '../../utils/stockGrouping'
import { AddWatchModal } from '../StockDetail/AddWatchModal'

const STORAGE_VIEW_KEY = 'stock_watchlist_view_mode'
const POLL_INTERVAL_MS = 60 * 1000

type ViewMode = 'cards' | 'table'

export function WatchSection({
  onSelectTicker,
  onChanged,
  refreshTrigger,
}: {
  onSelectTicker: (ticker: string, name: string) => void
  onChanged?: () => void
  refreshTrigger?: number
}) {
  const [items, setItems] = useState<WatchItem[]>([])
  const [prices, setPrices] = useState<PriceMap>({})
  const [initialLoading, setInitialLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const requestSeq = useRef(0)
  const itemsRef = useRef<WatchItem[]>([])
  itemsRef.current = items

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_VIEW_KEY)
      return saved === 'table' ? 'table' : 'cards'
    } catch {
      return 'cards'
    }
  })

  const handleSetViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    try {
      localStorage.setItem(STORAGE_VIEW_KEY, mode)
    } catch {
      // Ignore localStorage errors in restricted environments
    }
  }

  const loadPrices = useCallback(async (list: WatchItem[], options?: { force?: boolean }) => {
    if (list.length === 0) {
      setPrices({})
      setInitialLoading(false)
      return
    }
    const seq = ++requestSeq.current
    try {
      const items = list.map((w) => ({ market: 'TPE' as const, ticker: w.ticker }))
      const map = await (options?.force ? fetchPrices(items, { force: true }) : fetchPrices(items))
      if (seq !== requestSeq.current) return // Discard outdated response
      setPrices(map)
    } catch {
      // Retain existing prices on network hiccup; never clear out loaded prices
    } finally {
      if (seq === requestSeq.current) {
        setInitialLoading(false)
      }
    }
  }, [])

  const load = useCallback(async () => {
    let list: WatchItem[] = []
    try {
      list = await listWatchlist()
    } catch {
      setItems([])
      setPrices({})
      setInitialLoading(false)
      return
    }
    setItems(list)
    await loadPrices(list)
  }, [loadPrices])

  useEffect(() => {
    void load()
  }, [load])

  // Listen to manual refresh triggers from the dashboard top toolbar
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      void loadPrices(itemsRef.current, { force: true })
    }
  }, [refreshTrigger, loadPrices])

  // 60-second silent background polling + foreground catch-up (identical to useStockPrices)
  useEffect(() => {
    const timer = setInterval(() => void loadPrices(itemsRef.current), POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadPrices(itemsRef.current)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadPrices])

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

  const [filter, setFilter] = useState<string>('all')

  const grouping = useMemo(() => {
    return groupWatchItems(items, (item) => prices[`TPE:${item.ticker}`]?.industry)
  }, [items, prices])

  const activeFilter = useMemo(() => {
    if (filter === 'all') return 'all'
    if (filter === '__other__' && grouping.otherCount > 0) return '__other__'
    if (grouping.clusteredGroupNames.includes(filter)) return filter
    return 'all'
  }, [filter, grouping.clusteredGroupNames, grouping.otherCount])

  useEffect(() => {
    if (filter !== 'all') {
      const isValidOther = filter === '__other__' && grouping.otherCount > 0
      const isValidClustered = grouping.clusteredGroupNames.includes(filter)
      if (!isValidOther && !isValidClustered) {
        setFilter('all')
      }
    }
  }, [filter, grouping.clusteredGroupNames, grouping.otherCount])

  const displayedGroups = useMemo(() => {
    if (!grouping.hasGroups) {
      return [{ key: 'all', name: '', isClustered: false, items }]
    }
    if (activeFilter === 'all') {
      return grouping.groups
    }
    if (activeFilter === '__other__') {
      const otherGroup = grouping.groups.find((g) => g.key === '__other__')
      return otherGroup ? [otherGroup] : []
    }
    const match = grouping.groups.find((g) => g.key === activeFilter)
    return match ? [match] : []
  }, [grouping, activeFilter, items])

  const atMax = items.length >= WATCHLIST_MAX

  return (
    <div className="section" data-testid="watchlist-section">
      <div className="section-title">
        <h2>
          <span>觀察股票</span>
          <span className="badge badge-count">{`${items.length}/${WATCHLIST_MAX}`}</span>
        </h2>
        <div className="toolbar">
          {atMax && <span className="hint">已達上限，請先移除其他標的</span>}
          <div className="view-toggle-group" role="group" aria-label="切換檢視模式">
            <button
              type="button"
              className={viewMode === 'cards' ? 'view-toggle-btn active' : 'view-toggle-btn'}
              onClick={() => handleSetViewMode('cards')}
              aria-label="圖卡模式"
              title="圖卡模式"
            >
              <LayoutGrid size={13} />
              <span>圖卡</span>
            </button>
            <button
              type="button"
              className={viewMode === 'table' ? 'view-toggle-btn active' : 'view-toggle-btn'}
              onClick={() => handleSetViewMode('table')}
              aria-label="條列模式"
              title="條列模式"
            >
              <List size={13} />
              <span>條列</span>
            </button>
          </div>
          <button
            className="btn btn-sm btn-primary"
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
        <>
          {grouping.hasGroups && (
            <div className="chip-toggle watchlist-filter-chips" role="group" aria-label="產業快速篩選">
              <button
                type="button"
                className={activeFilter === 'all' ? 'chip-btn active' : 'chip-btn'}
                onClick={() => setFilter('all')}
                data-testid="filter-chip-all"
              >
                {`全部 (${items.length})`}
              </button>
              {grouping.clusteredGroupNames.map((gName) => {
                const count = grouping.groupCounts.get(gName) ?? 0
                return (
                  <button
                    key={gName}
                    type="button"
                    className={activeFilter === gName ? 'chip-btn active' : 'chip-btn'}
                    onClick={() => setFilter(gName)}
                    data-testid={`filter-chip-${gName}`}
                  >
                    {`${gName} (${count})`}
                  </button>
                )
              })}
              {grouping.otherCount > 0 && (
                <button
                  type="button"
                  className={activeFilter === '__other__' ? 'chip-btn active' : 'chip-btn'}
                  onClick={() => setFilter('__other__')}
                  data-testid="filter-chip-other"
                >
                  {`其他 (${grouping.otherCount})`}
                </button>
              )}
            </div>
          )}

          {viewMode === 'cards' ? (
            <div className="watchlist-cards-wrap" data-testid="watchlist-cards">
              {displayedGroups.map((group) => (
                <div key={group.key} className="watchlist-group-section" data-testid={`watch-group-${group.key}`}>
                  {grouping.hasGroups && (
                    <div className="watchlist-group-title">
                      <span>{group.name}</span>
                      <span className="badge badge-count">{group.items.length}</span>
                    </div>
                  )}
                  <div className="watchlist-card-grid">
                    {group.items.map((item) => {
                      const quote = prices[`TPE:${item.ticker}`]
                      const pct =
                        quote && quote.prevClose !== null && quote.prevClose !== 0
                          ? (quote.price - quote.prevClose) / quote.prevClose
                          : null
                      const category = getStockCategory(item.ticker, item.name, quote?.industry)
                      return (
                        <div
                          key={item.ticker}
                          className="watchlist-card"
                          data-testid={`watch-card-${item.ticker}`}
                          onClick={() => onSelectTicker(item.ticker, item.name)}
                        >
                          <div className="watchlist-card-head">
                            <div className="watchlist-card-meta">
                              <span className="watchlist-card-ticker">{item.ticker}</span>
                              <span className="watchlist-card-name" title={item.name}>
                                {item.name}
                              </span>
                              {category && <span className="watchlist-card-badge">{category}</span>}
                            </div>
                            <button
                              type="button"
                              className="watchlist-card-del"
                              aria-label={`移除 ${item.ticker} ${item.name}`}
                              disabled={removing !== null}
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleRemove(item.ticker)
                              }}
                            >
                              ×
                            </button>
                          </div>
                          <div className="watchlist-card-body">
                            <div className={`watchlist-card-price ${pnlClass(pct)}`}>
                              {initialLoading && !quote ? (
                                <span className="skeleton" style={{ width: 60, height: 18, display: 'inline-block' }} />
                              ) : quote ? (
                                fmtPrice(quote.price, 'TWD')
                              ) : (
                                '—'
                              )}
                            </div>
                            <div className={`watchlist-card-change ${pnlClass(pct)}`}>
                              {pct === null ? '—' : fmtSignedPercent(pct)}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="glass table-scroll" data-testid="watchlist-table">
              <table className="data-table">
                <colgroup>
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '35%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '8%' }} />
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
                  {displayedGroups.map((group) => (
                    <Fragment key={group.key}>
                      {grouping.hasGroups && (
                        <tr className="watchlist-group-row" data-testid={`watch-group-row-${group.key}`}>
                          <td colSpan={5} className="watchlist-group-cell">
                            <span>{group.name}</span>
                            <span className="badge badge-count">{group.items.length}</span>
                          </td>
                        </tr>
                      )}
                      {group.items.map((item) => {
                        const quote = prices[`TPE:${item.ticker}`]
                        const pct =
                          quote && quote.prevClose !== null && quote.prevClose !== 0
                            ? (quote.price - quote.prevClose) / quote.prevClose
                            : null
                        const category = getStockCategory(item.ticker, item.name, quote?.industry)
                        return (
                          <tr
                            key={item.ticker}
                            data-testid={`watch-row-${item.ticker}`}
                            onClick={() => onSelectTicker(item.ticker, item.name)}
                            style={{ cursor: 'pointer' }}
                          >
                            <td>{item.ticker}</td>
                            <td>
                              <div className="watchlist-table-name-cell">
                                <span>{item.name}</span>
                                {category && <span className="watchlist-card-badge">{category}</span>}
                              </div>
                            </td>
                            <td className="num">
                              {initialLoading && !quote ? (
                                <span className="skeleton" style={{ width: 60, height: 18, display: 'inline-block' }} />
                              ) : quote ? (
                                fmtPrice(quote.price, 'TWD')
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className={`num ${pnlClass(pct)}`}>{pct === null ? '—' : fmtSignedPercent(pct)}</td>
                            <td>
                              <button
                                type="button"
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
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
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
