// @vitest-environment jsdom
/**
 * A6 audit finding A5 — the shared Modal had `role="dialog"` and Escape-to-close, but no
 * focus management: opening it left focus on the page behind, Tab walked out of the dialog
 * into the background, and closing it dropped focus to <body>. Every one of those is a
 * keyboard-only user losing their place, and none of them is visible in a screenshot, so
 * they are asserted here rather than left to review.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { Modal } from './Modal'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function dialog(): HTMLElement {
  return screen.getByRole('dialog')
}

function focusablesIn(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
}

function renderModal() {
  return render(
    <Modal title="測試對話框" onClose={vi.fn()}>
      <button type="button">第一個</button>
      <input aria-label="金額" />
      <button type="button">最後一個</button>
    </Modal>,
  )
}

describe('Modal focus management', () => {
  it('marks itself as modal for assistive technology', () => {
    renderModal()
    expect(dialog().getAttribute('aria-modal')).toBe('true')
  })

  it('moves focus into the dialog when it opens', () => {
    renderModal()
    expect(dialog().contains(document.activeElement)).toBe(true)
  })

  it('wraps Tab from the last focusable back to the first', () => {
    renderModal()
    const items = focusablesIn(dialog())
    const first = items[0]
    const last = items[items.length - 1]

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })

    expect(document.activeElement).toBe(first)
  })

  it('wraps Shift+Tab from the first focusable back to the last', () => {
    renderModal()
    const items = focusablesIn(dialog())
    const first = items[0]
    const last = items[items.length - 1]

    first.focus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(last)
  })

  it('returns focus to the opener when it closes', () => {
    const opener = document.createElement('button')
    opener.textContent = '開啟'
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const view = renderModal()
    expect(document.activeElement).not.toBe(opener)

    view.unmount()

    expect(document.activeElement).toBe(opener)
  })
})
