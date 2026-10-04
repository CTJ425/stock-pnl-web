// @vitest-environment jsdom
/**
 * Task 193 M10 / M15 for 國際指數.
 *
 * M10 — the first full load (all four regions) and the open-regions-only poll tick shared one request
 *       id. A tab that came back to the foreground a moment after mount fired a tick that invalidated
 *       the still-running full load, and later ticks only ask for open regions, so the closed markets
 *       stayed 「—」 until the page was remounted.
 * M15 — the 60 s timer kept calling the Edge function while the tab was hidden.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchIndexQuotes } = vi.hoisted(() => ({ fetchIndexQuotes: vi.fn() }))
vi.mock('../../services/indexQuotes', () => ({ fetchIndexQuotes }))

import { GlobalIndices } from './GlobalIndices'

const quote = (ticker: string, price: number) => ({ ticker, price, prevClose: price - 10, asOf: null })

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// Wednesday 2026-09-16 10:30 Taipei: TW, JP and KR are in session, the US is not.
const OPEN_FOR_TW_JP_KR = new Date('2026-09-16T02:30:00Z')

beforeEach(() => {
  fetchIndexQuotes.mockReset()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(OPEN_FOR_TW_JP_KR)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('GlobalIndices — 開頁後馬上切回前景', () => {
  it('a poll tick does not throw away the full load that is still running', async () => {
    const full = deferred<Record<string, ReturnType<typeof quote>>>()
    fetchIndexQuotes.mockImplementationOnce(() => full.promise) // the mount-time full load
    fetchIndexQuotes.mockImplementation(async (tickers: string[]) =>
      Object.fromEntries(tickers.map((t) => [t, quote(t, 100)])),
    )

    render(<GlobalIndices onSelect={() => {}} />)
    await waitFor(() => expect(fetchIndexQuotes).toHaveBeenCalledTimes(1))

    // The tab regains visibility while the full load is in flight → a tick for the open regions.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(fetchIndexQuotes).toHaveBeenCalledTimes(2))
    const tickTickers = fetchIndexQuotes.mock.calls[1][0] as string[]
    expect(tickTickers).not.toContain('^DJI') // US is closed, so the tick skips it

    // The full load now lands, carrying the US quote the tick never asked for.
    await act(async () => {
      full.resolve({ '^DJI': quote('^DJI', 52573.3), '^TWII': quote('^TWII', 1) })
    })
    const us = await screen.findByTestId('gix-card-^DJI')
    expect(us.textContent).toContain('52,573')
    // …and the newer tick answer for a ticker both asked about is not overwritten by the older full load.
    expect(screen.getByTestId('gix-card-^TWII').textContent).toContain('100')
  })
})

describe('GlobalIndices — 分頁在背景時不輪詢', () => {
  it('skips the 60 s timer while hidden and catches up on return', async () => {
    fetchIndexQuotes.mockImplementation(async (tickers: string[]) =>
      Object.fromEntries(tickers.map((t) => [t, quote(t, 100)])),
    )
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    render(<GlobalIndices onSelect={() => {}} />)
    await waitFor(() => expect(fetchIndexQuotes).toHaveBeenCalledTimes(1)) // the mount load

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })
    expect(fetchIndexQuotes).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(fetchIndexQuotes).toHaveBeenCalledTimes(2))
  })
})
