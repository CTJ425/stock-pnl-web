// @vitest-environment jsdom
/**
 * Audit finding A4 — the dashboard holdings row and the two watchlist rows were the main
 * route into the stock detail page, and all three were `onClick` on a `<tr>`/`<div>` with no
 * role, no tabIndex and no key handler. A keyboard user could not reach the detail page at
 * all. These are the semantics every one of those call sites now spreads.
 */
import { describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent } from 'react'

import { useRowActivate } from './useRowActivate'

function keyEvent(key: string) {
  const preventDefault = vi.fn()
  return { event: { key, preventDefault } as unknown as KeyboardEvent, preventDefault }
}

describe('useRowActivate', () => {
  it('exposes button semantics and a tab stop', () => {
    const props = useRowActivate(vi.fn(), '開啟 2330 台積電')

    expect(props.role).toBe('button')
    expect(props.tabIndex).toBe(0)
    expect(props['aria-label']).toBe('開啟 2330 台積電')
  })

  it('activates on Enter', () => {
    const onActivate = vi.fn()
    const { event, preventDefault } = keyEvent('Enter')

    useRowActivate(onActivate, '列').onKeyDown(event)

    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('activates on Space and stops the page from scrolling', () => {
    const onActivate = vi.fn()
    const { event, preventDefault } = keyEvent(' ')

    useRowActivate(onActivate, '列').onKeyDown(event)

    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('ignores every other key without swallowing it', () => {
    const onActivate = vi.fn()
    const props = useRowActivate(onActivate, '列')

    for (const key of ['Tab', 'Escape', 'a', 'ArrowDown']) {
      const { event, preventDefault } = keyEvent(key)
      props.onKeyDown(event)
      expect(preventDefault).not.toHaveBeenCalled()
    }

    expect(onActivate).not.toHaveBeenCalled()
  })
})
