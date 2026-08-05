/**
 * 個股分析頁（導覽分頁）：負責「看哪一檔」與持股數字，內容區交給 StockDetailPage。
 *
 * 只列台股：盤後籌碼的資料源（TWSE）只涵蓋上市台股，把美股放進選單只會讓人選了才發現沒東西。
 * 持股數字與庫存總覽共用 buildHoldingRows，避免兩頁各算一份而走鐘 ——
 * 0.6.36 起畫面上不再顯示持股，但下拉選單要列出持有的台股、即點即產報告也要帶持股脈絡，
 * 所以這層仍照算；報價卡要的那筆 PriceQuote 也由這裡的 prices 直接往下傳。
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

  // 選中的代號可能因交易異動而不在持股裡了（賣光、換工作區），此時回退到第一檔
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
    0.6.7 由原生 `<select>` 換成與頁首工作區選單同一個 HeaderMenu。

    起因是實際壞掉了：`.ws-select select` 的樣式（含內嵌的 chevron 圖示）在 0.6.6
    被當成「dev.3 之後選不到任何元素的死 CSS」整段刪除 —— 但那只對頁首成立，
    這裡一直還在用它，於是這顆下拉退化成毫無樣式的瀏覽器原生控制項。

    修法不是把 CSS 補回來，而是收斂到同一個元件：兩處本來就該長一樣，
    各留一份樣式正是這次會走鐘的原因。
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
        // 這顆在畫面左側，且持股可能有數十檔：靠左展開並限高可捲
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
      // 換股時整組 state（分頁籤、報告、PDF 狀態）重置，避免看到上一檔的殘留
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
