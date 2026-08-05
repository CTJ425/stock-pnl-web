/**
 * Chart legend. Two deliberate rules:
 * 1. Two or more sequences must have a legend - the identity cannot be conveyed by color alone.
 * 2. Use general text colors for text instead of sequential colors; the color is borne by the color block next to it (the smaller the color block, the easier it is to read the text clearly).
 *
 * Items given `onToggle` will become buttons that can turn off the sequence (0.6.26, in use by Profitability).
 * **If you don’t give it, keep the pure mark and don’t click**——The legends of the KD and moving average charts are just for explanation.
 * Making them all buttons only makes people think there is something to press there.
 */
export interface LegendItem {
  label: string
  color: string
  /** Optional supplementary value, such as the day's trading exceeds*/
  note?: string
  /** Whether it is currently turned off (only meaningful when switchable)*/
  hidden?: boolean
  /** Order only if you give it*/
  onToggle?: () => void
  /** This is the last visible sequence: the button remains but is disabled so that the entire graph is not turned into an empty axis.*/
  toggleLocked?: boolean
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="chart-legend">
      {items.map((it) => {
        /*
          A switched-off series gets a hollow swatch: it is still in the legend (this stock has that indicator),
          it is just not drawn. The swatch colour is a literal, so it is set with an inline style rather than a
          CSS override (the background is inline anyway, and a class would need !important).
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
