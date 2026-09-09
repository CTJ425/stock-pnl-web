// @vitest-environment jsdom
/**
 * Audit finding B3 — success and failure feedback was per-page and inconsistent: some writes
 * showed a banner that never dismissed, several showed nothing at all, and the app had exactly
 * one aria-live region in total. This is the single channel that replaces all of that, so the
 * live region and the auto-dismiss are asserted, not assumed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ToastProvider, useToast } from './Toast'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Trigger({ message, kind }: { message: string; kind?: 'success' | 'error' }) {
  const { show } = useToast()
  return (
    <button type="button" onClick={() => show(message, kind)}>
      觸發
    </button>
  )
}

describe('ToastProvider', () => {
  it('keeps a polite live region in the DOM before any toast exists', () => {
    render(
      <ToastProvider>
        <span>內容</span>
      </ToastProvider>,
    )

    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')
  })

  it('shows a message and removes it when the close button is pressed', () => {
    render(
      <ToastProvider>
        <Trigger message="已儲存" />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByText('觸發'))
    expect(screen.getByText('已儲存')).toBeDefined()

    fireEvent.click(screen.getByLabelText('關閉通知'))
    expect(screen.queryByText('已儲存')).toBeNull()
  })

  it('dismisses itself after five seconds', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Trigger message="已刪除" />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByText('觸發'))
    expect(screen.queryByText('已刪除')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.queryByText('已刪除')).toBeNull()
  })

  it('marks an error toast differently from a success toast', () => {
    render(
      <ToastProvider>
        <Trigger message="寫入失敗" kind="error" />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByText('觸發'))
    const toast = screen.getByText('寫入失敗').closest('.toast')

    expect(toast?.className).toContain('toast-error')
  })

  it('does not throw when used outside the provider', () => {
    expect(() => render(<Trigger message="孤兒" />)).not.toThrow()
    expect(() => fireEvent.click(screen.getByText('觸發'))).not.toThrow()
  })
})
