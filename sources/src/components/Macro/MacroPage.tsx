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
import { ChevronsDownUp, ChevronsUpDown, Globe, Minus, Plus, RefreshCw } from 'lucide-react'
import { fetchMacro, type MacroData, type MacroIndicator, type MacroPoint } from '../../services/macroProxy'
import { chipClass, fmtUpdatedAt } from '../StockDetail/chipFormat'
import { CHART_COLORS } from '../Charts/chartColors'
import { SPARK_W, SparkCell } from '../Charts/SparkCell'
import { latestPeriod, periodsBehind } from './macroPeriod'
import { TwMarketSection } from './TwMarketSection'

/** 兩個 ISO 時間是否落在同一個本地日曆日。壞值一律視為不同日（寧可多顯示一行） */
function isSameDay(a: string, b: string): boolean {
  const da = new Date(a)
  const db = new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
  return da.toDateString() === db.toDateString()
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

/** 與前一期的差；兩期都要有值才算得出來（缺一期回 null，不以 0 冒充「持平」） */
function delta(latest: MacroPoint | null, previous: MacroPoint | null): number | null {
  const a = latest?.value
  const b = previous?.value
  if (typeof a !== 'number' || typeof b !== 'number') return null
  return a - b
}

/** 帶正負號的變化量。單位跟著指標走（千人不取小數、其餘兩位） */
function fmtDelta(d: number | null, unit: string): string {
  if (d === null) return '—'
  if (Math.abs(d) < 0.005) return '持平'
  const shown = unit === '千人' ? Math.abs(d).toLocaleString('en-US') : Math.abs(d).toFixed(2)
  return `${d > 0 ? '+' : '−'}${shown}`
}

/**
 * 每一期與其前一期的差，由舊到新，長度與 `points` 相同（第一期沒有前一期，為 null）。
 * 表格的顏色、走勢線方向、連續判定全部由這一份推導，避免三處各算一次而漂移。
 */
function deltaSeries(points: MacroPoint[]): Array<number | null> {
  return points.map((p, i) => (i === 0 ? null : delta(p, points[i - 1])))
}

/**
 * 連續同向的期數（0.6.34），仿台股法人表的「連續」欄。
 *
 * **但判定的東西不一樣，不能直接沿用 `trendAt`**：法人買賣超看的是金額的正負號
 * （買超 / 賣超本身就有方向），而 CPI 年增率永遠是正的，正負號沒有意義 ——
 * 這裡看的是**與前一期相比的升降**。
 *
 * `points` 由舊到新。缺值的期別會中斷計算：把它當成「與前一期相同」會把兩段
 * 不相干的升勢接成一段，比少報一期更糟。
 */
function risingStreak(points: MacroPoint[]): { direction: 1 | -1; periods: number } | null {
  const values: number[] = []
  for (const p of points) {
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) values.length = 0
    else values.push(p.value)
  }
  if (values.length < 3) return null
  const direction = Math.sign(values[values.length - 1] - values[values.length - 2])
  if (direction === 0) return null
  let periods = 0
  for (let i = values.length - 1; i > 0; i--) {
    if (Math.sign(values[i] - values[i - 1]) !== direction) break
    periods++
  }
  // 連 1 期不是趨勢，只是「這期比上期高」，而那句話上面那行已經說了
  return periods >= 2 ? { direction: direction as 1 | -1, periods } : null
}

/**
 * 瘦身後的指標 chip（0.6.35 取代原本的五張 KPI 卡）。
 *
 * 只留名稱與最新值：期別、較上期、走勢、連續、說明全部在下方那張表裡，
 * 卡片版等於把同一份數字說兩次。這一行的用途只有「現在幾 %」的快速一覽。
 */
function IndicatorChip({ ind }: { ind: MacroIndicator }) {
  return (
    <div className="mac-chip">
      <span className="mac-chip-label">{ind.label}</span>
      <span className="mac-chip-value">{fmtValue(ind.latest?.value ?? null, ind.unit)}</span>
    </div>
  )
}

/**
 * 展開某個指標的逐期明細（0.6.35）。
 *
 * 巢狀表格的寫法與台股法人表的 `DayDetail` 一致：明細是「期別 × 數值 / 較上期」，
 * 與父列的欄位形狀不同，硬塞進同一組欄位只會逼出一堆 colSpan 佔位格。
 * 由新到舊，與父表相反 —— 表格第一列要是最近的那期，走勢線才由舊到新。
 */
function IndicatorDetail({ ind }: { ind: MacroIndicator }) {
  const deltas = deltaSeries(ind.points)
  const rows = ind.points.map((p, i) => ({ point: p, d: deltas[i] })).reverse()
  return (
    <tr className="detail-row">
      {/* 指標欄 + 最新 + 較上期 + 趨勢 + 連續 */}
      <td colSpan={5} style={{ padding: '4px 14px 10px 34px' }}>
        <table className="data-table" style={{ minWidth: 0, fontSize: 12.5 }}>
          <thead>
            <tr>
              <th>{ind.label} 明細</th>
              <th className="num">數值</th>
              <th className="num">較上期</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ point, d }) => (
              <tr key={point.period}>
                <td>{fmtPeriod(point.period)}</td>
                <td className={`num ${chipClass(d)}`}>{fmtValue(point.value, ind.unit)}</td>
                <td className={`num ${chipClass(d)}`}>{fmtDelta(d, ind.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  )
}

/**
 * 指標列：一列一個指標，右側掛自己的趨勢線與連續期數（0.6.35）。
 *
 * ⚠️ **顏色的規則是「紅＝比上期高、綠＝比上期低」，紅不等於好。**
 * 0.6.34 之前非農就業是依**數值正負**上色（就業人數增加＝紅），改成全表一致之後
 * 它跟著看升降 —— 所以「+57 千人但比上期少 72」現在是綠的。同一張表不能有些格子
 * 紅代表「值是正的」、有些代表「比上期高」，兩套規則並存比一套規則更難讀。
 * 表格下方那句 hint 就是為了講明這件事，不可刪。
 *
 * 走勢線畫的是**該指標自己的 12 期數值**（不是升降量）：使用者要看的是
 * 「這個指標往哪走」，畫升降量會變成一條在 0 上下跳的線，看不出水位。
 */
function IndicatorRow({
  ind,
  behind,
  open,
  onToggle,
}: {
  ind: MacroIndicator
  behind: number
  open: boolean
  onToggle: () => void
}) {
  const d = delta(ind.latest, ind.previous)
  const streak = risingStreak(ind.points)
  const canExpand = ind.points.length > 0
  return (
    <>
      <tr>
        <td>
          <div className="cell-tree">
            {canExpand ? (
              <button
                className="year-toggle"
                onClick={onToggle}
                aria-expanded={open}
                aria-label={`${open ? '收合' : '展開'} ${ind.label} 的逐期明細`}
              >
                {open ? <Minus size={13} /> : <Plus size={13} />}
              </button>
            ) : (
              <span className="toggle-slot" />
            )}
            <div>
              <div className="mac-row-label">
                {ind.label}
                {/* 只有落後時才掛徽章：五列都掛「最新」等於沒有訊號 */}
                {behind > 0 && <span className="badge badge-warn">落後 {behind} 期</span>}
              </div>
              <div className="mac-row-note">{ind.note}</div>
            </div>
          </div>
        </td>
        <td className={`num ${chipClass(d)}`}>
          <div>{fmtValue(ind.latest?.value ?? null, ind.unit)}</div>
          <div className="mac-row-period">{fmtPeriod(ind.latest?.period)}</div>
        </td>
        <td className={`num ${chipClass(d)}`}>{fmtDelta(d, ind.unit)}</td>
        <td className="num" style={{ width: SPARK_W + 18 }}>
          <SparkCell
            points={ind.points.map((p) => p.value)}
            color={d === null ? CHART_COLORS.axis : d > 0 ? CHART_COLORS.up : CHART_COLORS.down}
            ariaLabel={`${ind.label}近 ${ind.points.length} 期走勢`}
          />
        </td>
        <td
          className={`num ${streak ? chipClass(streak.direction) : ''}`}
          style={{ whiteSpace: 'nowrap' }}
        >
          {streak ? (
            <>
              連 {streak.periods} 期{streak.direction > 0 ? '上升' : '下降'}
              {/* 落後中的指標，那個「連續」的末端不是現在，不講清楚會被讀成當前趨勢 */}
              {behind > 0 && <div className="mac-row-period">截至該期</div>}
            </>
          ) : (
            '—'
          )}
        </td>
      </tr>
      {open && <IndicatorDetail ind={ind} />}
    </>
  )
}

export function MacroPage() {
  const [macro, setMacro] = useState<MacroData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const m = await fetchMacro()
    setMacro(m)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /*
    美國那份的載入中／查無狀態底下仍然掛著台股市場（0.6.28）：
    兩塊資料各自載入、各自失敗，美國 FRED 抓不到不該讓整頁只剩一句「尚未產生」。
  */
  if (loading) {
    return (
      <>
        <div className="glass empty-state section">
          <RefreshCw size={28} className="spin" />
          <div style={{ marginTop: 10 }}>正在讀取總體經濟資料…</div>
        </div>
        <TwMarketSection />
      </>
    )
  }

  if (!macro) {
    return (
      <>
        <div className="glass empty-state section">
          <div className="empty-icon">
            <Globe size={36} />
          </div>
          <div>總體經濟資料尚未產生。</div>
          <div className="hint" style={{ marginTop: 6 }}>
            每日排程完成後會自動補上，稍後再回來看看。
          </div>
        </div>
        <TwMarketSection />
      </>
    )
  }

  // 落後判定的基準是「同組其他指標最新到哪一期」，不查發布行事曆（見 macroPeriod.ts）
  const peerLatest = latestPeriod(macro.indicators.map((i) => i.latest?.period))

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /*
    「全部展開」只認展得開的列（有 points 的）——若把沒有資料的指標也算進來，
    allOpen 永遠是 false，按鈕會卡在「全部展開」按不動（同法人表與年度收益頁的處置）。
  */
  const expandable = macro.indicators.filter((i) => i.points.length > 0).map((i) => i.id)
  const allOpen = expandable.length > 0 && expandable.every((id) => expanded.has(id))
  const toggleAll = () => setExpanded(allOpen ? new Set() : new Set(expandable))

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
            <span className="source-tag section-stamp">
              資料更新於 {fmtUpdatedAt(macro.asOf)}
              {/*
                0.6.11 起 asOf 只在資料真的變動時才跳，月度數據一個月才動一次 ——
                單看它會像是壞掉了。同日的檢查時間沒有資訊量（就是 asOf 本身），
                只在不同日時才補上，讓「這個月還沒發布」與「排程掛了」分得開。
              */}
              {macro.checkedAt && !isSameDay(macro.checkedAt, macro.asOf) && (
                <>（最後檢查 {fmtUpdatedAt(macro.checkedAt)}）</>
              )}
            </span>
          )}
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : undefined} />
            重新整理
          </button>
        </div>

        {/* 瘦身成一行（0.6.35）：細節全在下方的表，卡片版等於把同一份數字說兩次 */}
        <div className="mac-chip-row">
          {macro.indicators.map((ind) => (
            <IndicatorChip key={ind.id} ind={ind} />
          ))}
        </div>
      </div>

      {/*
        一列一個指標（0.6.35，原本是一列一個月份）。

        **為什麼要轉置**：法人表的「趨勢／連續」描述的是「合計」這一個序列，
        而五個總經指標沒有合計可言（單位是 %、千人、指數，加總沒有意義）。
        轉成一列一個指標之後，趨勢與連續描述的就是該指標自己的 12 期 —— 語意才成立，
        而且對回法人表「一列一個東西 ＋ 它自己的趨勢與連續」的形狀。

        代價是「同一個月五個指標」要橫著看，這是刻意接受的取捨。
      */}
      <div className="section glass" style={{ padding: '18px 20px' }}>
        <div className="rpt-section-head">
          <div className="chart-title">近期走勢・近 12 期</div>
          {expandable.length > 0 && (
            <button className="btn btn-sm" onClick={toggleAll}>
              {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
              {allOpen ? '全部收起' : '全部展開'}
            </button>
          )}
        </div>

        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>指標</th>
                <th className="num">最新</th>
                <th className="num">較上期</th>
                <th className="num">趨勢</th>
                <th className="num">連續</th>
              </tr>
            </thead>
            <tbody>
              {macro.indicators.map((ind) => (
                <IndicatorRow
                  key={ind.id}
                  ind={ind}
                  behind={periodsBehind(ind.latest?.period ?? null, peerLatest)}
                  open={expanded.has(ind.id)}
                  onToggle={() => toggle(ind.id)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/*
          這句不可刪：全表改用升降色之後，非農就業的紅綠不再代表「就業增加 / 減少」，
          而是「比上期高 / 低」。沒有這句，紅色會被讀成「好消息」。
        */}
        <p className="hint" style={{ marginTop: 8 }}>
          紅色代表比上期高、綠色代表比上期低；升降本身沒有好壞之分。
          點左側的「＋」看該指標逐期的數字。資料來源：美國聖路易聯準銀行 FRED。
        </p>
      </div>

      {/*
        台股市場擺在美國總經之後：這一頁的主軸是「與個股無關的市場背景」，
        兩塊都屬於它。自己載入自己的資料（同本頁的做法），互不影響 ——
        美國那份抓不到時，台股這段照樣看得到。
      */}
      <TwMarketSection />
    </>
  )
}
