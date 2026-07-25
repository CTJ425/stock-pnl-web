/**
 * 圖表配色。台股慣例紅正綠負，深淺兩種主題與 PDF 淺色底都可讀。
 *
 * 這裡刻意用**字面值而非 CSS 變數**：html2canvas 擷取 inline SVG 時會把 SVG 序列化成圖片，
 * 祖先層的 CSS 變數解析不到，PDF 內的圖形會變黑。配色也因此不隨主題改變。
 */
export const CHART_COLORS = {
  up: '#e0455b',
  down: '#10a05c',
  line: '#5b6cf0',
  axis: '#8a94a3',
  grid: 'rgba(138, 148, 163, 0.3)',
  zero: 'rgba(138, 148, 163, 0.7)',
} as const
