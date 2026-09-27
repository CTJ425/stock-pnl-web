/**
 * Chart coloring. Taiwan stocks mark a rise in red and a fall in green. The palette stays readable
 * on both the dark and the light theme ground.
 *
 * The values are literals, not CSS variables: one palette serves both themes, so a chart colour
 * never changes with the theme.
 */
export const CHART_COLORS = {
  up: '#dc4a44', // statement red, between the two themes' --up
  down: '#1f9460', // statement green, between the two themes' --down
  line: '#5b8cc6', // ruling blue, between the two themes' accent
  axis: '#8d8d8d', // Carbon gray 50
  grid: 'rgba(141, 141, 141, 0.3)',
  zero: 'rgba(141, 141, 141, 0.7)',
  guide: 'rgba(138, 148, 163, 0.45)', // MultiLineChart's dashed reference lines (e.g. KD's 20/80)
  bbUpper: '#a8a8a8', // Bollinger upper band (TechnicalTab), Carbon gray 30
  bbLower: '#6f6f6f', // Bollinger lower band (TechnicalTab), Carbon gray 60
  vwap: '#08bdba', // Intraday 均價 line (IntradayChart); mirrors --accent-2 (index.css) as a literal
} as const

/**
 * Category color matching (when displaying multiple legal persons at the same time, use "identity" coloring instead of rising or falling).
 *
 * The up/down above is **polarity** encoding (red positive, green negative), which can only express the positive and negative of one sequence at a time;
 * When drawing several series at once, the color must express "who is this", and the sign is carried by the bar's direction from the zero axis.
 * Two codes cannot be overlapped on the same set of tags.
 *
 * 2026-09-27 statement redesign: blue / yellow / violet / pink, deliberately without red or green (those mean
 * up / down here). They are CSS variables (`--chart-c1…4`, tokens.css) so each theme gets its own validated steps;
 * `fill="var(--x)"` resolves in SVG presentation attributes. validate_palette.js:
 *   light #2a78d6 #eda100 #4a3aa7 #e87ba4 on paper: all checks PASS, contrast WARN for yellow and pink
 *   dark  #3987e5 #c98500 #9085e9 #d55181 on night paper: all PASS
 * The contrast WARN requires visible labels or a table view as relief: every chart using these ships a legend and
 * keeps its numbers in a table under it.
 */
export const CATEGORICAL_COLORS = [
  'var(--chart-c1)',
  'var(--chart-c2)',
  'var(--chart-c3)',
  'var(--chart-c4)',
] as const

