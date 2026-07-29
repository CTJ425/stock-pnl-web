/**
 * 匯率換算與走勢區間的純函式。
 *
 * 抽出來的理由與 technicalView.ts / chipStreak.ts 相同：這些是這個 feature
 * 唯一真正會算錯的地方（除以 0、區間切錯、千分位解析），把它們留在元件裡就只能靠
 * render 出來的字串反推，測不乾淨。
 *
 * **方向約定：`rate` 一律是「1 單位外幣可換多少台幣」**，與後端
 * supabase/functions/stock-report/fxRates.ts 的 FxPoint 一致。反向不另存一份。
 *
 * 0.6.7 移除換算器後，金額換算與輸入解析（twdToForeign / foreignToTwd /
 * parseAmount / formatAmount）一併刪除 —— 沒有呼叫端的函式留著只會被誤以為還有人用。
 */
import type { FxPoint } from '../../services/fxProxy'

export type FxRange = '3m' | '6m' | '1y'

export const FX_RANGES: readonly { id: FxRange; label: string; months: number }[] = [
  { id: '3m', label: '3 個月', months: 3 },
  { id: '6m', label: '6 個月', months: 6 },
  { id: '1y', label: '1 年', months: 12 },
]

/** 匯率顯示：各幣別量級差很大，小數位數由幣別自帶（KRW 需要 5 位） */
export function formatRate(v: number | null, decimals: number): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return v.toFixed(decimals)
}

/**
 * 依數值量級決定小數位（取約 5 位有效數字），夾在 2～6 位之間。
 *
 * 用在**反向**那張圖：幣別自帶的 `decimals` 是為正向量級挑的，倒過來就不合用了。
 * 1 TWD 可換的外幣量級跨了四個數量級：
 *   美元 0.030958（要 6 位）／日圓 5.0710（4 位）／韓元 45.366（3 位）
 * 一律沿用正向的位數，不是全變 0.031 就是變 5.0710000。
 */
export function autoDecimals(v: number | null): number {
  if (v === null || !Number.isFinite(v) || v === 0) return 2
  const mag = Math.floor(Math.log10(Math.abs(v)))
  return Math.min(Math.max(4 - mag, 2), 6)
}

/**
 * 取倒數序列：「1 外幣 = N 台幣」→「1 台幣 = N 外幣」。
 *
 * 注意這**不是把圖上下翻轉**：1/x 是非線性的，兩張圖的形狀不會互為鏡像，
 * 高低點的日期會對調（正向的最高點就是反向的最低點）。這是數學事實，不是 bug。
 *
 * 0 一律跳過（不可能，但除以 0 會產生 Infinity 汙染整個值域計算）。
 */
export function invertPoints(points: FxPoint[]): FxPoint[] {
  const out: FxPoint[] = []
  for (const [date, rate] of points) {
    if (!Number.isFinite(rate) || rate === 0) continue
    out.push([date, 1 / rate])
  }
  return out
}

/**
 * 取最近 N 個月的資料。
 *
 * **基準點是序列的最後一天，不是今天。** 資料若停在幾天前（排程掛掉、假日），
 * 用今天當基準會讓「3 個月」實際上只剩兩個多月，圖會莫名其妙變短；
 * 以資料本身的最後一天回推，看到的永遠是「這份資料最近三個月」。
 */
export function sliceByRange(points: FxPoint[], range: FxRange): FxPoint[] {
  if (points.length === 0) return []
  const months = FX_RANGES.find((r) => r.id === range)?.months ?? 12
  const last = points[points.length - 1][0]
  const d = new Date(`${last}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return points
  d.setUTCMonth(d.getUTCMonth() - months)
  const cutoff = d.toISOString().slice(0, 10)
  return points.filter((p) => p[0] >= cutoff)
}

/** 變動百分比。基期為 0 時回 null（不硬算） */
export function changePct(latest: number | null, base: number | null): number | null {
  if (latest === null || base === null) return null
  if (!Number.isFinite(latest) || !Number.isFinite(base) || base === 0) return null
  return (latest / base - 1) * 100
}

export interface RangeStats {
  high: number
  highDate: string
  low: number
  lowDate: string
  /** 區間首尾的漲跌幅（%），只有一筆時為 null */
  changePct: number | null
}

/** 區間高低與首尾漲跌幅。空序列回 null */
export function rangeStats(points: FxPoint[]): RangeStats | null {
  if (points.length === 0) return null
  let hi = points[0]
  let lo = points[0]
  for (const p of points) {
    if (p[1] > hi[1]) hi = p
    if (p[1] < lo[1]) lo = p
  }
  return {
    high: hi[1],
    highDate: hi[0],
    low: lo[1],
    lowDate: lo[0],
    changePct: points.length > 1 ? changePct(points[points.length - 1][1], points[0][1]) : null,
  }
}

/**
 * X 軸要標哪幾格。一年份有 260 個點，全部標會糊成一團黑。
 *
 * 平均取 `want` 個（含頭尾），交給 ChartFrame 的 labelIndices。
 */
export function labelIndicesFor(n: number, want = 6): number[] {
  if (n <= 0) return []
  if (n <= want) return Array.from({ length: n }, (_, i) => i)
  const step = (n - 1) / (want - 1)
  return Array.from({ length: want }, (_, i) => Math.round(i * step))
}

/**
 * 資料是否過期。
 *
 * 為什麼要有這個判斷：Storage 上的舊檔在畫面上與新檔長得**一模一樣**，
 * 而這頁的數字會被拿去做金錢決策。0.6.4-dev.5 那次的教訓正是這種
 * 「顯示的資料是錯的、而且使用者看不出來」（見 services/reportsBucket.ts 的說明）。
 */
export const FX_STALE_DAYS = 3

export function isStale(asOf: string, now: Date, days = FX_STALE_DAYS): boolean {
  const t = Date.parse(asOf)
  if (!Number.isFinite(t)) return false
  return now.getTime() - t > days * 86_400_000
}

/** 'YYYY-MM-DD' → 'MM/DD'；跨年的序列要看得出年份，故 1 年區間帶年份 */
export function fmtChartLabel(date: string, withYear: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  return withYear ? `${m[1]}/${m[2]}` : `${m[2]}/${m[3]}`
}
