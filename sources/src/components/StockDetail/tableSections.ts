/**
 * 個股分析裡「有欄位的表格」區塊清單（0.6.23）。
 *
 * 只收表格 —— 圖表區塊（買賣超走勢、日 K、KD）不在內。
 * 收合是為了跳過一大片數字，而圖表本來就是一眼看完的東西，收起來省不到什麼。
 *
 * 這份清單存在的唯一理由是「一鍵全部收起 / 展開」：那顆按鈕在 `StockDetailPage`，
 * 它不該知道 `ChipsTab` / `FundamentalTab` 內部長什麼樣，只需要知道有哪些鍵。
 * **新增可收合的表格時，這裡要跟著加**，否則那顆按鈕會漏掉它。
 */
export const TABLE_SECTION_IDS = [
  'sec-chips-institutional',
  'sec-chips-margin',
  'sec-fund-profit',
  'sec-fund-revenue',
] as const

export type TableSectionId = (typeof TABLE_SECTION_IDS)[number]

/** 收合狀態與開關，由 `StockDetailPage` 持有、往下傳給兩個分頁 */
export interface CollapseProps {
  /** 已收起的區塊；不在裡面的一律是展開 */
  collapsed: ReadonlySet<string>
  onToggle: (id: TableSectionId) => void
}
