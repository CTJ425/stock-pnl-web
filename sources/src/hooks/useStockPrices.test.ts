// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Holding } from '../utils/pnlEngine'
import { useStockPrices } from './useStockPrices'

const fetchPrices = vi.hoisted(() => vi.fn())
vi.mock('../services/priceProxy', () => ({ fetchPrices }))

const holding = {
  key: 'TPE:2330',
  market: 'TPE',
  ticker: '2330',
} as unknown as Holding

beforeEach(() => {
  fetchPrices.mockReset()
  fetchPrices.mockResolvedValue({
    'TPE:2330': { price: 605, asOf: '2026-07-20T05:00:00Z', source: 'edge', stale: false },
  })
})

afterEach(() => {
  // 卸載殘留的 hook 實例，否則其 visibilitychange listener 會污染後續測試
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useStockPrices', () => {
  it('掛載時抓一次價', async () => {
    const { result } = renderHook(() => useStockPrices([holding]))
    await waitFor(() => expect(result.current.prices['TPE:2330']?.price).toBe(605))
    expect(fetchPrices).toHaveBeenCalledTimes(1)
    expect(fetchPrices).toHaveBeenCalledWith(
      [{ market: 'TPE', ticker: '2330' }],
      { force: undefined },
    )
  })

  it('每分鐘背景輪詢，且不觸發 loading 指示', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useStockPrices([holding]))
    await waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(1))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(fetchPrices).toHaveBeenCalledTimes(2)
    // 輪詢為非 force：TTL 內的代號由 priceProxy 命中快取、不會真的打 API
    expect(fetchPrices).toHaveBeenLastCalledWith(expect.anything(), { force: undefined })
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(fetchPrices).toHaveBeenCalledTimes(3)
  })

  it('分頁切回前景時補抓', async () => {
    renderHook(() => useStockPrices([holding]))
    await waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(1))

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(2))
  })

  it('分頁進入背景時不抓', async () => {
    renderHook(() => useStockPrices([holding]))
    await waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(1))

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(fetchPrices).toHaveBeenCalledTimes(1)
  })

  it('手動重新整理帶 force 略過快取', async () => {
    const { result } = renderHook(() => useStockPrices([holding]))
    await waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(1))

    await act(async () => {
      result.current.refresh()
    })
    await waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(2))
    expect(fetchPrices).toHaveBeenLastCalledWith(expect.anything(), { force: true })
  })

  it('卸載後停止輪詢', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { unmount } = renderHook(() => useStockPrices([holding]))
    await waitFor(() => expect(fetchPrices).toHaveBeenCalledTimes(1))

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000)
    })
    expect(fetchPrices).toHaveBeenCalledTimes(1)
  })

  it('無持股時不發請求', async () => {
    renderHook(() => useStockPrices([]))
    await waitFor(() => expect(fetchPrices).not.toHaveBeenCalled())
  })
})
