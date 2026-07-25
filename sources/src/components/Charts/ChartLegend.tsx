/**
 * 圖表圖例。兩個刻意的規則：
 * 1. 兩條以上序列一律要有圖例 —— 身分不能只靠顏色傳達。
 * 2. 文字用一般文字色，不用序列色；顏色由旁邊的色塊承擔（色塊小、文字才讀得清）。
 */
export interface LegendItem {
  label: string
  color: string
  /** 選填的補充值，例如當日買賣超 */
  note?: string
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="chart-legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className="chart-legend-swatch" style={{ background: it.color }} aria-hidden="true" />
          <span className="chart-legend-label">{it.label}</span>
          {it.note && <span className="chart-legend-note">{it.note}</span>}
        </li>
      ))}
    </ul>
  )
}
