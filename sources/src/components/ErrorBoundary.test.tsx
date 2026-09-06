// @vitest-environment jsdom
/**
 * Spec 146 Phase 2 — the app had no ErrorBoundary at all, so a throw during render unmounted
 * the tree and left a blank page with nothing recorded anywhere. The boundary has two jobs and
 * both are asserted here: show the user something, and record what happened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
// React 19 moved the JSX namespace out of global scope; `Boom` always throws, so without an
// explicit annotation it infers `never` and stops being a valid JSX component (TS2786).
import type { JSX } from 'react'

const { logClient } = vi.hoisted(() => ({ logClient: vi.fn() }))
vi.mock('../services/appLog', () => ({ logClient }))

const { ErrorBoundary } = await import('./ErrorBoundary')

function Boom(): JSX.Element {
  throw new Error('render exploded')
}

function Fine(): JSX.Element {
  return <p>正常內容</p>
}

beforeEach(() => {
  vi.clearAllMocks()
  // React prints the caught error to console.error; that is expected here, not a failure.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Fine />
      </ErrorBoundary>,
    )
    expect(screen.getByText('正常內容')).toBeTruthy()
    expect(logClient).not.toHaveBeenCalled()
  })

  it('shows a fallback instead of a blank page when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/頁面發生錯誤/)).toBeTruthy()
    expect(screen.queryByText('正常內容')).toBeNull()
  })

  it('records the failure through logClient', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(logClient).toHaveBeenCalled()
    const [level, action, message, detail] = logClient.mock.calls[0]
    expect(level).toBe('error')
    expect(action).toBe('render')
    expect(message).toContain('render exploded')
    expect(typeof (detail as { stack?: unknown }).stack).toBe('string')
  })

  it('survives a throw that is not an Error', () => {
    function BoomNull(): JSX.Element {
      // React passes the thrown value straight through; `null` is legal and reading .message
      // off it inside componentDidCatch would throw again, with no ancestor boundary to catch it.
      throw null
    }
    render(
      <ErrorBoundary>
        <BoomNull />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/頁面發生錯誤/)).toBeTruthy()
    expect(logClient).toHaveBeenCalledTimes(1)
    expect(logClient.mock.calls[0][2]).toBe('null')
  })

  it('offers the user a way out of the fallback', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('button', { name: /重新載入/ })).toBeTruthy()
  })
})
