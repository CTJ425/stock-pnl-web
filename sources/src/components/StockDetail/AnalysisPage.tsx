/**
 * Individual stock analysis page (navigation pagination): Responsible for "Which stock to look at" and holding figures, the content area is handed over to StockDetailPage.
 *
 * Only Taiwanese stocks are listed: The data source of after-hours chips (TWSE) only covers listed Taiwanese stocks. Putting US stocks into the menu will only make you realize that there is nothing.
 * The holding figures and the inventory overview share the same buildHoldingRows to avoid counting one copy on each page and running out of time——
 * Starting from 0.6.36, stock holdings will no longer be displayed on the screen, but the drop-down menu must list the Taiwan stocks held, and the click-to-purchase report must also include the holding context.
 * So this layer is still calculated; the PriceQuote required by the quotation card is also directly passed down from the prices here.
 */
import { useMemo, useState } from 'react'
import { Check, ChevronDown, Inbox } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useStockPrices } from '../../hooks/useStockPrices'
import { buildHoldingRows } from '../../utils/holdingRows'
import { getFeeRate } from '../../utils/settings'
import { displayStockName } from '../../services/usStockNames'
import { HeaderMenu } from '../Common/HeaderMenu'
import { StockDetailPage } from './StockDetailPage'

export function AnalysisPage() {
  const { ledger, current } = useWorkspace()
  const holdings = ledger.holdings
  const { prices } = useStockPrices(holdings)
  const feeRate = getFeeRate(current?.id)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const twRows = useMemo(
    () =>
      buildHoldingRows(holdings, prices, feeRate, current?.id).filter(
        (r) => r.holding.currency === 'TWD',
      ),
    [holdings, prices, feeRate, current?.id],
  )

  // The selected code may no longer be in the holdings due to transaction changes (sold out, changed workspace), and will fall back to the first level at this time.
  const selected = twRows.find((r) => r.holding.key === selectedKey) ?? twRows[0] ?? null

  if (!selected) {
    return (
      <div className="section">
        <div className="glass empty-state">
          <div className="empty-icon">
            <Inbox size={36} />
          </div>
          <div>目前沒有台股持股，沒有可以分析的個股。</div>
          <div className="hint" style={{ marginTop: 6 }}>
            盤後籌碼資料只涵蓋上市台股。到「交易紀錄」新增一筆台股買入後，這裡就會出現。
          </div>
        </div>
      </div>
    )
  }

  const name = displayStockName(
    selected.holding.market,
    selected.holding.ticker,
    selected.holding.name,
  )

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
                aria-checked={r.holding.key === selected.holding.key}
                className={
                  r.holding.key === selected.holding.key ? 'hmenu-item is-current' : 'hmenu-item'
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
  )

  return (
    <StockDetailPage
      // When exchanging shares, the entire state (tab, report, PDF state) is reset to avoid seeing the remnants of the previous file.
      key={selected.holding.key}
      ticker={selected.holding.ticker}
      name={name}
      holding={{
        qty: selected.holding.qty,
        avgCost: selected.holding.avgCost,
        price: selected.price,
        unrealized: selected.unrealized,
        roi: selected.roi,
      }}
      quote={prices[selected.holding.key] ?? null}
      selector={selector}
    />
  )
}
