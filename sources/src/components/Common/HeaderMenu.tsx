/**
 * 下拉選單的共用外殼。
 *
 * 抽出來是因為多個選單需要一模一樣的行為：點外面關閉、Esc 關閉並把焦點還給觸發鈕、
 * 正確的 aria。各寫一份遲早只會修好其中一邊，而這種不一致從呼叫端完全看不出來
 * （與 mergePeriodSeries 同一個理由）。
 *
 * 0.6.7 從 AppShell 搬到 Common：使用者從第三個呼叫端（個股分析的個股切換）開始，
 * 它已經不是頁首專屬了。搬家的另一個理由見 AnalysisPage —— 那裡原本是原生 `<select>`，
 * 而它的樣式在 0.6.6 被當成死 CSS 刪掉了。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export function HeaderMenu({
  triggerLabel,
  triggerContent,
  triggerClass,
  menuLabel,
  popClass,
  children,
}: {
  triggerLabel: string
  triggerContent: ReactNode
  triggerClass: string
  menuLabel: string
  /**
   * 附加在彈出層上的樣式。預設 `.hmenu-pop` 是**靠右對齊**（`right: 0`），
   * 那是為頁首右側的選單設計的 —— 從畫面左側叫出來時要加 `hmenu-pop-left`，
   * 否則彈出層會往左展開而跑出畫面。清單可能很長時再加 `hmenu-pop-scroll`。
   */
  popClass?: string
  /** 收到的 close 用來讓選項點完自己關閉 */
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      // 焦點要還回觸發鈕，否則鍵盤使用者按 Esc 之後會掉到 document
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="hmenu" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {triggerContent}
      </button>
      {open && (
        <div
          className={popClass ? `hmenu-pop ${popClass}` : 'hmenu-pop'}
          role="menu"
          aria-label={menuLabel}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
