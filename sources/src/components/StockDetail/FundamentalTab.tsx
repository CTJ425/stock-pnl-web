/**
 * 基本面分頁：估值三指標（本益比 / 殖利率 / 股價淨值比）與近 12 個月月營收。
 * 資料來自盤後批次預產的 fundamental/{ticker}.json，此元件只負責呈現、不自己載入
 * ——同一份資料還要餵給標題列的產業別 badge 與 AI 解讀，故由 StockDetailPage 載一次分發。
 *
 * 單位陷阱：月營收是**千元**、殖利率與增減率是 **%**。表頭與欄名都要標，
 * 不可只在程式裡知道（沿用籌碼分頁「股 / 張」的準則）。
 */
import { RefreshCw } from 'lucide-react'
import type { FundamentalData } from '../../services/fundamentalProxy'
import { chipClass, fmtInt } from './chipFormat'

interface FundamentalTabProps {
  fundamental: FundamentalData | null
  loading: boolean
}

/** 小數點兩位；無資料回「—」（不以 0 冒充缺值） */
function fmtRatio(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toFixed(2)
}

/** 帶正負號的百分比 */
function fmtPercent(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

/** 'YYYY-MM' → 'YYYY 年 MM 月' */
function fmtYearMonth(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[1]} 年 ${m[2]} 月` : ym
}

export function FundamentalTab({ fundamental, loading }: FundamentalTabProps) {
  if (loading) {
    return (
      <div className="empty-state" style={{ padding: 32 }}>
        <RefreshCw size={28} className="spin" />
        <div style={{ marginTop: 10 }}>正在讀取基本面…</div>
      </div>
    )
  }

  if (!fundamental) {
    return (
      <div className="empty-state" style={{ padding: 32 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>基本面資料尚未產生</div>
        <div className="hint" style={{ marginTop: 6 }}>
          盤後批次完成後會自動補上，稍後再回來看看。
        </div>
      </div>
    )
  }

  const { valuation, revenueMonths, notes } = fundamental
  // 由新到舊呈現（檔案內是由舊到新，方便批次合併）
  const months = [...revenueMonths].reverse()

  return (
    <div>
      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>估值指標</h3>
          {valuation?.dataDate && <span className="source-tag">資料日 {valuation.dataDate}</span>}
        </div>

        {valuation ? (
          <div className="kpi-grid">
            <div className="glass kpi">
              <div className="kpi-label">本益比 (PER)</div>
              <div className="kpi-value">{fmtRatio(valuation.peRatio)}</div>
              <div className="kpi-sub">股價 ÷ 每股盈餘；虧損公司不適用</div>
            </div>
            <div className="glass kpi">
              <div className="kpi-label">殖利率</div>
              <div className="kpi-value">
                {valuation.dividendYieldPercent === null
                  ? '—'
                  : `${valuation.dividendYieldPercent.toFixed(2)}%`}
              </div>
              <div className="kpi-sub">近一年現金股利相對現價的比率</div>
            </div>
            <div className="glass kpi">
              <div className="kpi-label">股價淨值比 (PBR)</div>
              <div className="kpi-value">{fmtRatio(valuation.pbRatio)}</div>
              <div className="kpi-sub">股價相對每股淨值的倍數</div>
            </div>
          </div>
        ) : (
          <p className="hint">查無估值資料。</p>
        )}
      </section>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>月營收</h3>
          <span className="source-tag">單位：千元</span>
        </div>

        {months.length === 0 ? (
          <p className="hint">查無月營收資料。</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>月份</th>
                  <th className="num">當月營收（千元）</th>
                  <th className="num">月增</th>
                  <th className="num">年增</th>
                  <th className="num">累計年增</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.yearMonth}>
                    <td>{fmtYearMonth(m.yearMonth)}</td>
                    <td className="num">{fmtInt(m.revenueThousandTwd)}</td>
                    <td className={`num ${chipClass(m.momPercent)}`}>{fmtPercent(m.momPercent)}</td>
                    <td className={`num ${chipClass(m.yoyPercent)}`}>{fmtPercent(m.yoyPercent)}</td>
                    <td className={`num ${chipClass(m.cumulativeYoyPercent)}`}>
                      {fmtPercent(m.cumulativeYoyPercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint" style={{ marginTop: 8 }}>
          月營收由公司每月 10 日前自結公布，與季報的認列基礎不同，僅供趨勢參考。
        </p>
      </section>

      {notes.length > 0 && (
        <section className="rpt-section">
          {notes.map((n) => (
            <p className="hint" key={n}>
              {n}
            </p>
          ))}
        </section>
      )}
    </div>
  )
}
