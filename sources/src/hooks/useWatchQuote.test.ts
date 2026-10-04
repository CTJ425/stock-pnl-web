// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWatchQuote } from './useWatchQuote'

const fetchPrices = vi.hoisted(() => vi.fn())
vi.mock('../services/priceProxy', () => ({ fetchPrices }))

const quote = (price: number) => ({ price, asOf: '2026-10-04T05:00:00Z', source: 'edge', stale: false })

beforeEach(() => {
  fetchPrices.mockReset()
  fetchPrices.mockImplementation(async (items: Array<{ ticker: string }>) => ({
    [`TPE:${items[0].ticker}`]: quote(items[0].ticker === '2330' ? 100 : 35),
  }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useWatchQuote (Task 193 M4 / M5)', () => {
  it('returns null without a ticker and fetches nothing', () => {
    const { result } = renderHook(() => useWatchQuote(null))
    expect(result.current).toBeNull()
    expect(fetchPrices).not.toHaveBeenCalled()
  })

  it('never hands out the previous ticker\'s quote on the render where the ticker changes', async () => {
    const { result, rerender } = renderHook(({ t }) => useWatchQuote(t), { initialProps: { t: '2330' as string | null } })
    await waitFor(() => expect(result.current?.price).toBe(100))
    // A render that already carries ticker B must not still expose A's 100 (that is what seeded 損益試算
    // with the wrong price): it has to read null until B's own quote arrives.
    const seen: Array<number | null> = []
    rerender({ t: '6488' })
    seen.push(result.current?.price ?? null)
    expect(seen).toEqual([null])
    await waitFor(() => expect(result.current?.price).toBe(35))
  })

  it('drops a response that lands after the selection moved on', async () => {
    let resolveA!: (v: unknown) => void
    fetchPrices.mockImplementationOnce(() => new Promise((res) => (resolveA = res)))
    const { result, rerender } = renderHook(({ t }) => useWatchQuote(t), { initialProps: { t: '2330' } })
    rerender({ t: '6488' })
    await waitFor(() => expect(result.current?.price).toBe(35))
    await act(async () => {
      resolveA({ 'TPE:2330': quote(100) })
    })
    expect(result.current?.price).toBe(35)
  })

  it('polls every minute while the tab is visible, so the quote keeps moving', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderHook(() => useWatchQuote('2330'))
    await waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(fetchPrices).toHaveBeenCalledTimes(2)
  })

  it('skips the tick while the tab is hidden and catches up when it returns', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    renderHook(() => useWatchQuote('2330'))
    await waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000)
    })
    expect(fetchPrices).toHaveBeenCalledTimes(1)
    visibility.mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(2))
  })

  it('resolves to null when the quote is unavailable', async () => {
    fetchPrices.mockResolvedValue({})
    const { result } = renderHook(() => useWatchQuote('2330'))
    await waitFor(() => expect(fetchPrices).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })
})
