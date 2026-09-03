/**
 * Individual stock analysis page: which held or watched Taiwan stock to inspect.
 *
 * The stock picker lists both TW holdings (持股) and watched stocks (觀察), each under its
 * own heading. A watched stock can also be reached as the current selection via the 觀察股票
 * tab inside StockDetailPage, without going through this menu.
 * TWSE after-hours chips cover listed TW only, so the picker stays TW-only.
 * Holding figures share `buildHoldingRows` with the inventory overview.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Inbox, Plus } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useStockPrices } from '../../hooks/useStockPrices'
import { buildHoldingRows } from '../../utils/holdingRows'
import { getFeeRate } from '../../utils/settings'
import { displayStockName } from '../../services/usStockNames'
import { fetchPrices, type PriceQuote } from '../../services/priceProxy'
import { positionKey } from '../../types/models'
import { listWatchlist, type WatchItem } from '../../services/watchlistService'
import { groupWatchItems } from '../../utils/stockGrouping'
import { HeaderMenu } from '../Common/HeaderMenu'
import { StockDetailPage } from './StockDetailPage'
import { AddWatchModal } from './AddWatchModal'

interface AnalysisPageProps {
  initialTicker?: string
}

export function AnalysisPage({ initialTicker }: AnalysisPageProps = {}) {
  const { ledger, current } = useWorkspace()
  const holdings = ledger.holdings
  const { prices } = useStockPrices(holdings)
  const feeRate = getFeeRate(current?.id)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // Remembers what WatchSection handed over (ticker + name) so a stock added to the watchlist after
  // mount still resolves — the loaded `watchlist` copy below is not refreshed on every click.
  const [pickedWatch, setPickedWatch] = useState<{ ticker: string; name: string } | null>(null)
  const [watchlist, setWatchlist] = useState<WatchItem[]>([])
  const [watchQuote, setWatchQuote] = useState<PriceQuote | null>(null)
  const [showAddWatch, setShowAddWatch] = useState(false)

  /**
   * `clearBridge` drops `pickedWatch` only once the fresh list is in hand. Clearing it when the
   * reload is DISPATCHED lets an unrelated second change strip the bridge while this copy is
   * still stale, remounting the user away from the stock they just picked.
   */
  function reloadWatchlist(clearBridge = false) {
    // A watchlist load failure must never blank out the page for a user with holdings.
    listWatchlist()
      .then((list) => {
        setWatchlist(list)
        if (clearBridge) setPickedWatch(null)
      })
      .catch(() => {
        setWatchlist([])
        if (clearBridge) setPickedWatch(null)
      })
  }

  useEffect(() => {
    reloadWatchlist()
  }, [])

  useEffect(() => {
    if (initialTicker) {
      setSelectedKey(`watch:${initialTicker}`)
    }
  }, [initialTicker])

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
  // A held ticker already carries qty/cost/quote via holdingEntries; a watched selection
  // resolves to that holding entry instead, so the same stock never appears twice.
  const heldTickers = new Set(holdingEntries.map((e) => e.ticker))
  const availableWatch = watchlist.filter((w) => !heldTickers.has(w.ticker))
  const watchEntries: Entry[] = availableWatch.map((w) => ({
    kind: 'watch',
    key: `watch:${w.ticker}`,
    ticker: w.ticker,
    name: w.name,
  }))
  const watchByTicker = (ticker: string): Entry | null =>
    watchEntries.find((e) => e.ticker === ticker) ?? null

  // A ticker that is held is a holding, full stop — the watchlist is only how you found it.
  // So a `watch:` key is resolved against holdings FIRST, by ticker, before falling through to
  // the watchlist / pickedWatch bridge. Fall back order (this expression, then below): holding →
  // loaded watchlist → pickedWatch bridge → first holding → first watched. Watched entries also
  // appear in the menu's 觀察 group, and can still be reached as the current selection via the
  // 觀察股票 tab.
  const selectedFromKey = selectedKey
    ? selectedKey.startsWith('watch:')
      ? (holdingEntries.find((e) => e.ticker === selectedKey.slice('watch:'.length)) ??
        watchByTicker(selectedKey.slice('watch:'.length)) ??
        (pickedWatch && `watch:${pickedWatch.ticker}` === selectedKey
          ? { kind: 'watch' as const, key: selectedKey, ticker: pickedWatch.ticker, name: pickedWatch.name }
          : null))
      : (holdingEntries.find((e) => e.key === selectedKey) ?? null)
    : null
  const initialEntry = initialTicker
    ? (holdingEntries.find((e) => e.ticker === initialTicker) ?? watchByTicker(initialTicker))
    : null
  const selected = selectedFromKey ?? initialEntry ?? holdingEntries[0] ?? watchEntries[0] ?? null

  const watchTicker = selected?.kind === 'watch' ? selected.ticker : null

  const watchGrouping = useMemo(() => {
    return groupWatchItems(watchEntries, (e) => {
      if (watchQuote && watchTicker === e.ticker && watchQuote.industry) {
        return watchQuote.industry
      }
      return prices[`TPE:${e.ticker}`]?.industry
    })
  }, [watchEntries, watchQuote, watchTicker, prices])

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
            盤後籌碼資料只涵蓋上市台股。到「交易紀錄」新增一筆台股買入，或加入一檔觀察標的。
          </div>
          <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setShowAddWatch(true)}>
            <Plus size={14} />
            加入觀察
          </button>
        </div>
        {showAddWatch && (
          <AddWatchModal
            watched={watchlist.map((w) => w.ticker)}
            onClose={() => setShowAddWatch(false)}
            onAdded={() => {
              reloadWatchlist()
            }}
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
        {(close) => {
          const item = (e: Entry) => (
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
          )
          return (
            <>
              {holdingEntries.length > 0 && (
                <>
                  <div className="hmenu-head">持股</div>
                  {holdingEntries.map(item)}
                </>
              )}
              {holdingEntries.length > 0 && watchEntries.length > 0 && <div className="hmenu-sep" />}
              {watchEntries.length > 0 && (
                <>
                  {!watchGrouping.hasGroups ? (
                    <>
                      <div className="hmenu-head">觀察</div>
                      {watchEntries.map(item)}
                    </>
                  ) : (
                    watchGrouping.groups.map((group, idx) => (
                      <Fragment key={group.key}>
                        {idx > 0 && <div className="hmenu-sep" />}
                        <div className="hmenu-head">{`觀察 ── ${group.name}`}</div>
                        {group.items.map(item)}
                      </Fragment>
                    ))
                  )}
                </>
              )}
            </>
          )
        }}
      </HeaderMenu>
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
        rawAvgCost={selected.kind === 'holding' ? selected.row.holding.rawAvgCost : null}
        avgCost={selected.kind === 'holding' ? selected.row.holding.avgCost : null}
        quote={selected.kind === 'holding' ? prices[selected.row.holding.key] ?? null : watchQuote}
        selector={selector}
        onSelectTicker={(ticker, name) => {
          setPickedWatch({ ticker, name })
          setSelectedKey(`watch:${ticker}`)
        }}
        onWatchlistChanged={() => {
          reloadWatchlist(true)
        }}
      />
    </>
  )
}
