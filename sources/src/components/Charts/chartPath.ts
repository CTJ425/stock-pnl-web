/**
 * SVG 路徑組裝與版面定位的共用純函式。
 *
 * 為什麼獨立成一個檔而不是放在 chartFrame.tsx：那個檔匯出元件，
 * 從元件檔一併匯出非元件會觸發 react(only-export-components) —— Fast Refresh 會整檔重載。
 */
import type { PlotGeometry } from './chartFrame'

/**
 * 把值序列切成連續有值的區段，每段是 `[x, y]` 座標陣列。
 *
 * 「遇 null 斷開、不內插、丟棄只有一個點的段」這條規則被折線、面積、均線疊圖共用，
 * 抽在這裡是因為**各寫一份必然會在「缺資料要不要連起來」上走鐘** ——
 * 面積填充尤其不能自己分一次段：填色與線條的斷點只要差一格，
 * 畫面上就會出現一塊沒有線的色塊，而且很難看出是哪邊錯。
 */
function segments(values: Array<number | null>, geo: PlotGeometry): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = []
  let current: Array<[number, number]> = []
  values.forEach((v, i) => {
    if (v === null || v === undefined) {
      if (current.length > 1) out.push(current)
      current = []
      return
    }
    current.push([geo.bandCenter(i), geo.y(v)])
  })
  if (current.length > 1) out.push(current)
  return out
}

const pt = ([x, y]: [number, number]) => `${x.toFixed(2)},${y.toFixed(2)}`

/**
 * 把連續有值的區段切成多條折線的 points 字串（遇 null 斷開、不內插）。
 * 折線圖、均線疊圖、KD 圖三處共用 —— 各寫一份必然會在「缺資料要不要連起來」上走鐘。
 */
export function lineSegments(values: Array<number | null>, geo: PlotGeometry): string[] {
  return segments(values, geo).map((seg) => seg.map(pt).join(' '))
}

/**
 * 同樣的分段，但每段各自往下封閉到繪圖區底邊，供 `<polygon>` 做面積填充。
 *
 * 底邊用 `geo.innerH` 而不是 `geo.y(0)`：折線圖的值域刻意不含 0
 * （匯率 0.195～0.202、融資餘額動輒數萬張，從 0 起算會把變化壓成一條直線），
 * `geo.y(0)` 會落在繪圖區外面很遠的地方。
 */
export function areaSegments(values: Array<number | null>, geo: PlotGeometry): string[] {
  return segments(values, geo).map((seg) => {
    const first = seg[0]
    const last = seg[seg.length - 1]
    return [pt([first[0], geo.innerH]), ...seg.map(pt), pt([last[0], geo.innerH])].join(' ')
  })
}

/**
 * 把 tooltip 的中心 x 夾在容器內，避免最左 / 最右的資料點讓它超出去。
 *
 * `.chart-tip` 是 `translate(-50%, …)`，中心貼齊資料點；序列頭尾兩點的中心
 * 距離容器邊緣只有半個 bandWidth，寬一點的 tooltip 就會被裁掉。
 *
 * `estWidth` 是**估算值**（呼叫端由字元數推），目的只是擋掉明顯溢出、不追求像素精確 ——
 * 要精確就得先 render 再量再重排，為了一個提示框不值得。
 * 容器比 tooltip 還窄時回正中間（再夾也只是換一邊被裁）。
 */
export function clampTipCenter(centerPx: number, estWidthPx: number, viewW: number): number {
  const half = estWidthPx / 2
  if (half * 2 >= viewW) return viewW / 2
  return Math.min(Math.max(centerPx, half), viewW - half)
}
