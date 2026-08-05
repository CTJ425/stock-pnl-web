/**
 * The volume of the entire Taiwan stock market can be compared with the trading volume of the three major legal persons (0.6.28).
 *
 * **Why put it on the general economic page instead of the annual income page**: The annual income answers "how much I earned" (all personal
 * Realized profit and loss), the answer here is "How is the market?" Put both on the same page. Readers must judge first every time they look at a number.
 * Is this your own or the market's? This page is originally a "common background unrelated to individual stocks", and market volume can belong here.
 *
 * Unit trap: The source is **yuan**, and the screen is converted into **billion yuan** (the market's single-day turnover is 885.5 billion,
 * In meta it is 885,506,043,091 - no one reads it that way). The unit of individual stock chips is "share", and the two are not comparable.
 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, Minus, Plus, RefreshCw } from 'lucide-react'
import {
  fetchMarketDaily,
  type MarketData,
  type MarketDay,
  type MarketInstitutionalSide,
} from '../../services/marketProxy'
import { CandleChart } from '../Charts/CandleChart'
import { LineSeriesChart } from '../Charts/LineSeriesChart'
import { CHART_COLORS } from '../Charts/chartColors'
import { SPARK_W, SparkCell } from '../Charts/SparkCell'
import { chipClass, fmtUpdatedAt } from '../StockDetail/chipFormat'

/** The trading amount and the market K-line show several trading days. After about one season, you can see the trend without crushing the X-axis.*/
const SHOWN_DAYS = 60

/**
 * The trading super of the three major legal persons only looks at the last 7 trading days (0.6.30).
 *
 * Consistent with the chip chart of individual stock analysis (where HISTORY_DAYS = 7) - the two charts ask the same question
 * "Is the legal person buying or selling these days?" If you look at one picture for a week and the other for a season, you will think that you are comparing different things.
 * Volume energy and index can last for one season: those two ask "where is the market?" and require a longer context.
 */
const INSTITUTIONAL_DAYS = 7

/** Yuan → billion yuan. Returns null if the value is missing (do not pretend to be 0)*/
function toBillion(twd: number | null | undefined): number | null {
  return typeof twd === 'number' && Number.isFinite(twd) ? twd / 1e8 : null
}

/** 100 million yuan, one decimal place; with plus or minus sign (you need to be able to see the direction when buying and selling super)*/
function fmtBillionSigned(v: number | null): string {
  if (v === null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)} 億`
}

function fmtBillion(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)} 億`
}

/** 'YYYY-MM-DD' → 'MM/DD' (the X-axis grid is only about 8px, so there is no need to fit the year)*/
function shortDate(date: string): string {
  const m = date.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}/${m[2]}` : date
}

/**
 * The height of each of the three pictures stacked one on top of the other (0.6.34).
 *
 * The total height of the stacked elements is the sum of the three. Using the 220 when placed side by side will turn this section into a 700px wall.
 * The K line and the trend line are at the same height (they are two ways of drawing the same index), and the transaction amount is a bit lower -
 * It is a supporting role. It is more effective to describe the master-slave relationship in a high degree than to add a line to explain it.
 */
const STACK_CHART_H = 180
const STACK_VOLUME_H = 140

/**
 * Look at the trend line of the trend bar for a few days (0.6.32).
 *
 * Deliberately longer than the 7 columns of the table: if we only use those days in the table, there will be only one dot in the first column and no line can be drawn, and two dots in the second column.
 * Nothing can be seen. Taking 15 days allows each column to have enough context, at the cost of the lines in the oldest columns extending out of the table.
 * ——But that's exactly what "trend" should mean: it answers "what's the trend today", not "what's happening in the table."
 */
const TREND_DAYS = 15

/** The display order and column names of the six units. The table header, expansion details, and KPIs should all be included to avoid drifting due to writing each of the three places once.*/
const UNITS: ReadonlyArray<{ key: keyof MarketInstitutionalSide; label: string }> = [
  { key: 'foreignTwd', label: '外資' },
  { key: 'foreignDealerTwd', label: '外資自營商' },
  { key: 'trustTwd', label: '投信' },
  { key: 'dealerSelfTwd', label: '自營商（自行）' },
  { key: 'dealerHedgeTwd', label: '自營商（避險）' },
  { key: 'totalTwd', label: '合計' },
]

/**
 * The total buying and selling trend up to a certain day and the number of consecutive days in the same direction.
 *
 * `values` is from old to new and **only contains the days of the legal person amount** - leaving the days that have not been filled up in the sequence,
 * The trend line will have a breakpoint out of thin air, and the number of consecutive days will be interrupted by a "not yet made up" and reported low.
 */
function trendAt(values: number[], endIdx: number): { points: number[]; streak: number } {
  const points = values.slice(Math.max(0, endIdx - TREND_DAYS + 1), endIdx + 1)
  const last = values[endIdx]
  let streak = 0
  if (last !== undefined && last !== 0) {
    const sign = Math.sign(last)
    for (let i = endIdx; i >= 0 && Math.sign(values[i]) === sign; i--) streak++
  }
  return { points, streak }
}

/**
 * Trend and two consecutive grids (0.6.33 split by one grid).
 *
 * **Why it must be divided into two columns**: Originally, the trend line and "N consecutive days" were squeezed into the same grid on the right row.
 * The labeled columns will push the lines to the left, and the beginning and end of the lines in the entire column will not be aligned, making it look like the trend range of each column is different.
 * After the columns are divided, the lines have a fixed width and fixed position, so that the columns can be compared.
 *
 * The trend line uses **polar colors** (red for buying and green for selling, according to the direction of the last day); when the line cannot be drawn, `SparkCell` prints "—" by itself.
 */
function TrendCells({ points, streak }: { points: number[]; streak: number }) {
  const last = points[points.length - 1]
  if (last === undefined) {
    return (
      <>
        <td className="num">—</td>
        <td className="num">—</td>
      </>
    )
  }
  const color = last > 0 ? CHART_COLORS.up : last < 0 ? CHART_COLORS.down : CHART_COLORS.axis
  // 1 consecutive day is not a trend and will not be printed (at this time, the continuous column is given "—" instead of leaving it blank, which will be read as missing data)
  const label = streak >= 2 ? `連 ${streak} 日${last > 0 ? '買超' : '賣超'}` : null
  return (
    <>
      <td className="num" style={{ width: SPARK_W + 18 }}>
        <SparkCell
          points={points}
          color={color}
          ariaLabel={`近 ${points.length} 個交易日的三大法人合計買賣超走勢`}
        />
      </td>
      <td className={`num ${label ? chipClass(last) : ''}`} style={{ whiteSpace: 'nowrap' }}>
        {label ?? '—'}
      </td>
    </>
  )
}

/**
 * Expand the buy/sell details for a certain day.
 *
 * **The nested table is used here, which is contrary to the disposal of annual income**, and it is deliberate: the detail column over there is the same as the parent column
 * It’s the same set of fields (same amount, same caliber), and the column widths must be aligned to be readable; the details here are
 * "Six units × buy / sell / buy and sell over" is fundamentally different from the "six units in each column" of the parent column.
 * Forcing the same set of columns will just force a bunch of colSpan placeholders.
 */
function DayDetail({ day }: { day: MarketDay }) {
  const buy = day.institutional?.buy
  const sell = day.institutional?.sell
  return (
    <tr className="detail-row">
      {/* 日期欄 + 六個單位 + 趨勢 + 連續 */}
      <td colSpan={UNITS.length + 3} style={{ padding: '4px 14px 10px 34px' }}>
        <table className="data-table" style={{ minWidth: 0, fontSize: 12.5 }}>
          <thead>
            <tr>
              <th>{day.date} 明細</th>
              <th className="num">買進</th>
              <th className="num">賣出</th>
              <th className="num">買賣超</th>
            </tr>
          </thead>
          <tbody>
            {UNITS.map((u) => {
              const b = toBillion(buy?.[u.key] ?? null)
              const s = toBillion(sell?.[u.key] ?? null)
              const n = toBillion(day.institutional?.[u.key] ?? null)
              return (
                <tr key={u.key}>
                  <td>{u.label}</td>
                  <td className="num">{fmtBillion(b)}</td>
                  <td className="num">{fmtBillion(s)}</td>
                  <td className={`num ${chipClass(n)}`}>{fmtBillionSigned(n)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </td>
    </tr>
  )
}

export function TwMarketSection() {
  const [market, setMarket] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /*
    三張圖共用的 hover 索引（0.6.34）。放在這裡而不是各圖自持，是為了讓滑到某一天時
    K 線、指數走勢、成交金額同時反白同一天 —— 使用者問的是「那天發生什麼」，
    不是「那天的指數是多少」。索引對得起來的前提是三張圖吃同一組 days（見下方 candles）。
  */
  const [hover, setHover] = useState<number | null>(null)

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
  const instDays = market.days.slice(-INSTITUTIONAL_DAYS)
  /*
    K 線要開高低收四個價，缺任何一個那根就不畫 —— 開高低與收盤是不同來源，
    最新一兩天可能只有收盤。**但那一天的欄位要留著**（0.6.34）：三張圖疊起來共用
    一個 hover 索引，把不完整的日子過濾掉會讓 K 線的第 N 根不是另外兩張的第 N 天。
    用收盤補開高低仍然不行，那會畫出一整排十字線，看起來像那天真的沒有波動。
  */
  const candles = days.map((d) => ({
    label: shortDate(d.date),
    open: d.taiexOpen,
    high: d.taiexHigh,
    low: d.taiexLow,
    close: d.taiex,
  }))
  const drawableCandles = candles.filter(
    (c) => c.open !== null && c.high !== null && c.low !== null && c.close !== null,
  ).length
  const latest = days[days.length - 1] ?? null
  /*
    法人金額是逐日回補的，最新幾天常常還沒補到（見 marketProxy 的說明）。
    KPI 取「最近一筆有法人金額的日子」而不是直接讀 latest，
    否則剛收盤那幾小時整排會顯示「—」，看起來像壞掉。
  */
  const latestInst = [...days].reverse().find((d) => d.institutional) ?? null

  /*
    趨勢欄的底稿：取全部 60 天裡「有法人金額」的日子，由舊到新。
    表格只有 7 列，但走勢要看 15 天 —— 所以底稿不能只用 instDays。
  */
  const trendDays = days.filter((d) => d.institutional?.totalTwd != null)
  const trendValues = trendDays.map((d) => d.institutional!.totalTwd!)
  const trendIdx = new Map(trendDays.map((d, i) => [d.date, i]))

  const toggle = (date: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })

  /*
    「全部展開」只認**展得開**的列（有買進 / 賣出明細的）。
    若把還沒補到明細的舊資料日也算進來，allOpen 永遠是 false，
    按鈕會卡在「全部展開」按不動 —— 同 YearlyPage 只計 sells 不為空的個股。
  */
  const expandable = instDays.filter((d) => d.institutional?.buy).map((d) => d.date)
  const allOpen = expandable.length > 0 && expandable.every((d) => expanded.has(d))
  const toggleAll = () => setExpanded(allOpen ? new Set() : new Set(expandable))

  // X-axis: 60 days each grid is about 8px, all labels will be mushy - one label every 10 days (six labels).
  // The three pictures have the same set of indexes and the same set of labels, so the X-axis can really match up.
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

      {/*
        三張圖上中下疊放、共用同一個 hover 索引（0.6.34；0.6.33 是 K 線與走勢線左右並排）。

        **Why is it up and down instead of left and right**: Swipe to a certain day to see the amplitude, index position and energy of that day at the same time.
        而三張圖只有在同寬、同一組 X 軸、同一個索引時，crosshair 才會落在同一天。
        左右並排的話每張只有一半寬度，同一個像素位置代表的日子不一樣。

        `hover` 由這裡持有、傳給三張圖，所以滑鼠在任何一張上都會三張一起反白，
        三個 tooltip 各報自己那件事（K 線報開高低收、走勢線報指數、金額報億元）。
      */}
      <div style={{ marginTop: 16 }}>
        <div className="chart-title">加權指數日 K（近 {drawableCandles} 個交易日）</div>
        {drawableCandles === 0 ? (
          <p className="hint">開高低尚未補到，暫時畫不出 K 線（收盤指數見上方 KPI）。</p>
        ) : (
          <CandleChart
            candles={candles}
            labelIndices={labelIndices}
            height={STACK_CHART_H}
            formatValue={(v) => v.toFixed(2)}
            ariaLabel={`近 ${drawableCandles} 個交易日的加權指數日 K 線`}
            hoverIndex={hover}
            onHover={setHover}
            crosshair
          />
        )}
      </div>

      <div className="chart-title" style={{ marginTop: 14 }}>
        加權指數走勢（收盤）
      </div>
      <LineSeriesChart
        points={days.map((d) => ({ label: shortDate(d.date), value: d.taiex }))}
        labelIndices={labelIndices}
        height={STACK_CHART_H}
        formatValue={(v) => v.toFixed(2)}
        ariaLabel={`近 ${days.length} 個交易日的加權指數收盤走勢`}
        hoverIndex={hover}
        onHover={setHover}
      />

      <div className="chart-title" style={{ marginTop: 14 }}>
        每日成交金額（億元）
      </div>
      <LineSeriesChart
        points={days.map((d) => ({ label: shortDate(d.date), value: toBillion(d.tradeValueTwd) }))}
        labelIndices={labelIndices}
        height={STACK_VOLUME_H}
        formatValue={(v) => `${v.toFixed(1)} 億`}
        ariaLabel={`近 ${days.length} 個交易日的台股成交金額`}
        hoverIndex={hover}
        onHover={setHover}
      />

      {/*
        **The table is from new to old, and the trend chart is from old to new** - consistent with the treatment of monthly revenue and profitability:
        走勢圖左邊必須是比較早的日子，而表格第一列要是最近的那天。
        兩者方向刻意相反，不是筆誤。

        原本這裡還有一張法人買賣超長條圖，0.6.33 移除：同一份數字已經有表格（看得到金額）
        與趨勢欄（看得出方向），長條圖是第三種說法，只是把卡片拉長。
      */}
      <div className="rpt-section-head" style={{ marginTop: 18 }}>
        <div className="chart-title">
          三大法人買賣超（億元）・近 {instDays.length} 個交易日
        </div>
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
              <th>日期</th>
              {UNITS.map((u) => (
                <th className="num" key={u.key}>
                  {u.label}
                </th>
              ))}
              <th className="num">趨勢</th>
              <th className="num">連續</th>
            </tr>
          </thead>
          <tbody>
            {[...instDays].reverse().map((d) => {
              const inst = d.institutional
              const idx = trendIdx.get(d.date)
              const { points, streak } = idx === undefined
                ? { points: [], streak: 0 }
                : trendAt(trendValues, idx)
              const isOpen = expanded.has(d.date)
              // Buying/selling was only saved in 0.6.32. The old data only has the difference - no expand button will be given without details.
              const canExpand = Boolean(inst?.buy)
              return (
                <Fragment key={d.date}>
                  <tr>
                    <td>
                      <div className="cell-tree">
                        {canExpand ? (
                          <button
                            className="year-toggle"
                            onClick={() => toggle(d.date)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? '收合' : '展開'} ${d.date} 的買進賣出明細`}
                          >
                            {isOpen ? <Minus size={13} /> : <Plus size={13} />}
                          </button>
                        ) : (
                          <span className="toggle-slot" />
                        )}
                        {d.date}
                      </div>
                    </td>
                    {/* 這一天還沒補到法人金額時整列給「—」，不要用 0 冒充 */}
                    {UNITS.map((u) => {
                      const b = toBillion(inst?.[u.key] ?? null)
                      return (
                        <td className={`num ${chipClass(b)}`} key={u.key}>
                          {fmtBillionSigned(b)}
                        </td>
                      )
                    })}
                    <TrendCells points={points} streak={streak} />
                  </tr>
                  {isOpen && <DayDetail day={d} />}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/*
        0.6.33 由兩大段砍成一句。原本連抓取週期都寫在這裡，但那是排程的事、
        使用者看盤時不需要，而且前端自備一份班次常數必然與 pg_cron 漂移
        （實際就漂了：寫著「最多 5 天」時後端已經是 15）。整段移到後台的抓取狀況頁。
      */}
      <p className="hint" style={{ marginTop: 8 }}>
        買賣超＝買進金額−賣出金額，紅色為買超；「—」是那天還沒補到，不是沒有進出。
      </p>
    </div>
  )
}
