/**
 * 表格「趨勢」欄裡的迷你走勢線（0.6.35 由 TwMarketSection 抽出）。
 *
 * 兩張表都要這個東西：台股法人表看合計買賣超的近 15 個交易日，
 * 美國總經表看單一指標的近 12 期。**只抽繪製，不抽「連續」的判定** ——
 * 法人看的是金額正負號、總經看的是與前一期的升降，那是兩件不同的事，
 * 硬合成一個「通用 streak」只會多一個參數與一段條件。
 *
 * 顏色由呼叫端決定並以字面值傳入，不吃 CSS 變數：html2canvas 匯出 PDF 時
 * 解析不到祖先層的變數，圖會整片變黑（`chartColors.ts` 有同一條註記）。
 *
 * 不足兩點時 `sparkline` 回 null，此處印「—」而不是留白 ——
 * 一個點連不成線，硬畫會變成一個小點，看起來像壞掉的圖；
 * 而留白會被讀成「這格沒有資料」，與「資料還不夠畫線」不是同一件事。
 * 兩張表要的都是這個行為，所以放在元件裡而不是各自處理。
 */
import { sparkline } from './sparkline'

/** viewBox 尺寸。實際顯示尺寸由呼叫端以 inline style 指定（兩張表的欄寬需求不同） */
export const SPARK_W = 64
export const SPARK_H = 18

interface SparkCellProps {
  /** 由舊到新 */
  points: ReadonlyArray<number | null>
  color: string
  ariaLabel: string
}

export function SparkCell({ points, color, ariaLabel }: SparkCellProps) {
  const g = sparkline(points, SPARK_W, SPARK_H)
  if (!g) return <>—</>
  return (
    <svg
      className="mac-spark"
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      style={{ width: SPARK_W, height: SPARK_H, display: 'block', marginLeft: 'auto' }}
    >
      <path d={g.area} fill={color} opacity="0.16" />
      <polyline
        points={g.line}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={g.lastX} cy={g.lastY} r="2.2" fill={color} />
    </svg>
  )
}
