/**
 * Individual stock analysis page: which held or watched Taiwan stock to inspect.
 *
 * The menu offers two groups: 持股 (TPE holdings) and 觀察 (watchlist tickers, no position).
 * TWSE after-hours chips cover listed TW only, so both groups are TW-only.
 * Holding figures share `buildHoldingRows` with the inventory overview.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Inbox } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useStockPrices } from '../../hooks/useStockPrices'
import { buildHoldingRows } from '../../utils/holdingRows'
import { getFeeRate } from '../../utils/settings'
import { displayStockName } from '../../services/usStockNames'
import { fetchPrices, type PriceQuote } from '../../services/priceProxy'
import { positionKey } from '../../types/models'
import { listWatchlist, type WatchItem } from '../../services/watchlistService'
import { HeaderMenu } from '../Common/HeaderMenu'
import { StockDetailPage } from './StockDetailPage'
import { WatchlistPanel } from './WatchlistPanel'

export function AnalysisPage() {
  const { ledger, current } = useWorkspace()
  const holdings = ledger.holdings
  const { prices } = useStockPrices(holdings)
  const feeRate = getFeeRate(current?.id)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [watchlist, setWatchlist] = useState<WatchItem[]>([])
  const [showWatchlistPanel, setShowWatchlistPanel] = useState(false)
  const [watchQuote, setWatchQuote] = useState<PriceQuote | null>(null)

  function reloadWatchlist() {
    // A watchlist load failure must never blank out the page for a user with holdings.
    listWatchlist()
      .then(setWatchlist)
      .catch(() => setWatchlist([]))
  }

  useEffect(() => {
    reloadWatchlist()
  }, [])

  const twRows = useMemo(
    () =>
      buildHoldingRows(holdings, prices, feeRate, current?.id).filter(
        (r) => r.holding.currency === 'TWD',
      ),
    [holdings, prices, feeRate, current?.id],
  )

  type Entry =
    | { kind: 'holding'; key: string; ticker: string; name: string; row: (typeof twRows)[number] }
    | { kind: 'watch'; key: string; ticker: string; name: string }

  const holdingEntries: Entry[] = twRows.map((r) => ({
    kind: 'holding',
    key: r.holding.key,
    ticker: r.holding.ticker,
    name: displayStockName(r.holding.market, r.holding.ticker, r.holding.name),
    row: r,
  }))
  // A held ticker already carries qty/cost/quote via holdingEntries; keep that entry
  // and drop the watch duplicate so the same stock never appears twice in the menu.
  const heldTickers = new Set(holdingEntries.map((e) => e.ticker))
  const watchEntries: Entry[] = watchlist
    .filter((w) => !heldTickers.has(w.ticker))
    .map((w) => ({
      kind: 'watch',
      key: `watch:${w.ticker}`,
      ticker: w.ticker,
      name: w.name,
    }))

  // Sold-out or workspace change may drop the selected key — fall back to the first
  // holding, then the first watched entry.
  const allEntries = [...holdingEntries, ...watchEntries]
  const selected =
    allEntries.find((e) => e.key === selectedKey) ?? holdingEntries[0] ?? watchEntries[0] ?? null

  const watchTicker = selected?.kind === 'watch' ? selected.ticker : null

  // Watched tickers carry no quote from useStockPrices (holdings-only), so fetch just the
  // one currently on screen. `cancelled` drops a stale response if the selection moves on
  // before this fetch resolves.
  useEffect(() => {
    if (!watchTicker) {
      setWatchQuote(null)
      return
    }
    let cancelled = false
    setWatchQuote(null)
    fetchPrices([{ market: 'TPE', ticker: watchTicker }])
      .then((map) => {
        if (cancelled) return
        setWatchQuote(map[positionKey('TPE', watchTicker)] ?? null)
      })
      .catch(() => {
        if (!cancelled) setWatchQuote(null)
      })
    return () => {
      cancelled = true
    }
  }, [watchTicker])

  if (!selected) {
    return (
      <div className="section">
        <div className="glass empty-state">
          <div className="empty-icon">
            <Inbox size={36} />
          </div>
          <div>目前沒有台股持股，沒有可以分析的個股。</div>
          <div className="hint" style={{ marginTop: 6 }}>
            盤後籌碼資料只涵蓋上市台股。到「交易紀錄」新增一筆台股買入，或按下方按鈕加入一檔觀察標的。
          </div>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 12 }}
            onClick={() => setShowWatchlistPanel(true)}
          >
            管理觀察
          </button>
        </div>
        {showWatchlistPanel && (
          <WatchlistPanel
            onClose={() => setShowWatchlistPanel(false)}
            onChanged={reloadWatchlist}
          />
        )}
      </div>
    )
  }

  const label = (e: Entry) => `${e.ticker} ${e.name}`

  const selector = (
    <div className="ws-select">
      <HeaderMenu
        triggerLabel={`切換個股：${label(selected)}`}
        triggerClass="hmenu-ws"
        triggerContent={
          <>
            <span className="hmenu-ws-name">{label(selected)}</span>
            <ChevronDown size={12} className="hmenu-caret" />
          </>
        }
        menuLabel="個股清單"
        popClass="hmenu-pop-left hmenu-pop-scroll"
      >
        {(close) => (
          <>
            {holdingEntries.length > 0 && (
              <>
                <div className="hmenu-group-label">持股</div>
                {holdingEntries.map((e) => (
                  <button
                    key={e.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={e.key === selected.key}
                    className={e.key === selected.key ? 'hmenu-item is-current' : 'hmenu-item'}
                    onClick={() => {
                      setSelectedKey(e.key)
                      close()
                    }}
                  >
                    <Check size={14} className="hmenu-check" aria-hidden="true" />
                    <span>{label(e)}</span>
                  </button>
                ))}
              </>
            )}
            {watchEntries.length > 0 && (
              <>
                <div className="hmenu-group-label">觀察</div>
                {watchEntries.map((e) => (
                  <button
                    key={e.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={e.key === selected.key}
                    className={e.key === selected.key ? 'hmenu-item is-current' : 'hmenu-item'}
                    onClick={() => {
                      setSelectedKey(e.key)
                      close()
                    }}
                  >
                    <Check size={14} className="hmenu-check" aria-hidden="true" />
                    <span>{label(e)}</span>
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </HeaderMenu>
      <button type="button" className="btn" onClick={() => setShowWatchlistPanel(true)}>
        管理觀察
      </button>
    </div>
  )

  return (
    <>
      <StockDetailPage
        key={selected.key}
        ticker={selected.ticker}
        name={selected.name}
        holding={
          selected.kind === 'holding'
            ? {
                qty: selected.row.holding.qty,
                avgCost: selected.row.holding.avgCost,
                price: selected.row.price,
                unrealized: selected.row.unrealized,
                roi: selected.row.roi,
              }
            : null
        }
        quote={selected.kind === 'holding' ? prices[selected.row.holding.key] ?? null : watchQuote}
        selector={selector}
      />
      {showWatchlistPanel && (
        <WatchlistPanel
          onClose={() => setShowWatchlistPanel(false)}
          onChanged={reloadWatchlist}
        />
      )}
    </>
  )
}
