/**
 * 折線圖（單一序列），Google Finance 風格：線下方漸層填充、hover 垂直虛線、
 * tooltip 貼著資料點（0.6.8）。
 *
 * 值域不強制含 0 —— 融資餘額動輒數萬張、匯率是 0.19x，從 0 起算會把變化壓成一條直線。
 * 融資與融券量級差距大，各自畫一張、不共用 Y 軸。
 * 缺資料的日子斷線（不內插），避免看起來像真有那天的數字。
 */
import { useId } from 'react'
import { ChartFrame } from './chartFrame'
import { areaSegments, lineSegments } from './chartPath'
import { CHART_COLORS } from './chartColors'
import { niceDomain } from './chartScale'

export interface LinePoint {
  label: string
  value: number | null
}

/**
 * 超過這個點數就不逐點畫圓點，只畫 hover 那一顆。
 *
 * 籌碼頁只有 7 天，圓點標出「哪幾天有資料」是有用的；
 * 匯率一年 260 點，260 顆圓點會把線糊成一條毛毛蟲、反而看不出走勢。
 */
const DOT_LIMIT = 20

interface LineSeriesChartProps {
  points: LinePoint[]
  height?: number
  color?: string
  /**
   * 只標這幾格的 X 軸標籤。融資餘額走勢只有 7 天、全部標得下，
   * 但匯率一年有 260 個點，不抽稀會糊成一團（0.6.7 新增，沿用 MultiLineChart 的同名 prop）。
   */
  labelIndices?: number[]
  formatValue: (v: number) => string
  ariaLabel: string
}

export function LineSeriesChart({
  points,
  height = 170,
  color = CHART_COLORS.line,
  labelIndices,
  formatValue,
  ariaLabel,
}: LineSeriesChartProps) {
  const domain = niceDomain(points.map((p) => p.value))
  const showDots = points.length <= DOT_LIMIT
  const values = points.map((p) => p.value)

  /*
    漸層的 id 不能直接用 useId() 的原值：React 產生的是 `:r3:` 這種帶冒號的字串，
    而 `url(#:r3:)` 不是合法的選擇器語法，填色會整片消失。去掉冒號再用。
    同一頁會有多張圖（匯率頁兩張、籌碼頁兩張），id 必須逐個實例唯一，不能寫死。
  */
  const gradId = `chart-area-${useId().replace(/:/g, '')}`

  return (
    <ChartFrame
      height={height}
      domain={domain}
      labels={points.map((p) => p.label)}
      labelIndices={labelIndices}
      ariaLabel={ariaLabel}
      crosshair
      tooltipAnchor={(i) => points[i]?.value ?? null}
      tooltipFor={(i) => {
        const p = points[i]
        if (!p) return null
        return `${p.label}　${p.value === null ? '無資料' : formatValue(p.value)}`
      }}
    >
      {(geo) => (
        <>
          <defs>
            {/*
              stop 的顏色必須是字面值，不可用 CSS 變數 —— html2canvas 序列化 SVG 時
              解析不到祖先層的變數，籌碼報告的 PDF 會整片變黑（見 chartColors.ts）。
            */}
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* 面積在折線之下：先畫，才不會蓋住線與圓點 */}
          {areaSegments(values, geo).map((d, i) => (
            <polygon key={`area-${i}`} points={d} fill={`url(#${gradId})`} stroke="none" />
          ))}

          {lineSegments(values, geo).map((d, i) => (
            <polyline
              key={i}
              points={d}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {points.map((p, i) =>
            p.value === null || (!showDots && geo.hover !== i) ? null : (
              <circle
                key={`${p.label}-${i}`}
                cx={geo.bandCenter(i)}
                cy={geo.y(p.value)}
                r={geo.hover === i ? 4.5 : 2.8}
                fill={color}
              />
            ),
          )}
        </>
      )}
    </ChartFrame>
  )
}
