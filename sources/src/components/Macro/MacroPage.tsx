/**
 * 「總體經濟」頂層頁面：美國五項總體經濟指標。
 *
 * 0.6.5-dev.1 時這是個股分析底下的一個分頁，dev.2 提為頂層頁 ——
 * **這份資料與個股無關**，全市場共用一份。掛在個股分析底下會逼使用者
 * 先選一檔股票，才看得到一份跟那檔股票無關的資料，還得特地印一行
 * 「與您正在查看的個股無關」來補救。提到頂層之後那句話就不必了。
 *
 * 資料來自 `macro/us.json`（全域單檔，非 per-ticker），本元件**自己載入** ——
 * 它不再有父元件可以分發（`AiTab` 需要同一份資料時自己去抓，見該檔說明）。
 *
 * 單位陷阱：三個物價指標是 **%**（年增率）、非農是**千人**（較上月增減）、
 * 消費者信心是**指數值**。一律讀資料自帶的 `unit`，不要在這裡寫死。
 */
import { useCallback, useEffect, useState } from 'react'
import { Globe, RefreshCw } from 'lucide-react'
import { fetchMacro, type MacroData, type MacroIndicator, type MacroPoint } from '../../services/macroProxy'
import { chipClass, fmtUpdatedAt } from '../StockDetail/chipFormat'

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

export function MacroPage() {
  const [macro, setMacro] = useState<MacroData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const m = await fetchMacro()
    setMacro(m)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="glass empty-state section">
        <RefreshCw size={28} className="spin" />
        <div style={{ marginTop: 10 }}>正在讀取總體經濟資料…</div>
      </div>
    )
  }

  if (!macro) {
    return (
      <div className="glass empty-state section">
        <div className="empty-icon">
          <Globe size={36} />
        </div>
        <div>總體經濟資料尚未產生。</div>
        <div className="hint" style={{ marginTop: 6 }}>
          每日排程完成後會自動補上，稍後再回來看看。
        </div>
      </div>
    )
  }

  // 走勢表的欄位＝所有指標出現過的期別聯集，由新到舊。
  // 各指標的發布時程不同（PCE 通常比 CPI 晚一個月），不能假設它們對齊。
  const periods = [...new Set(macro.indicators.flatMap((i) => i.points.map((p) => p.period)))]
    .sort()
    .reverse()
    .slice(0, 12)

  return (
    <>
      {/*
        頂層頁沒有 .detail-body 包著（那是個股分析的容器，padding 在 index.css），
        故自己包 .section + .glass，否則內容會貼齊視窗邊緣。
      */}
      <div className="section glass" style={{ padding: '18px 20px' }}>
        <div className="rpt-section-head">
          <h3 className="head-tight">{macro.region}總體經濟</h3>
          {macro.asOf && (
            <span className="source-tag section-stamp">資料更新於 {fmtUpdatedAt(macro.asOf)}</span>
          )}
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : undefined} />
            重新整理
          </button>
        </div>

        <div className="kpi-grid" style={{ marginTop: 14 }}>
          {macro.indicators.map((ind) => (
            <IndicatorCard key={ind.id} ind={ind} />
          ))}
        </div>
      </div>

      <div className="section glass" style={{ padding: '18px 20px' }}>
        <div className="rpt-section-head">
          <h3>近期走勢</h3>
          <span className="source-tag">單位見各欄標題</span>
        </div>

        <div className="table-scroll" style={{ marginTop: 12 }}>
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
      </div>
    </>
  )
}
