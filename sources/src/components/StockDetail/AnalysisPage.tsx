/**
 * Individual stock analysis page: which held Taiwan stock to inspect.
 *
 * Only TPE holdings appear in the menu (TWSE after-hours chips cover listed TW only).
 * Holding figures share `buildHoldingRows` with the inventory overview.
 * 0.7.0: removed 搜尋個股 (watchlist) and TOP20 tabs — holdings only, as pre-0.6.44.
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

  // Sold-out or workspace change may drop the selected key — fall back to the first row.
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
