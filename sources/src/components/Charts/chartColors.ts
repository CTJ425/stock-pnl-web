/**
 * Chart coloring. Taiwan stocks are conventionally marked with positive red and negative green, and both dark and light themes are readable with the light background of the PDF.
 *
 * Literal values ​​are deliberately used here instead of CSS variables: when html2canvas retrieves inline SVG, it will serialize the SVG into images.
 * The CSS variables in the ancestor layer cannot be parsed, and the graphics in the PDF will turn black. The color scheme therefore does not change with the theme.
 */
export const CHART_COLORS = {
  up: '#e0455b',
  down: '#10a05c',
  line: '#5b6cf0',
  axis: '#8a94a3',
  grid: 'rgba(138, 148, 163, 0.3)',
  zero: 'rgba(138, 148, 163, 0.7)',
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
  '#3987e5', // slot 1 blue
  '#d95926', // slot 2 orange
  '#199e70', // slot 3 aqua
  '#c98500', // slot 4 yellow
] as const
