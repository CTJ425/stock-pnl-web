import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Modal } from './Modal'

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

// Called outside the provider must not throw; resolve false as if the user cancelled.
const noopConfirm: ConfirmFn = () => Promise.resolve(false)

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext) ?? noopConfirm
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  // Mirrors `pending` so settle() can resolve the promise without racing the next render.
  const pendingRef = useRef<PendingConfirm | null>(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve }
      pendingRef.current = next
      setPending(next)
    })
  }, [])

  const settle = useCallback((value: boolean) => {
    pendingRef.current?.resolve(value)
    pendingRef.current = null
    setPending(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Modal title={pending.title} onClose={() => settle(false)} disableBackdropClose>
          <p style={{ whiteSpace: 'pre-line' }}>{pending.message}</p>
          <div className="toolbar" style={{ marginTop: 14 }}>
            <div className="spacer" />
            <button className="btn" onClick={() => settle(false)}>
              取消
            </button>
            <button
              className={pending.danger ? 'btn btn-danger' : 'btn btn-primary'}
              onClick={() => settle(true)}
            >
              {pending.confirmLabel ?? '確定'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}
