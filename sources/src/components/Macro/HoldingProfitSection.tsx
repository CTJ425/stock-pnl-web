/**
 * 「持股獲利能力」：把每一檔持股的四項利率橫向排開比較（0.6.20）。
 *
 * 為什麼放在總經頁：這四項本來就有（`fundamental/{代號}.json` 的 `profitQuarters`），
 * 但目前只出現在「個股分析 → 基本面」，一次看一檔 —— 而「這幾檔誰比較會賺」
 * 是看完就要下判斷的問題，得排在一起才比得出來。
 *
 * ⚠️ **逐檔下載**：持股 N 檔就是 N 個請求（與庫存總覽抓現價同一個量級）。
 * 只對台股發請求 —— 美股與 ETF 在公開資訊觀測站的季報裡根本沒有，
 * 對它們發請求只會換來 N 個 404。
 *
 * ⚠️ 欄位名稱沿用「稅前純益率 / 稅後純益率」，與個股基本面那一頁一致。
 * 同一個數字在兩個地方叫不同名字，比名稱不夠直覺更容易讓人誤判。
 */
import { useEffect, useState } from 'react'
import { PieChart } from 'lucide-react'
import { fetchFundamental, type ProfitQuarter } from '../../services/fundamentalProxy'
import { displayStockName } from '../../services/usStockNames'
import { useWorkspace } from '../../context/WorkspaceContext'
import { CHART_COLORS } from '../Charts/chartColors'
import { sparkline } from './sparkline'

/** 走勢線的 viewBox 尺寸；實際顯示尺寸由 CSS 決定（`.hp-spark`） */
const SPARK_W = 56
const SPARK_H = 20

/** 四個欄位。順序即損益表由上而下的順序：毛利 → 營益 → 稅前 → 稅後 */
const COLUMNS: Array<{ label: string; pick: (q: ProfitQuarter) => number | null }> = [
  { label: '毛利率', pick: (q) => q.grossMarginPercent },
  { label: '營益率', pick: (q) => q.operatingMarginPercent },
  { label: '稅前純益率', pick: (q) => q.pretaxMarginPercent },
  { label: '稅後純益率', pick: (q) => q.netMarginPercent },
]

interface Row {
  key: string
  ticker: string
  name: string
  /** 由舊到新，最多 8 季。空陣列代表這一檔沒有季報資料（ETF / 美股 / 尚未產生） */
  quarters: ProfitQuarter[]
}

/**
 * 利率的百分比。資料本身已經是百分比數值（59.2 代表 59.2%）。
 *
 * 與個股基本面那一頁不同的是**這裡不帶正負號** —— 毛利率不是「變化量」，
 * 掛一個 `+` 會讀起來像是「比上季多 59%」。負值（虧損）本來就會帶負號。
 */
function fmtMargin(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(2)}%`
}

/** 'YYYY-Qn' → 'YYYY Qn'（畫面上不需要那個連字號） */
function fmtQuarter(yq: string | undefined): string {
  return yq ? yq.replace('-', ' ') : '—'
}

function Spark({ values, label }: { values: Array<number | null>; label: string }) {
  const g = sparkline(values, SPARK_W, SPARK_H, 2)
  if (!g) return null
  return (
    <svg
      className="hp-spark"
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path d={g.area} fill={CHART_COLORS.line} opacity="0.16" />
      <polyline
        points={g.line}
        fill="none"
        stroke={CHART_COLORS.line}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={g.lastX} cy={g.lastY} r="2" fill={CHART_COLORS.line} />
    </svg>
  )
}

export function HoldingProfitSection() {
  const { ledger } = useWorkspace()
  const holdings = ledger.holdings
  const [rows, setRows] = useState<Row[] | null>(null)

  // 持股組合變動時重抓。qty 變動不影響獲利能力，故只看代號清單
  const holdingsKey = holdings.map((h) => h.key).sort().join(',')

  useEffect(() => {
    let alive = true
    const targets = holdings.map((h) => ({
      key: h.key,
      ticker: h.ticker,
      name: displayStockName(h.market, h.ticker, h.name),
      // 只有台股個股有季報（來源是公開資訊觀測站的 T187AP17_L）
      fetchable: h.market === 'TPE',
    }))

    void Promise.all(
      targets.map(async (t) => {
        if (!t.fetchable) return { ...t, quarters: [] as ProfitQuarter[] }
        const f = await fetchFundamental(t.ticker)
        return { ...t, quarters: f?.profitQuarters ?? [] }
      }),
    ).then((result) => {
      if (alive) setRows(result)
    })

    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsKey])

  const withData = rows?.filter((r) => r.quarters.length > 0) ?? []
  const latestQuarter = withData
    .map((r) => r.quarters[r.quarters.length - 1]?.yearQuarter ?? '')
    .sort()
    .pop()

  return (
    <div className="section glass" style={{ padding: '18px 20px' }}>
      <div className="rpt-section-head">
        <h3 className="head-tight">持股獲利能力</h3>
        <span className="source-tag section-stamp">
          季頻・資料來源公開資訊觀測站
          {latestQuarter && `・最新季別 ${fmtQuarter(latestQuarter)}`}
        </span>
      </div>

      {rows === null ? (
        <p className="hint" style={{ marginTop: 12 }}>
          正在讀取持股的獲利能力…
        </p>
      ) : withData.length === 0 ? (
        <div className="empty-state" style={{ padding: '26px 20px' }}>
          <div className="empty-icon">
            <PieChart size={32} />
          </div>
          <div>持股的季度獲利能力尚未產生。</div>
          <div className="hint" style={{ marginTop: 6 }}>
            每晚的批次會逐檔補上，稍後再回來看看。若你的持股都是 ETF 或美股，這一區會一直是空的。
          </div>
        </div>
      ) : (
        <>
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>持股</th>
                  <th>最新季別</th>
                  {COLUMNS.map((c) => (
                    <th key={c.label} className="num">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const latest = r.quarters[r.quarters.length - 1]
                  return (
                    <tr key={r.key}>
                      <td className="hp-name">
                        <b>{r.ticker}</b>
                        <span>{r.name}</span>
                      </td>
                      <td className="ast-mono">{fmtQuarter(latest?.yearQuarter)}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.label} className="num">
                          {latest ? (
                            <span className="hp-cell">
                              <span className="hp-val">{fmtMargin(c.pick(latest))}</span>
                              <Spark
                                values={r.quarters.map(c.pick)}
                                label={`${r.ticker} ${c.label}近 ${r.quarters.length} 季走勢`}
                              />
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="hint" style={{ marginTop: 8 }}>
            走勢線為近 8 季。<b>只有台股個股有這份資料</b> —— 來源是公開資訊觀測站的季報，
            ETF 與美股不在裡面，顯示「—」是正常的，不是抓取失敗。
          </p>
        </>
      )}
    </div>
  )
}
