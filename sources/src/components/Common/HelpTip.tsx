/**
 * Field description tips: The "?" icon next to the table header will display the description when the mouse is moved or the keyboard is focused.
 *
 * The bubbles are rendered with position: fixed and actual coordinates - the outer layer of the table is a scroll container with overflow: auto.
 * Using absolute will be cropped. And must be portal to body: table container .glass has backdrop-filter,
 * Will become a fixed positioned containing block, which will be offset relative to the terrarium instead of the viewport if left in place.
 * Touch devices don't have hover, so they can be opened and closed by clicking on them.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface HelpTipProps {
  /** Field description content*/
  text: string
  /** Field name to use for accessibility labels (e.g. "Current Price")*/
  label: string
}

const BUBBLE_WIDTH = 260
const GAP = 8

export function HelpTip({ text, label }: HelpTipProps) {
  const [pos, setPos] = useState<{ top: number; left: number; flipTop: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const id = useId()

  const show = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // By default, it is displayed below the icon and aligned to the left; when it is close to the right edge of the window, it is retracted to avoid exceeding the screen.
    const left = Math.max(
      GAP,
      Math.min(r.left, window.innerWidth - BUBBLE_WIDTH - GAP),
    )
    setPos({ top: r.bottom + 6, left, flipTop: r.top - 6 })
  }, [])

  const hide = useCallback(() => setPos(null), [])

  // If there is insufficient space below, flip to the top of the icon (the height must be measured after actual rendering)
  useLayoutEffect(() => {
    const el = bubbleRef.current
    if (!pos || !el) return
    const h = el.offsetHeight
    if (pos.top + h > window.innerHeight - GAP) {
      el.style.top = `${Math.max(GAP, pos.flipTop - h)}px`
    }
  }, [pos])

  // Close when scrolling or resizing the window: fixed bubbles will not scroll with the table
  useEffect(() => {
    if (!pos) return
    const onDismiss = () => setPos(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPos(null)
    }
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [pos])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="help-tip"
        aria-label={`${label}欄位說明`}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation()
          if (pos) hide()
          else show()
        }}
      >
        ?
      </button>
      {pos &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            className="help-bubble"
            style={{ top: pos.top, left: pos.left, width: BUBBLE_WIDTH }}
          >
            <div className="help-bubble-title">{label}</div>
            {text}
          </div>,
          document.body,
        )}
    </>
  )
}
