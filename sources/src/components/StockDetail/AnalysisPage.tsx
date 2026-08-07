/**
 * Individual stock analysis page (navigation pagination): Responsible for "Which stock to look at" and holding figures, the content area is handed over to StockDetailPage.
 *
 * Only Taiwanese stocks are listed: The data source of after-hours chips (TWSE) only covers listed Taiwanese stocks. Putting US stocks into the menu will only make you realize that there is nothing.
 * The holding figures and the inventory overview share the same buildHoldingRows to avoid counting one copy on each page and running out of time——
 * Starting from 0.6.36, stock holdings will no longer be displayed on the screen, but the drop-down menu must list the Taiwan stocks held, and the click-to-purchase report must also include the holding context.
 * So this layer is still calculated; the PriceQuote required by the quotation card is also directly passed down from the prices here.
 *
 * 0.6.44 —— **the target no longer has to be a holding**. The dropdown keeps listing what you own
 * (that is the common case and it carries cost/ROI), but a search box beside it reaches the whole
 * listed + OTC market via the same `searchStocks` the transaction form uses. A searched stock has
 * no `holding`, which `StockDetailPage` has always accepted (`holding: null` is what the nightly
 * batch itself passes), and no entry in `useStockPrices` either, so its quote is fetched here.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { HeaderMenu } from '../Common/HeaderMenu'
import { StockDetailPage } from './StockDetailPage'

/** What the content area is currently looking at, whichever of the two pickers produced it */
interface Target {
  ticker: string
  name: string
  /** null = not held; the content area then simply omits the holding context */
  holding: ReportHolding | null
}

/** Debounce for the search box, same 300ms the transaction form settled on */
const SEARCH_DEBOUNCE_MS = 300

export function AnalysisPage() {
  const { ledger, current } = useWorkspace()
  const holdings = ledger.holdings
  const { prices } = useStockPrices(holdings)
  const feeRate = getFeeRate(current?.id)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  /** Set only by the search box; wins over the dropdown until cleared */
  const [searched, setSearched] = useState<Target | null>(null)

  const twRows = useMemo(
    () =>
      buildHoldingRows(holdings, prices, feeRate, current?.id).filter(
        (r) => r.holding.currency === 'TWD',
      ),
    [holdings, prices, feeRate, current?.id],
  )

  // The selected code may no longer be in the holdings due to transaction changes (sold out, changed workspace), and will fall back to the first level at this time.
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

  const target = searched ?? holdingTarget

  /*
    Quote for a searched stock.

    `useStockPrices` polls the holdings and nothing else, so a stock you do not own is simply absent
    from `prices`. Rather than fake a Holding to feed that hook, fetch this one directly —— the
    `stock-price` function has no whitelist of any kind, and `fetchPrices` already de-duplicates
    against the same localStorage TTL cache the hook uses, so opening a stock you looked at a minute
    ago sends no request at all.

    Deliberately one-shot, not polled: the holdings are what the user watches tick; a stock being
    researched is looked at, not monitored.
  */
  const [searchedQuote, setSearchedQuote] = useState<PriceQuote | null>(null)
  const searchedTicker = searched?.ticker ?? null
  useEffect(() => {
    if (!searchedTicker) {
      setSearchedQuote(null)
      return
    }
    let alive = true
    setSearchedQuote(null)
    void (async () => {
      const map = await fetchPrices([{ market: 'TPE', ticker: searchedTicker }])
      if (alive) setSearchedQuote(map[positionKey('TPE', searchedTicker)] ?? null)
    })()
    return () => {
      alive = false
    }
  }, [searchedTicker])

  const quote = searched
    ? searchedQuote
    : selectedRow
      ? (prices[selectedRow.holding.key] ?? null)
      : null

  // ---- Search box: same three-part pattern as TransactionForm (debounce, stale-response guard, outside-click collapse) ----
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
      // Taiwan only: the whole page (chips, fundamentals, daily) is fed by TWSE/TPEx sources.
      setSuggestions(results.filter((r) => r.market === 'TPE'))
    }, SEARCH_DEBOUNCE_MS)
  }

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [])

  const pickSuggestion = (item: StockSearchResult) => {
    // A code you actually own goes through the holdings path instead, so the analysis keeps its
    // cost basis and ROI —— otherwise searching for your own stock would silently lose them.
    const owned = twRows.find((r) => r.holding.ticker === item.symbol)
    if (owned) {
      setSelectedKey(owned.holding.key)
      setSearched(null)
    } else {
      setSearched({ ticker: item.symbol, name: item.name, holding: null })
    }
    setQuery('')
    setSuggestions(null)
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

  /*
    0.6.7 swapped the native `<select>` for the same HeaderMenu the workspace switcher uses.

    It was prompted by an actual breakage: the styles for `.ws-select select` (including the inline chevron icon)
    were deleted wholesale in 0.6.6 as "dead CSS that has matched nothing since dev.3" —— true for the header,
    but this dropdown was still using them, so it degraded into an unstyled native browser control.

    The fix was not to restore the CSS but to converge on one component: the two places were always meant to
    look the same, and keeping a copy of the styles each is exactly why they drifted.
  */
  const selector = (
    <div className="ws-select">
      {twRows.length > 0 && (
        <HeaderMenu
          triggerLabel={
            searched
              ? `目前：${searched.ticker} ${searched.name}（非持股）`
              : `切換個股：${selectedRow ? label(selectedRow) : ''}`
          }
          triggerClass="hmenu-ws"
          triggerContent={
            <>
              <span className="hmenu-ws-name">
                {searched
                  ? `${searched.ticker} ${searched.name}`
                  : selectedRow
                    ? label(selectedRow)
                    : ''}
              </span>
              <ChevronDown size={12} className="hmenu-caret" />
            </>
          }
          menuLabel="個股清單"
          // This one is on the left side of the screen, and there may be dozens of holdings: expand to the left and can be rolled up to a limited height.
          popClass="hmenu-pop-left hmenu-pop-scroll"
        >
          {(close) => (
            <>
              {twRows.map((r) => (
                <button
                  key={r.holding.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={!searched && r.holding.key === selectedRow?.holding.key}
                  className={
                    !searched && r.holding.key === selectedRow?.holding.key
                      ? 'hmenu-item is-current'
                      : 'hmenu-item'
                  }
                  onClick={() => {
                    setSelectedKey(r.holding.key)
                    setSearched(null)
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
      )}

      <div className="stock-search" ref={searchBoxRef}>
        <Search size={13} className="stock-search-icon" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryInput(e.target.value)}
          placeholder="查詢其他台股"
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
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {searched && (
        <button
          type="button"
          className="btn btn-sm stock-search-clear"
          onClick={() => setSearched(null)}
          // Only offered when there is somewhere to go back to; otherwise it would clear the page.
          disabled={twRows.length === 0}
        >
          <X size={13} />
          回到持股
        </button>
      )}
    </div>
  )

  /*
    No target at all = no TW holdings and nothing searched yet. Before 0.6.44 this branch returned
    early with just the empty state, which now would hide the search box along with it —— the one
    control that gets the user out of this state.
  */
  if (!target) {
    return (
      <div className="section">
        <div className="detail-head">{selector}</div>
        <div className="glass empty-state">
          <div className="empty-icon">
            <Inbox size={36} />
          </div>
          <div>目前沒有台股持股，用上面的查詢框挑一檔台股來看。</div>
          <div className="hint" style={{ marginTop: 6 }}>
            盤後籌碼資料只涵蓋上市櫃台股。到「交易紀錄」新增一筆台股買入後，這裡也會列出你的持股。
          </div>
        </div>
      </div>
    )
  }

  return (
    <StockDetailPage
      // When exchanging shares, the entire state (tab, report, PDF state) is reset to avoid seeing the remnants of the previous file.
      key={target.ticker}
      ticker={target.ticker}
      name={target.name}
      holding={target.holding}
      quote={quote}
      selector={selector}
    />
  )
}
