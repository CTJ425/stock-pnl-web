/**
 * 指標卡上那條迷你走勢線的座標計算（純函式，方便單獨測試）。
 *
 * 為什麼不用 `components/Charts/LineSeriesChart`：那支帶座標軸、格線、hover 十字線與
 * tooltip，高度預設 170px —— 放進 KPI 卡片會比卡片本身還高。這裡要的是
 * 「一眼看方向」，不是可讀值的圖，所以只算路徑、不畫任何刻度。
 *
 * 座標系是 viewBox 的 0..width / 0..height，實際尺寸交給 CSS
 * （SVG 用 `preserveAspectRatio="none"` 拉伸，線寬則靠 `vector-effect` 維持）。
 */

export interface SparklineGeometry {
  /** `<polyline points>` 用的座標字串 */
  line: string
  /** 線下填色用的封閉路徑（`<path d>`） */
  area: string
  /** 最後一個有值的點，用來畫端點圓 */
  lastX: number
  lastY: number
}

/**
 * 把一組數值換算成迷你走勢線的座標。
 *
 * `null`（該期尚未發布）**跳過不畫**，但仍佔一個 x 位置 ——
 * 壓縮掉會讓時間軸失真，畫成 0 則是憑空捏造一個數字。
 *
 * 少於兩個有效值時回 null（一個點連不成線），呼叫端據此不渲染。
 */
export function sparkline(
  values: ReadonlyArray<number | null | undefined>,
  width: number,
  height: number,
  pad = 3,
): SparklineGeometry | null {
  const pts: Array<{ x: number; y: number }> = []
  const usable = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
  const finite = usable.filter((v): v is number => v !== null)
  if (finite.length < 2 || values.length < 2) return null

  const min = Math.min(...finite)
  const max = Math.max(...finite)
  // 全部一樣高時擺中線，不要除以 0
  const span = max - min || 1
  const top = pad
  const bottom = height - pad

  usable.forEach((v, i) => {
    if (v === null) return
    const x = (i / (values.length - 1)) * width
    const y = max === min ? height / 2 : bottom - ((v - min) / span) * (bottom - top)
    pts.push({ x: round(x), y: round(y) })
  })

  const line = pts.map((p) => `${p.x},${p.y}`).join(' ')
  const first = pts[0]
  const last = pts[pts.length - 1]
  return {
    line,
    area: `M${first.x},${first.y} ${line} L${last.x},${height} L${first.x},${height} Z`,
    lastX: last.x,
    lastY: last.y,
  }
}

/** 座標留兩位小數就夠，字串短一點 DOM 也小一點 */
function round(n: number): number {
  return Math.round(n * 100) / 100
}
