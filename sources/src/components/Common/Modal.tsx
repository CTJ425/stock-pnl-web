import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  /** 表單類彈窗防誤觸：點擊遮罩空白處不關閉（僅能按 X 或 Esc） */
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

  // Portal 到 body：祖先若有 backdrop-filter（如 app-header）會攔截 fixed 定位，
  // 導致遮罩被限制在祖先的框內
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
