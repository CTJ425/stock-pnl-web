/**
 * 圖表外框：Y 軸格線與刻度、X 軸標籤、hover 命中區與 tooltip。
 * 各圖表只負責畫「標記」（長條 / 折線），座標由 geo 提供。
 *
 * 兩個受 PDF 擷取限制而來的設計決定：
 * 1. viewBox 寬度＝實測容器寬度（1:1，不縮放）。用固定 viewBox 等比縮放雖然免去量測，
 *    但字級會跟著容器放大縮小 —— 寬螢幕上刻度變兩倍大、手機上又小到看不清。
 * 2. 字級與顏色一律寫成 SVG 屬性，不靠 CSS。html2canvas 會把 inline SVG 序列化成圖片，
 *    外部樣式表與祖先層的 CSS 變數都解析不到，PDF 會變成一團黑色巨大文字。
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CHART_COLORS } from './chartColors'
import { clampTipCenter } from './chartPath'
import { domainTicks, fmtAxisNumber, scaleY, tickStep, type Domain } from './chartScale'

const PAD = { left: 58, right: 12, top: 10, bottom: 24 }
/** 尚未量到寬度（首次 render / 無 ResizeObserver 的測試環境）時的預設值 */
const FALLBACK_W = 560
const MIN_W = 240
const FONT_SIZE = 11

/** 量測容器寬度，讓 SVG 以 1:1 繪製 */
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(FALLBACK_W)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setWidth(Math.max(Math.round(el.clientWidth), MIN_W))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

export interface PlotGeometry {
  innerW: number
  innerH: number
  count: number
  bandWidth: number
  /** 第 i 個資料點的中心 x（繪圖區座標） */
  bandCenter: (i: number) => number
  /** 數值 → 繪圖區 y 座標 */
  y: (v: number) => number
  /** 目前 hover 的索引（無則 null），供標記做高亮 */
  hover: number | null
}

interface ChartFrameProps {
  height: number
  domain: Domain
  /** X 軸標籤，長度即資料點數 */
  labels: string[]
  /**
   * 只標示這些索引的標籤（未指定時每個都標）。
   * 籌碼圖只有 7 個點可以全標，但日 K 一年有 244 根 —— 全標會糊成一團黑條。
   * 命中區仍然逐點建立，hover 精度不受影響。
   */
  labelIndices?: number[]
  ariaLabel: string
  /** 回傳該點的 tooltip 文字；回 null 表示該點不顯示 */
  tooltipFor?: (index: number) => string | null
  /**
   * hover 時畫一條垂直虛線貫穿繪圖區。
   *
   * **只有折線圖啟用**（0.6.8）。K 線與長條圖的標記本身就佔滿整欄、hover 已用減淡表示，
   * 再加一條線只是噪音；而且它們有既有的 DOM 斷言，多一個元素就會踩到。
   */
  crosshair?: boolean
  /**
   * 回傳該點的**數值**，讓 tooltip 貼著資料點上下移動（Google Finance 那種）。
   *
   * 未給時 tooltip 維持釘在繪圖區頂端 —— 長條圖與 K 線沒有單一個「該點的 y」
   * （長條有高低兩端、K 線有四個價），硬挑一個只會讓提示框停在沒有意義的位置。
   */
  tooltipAnchor?: (index: number) => number | null
  children: (geo: PlotGeometry) => ReactNode
}

export function ChartFrame({
  height,
  domain,
  labels,
  labelIndices,
  ariaLabel,
  tooltipFor,
  crosshair = false,
  tooltipAnchor,
  children,
}: ChartFrameProps) {
  const [hover, setHover] = useState<number | null>(null)
  const { ref: wrapRef, width: viewW } = useMeasuredWidth()
  const titleId = useId()

  const innerW = viewW - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom
  const count = Math.max(labels.length, 1)
  const bandWidth = innerW / count
  const geo: PlotGeometry = {
    innerW,
    innerH,
    count,
    bandWidth,
    bandCenter: (i) => bandWidth * (i + 0.5),
    y: (v) => scaleY(v, domain, innerH),
    hover,
  }

  const ticks = domainTicks(domain)
  const step = tickStep(domain)
  const shownLabels = labelIndices ?? labels.map((_, i) => i)
  const tipText = hover === null ? null : (tooltipFor?.(hover) ?? null)
  // 以百分比定位 tooltip，免在 React state 裡再存一份像素座標。
  // 寬度由字元數估：中英數混排約 8px/字，加上左右 padding —— 只用來 clamp，不求精確
  const tipCenter =
    hover === null
      ? 0
      : clampTipCenter(PAD.left + geo.bandCenter(hover), (tipText?.length ?? 0) * 8 + 18, viewW)
  const tipLeft = (tipCenter / viewW) * 100
  // 有 tooltipAnchor 且該點有值時貼著資料點，否則沿用「釘在繪圖區頂端」
  const anchorValue = hover === null ? null : (tooltipAnchor?.(hover) ?? null)
  const tipTop =
    anchorValue === null
      ? (PAD.top / height) * 100
      : ((PAD.top + geo.y(anchorValue)) / height) * 100

  return (
    <div className="chart-wrap" ref={wrapRef}>
      {/*
        整張圖一個 tab stop：聚焦後用左右方向鍵逐點移動、Home / End 跳頭尾、Esc 取消。
        role 由 img 改為 group —— 可聚焦、可操作的東西不該宣告成一張圖片。
      */}
      <svg
        className="chart-svg"
        viewBox={`0 0 ${viewW} ${height}`}
        width={viewW}
        height={height}
        role="group"
        aria-labelledby={titleId}
        tabIndex={0}
        onMouseLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          const last = labels.length - 1
          if (last < 0) return
          const move = (next: number) => {
            e.preventDefault()
            setHover(Math.min(Math.max(next, 0), last))
          }
          if (e.key === 'ArrowRight') move(hover === null ? 0 : hover + 1)
          else if (e.key === 'ArrowLeft') move(hover === null ? last : hover - 1)
          else if (e.key === 'Home') move(0)
          else if (e.key === 'End') move(last)
          else if (e.key === 'Escape') setHover(null)
        }}
      >
        <title id={titleId}>{ariaLabel}</title>
        <g transform={`translate(${PAD.left}, ${PAD.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={0}
                x2={innerW}
                y1={geo.y(t)}
                y2={geo.y(t)}
                stroke={t === 0 ? CHART_COLORS.zero : CHART_COLORS.grid}
                strokeWidth={t === 0 ? 1.2 : 1}
              />
              <text
                x={-8}
                y={geo.y(t) + FONT_SIZE / 3}
                textAnchor="end"
                fontSize={FONT_SIZE}
                fill={CHART_COLORS.axis}
              >
                {fmtAxisNumber(t, step)}
              </text>
            </g>
          ))}

          {/* crosshair 畫在標記之前，才會被折線與面積蓋在下面（同 Google Finance） */}
          {crosshair && hover !== null && (
            <line
              x1={geo.bandCenter(hover)}
              x2={geo.bandCenter(hover)}
              y1={0}
              y2={innerH}
              stroke={CHART_COLORS.axis}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {children(geo)}

          {shownLabels.map((i) => (
            <text
              key={`${labels[i]}-${i}`}
              x={geo.bandCenter(i)}
              y={innerH + FONT_SIZE + 4}
              textAnchor="middle"
              fontSize={FONT_SIZE}
              fill={CHART_COLORS.axis}
            >
              {labels[i]}
            </text>
          ))}

          {/*
            透明命中區：整欄可 hover，比細長條好點。

            **這些 rect 刻意不可聚焦**（0.6.8）。它們原本每個都是 `tabIndex={0}`，
            一年份的日 K 就是 244 個看不見的 tab stop；0.6.8 把四段併成一頁之後，
            同一頁最多會有 765 個 —— 鍵盤使用者要按七百多次才離得開這一頁。
            改成整張圖一個 tab stop（見 <svg> 的 tabIndex 與 onKeyDown），
            進到圖上後用左右方向鍵逐點移動。
          */}
          {labels.map((label, i) => (
            <rect
              key={`hit-${label}-${i}`}
              x={bandWidth * i}
              y={0}
              width={bandWidth}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </g>
      </svg>

      {tipText && (
        <div className="chart-tip" style={{ left: `${tipLeft}%`, top: `${tipTop}%` }} role="status">
          {tipText}
        </div>
      )}
    </div>
  )
}
