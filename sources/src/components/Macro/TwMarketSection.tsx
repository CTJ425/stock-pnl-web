/**
 * 台股全市場的量能與三大法人買賣金額（0.6.28）。
 *
 * **為什麼放在總經頁而不是年度收益頁**：年度收益回答的是「我賺了多少」（全部是個人
 * 已實現損益），這裡回答的是「市場如何」。兩者放同一頁，讀者每看一個數字都要先判斷
 * 這是自己的還是大盤的。這一頁本來就是「與個股無關的共用背景」，市場量能屬於這裡。
 *
 * 單位陷阱：來源是**元**，畫面一律換算成**億元**（大盤單日成交 8,855 億，
 * 用元顯示是 885,506,043,091 —— 沒有人這樣讀）。個股籌碼的單位是「股」，兩者不可比較。
 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { fetchMarketDaily, type MarketData } from '../../services/marketProxy'
import { BarSeriesChart } from '../Charts/BarSeriesChart'
import { LineSeriesChart } from '../Charts/LineSeriesChart'
import { chipClass, fmtUpdatedAt } from '../StockDetail/chipFormat'

/** 畫面上顯示幾個交易日。約一季，看得出趨勢又不會把 X 軸擠爛 */
const SHOWN_DAYS = 60

/** 元 → 億元。缺值回 null（不以 0 冒充） */
function toBillion(twd: number | null | undefined): number | null {
  return typeof twd === 'number' && Number.isFinite(twd) ? twd / 1e8 : null
}

/** 億元，一位小數；帶正負號（買賣超要看得出方向） */
function fmtBillionSigned(v: number | null): string {
  if (v === null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)} 億`
}

function fmtBillion(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)} 億`
}

/** 'YYYY-MM-DD' → 'MM/DD'（X 軸一格只有約 8px，年份放不下也不需要） */
function shortDate(date: string): string {
  const m = date.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}/${m[2]}` : date
}

export function TwMarketSection() {
  const [market, setMarket] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setMarket(await fetchMarketDaily())
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !market) {
    return (
      <div className="section glass" style={{ padding: '18px 20px' }}>
        <div className="empty-state" style={{ padding: 24 }}>
          <RefreshCw size={24} className="spin" />
          <div style={{ marginTop: 10 }}>正在讀取台股市場資料…</div>
        </div>
      </div>
    )
  }

  if (!market) {
    return (
      <div className="section glass" style={{ padding: '18px 20px' }}>
        <div className="rpt-section-head">
          <h3 className="head-tight">台股市場</h3>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          市場資料尚未產生，盤後排程完成後會自動補上。
        </p>
      </div>
    )
  }

  const days = market.days.slice(-SHOWN_DAYS)
  const latest = days[days.length - 1] ?? null
  /*
    法人金額是逐日回補的，最新幾天常常還沒補到（見 marketProxy 的說明）。
    KPI 取「最近一筆有法人金額的日子」而不是直接讀 latest，
    否則剛收盤那幾小時整排會顯示「—」，看起來像壞掉。
  */
  const latestInst = [...days].reverse().find((d) => d.institutional) ?? null

  // X 軸：60 天每格約 8px，全標會糊成一團 —— 每 10 天標一個（六個標籤）
  const labelIndices = days.map((_, i) => i).filter((i) => i % 10 === 0)

  return (
    <div className="section glass" style={{ padding: '18px 20px' }}>
      <div className="rpt-section-head">
        <h3 className="head-tight">台股市場</h3>
        {market.asOf && (
          <span className="source-tag section-stamp">
            資料更新於 {fmtUpdatedAt(market.asOf)}（共 {market.days.length} 個交易日）
          </span>
        )}
        <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : undefined} />
          重新整理
        </button>
      </div>

      <div className="kpi-grid" style={{ marginTop: 14 }}>
        <div className="glass kpi">
          <div className="kpi-label">成交金額</div>
          <div className="kpi-value">{fmtBillion(toBillion(latest?.tradeValueTwd))}</div>
          <div className="kpi-sub">{latest ? `${latest.date}（最近交易日）` : '—'}</div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">加權指數</div>
          <div className="kpi-value">{latest?.taiex?.toLocaleString('en-US') ?? '—'}</div>
          <div className={`kpi-sub ${chipClass(latest?.changePoints ?? null)}`}>
            {latest?.changePoints === null || latest?.changePoints === undefined
              ? '—'
              : `${latest.changePoints > 0 ? '+' : ''}${latest.changePoints.toFixed(2)} 點`}
          </div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">三大法人買賣超</div>
          <div className={`kpi-value ${chipClass(latestInst?.institutional?.totalTwd ?? null)}`}>
            {fmtBillionSigned(toBillion(latestInst?.institutional?.totalTwd))}
          </div>
          <div className="kpi-sub">
            {latestInst ? `${latestInst.date} 全市場合計` : '尚未補到法人金額'}
          </div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">其中外資</div>
          <div className={`kpi-value ${chipClass(latestInst?.institutional?.foreignTwd ?? null)}`}>
            {fmtBillionSigned(toBillion(latestInst?.institutional?.foreignTwd))}
          </div>
          <div className="kpi-sub">
            投信 {fmtBillionSigned(toBillion(latestInst?.institutional?.trustTwd))}
          </div>
        </div>
      </div>

      <div className="chart-title" style={{ marginTop: 16 }}>
        每日成交金額（億元）
      </div>
      <LineSeriesChart
        points={days.map((d) => ({ label: shortDate(d.date), value: toBillion(d.tradeValueTwd) }))}
        labelIndices={labelIndices}
        formatValue={(v) => `${v.toFixed(1)} 億`}
        ariaLabel={`近 ${days.length} 個交易日的台股成交金額`}
      />

      <div className="chart-title" style={{ marginTop: 16 }}>
        三大法人買賣超（億元）
      </div>
      {/*
        單序列長條走紅正綠負的極性色（不指定 color），與個股籌碼的買賣超圖一致 ——
        方向才是這張圖要傳達的東西，「是誰」在這裡只有一個答案（全市場合計）。
      */}
      <BarSeriesChart
        labels={days.map((d) => shortDate(d.date))}
        series={[
          {
            name: '三大法人合計',
            values: days.map((d) => toBillion(d.institutional?.totalTwd ?? null)),
          },
        ]}
        labelIndices={labelIndices}
        formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} 億`}
        ariaLabel={`近 ${days.length} 個交易日的三大法人買賣超金額`}
      />
      <p className="hint" style={{ marginTop: 8 }}>
        買賣超是全市場的買進金額減掉賣出金額，紅色代表法人整體買超。
        法人金額約 15:00–15:30 公布，且是逐日回補的 —— 最新一兩天沒有長條是還沒補到，
        不是那天沒有法人進出。成交金額與加權指數則收盤後就有。
      </p>
    </div>
  )
}
