/**
 * 日 K 蠟燭圖，可疊加均線。
 *
 * 幾個刻意的取捨：
 * - **值域不含 0**。股價從 0 起算會把整年的波動壓成頂端一條細線。
 * - **紅漲綠跌**（台股慣例，與籌碼圖的 up/down 同一組色）：以「當根收盤 vs 開盤」決定，
 *   不是與前一根比 —— 這與看盤軟體的實心 / 空心邏輯一致。
 * - **均線用類別色**：均線之間的差異是「身分」（5/20/60 日），不是漲跌，
 *   故取 CATEGORICAL_COLORS 而非 up/down（顏色一次只能做一件事，見 SPEC）。
 * - 一年 244 根時每根不到 2px，蠟燭實體會退化成一條線；此時仍保證至少 1px 寬，
 *   讓「有這根」看得出來。
 */
import { ChartFrame } from './chartFrame'
import { lineSegments } from './chartPath'
import { CHART_COLORS } from './chartColors'
import { niceDomain } from './chartScale'

/**
 * 開高低收任一為 null 就畫不出這根，該欄留白（0.6.34）。
 *
 * 原本呼叫端是先把不完整的日子**過濾掉**，但這樣一來第 N 根就不是第 N 天了 ——
 * 與其他共用 X 軸的圖疊在一起時，同一個 hover 索引會指到不同日期。
 * 保留欄位、只是不畫，索引才對得起來。用收盤去補開高低仍然不行：
 * 那會畫出一整排十字線，看起來像那天真的沒有波動。
 */
export interface Candle {
  label: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
}

/** 四個價都齊的那根（畫圖與 tooltip 用） */
type FullCandle = { label: string; open: number; high: number; low: number; close: number }

function full(c: Candle | undefined): FullCandle | null {
  if (!c || c.open === null || c.high === null || c.low === null || c.close === null) return null
  return c as FullCandle
}

export interface OverlayLine {
  name: string
  color: string
  values: Array<number | null>
}

interface CandleChartProps {
  candles: Candle[]
  overlays?: OverlayLine[]
  labelIndices?: number[]
  height?: number
  formatValue: (v: number) => string
  ariaLabel: string
  /** 額外附在 tooltip 尾端的文字（例如成交量） */
  tooltipExtra?: (index: number) => string | null
  /** 與其他圖共用 hover 時由外部持有；未給則自持（見 chartFrame） */
  hoverIndex?: number | null
  onHover?: (index: number | null) => void
  crosshair?: boolean
}

export function CandleChart({
  candles,
  overlays = [],
  labelIndices,
  height = 260,
  formatValue,
  ariaLabel,
  tooltipExtra,
  hoverIndex,
  onHover,
  crosshair,
}: CandleChartProps) {
  // 值域要同時容納蠟燭的高低與均線，否則均線會被畫到框外
  const domain = niceDomain([
    ...candles.flatMap((c) => [c.high, c.low]),
    ...overlays.flatMap((o) => o.values),
  ])

  return (
    <ChartFrame
      height={height}
      domain={domain}
      labels={candles.map((c) => c.label)}
      labelIndices={labelIndices}
      ariaLabel={ariaLabel}
      hoverIndex={hoverIndex}
      onHover={onHover}
      crosshair={crosshair}
      tooltipFor={(i) => {
        const c = full(candles[i])
        // 開高低收沒齊的日子只報日期：其他共用 X 軸的圖仍有那天的數字，
        // 這裡回 null 會讓整條 crosshair 上只有這張圖沒有提示，看起來像壞掉
        if (!c) return candles[i]?.label ?? null
        const ohlc = `開 ${formatValue(c.open)}　高 ${formatValue(c.high)}　低 ${formatValue(c.low)}　收 ${formatValue(c.close)}`
        const ma = overlays
          .map((o) => {
            const v = o.values[i]
            return v === null || v === undefined ? null : `${o.name} ${formatValue(v)}`
          })
          .filter((s): s is string => s !== null)
        const extra = tooltipExtra?.(i)
        return [c.label, ohlc, ma.join('　'), extra].filter(Boolean).join('｜')
      }}
    >
      {(geo) => {
        // 蠟燭實體佔欄寬六成，留出間隙；再窄也保底 1px
        const bodyW = Math.max(geo.bandWidth * 0.6, 1)

        return (
          <>
            {candles.map((raw, i) => {
              const c = full(raw)
              if (!c) return null
              const color = c.close >= c.open ? CHART_COLORS.up : CHART_COLORS.down
              const center = geo.bandCenter(i)
              const yHigh = geo.y(c.high)
              const yLow = geo.y(c.low)
              const yOpen = geo.y(c.open)
              const yClose = geo.y(c.close)
              const top = Math.min(yOpen, yClose)
              // 開盤等於收盤（十字線）時仍畫 1px，否則那天會整根消失
              const bodyH = Math.max(Math.abs(yClose - yOpen), 1)
              const dim = geo.hover !== null && geo.hover !== i

              return (
                <g key={`${c.label}-${i}`} opacity={dim ? 0.45 : 1}>
                  <line
                    x1={center}
                    x2={center}
                    y1={yHigh}
                    y2={yLow}
                    stroke={color}
                    strokeWidth={1}
                  />
                  <rect x={center - bodyW / 2} y={top} width={bodyW} height={bodyH} fill={color} />
                </g>
              )
            })}

            {overlays.map((o) =>
              lineSegments(o.values, geo).map((d, si) => (
                <polyline
                  key={`${o.name}-${si}`}
                  points={d}
                  fill="none"
                  stroke={o.color}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )),
            )}
          </>
        )
      }}
    </ChartFrame>
  )
}
