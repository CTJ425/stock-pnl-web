/**
 * 圖表圖例。兩個刻意的規則：
 * 1. 兩條以上序列一律要有圖例 —— 身分不能只靠顏色傳達。
 * 2. 文字用一般文字色，不用序列色；顏色由旁邊的色塊承擔（色塊小、文字才讀得清）。
 *
 * 給了 `onToggle` 的項目會變成按鈕，可把該序列關掉（0.6.26，獲利能力在用）。
 * **不給就維持純標示、不可點** —— KD 與均線那幾張圖的圖例只是說明，
 * 全部一律變成按鈕只會讓人以為那裡有東西可按。
 */
export interface LegendItem {
  label: string
  color: string
  /** 選填的補充值，例如當日買賣超 */
  note?: string
  /** 目前是否被關掉（僅在可切換時有意義） */
  hidden?: boolean
  /** 給了才可點 */
  onToggle?: () => void
  /** 這是最後一條可見序列：按鈕留著但停用，免得整張圖被關成空座標軸 */
  toggleLocked?: boolean
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="chart-legend">
      {items.map((it) => {
        /*
          關掉的序列改畫空心色塊：它仍然在圖例上（這檔股票有這項指標），
          只是沒畫進圖裡。色塊的顏色是字面值，故用 inline style 直接改，
          不靠 CSS 覆蓋（背景色本來就是 inline 的，用 class 蓋要 !important）。
        */
        const swatch = (
          <span
            className="chart-legend-swatch"
            style={
              it.hidden
                ? { background: 'transparent', boxShadow: `inset 0 0 0 1.5px ${it.color}` }
                : { background: it.color }
            }
            aria-hidden="true"
          />
        )
        const body = (
          <>
            {swatch}
            <span className="chart-legend-label">{it.label}</span>
            {it.note && <span className="chart-legend-note">{it.note}</span>}
          </>
        )

        return (
          <li key={it.label}>
            {it.onToggle ? (
              <button
                type="button"
                className="chart-legend-toggle"
                onClick={it.onToggle}
                aria-pressed={!it.hidden}
                disabled={it.toggleLocked}
                title={
                  it.toggleLocked
                    ? '至少要留一條線'
                    : it.hidden
                      ? `顯示${it.label}`
                      : `隱藏${it.label}`
                }
              >
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        )
      })}
    </ul>
  )
}
