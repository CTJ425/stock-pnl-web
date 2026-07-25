/**
 * 基本面數字格式化。
 *
 * 單位陷阱（三種不同單位，不可混用）：
 * - EPS：**元 / 股**（不是總額，所以不加 NT$ 前綴 —— 不要改用 utils/formatters 的 fmtPrice）
 * - 營收 / 淨利：**千元**（官方原始單位，顯示時換成億元較好讀）
 * - 殖利率：**百分比數值**（來源 0.94 就是 0.94%，不要再乘 100）
 */

/** 每股盈餘 / 每股淨值：元，2 位小數，負值保留負號 */
export function fmtPerShare(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n.toFixed(2)} 元`
}

/** 倍數（本益比、股價淨值比），2 位小數 */
export function fmtMultiple(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n.toFixed(2)} 倍`
}

/** 百分比（殖利率）。來源已是百分比數值，原樣加上 % */
export function fmtPercentValue(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n.toFixed(2)}%`
}

/**
 * 財報金額：來源單位是千元，換成「億元」顯示（1 億元 = 100,000 千元）。
 * 台股財報動輒數千億，用億元才讀得懂。
 */
export function fmtThousandsAsBillions(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const billions = n / 100_000
  const sign = billions < 0 ? '-' : ''
  return `${sign}${Math.abs(billions).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} 億元`
}

/** 季別標籤：2026 Q1 */
export function fmtQuarterLabel(year: number, quarter: number): string {
  return `${year} Q${quarter}`
}

/** 圖表 X 軸用的短季別標籤：26Q1 */
export function fmtQuarterShort(year: number, quarter: number): string {
  return `${String(year).slice(2)}Q${quarter}`
}
