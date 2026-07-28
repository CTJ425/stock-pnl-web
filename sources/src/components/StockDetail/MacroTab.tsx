/**
 * 總經分頁：美國五項總體經濟指標。
 *
 * 資料來自盤後批次預產的 macro/us.json（全域單檔），此元件只負責呈現、不自己載入
 * —— 同一份資料還要餵給 AI 分析，故由 StockDetailPage 載一次分發（同 fundamental 的作法）。
 *
 * **這一頁與個股無關**，每檔股票看到的完全一樣。畫面上要講明白，
 * 否則使用者會以為這些數字是這檔股票的。
 *
 * 單位陷阱：三個物價指標是 **%**（年增率）、非農是**千人**（較上月增減）、
 * 消費者信心是**指數值**。一律讀資料自帶的 `unit`，不要在這裡寫死。
 */
import { RefreshCw } from 'lucide-react'
import type { MacroData, MacroIndicator, MacroPoint } from '../../services/macroProxy'
import { chipClass, fmtUpdatedAt } from './chipFormat'

interface MacroTabProps {
  macro: MacroData | null
  loading: boolean
}

/** 'YYYY-MM' → 'YYYY 年 MM 月' */
function fmtPeriod(period: string | undefined): string {
  if (!period) return '—'
  const m = period.match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[1]} 年 ${m[2]} 月` : period
}

/** 帶單位的值。缺值回「—」（不以 0 冒充） */
function fmtValue(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (unit === '指數') return v.toFixed(1)
  if (unit === '千人') return `${v > 0 ? '+' : ''}${v.toLocaleString('en-US')} 千人`
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

/**
 * 與前一期的差。
 *
 * 物價的年增率與信心指數，「比上期高」本身沒有好壞之分（通膨升高對股市未必是壞事，
 * 端看情境），所以這裡只陳述變化量，不套用漲綠跌紅的損益色。
 */
function fmtDelta(latest: MacroPoint | null, previous: MacroPoint | null, unit: string): string {
  if (!latest?.value || !previous?.value) return '—'
  const d = latest.value - previous.value
  const abs = Math.abs(d)
  const shown = unit === '千人' ? abs.toLocaleString('en-US') : abs.toFixed(2)
  if (abs < 0.005) return '與上期持平'
  return `較上期${d > 0 ? '增加' : '減少'} ${shown}`
}

function IndicatorCard({ ind }: { ind: MacroIndicator }) {
  return (
    <div className="glass kpi">
      <div className="kpi-label">{ind.label}</div>
      <div className={`kpi-value ${ind.kind === 'momThousands' ? chipClass(ind.latest?.value) : ''}`}>
        {fmtValue(ind.latest?.value ?? null, ind.unit)}
      </div>
      <div className="kpi-sub">
        {fmtPeriod(ind.latest?.period)}・{fmtDelta(ind.latest, ind.previous, ind.unit)}
      </div>
      <div className="kpi-sub">{ind.note}</div>
    </div>
  )
}

export function MacroTab({ macro, loading }: MacroTabProps) {
  if (loading) {
    return (
      <div className="empty-state" style={{ padding: 32 }}>
        <RefreshCw size={28} className="spin" />
        <div style={{ marginTop: 10 }}>正在讀取總體經濟資料…</div>
      </div>
    )
  }

  if (!macro) {
    return (
      <div className="empty-state" style={{ padding: 32 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>總體經濟資料尚未產生</div>
        <div className="hint" style={{ marginTop: 6 }}>
          盤後批次完成後會自動補上，稍後再回來看看。
        </div>
      </div>
    )
  }

  // 走勢表的欄位＝所有指標出現過的期別聯集，由新到舊。
  // 各指標的發布時程不同（PCE 通常比 CPI 晚一個月），不能假設它們對齊。
  const periods = [
    ...new Set(macro.indicators.flatMap((i) => i.points.map((p) => p.period))),
  ]
    .sort()
    .reverse()
    .slice(0, 12)

  return (
    <div>
      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3 className="head-tight">{macro.region}總體經濟</h3>
          {macro.asOf && (
            <span className="source-tag section-stamp">資料更新於 {fmtUpdatedAt(macro.asOf)}</span>
          )}
        </div>

        {/* 使用者會在個股分析頁看到這一頁，必須先講清楚它不是這檔股票的數字 */}
        <p className="hint" style={{ marginBottom: 12 }}>
          以下是全市場共用的總體經濟背景，<strong>與您正在查看的個股無關</strong>
          ，每檔股票看到的都一樣。
        </p>

        <div className="kpi-grid">
          {macro.indicators.map((ind) => (
            <IndicatorCard key={ind.id} ind={ind} />
          ))}
        </div>
      </section>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>近期走勢</h3>
          <span className="source-tag">單位見各欄標題</span>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>月份</th>
                {macro.indicators.map((ind) => (
                  <th key={ind.id} className="num">
                    {ind.label}（{ind.unit}）
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period}>
                  <td>{fmtPeriod(period)}</td>
                  {macro.indicators.map((ind) => {
                    const p = ind.points.find((x) => x.period === period)
                    return (
                      <td key={ind.id} className="num">
                        {p ? fmtValue(p.value, ind.unit) : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="hint" style={{ marginTop: 8 }}>
          資料來源：美國聖路易聯準銀行 FRED。物價指標為排除食品與能源後的年增率，
          非農就業為較上月增減人數，消費者信心為密西根大學指數。空格代表該期尚未發布。
        </p>
      </section>
    </div>
  )
}
