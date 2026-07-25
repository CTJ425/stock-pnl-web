/**
 * 我的持股分頁：顯示點進來時的持股脈絡（由庫存總覽帶入，不重算）。
 * 共用報告不含個人資料，這頁的數字一律來自前端。
 */
import { Inbox } from 'lucide-react'
import type { ReportHolding } from '../../services/reportProxy'
import { fmtMoney, fmtPrice, fmtQty, fmtSignedMoney, fmtSignedPercent, pnlClass } from '../../utils/formatters'

export function HoldingTab({ holding }: { holding: ReportHolding | null }) {
  if (!holding) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Inbox size={32} />
        </div>
        <div>目前沒有這檔股票的持股紀錄。</div>
      </div>
    )
  }

  return (
    <section className="rpt-section">
      <h3>持股概況</h3>
      <div className="rpt-cards">
        <div className="rpt-card">
          <div className="k">持有股數</div>
          <div className="v">{fmtQty(holding.qty)}</div>
        </div>
        <div className="rpt-card">
          <div className="k">平均成本</div>
          <div className="v">{fmtPrice(holding.avgCost, 'TWD')}</div>
        </div>
        <div className="rpt-card">
          <div className="k">現價</div>
          <div className="v">{holding.price === null ? '—' : fmtPrice(holding.price, 'TWD')}</div>
        </div>
        <div className="rpt-card">
          <div className="k">未實現淨損益</div>
          <div className={`v ${pnlClass(holding.unrealized)}`}>
            {holding.unrealized === null ? '—' : fmtSignedMoney(holding.unrealized, 'TWD')}
          </div>
        </div>
        <div className="rpt-card">
          <div className="k">未實現報酬率</div>
          <div className={`v ${pnlClass(holding.roi)}`}>
            {holding.roi === null ? '—' : fmtSignedPercent(holding.roi)}
          </div>
        </div>
      </div>
      <p className="hint">
        平均成本已含買進手續費，未實現淨損益也預扣了賣出的手續費和證交稅，
        所以是「現在全部賣掉大概拿回多少」。投入成本 {fmtMoney(holding.avgCost * holding.qty, 'TWD')}。
      </p>
    </section>
  )
}
