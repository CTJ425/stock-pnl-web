// @vitest-environment jsdom
/**
 * Audit finding B4 — deleting a workspace, deleting transactions and clearing the AI config all
 * went through `window.confirm`, which ignores the Carbon theme and the app's own type scale.
 * This provider replaces them, so what matters is that it resolves the promise correctly in all
 * three exits (confirm, cancel, Escape) — a confirm dialog that resolves wrongly deletes data.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { ConfirmProvider, useConfirm } from './useConfirm'

afterEach(() => {
  cleanup()
})

function Harness({ onResult, danger }: { onResult: (v: boolean) => void; danger?: boolean }) {
  const confirm = useConfirm()
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await confirm({
          title: '刪除工作區',
          message: '這個動作無法復原。',
          confirmLabel: '刪除',
          danger,
        })
        onResult(ok)
      }}
    >
      觸發
    </button>
  )
}

function renderHarness(danger?: boolean) {
  const onResult = vi.fn()
  render(
    <ConfirmProvider>
      <Harness onResult={onResult} danger={danger} />
    </ConfirmProvider>,
  )
  fireEvent.click(screen.getByText('觸發'))
  return onResult
}

describe('ConfirmProvider', () => {
  it('shows the question in the shared Modal, not a native dialog', () => {
    renderHarness()

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('刪除工作區')
    expect(screen.getByText('這個動作無法復原。')).toBeDefined()
  })

  it('resolves true when the user confirms', async () => {
    const onResult = renderHarness()

    fireEvent.click(screen.getByText('刪除'))

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
  })

  it('resolves false when the user cancels', async () => {
    const onResult = renderHarness()

    fireEvent.click(screen.getByText('取消'))

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
  })

  it('resolves false when the user presses Escape', async () => {
    const onResult = renderHarness()

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
  })

  it('uses the project button convention for a destructive confirm', () => {
    renderHarness(true)

    expect(screen.getByText('刪除').className).toContain('btn-danger')
  })

  it('resolves false when used outside the provider', async () => {
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)

    fireEvent.click(screen.getByText('觸發'))

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
  })
})
