/**
 * 可收合的報告區塊。標題本身就是開關，內容收起時**不渲染**（不是 display:none）。
 *
 * 不渲染而非隱藏，是因為這些區塊裡有 SVG 圖表與長表格 ——
 * 收起來卻還留在 DOM 裡，等於使用者以為省下的東西其實一樣在算。
 * 代價是展開時圖表重新掛載（會重跑一次進場動畫），可以接受。
 *
 * ⚠️ **收合狀態由呼叫端持有**，不是自己 useState。
 * 「一鍵全部收起 / 展開」需要一個統一的狀態來源，各自為政就做不到那顆按鈕。
 */
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function CollapsibleSection({
  id,
  title,
  meta,
  open,
  onToggle,
  children,
}: {
  /** `aria-controls` 用，同時是收合狀態的鍵 */
  id: string
  title: ReactNode
  /** 標題右側的時間戳、單位等（原本 `.rpt-section-head` 裡 h3 以外的東西） */
  meta?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="rpt-section">
      <div className="rpt-section-head">
        <h3 className="head-tight">
          <button
            type="button"
            className="rpt-collapse"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={id}
          >
            <ChevronDown size={14} className={open ? 'rpt-caret open' : 'rpt-caret'} />
            {title}
          </button>
        </h3>
        {meta}
      </div>
      {open && <div id={id}>{children}</div>}
    </section>
  )
}
