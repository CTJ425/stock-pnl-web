/**
 * 報價卡：今日開高低量、昨收與今收（0.6.36，取代原本的「我的持股」卡）。
 *
 * 七格全部來自同一筆現價回應（TWSE MIS 的 o/h/l/v/y/z/ip），不另外請求 ——
 * 這也是不用 TWSE OpenAPI 日收盤端點的原因：實測收盤後兩小時它仍停在前一個交易日，
 * 拿它當「今收」會把昨收當成今收（2026-08-05 實測差 3.6%）。
 *
 * 這張卡是公開市場資料、不含個資，所以放在 PDF 擷取範圍內；
 * 被它取代的持股卡當初排在範圍外，正是因為那是個資。
 */
import { Inbox } from 'lucide-react'
import { isClosed, tradeDateLabel, type PriceQuote } from '../../services/priceProxy'
import { fmtPrice, pnlClass } from '../../utils/formatters'
import { fmtInt } from './chipFormat'

/** 卡片標題右側的狀態：什麼時候的報價、是不是快取 */
export function quoteMeta(quote: PriceQuote | null): string {
  if (!quote) return '尚未取得'
  const day = tradeDateLabel(quote.tradeDate)
  const state = quote.trial ? '試撮中' : isClosed(quote) ? '已收盤' : '盤中'
  const parts = [day, state, quote.tradeTime].filter((s): s is string => !!s)
  return quote.stale ? `${parts.join(' · ')} · 快取` : parts.join(' · ')
}

function Cell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rpt-card">
      <div className="k">{label}</div>
      <div className={className ? `v ${className}` : 'v'}>{value}</div>
    </div>
  )
}

export function QuoteTab({ quote }: { quote: PriceQuote | null }) {
  if (!quote) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Inbox size={32} />
        </div>
        <div>目前抓不到這檔股票的報價。</div>
      </div>
    )
  }

  const closed = isClosed(quote)
  // 昨收缺漏時不著色（平盤色），與庫存總覽現價欄同一個原則：不拿現價自己冒充基準
  const dayChange = quote.prevClose === null ? null : quote.price - quote.prevClose

  return (
    <section className="rpt-section">
      <h3>今日行情</h3>
      <div className="rpt-cards">
        <Cell label="開盤" value={fmtPrice(quote.open, 'TWD')} />
        <Cell label="最高" value={fmtPrice(quote.high, 'TWD')} />
        <Cell label="成交量" value={quote.volume === null ? '—' : `${fmtInt(quote.volume)} 張`} />
        <Cell label="昨收" value={fmtPrice(quote.prevClose, 'TWD')} />
        <Cell label="最低" value={fmtPrice(quote.low, 'TWD')} />
        {/* 試撮只在 08:30–09:00 與 13:25–13:30 進行，其餘時間沒有預估價可言 */}
        <Cell label="預估" value={quote.trial ? fmtPrice(quote.price, 'TWD') : '—'} />
        {/* 盤中還沒有「今收」，此時這格是最新成交價，改名以免誤讀 */}
        <Cell
          label={closed ? '今收' : '成交'}
          value={fmtPrice(quote.price, 'TWD')}
          className={pnlClass(dayChange)}
        />
      </div>
      <p className="hint">
        {closed
          ? '今天已經收盤，這是收盤的價格，到明天開盤前都不會再變。'
          : '盤中價格每分鐘更新一次。「預估」只有開盤前（8:30–9:00）和收盤前（13:25–13:30）試撮時才有。'}
      </p>
    </section>
  )
}
