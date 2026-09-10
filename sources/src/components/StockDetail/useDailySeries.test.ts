// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useDailySeries } from './useDailySeries'
import type { DailyRow, DailySeries, RemoteDaily } from '../../services/dailyProxy'
import { fetchDailySeries, fetchRemoteDaily } from '../../services/dailyProxy'
import { warmStockCore } from '../../services/warmStock'
import type { WarmResult } from '../../services/warmStock'

vi.mock('../../services/dailyProxy', async (importActual) => ({
  ...(await importActual<typeof import('../../services/dailyProxy')>()),
  fetchDailySeries: vi.fn(),
  fetchRemoteDaily: vi.fn(),
}))
vi.mock('../../services/warmStock', async (importActual) => ({
  ...(await importActual<typeof import('../../services/warmStock')>()),
  warmStockCore: vi.fn(),
}))

const mockFile = vi.mocked(fetchDailySeries)
const mockRemote = vi.mocked(fetchRemoteDaily)
const mockWarm = vi.mocked(warmStockCore)

function makeRows(n: number, base: number): DailyRow[] {
  const rows: DailyRow[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
    rows.push([d, base + i, base + i + 1, base + i - 1, base + i, 1_000_000])
  }
  return rows
}

const fileSeries: DailySeries = {
  ticker: '2330',
  asOf: '2026-09-10T05:00:00.000Z',
  lastDate: '2026-09-09',
  rows: makeRows(244, 100),
}

beforeEach(() => {
  mockFile.mockReset()
  mockRemote.mockReset()
  mockWarm.mockReset()
  mockWarm.mockResolvedValue({ dailySynced: 0 } as unknown as WarmResult)
})

describe('useDailySeries', () => {
  it('檔案存在時直接用，不打 Edge Function', async () => {
    mockFile.mockResolvedValue(fileSeries)
    const { result } = renderHook(() => useDailySeries('2330'))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.series?.rows).toHaveLength(244)
    expect(mockRemote).not.toHaveBeenCalled()
  })

  it('檔案不存在且 warm 產不出來時，改用 Edge 的 5 年日線', async () => {
    // PROD 的 daily/ 只有持股的 9 個檔案，2382 之類的搜尋標的沒有檔案。
    // 沒有這層後援，行情分頁的近 1 月／近 6 月／本年迄今／近 1 年 四個區間就會全部讀不到。
    mockFile.mockResolvedValue(null)
    mockRemote.mockResolvedValue({ rows: makeRows(1200, 500), granularity: '1d' } as RemoteDaily)

    const { result } = renderHook(() => useDailySeries('2382'))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(mockRemote).toHaveBeenCalledWith('2382', '5y')
    expect(result.current.series?.rows).toHaveLength(1200)
    expect(result.current.series?.ticker).toBe('2382')
    // lastDate 必須跟著資料走，否則新鮮度檢查會一直想再 warm 一次
    expect(result.current.series?.lastDate).toBe(makeRows(1200, 500)[1199][0])
  })

  it('Storage 讀取拋錯時也要走後援，不是直接判定 error', async () => {
    mockFile.mockRejectedValue(new Error('HTTP 400'))
    mockRemote.mockResolvedValue({ rows: makeRows(300, 500), granularity: '1d' } as RemoteDaily)

    const { result } = renderHook(() => useDailySeries('2382'))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.series?.rows).toHaveLength(300)
  })

  it('後援也拿不到資料時才是 empty', async () => {
    mockFile.mockResolvedValue(null)
    mockRemote.mockResolvedValue(null)

    const { result } = renderHook(() => useDailySeries('9999'))

    await waitFor(() => expect(result.current.status).toBe('empty'))
    expect(result.current.series).toBeNull()
  })

  it('warm 產出檔案時就不必打 Edge Function', async () => {
    mockFile.mockResolvedValueOnce(null).mockResolvedValueOnce(fileSeries)
    mockWarm.mockResolvedValue({ dailySynced: 1 } as unknown as WarmResult)

    const { result } = renderHook(() => useDailySeries('2330'))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(mockRemote).not.toHaveBeenCalled()
  })
})
