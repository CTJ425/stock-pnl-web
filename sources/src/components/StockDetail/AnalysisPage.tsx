/**
 * 個股分析頁（導覽分頁）：負責「看哪一檔」與持股數字，內容區交給 StockDetailPage。
 *
 * 只列台股：盤後籌碼的資料源（TWSE）只涵蓋上市台股，把美股放進選單只會讓人選了才發現沒東西。
 * 持股數字與庫存總覽共用 buildHoldingRows，避免兩頁各算一份而走鐘。
 */
import { useMemo, useState } from 'react'
import { Inbox } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useStockPrices } from '../../hooks/useStockPrices'
import { buildHoldingRows } from '../../utils/holdingRows'
import { getFeeRate } from '../../utils/settings'
import { displayStockName } from '../../services/usStockNames'
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

  const selector = (
    <div className="ws-select">
      <select
        value={selected.holding.key}
        onChange={(e) => setSelectedKey(e.target.value)}
        aria-label="切換個股"
      >
        {twRows.map((r) => (
          <option key={r.holding.key} value={r.holding.key}>
            {r.holding.ticker}{' '}
            {displayStockName(r.holding.market, r.holding.ticker, r.holding.name)}
          </option>
        ))}
      </select>
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
      selector={selector}
    />
  )
}
