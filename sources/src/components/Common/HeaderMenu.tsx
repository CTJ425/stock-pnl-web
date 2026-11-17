/**
 * A common shell for drop-down menus.
 *
 * It was extracted because multiple menus require the same behavior: click outside to close, Esc to close and return focus to the trigger button,
 * Correct aria. Writing a copy of each will sooner or later only fix one side, and this inconsistency is completely invisible from the caller.
 * (Same reason as mergePeriodSeries).
 *
 * 0.6.7 Moving from AppShell to Common: The user starts from the third call terminal (individual stock switching for individual stock analysis),
 * It is no longer exclusive to the top of the page. Another reason to move see AnalysisPage - where it used to be native `<select>`,
 * And its style was deleted as dead CSS in 0.6.6.
 */
import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'

const MENU_ITEM_SELECTOR = '[role^="menuitem"]:not([disabled]):not([aria-disabled="true"])'

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
   * Style attached to the popup layer. The default `.hmenu-pop` is **right aligned** (`right: 0`),
   * That's for the menu on the right side of the page header - add `hmenu-pop-left` when calling it from the left side of the screen,
   * Otherwise, the pop-up layer will expand to the left and run out of the screen. Add `hmenu-pop-scroll` if the list may be long.
   */
  popClass?: string
  /** The close received is used to close the option after clicking it.*/
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const pendingFocusRef = useRef<'first' | 'last' | null>(null)

  useEffect(() => {
    if (!open) return
    if (pendingFocusRef.current && popRef.current) {
      const items = Array.from(popRef.current.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR))
      if (items.length > 0) {
        const target = pendingFocusRef.current === 'last' ? items[items.length - 1] : items[0]
        target.focus()
      }
      pendingFocusRef.current = null
    }
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      // The focus must be returned to the trigger button, otherwise the keyboard user will drop to the document after pressing Esc.
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

  // Closes when focus leaves the menu (e.g. tabbing past the last item), on top of the
  // existing outside-click and Esc handling above — a keyboard user does not always click.
  const handleFocusOut = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null
    if (next && wrapRef.current?.contains(next)) return
    setOpen(false)
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        pendingFocusRef.current = e.key === 'ArrowUp' ? 'last' : 'first'
        setOpen(true)
      }
      return
    }
    const pop = popRef.current
    if (!pop) return
    const items = Array.from(pop.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR))
    if (items.length === 0) return
    e.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    let next = 0
    if (e.key === 'Home') {
      next = 0
    } else if (e.key === 'End') {
      next = items.length - 1
    } else if (current < 0) {
      next = e.key === 'ArrowUp' ? items.length - 1 : 0
    } else {
      next = (current + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
    }
    items[next].focus()
  }

  return (
    <div className="hmenu" ref={wrapRef} onBlur={handleFocusOut} onKeyDown={handleKeyDown}>
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
          ref={popRef}
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
