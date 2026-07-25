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

/**
 * 類別配色（同時顯示多個法人時用「身分」上色，而非漲跌）。
 *
 * 上面的 up/down 是**極性**編碼（紅正綠負），一次只能表達一條序列的正負；
 * 同時畫四個法人時，顏色必須改為表達「這是誰」，正負則交給長條在零軸上下的方向。
 * 兩種編碼不可疊在同一組標記上。
 *
 * 取自 dataviz 參考配色的固定順序（slot 1–4 的 dark steps），**依序指派、不循環**。
 * 選 dark steps 而非 light steps 的原因：本專案的圖表色必須是單一組字面值
 * （html2canvas 限制，見上），而 dark steps 是唯一同時通過淺底與深底全部檢查的一組
 * （light steps 在深色底會 FAIL 亮度帶）。驗證結果（validate_palette.js）：
 *   淺底 #fcfcfb：亮度/彩度/CVD/常視覺全 PASS，contrast 2.99 為 WARN
 *   深底 #131a2b：全部 PASS
 * 淺底的 contrast WARN 需要「可見標籤或表格檢視」作為緩解 —— 本頁同時具備
 * 圖例文字與上方的完整數字表格，故成立。
 */
export const CATEGORICAL_COLORS = [
  '#3987e5', // slot 1 blue
  '#d95926', // slot 2 orange
  '#199e70', // slot 3 aqua
  '#c98500', // slot 4 yellow
] as const
