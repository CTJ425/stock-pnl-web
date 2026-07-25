/**
 * 買賣超長條圖（紅正綠負）。零軸固定顯示，長條由零軸往上/往下長。
 * 值域強制含 0，否則正負長條的視覺長度會失真。
 */
import { ChartFrame } from './chartFrame'
import { CHART_COLORS } from './chartColors'
import { niceDomain } from './chartScale'

export interface BarPoint {
  label: string
  value: number | null
}

interface BarSeriesChartProps {
  points: BarPoint[]
  height?: number
  /** tooltip 與無資料判斷用的數值格式化（含單位） */
  formatValue: (v: number) => string
  ariaLabel: string
}

export function BarSeriesChart({
  points,
  height = 170,
  formatValue,
  ariaLabel,
}: BarSeriesChartProps) {
  const domain = niceDomain(
    points.map((p) => p.value),
    { includeZero: true },
  )

  return (
    <ChartFrame
      height={height}
      domain={domain}
      labels={points.map((p) => p.label)}
      ariaLabel={ariaLabel}
      tooltipFor={(i) => {
        const p = points[i]
        if (!p) return null
        return `${p.label}　${p.value === null ? '無資料' : formatValue(p.value)}`
      }}
    >
      {(geo) => {
        const zeroY = geo.y(0)
        const barW = Math.max(geo.bandWidth * 0.52, 3)
        return (
          <>
            {points.map((p, i) => {
              if (p.value === null) return null
              const valueY = geo.y(p.value)
              const top = Math.min(valueY, zeroY)
              // 值為 0 時仍畫 1px，讓「有資料但為 0」與「無資料」看得出差別
              const h = Math.max(Math.abs(valueY - zeroY), 1)
              return (
                <rect
                  key={`${p.label}-${i}`}
                  x={geo.bandCenter(i) - barW / 2}
                  y={top}
                  width={barW}
                  height={h}
                  rx={1.5}
                  fill={p.value < 0 ? CHART_COLORS.down : CHART_COLORS.up}
                  opacity={geo.hover === null || geo.hover === i ? 1 : 0.45}
                />
              )
            })}
          </>
        )
      }}
    </ChartFrame>
  )
}
