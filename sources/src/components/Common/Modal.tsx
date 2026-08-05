import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  /** Anti-accidental touch for form pop-up windows: Clicking on the blank space of the mask will not close it (you can only press X or Esc)*/
  disableBackdropClose?: boolean
}

export function Modal({ title, onClose, children, wide, disableBackdropClose }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Portal to body: If the ancestor has a backdrop-filter (such as app-header), it will intercept fixed positioning.
  // Causes the mask to be constrained to the ancestor's box
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (!disableBackdropClose && e.target === e.currentTarget) onClose()
      }}
    >
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="關閉">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
