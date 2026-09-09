/**
 * Chart coloring. Taiwan stocks are conventionally marked with positive red and negative green, and both dark and light themes are readable with the light background of the PDF.
 *
 * Literal values ​​are deliberately used here instead of CSS variables: when html2canvas retrieves inline SVG, it will serialize the SVG into images.
 * The CSS variables in the ancestor layer cannot be parsed, and the graphics in the PDF will turn black. The color scheme therefore does not change with the theme.
 */
export const CHART_COLORS = {
  up: '#fa4d56', // Carbon red 50
  down: '#24a148', // Carbon green 50
  line: '#4589ff', // Carbon blue 50
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
 * When drawing four legal persons at the same time, the color must be changed to express "who is this", and the positive and negative values ​​​​are given to the direction of the long bar above and below the zero axis.
 * Two codes cannot be overlapped on the same set of tags.
 *
 * Taken from the fixed order of dataviz reference color matching (dark steps of slots 1–4), **assigned in sequence, no loop**.
 * The reason for choosing dark steps instead of light steps: The chart color of this project must be a single set of literal values
 * (html2canvas limitation, see above), and dark steps are the only group that passes both the shallow and dark bottom checks.
 * (light steps will FAIL the brightness band on dark backgrounds). Validation results (validate_palette.js):
 *   Light bottom #fcfcfb: brightness/chroma/CVD/normal vision full PASS, contrast 2.99 is WARN
 *   Deep Bottom #131a2b: All PASS
 * Shallow contrast WARN requires "visible label or table view" as relief - this page has both
 * The legend text and the complete numerical table above are therefore established.
 */
export const CATEGORICAL_COLORS = [
  '#8a3ffc', // Carbon purple 60
  '#1192e8', // Carbon cyan 50
  '#009d9a', // Carbon teal 50
  '#ee5396', // Carbon magenta 50
] as const

/**
 * Carbon publishes two categorical orders: a dark set for light grounds and a light set for
 * dark grounds. This app needs one literal set for both (html2canvas limitation, see above),
 * so the four mid steps above are used. Every step keeps enough luminance separation from
 * both #161616 and the white PDF page, and the legend plus the value table carry the labels.
 */
