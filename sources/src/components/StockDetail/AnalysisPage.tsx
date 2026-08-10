/**
 * Individual stock analysis page: sub-tabs under 個股分析.
 *
 * - 我的持股: dropdown of current TW holdings + StockDetail with cost/ROI.
 * - 其他台股: up to 5 non-holdings (cloud `tw_watchlist` + local fallback), search to add,
 *   same StockDetail with holding=null.
 * - 成交值 Top30: ranked list from Storage (today + previous snapshot); open detail with holding=null.
 *
 * Rules (0.6.44+):
 * - Max 5 non-holdings per user.
 * - Sell-out or buy-in: ticker is pruned from the watchlist (holdings ∩ watchlist = ∅).
 * - Searching a code you already hold switches to the holdings tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Inbox, Search, X } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useStockPrices } from '../../hooks/useStockPrices'
import { buildHoldingRows } from '../../utils/holdingRows'
import { getFeeRate } from '../../utils/settings'
import { displayStockName } from '../../services/usStockNames'
import { searchStocks, type StockSearchResult } from '../../services/stockSearch'
import { fetchPrices, type PriceQuote } from '../../services/priceProxy'
import { positionKey } from '../../types/models'
import type { ReportHolding } from '../../services/reportProxy'
import {
  WATCHLIST_MAX,
  addWatchItem,
  loadWatchlist,
  pruneWatchlist,
  removeWatchItem,
  saveWatchlist,
  type WatchItem,
} from '../../services/twWatchlist'
import { prefetchStockData } from '../../services/prefetchStockData'
import { HeaderMenu } from '../Common/HeaderMenu'
import { StockDetailPage } from './StockDetailPage'
import { Top30Panel } from './Top30Panel'

type SubTab = 'holdings' | 'other' | 'top30'

interface Target {
  ticker: string
  name: string
  /** null = not held; the content area then simply omits the holding context */
  holding: ReportHolding | null
}

const SEARCH_DEBOUNCE_MS = 300

export function AnalysisPage() {
  const { ledger, current } = useWorkspace()
  const holdings = ledger.holdings
  const { prices } = useStockPrices(holdings)
  const feeRate = getFeeRate(current?.id)
  const [subTab, setSubTab] = useState<SubTab>('holdings')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const twRows = useMemo(
    () =>
      buildHoldingRows(holdings, prices, feeRate, current?.id).filter(
        (r) => r.holding.currency === 'TWD',
      ),
    [holdings, prices, feeRate, current?.id],
  )

  const heldTickers = useMemo(() => new Set(twRows.map((r) => r.holding.ticker)), [twRows])
  /** Stable key so we re-prune only when the held set actually changes, not on price ticks. */
  const heldKey = useMemo(
    () =>
      [...heldTickers]
        .sort()
        .join(','),
    [heldTickers],
  )

  // ---- Watchlist (其他台股) ----
  const [watchlist, setWatchlist] = useState<WatchItem[]>([])
  const [watchLoaded, setWatchLoaded] = useState(false)
  const [selectedWatchTicker, setSelectedWatchTicker] = useState<string | null>(null)
  const [watchError, setWatchError] = useState<string | null>(null)

  // ---- Top30 ----
  const [top30Pick, setTop30Pick] = useState<{ ticker: string; name: string } | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const items = await loadWatchlist()
      if (!alive) return
      setWatchlist(items)
      setWatchLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  // Buy-in → drop from watchlist (holdings ∩ list = ∅). Sell-out never auto-adds.
  useEffect(() => {
    if (!watchLoaded) return
    setWatchlist((prev) => {
      const held = new Set(heldKey ? heldKey.split(',') : [])
      const next = pruneWatchlist(prev, held)
      if (next.length === prev.length && next.every((n, i) => n.ticker === prev[i]?.ticker)) {
        return prev
      }
      void saveWatchlist(next)
      setSelectedWatchTicker((cur) =>
        cur && !next.some((i) => i.ticker === cur) ? (next[0]?.ticker ?? null) : cur,
      )
      return next
    })
  }, [heldKey, watchLoaded])

  const persistWatch = useCallback(async (next: WatchItem[]) => {
    setWatchlist(next)
    const r = await saveWatchlist(next)
    if (!r.ok) setWatchError(r.error ?? '儲存觀察清單失敗')
    else setWatchError(null)
  }, [])

  const selectedRow = twRows.find((r) => r.holding.key === selectedKey) ?? twRows[0] ?? null

  const holdingTarget: Target | null = selectedRow
    ? {
        ticker: selectedRow.holding.ticker,
        name: displayStockName(
          selectedRow.holding.market,
          selectedRow.holding.ticker,
          selectedRow.holding.name,
        ),
        holding: {
          qty: selectedRow.holding.qty,
          avgCost: selectedRow.holding.avgCost,
          price: selectedRow.price,
          unrealized: selectedRow.unrealized,
          roi: selectedRow.roi,
        },
      }
    : null

  const watchItem =
    watchlist.find((i) => i.ticker === selectedWatchTicker) ?? watchlist[0] ?? null
  const watchTarget: Target | null = watchItem
    ? { ticker: watchItem.ticker, name: watchItem.name, holding: null }
    : null

  const top30Target: Target | null = top30Pick
    ? { ticker: top30Pick.ticker, name: top30Pick.name, holding: null }
    : null

  const target =
    subTab === 'holdings' ? holdingTarget : subTab === 'other' ? watchTarget : top30Target

  // Quote for watched / top30 (non-holding) — one-shot.
  const [extraQuote, setExtraQuote] = useState<PriceQuote | null>(null)
  const extraTicker =
    subTab === 'other'
      ? (watchTarget?.ticker ?? null)
      : subTab === 'top30'
        ? (top30Target?.ticker ?? null)
        : null
  useEffect(() => {
    if (!extraTicker) {
      setExtraQuote(null)
      return
    }
    let alive = true
    setExtraQuote(null)
    void (async () => {
      const map = await fetchPrices([{ market: 'TPE', ticker: extraTicker }])
      if (alive) setExtraQuote(map[positionKey('TPE', extraTicker)] ?? null)
    })()
    return () => {
      alive = false
    }
  }, [extraTicker])

  const quote =
    subTab === 'other' || subTab === 'top30'
      ? extraQuote
      : selectedRow
        ? (prices[selectedRow.holding.key] ?? null)
        : null

  // ---- Search (其他台股 only) ----
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<StockSearchResult[] | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const searchSeq = useRef(0)
  const searchBoxRef = useRef<HTMLDivElement>(null)

  const handleQueryInput = (value: string) => {
    setQuery(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const q = value.trim()
    if (!q) {
      searchSeq.current++
      setSuggestions(null)
      return
    }
    searchTimer.current = setTimeout(async () => {
      const mySeq = ++searchSeq.current
      const results = await searchStocks(q)
      if (mySeq !== searchSeq.current) return
      setSuggestions(results.filter((r) => r.market === 'TPE'))
    }, SEARCH_DEBOUNCE_MS)
  }

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [])

  const pickSuggestion = (item: StockSearchResult) => {
    const owned = twRows.find((r) => r.holding.ticker === item.symbol)
    if (owned) {
      setSelectedKey(owned.holding.key)
      setSubTab('holdings')
      setQuery('')
      setSuggestions(null)
      setWatchError(null)
      return
    }
    const result = addWatchItem(watchlist, { ticker: item.symbol, name: item.name }, heldTickers)
    setQuery('')
    setSuggestions(null)
    if (!result.ok) {
      if (result.reason === 'full') {
        setWatchError(`最多只能保留 ${WATCHLIST_MAX} 檔非持股，請先移除一檔再新增`)
      } else if (result.reason === 'duplicate') {
        setSelectedWatchTicker(item.symbol)
        setWatchError(null)
      } else if (result.reason === 'held') {
        setWatchError(null)
      } else {
        setWatchError('無法加入此代號')
      }
      return
    }
    setWatchError(null)
    void persistWatch(result.items)
    // Kick off chip/fundamental warm before the detail pane mounts (quota-safe skip if already thick).
    void prefetchStockData(item.symbol, item.name)
    setSelectedWatchTicker(item.symbol)
    setSubTab('other')
  }

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSuggestions(null)
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  const label = (r: (typeof twRows)[number]) =>
    `${r.holding.ticker} ${displayStockName(r.holding.market, r.holding.ticker, r.holding.name)}`

  const subtabs = (
    <div className="subtabs" role="tablist" aria-label="個股分析分類">
      <button
        type="button"
        role="tab"
        aria-selected={subTab === 'holdings'}
        className={`subtab${subTab === 'holdings' ? ' active' : ''}`}
        onClick={() => setSubTab('holdings')}
      >
        我的持股
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={subTab === 'other'}
        className={`subtab${subTab === 'other' ? ' active' : ''}`}
        onClick={() => setSubTab('other')}
      >
        其他台股
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={subTab === 'top30'}
        className={`subtab${subTab === 'top30' ? ' active' : ''}`}
        onClick={() => setSubTab('top30')}
      >
        成交值 Top30
      </button>
    </div>
  )

  /** Primary menu only — sits on the same row as the stock title in StockDetailPage. */
  const holdingsMenu =
    twRows.length > 0 ? (
      <div className="ws-select analysis-select-primary">
        <HeaderMenu
          triggerLabel={`切換個股：${selectedRow ? label(selectedRow) : ''}`}
          triggerClass="hmenu-ws"
          triggerContent={
            <>
              <span className="hmenu-ws-name">{selectedRow ? label(selectedRow) : ''}</span>
              <ChevronDown size={12} className="hmenu-caret" />
            </>
          }
          menuLabel="個股清單"
          popClass="hmenu-pop-left hmenu-pop-scroll"
        >
          {(close) => (
            <>
              {twRows.map((r) => (
                <button
                  key={r.holding.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={r.holding.key === selectedRow?.holding.key}
                  className={
                    r.holding.key === selectedRow?.holding.key
                      ? 'hmenu-item is-current'
                      : 'hmenu-item'
                  }
                  onClick={() => {
                    setSelectedKey(r.holding.key)
                    close()
                  }}
                >
                  <Check size={14} className="hmenu-check" aria-hidden="true" />
                  <span>{label(r)}</span>
                </button>
              ))}
            </>
          )}
        </HeaderMenu>
      </div>
    ) : null

  const watchMenu =
    watchlist.length > 0 ? (
      <div className="ws-select analysis-select-primary">
        <HeaderMenu
          triggerLabel={`觀察中：${watchItem ? `${watchItem.ticker} ${watchItem.name}` : ''}`}
          triggerClass="hmenu-ws"
          triggerContent={
            <>
              <span className="hmenu-ws-name">
                {watchItem ? `${watchItem.ticker} ${watchItem.name}` : '選擇觀察股'}
              </span>
              <ChevronDown size={12} className="hmenu-caret" />
            </>
          }
          menuLabel="觀察清單"
          popClass="hmenu-pop-left hmenu-pop-scroll"
        >
          {(close) => (
            <>
              {watchlist.map((w) => (
                <button
                  key={w.ticker}
                  type="button"
                  role="menuitemradio"
                  aria-checked={w.ticker === watchItem?.ticker}
                  className={w.ticker === watchItem?.ticker ? 'hmenu-item is-current' : 'hmenu-item'}
                  onClick={() => {
                    setSelectedWatchTicker(w.ticker)
                    close()
                  }}
                >
                  <Check size={14} className="hmenu-check" aria-hidden="true" />
                  <span>
                    {w.ticker} {w.name}
                  </span>
                </button>
              ))}
            </>
          )}
        </HeaderMenu>
      </div>
    ) : null

  /** Search / remove / count — full-width row under the menu+title line so the title does not jump. */
  const watchSecondary = (
    <div className="analysis-select-secondary">
      <div className="stock-search" ref={searchBoxRef}>
        <Search size={13} className="stock-search-icon" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryInput(e.target.value)}
          placeholder="搜尋並加入觀察（最多 5 檔）"
          aria-label="查詢其他台股"
          autoComplete="off"
        />
        {suggestions !== null && (
          <div className="suggestions" role="listbox" aria-label="查詢結果">
            {suggestions.length === 0 ? (
              <div className="suggestion-empty">查無符合的台股</div>
            ) : (
              suggestions.map((s) => (
                <div
                  key={s.symbol}
                  role="option"
                  aria-selected={false}
                  tabIndex={0}
                  className="suggestion-item"
                  onClick={() => pickSuggestion(s)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      pickSuggestion(s)
                    }
                  }}
                >
                  <span>
                    {s.symbol} {s.name}
                    {heldTickers.has(s.symbol) ? '（已持股）' : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {watchItem && (
        <button
          type="button"
          className="btn btn-sm stock-search-clear"
          onClick={() => {
            const next = removeWatchItem(watchlist, watchItem.ticker)
            void persistWatch(next)
            setSelectedWatchTicker(next[0]?.ticker ?? null)
          }}
          aria-label={`移除 ${watchItem.ticker}`}
        >
          <X size={13} />
          移除
        </button>
      )}

      <span className="hint" style={{ alignSelf: 'center' }}>
        {watchlist.length}/{WATCHLIST_MAX}
      </span>
    </div>
  )

  /*
    Fragment (not a nested .detail-head): children participate in StockDetailPage's
    .detail-head-analysis flex/order layout — primary menu shares a row with the title.
  */
  const head = (
    <>
      {subtabs}
      {subTab === 'holdings' && holdingsMenu}
      {subTab === 'other' && watchMenu}
      {subTab === 'other' && watchSecondary}
      {subTab === 'top30' && top30Pick && (
        <div className="hint" style={{ alignSelf: 'center' }}>
          已選 {top30Pick.ticker} {top30Pick.name} · 可從下方排行再點其他檔
        </div>
      )}
      {watchError && subTab === 'other' && (
        <div className="hint analysis-watch-error" role="status">
          {watchError}
        </div>
      )}
    </>
  )

  /** Empty states still need a simple column chrome (no stock title row). */
  const emptyHead = (
    <div className="detail-head detail-head-empty">
      {subtabs}
      {subTab === 'holdings' && holdingsMenu}
      {subTab === 'other' && (
        <>
          {watchMenu}
          {watchSecondary}
        </>
      )}
      {watchError && subTab === 'other' && (
        <div className="hint analysis-watch-error" role="status">
          {watchError}
        </div>
      )}
    </div>
  )

  if (subTab === 'holdings' && !holdingTarget) {
    return (
      <div className="section">
        {emptyHead}
        <div className="glass empty-state">
          <div className="empty-icon">
            <Inbox size={36} />
          </div>
          <div>目前沒有台股持股。</div>
          <div className="hint" style={{ marginTop: 6 }}>
            到「交易紀錄」新增台股買入後，這裡會列出你的持股；或切到「其他台股」觀察非持股。
          </div>
          <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setSubTab('other')}>
            前往其他台股
          </button>
        </div>
      </div>
    )
  }

  if (subTab === 'other' && !watchTarget) {
    return (
      <div className="section">
        {emptyHead}
        <div className="glass empty-state">
          <div className="empty-icon">
            <Inbox size={36} />
          </div>
          <div>尚未加入觀察的台股。</div>
          <div className="hint" style={{ marginTop: 6 }}>
            用上方搜尋加入，最多 {WATCHLIST_MAX} 檔。賣光的持股不會自動進來；若之後買進，也會從這裡移除。
          </div>
        </div>
      </div>
    )
  }

  if (subTab === 'top30') {
    return (
      <div className="section">
        {emptyHead}
        <Top30Panel
          selectedTicker={top30Pick?.ticker ?? null}
          onSelect={(ticker, name) => setTop30Pick({ ticker, name })}
        />
        {top30Target && (
          <div style={{ marginTop: 12 }}>
            <StockDetailPage
              key={`top30-${top30Target.ticker}`}
              ticker={top30Target.ticker}
              name={top30Target.name}
              holding={null}
              quote={quote}
              selector={null}
            />
          </div>
        )}
      </div>
    )
  }

  if (!target) {
    return (
      <div className="section">
        {emptyHead}
      </div>
    )
  }

  return (
    <StockDetailPage
      key={`${subTab}-${target.ticker}`}
      ticker={target.ticker}
      name={target.name}
      holding={target.holding}
      quote={quote}
      selector={head}
    />
  )
}
