// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchIntraday } = vi.hoisted(() => ({ fetchIntraday: vi.fn() }))
vi.mock('../../services/intradayProxy', () => ({ fetchIntraday }))

const { fetchRemoteDaily } = vi.hoisted(() => ({ fetchRemoteDaily: vi.fn() }))
vi.mock('../../services/dailyProxy', () => ({ fetchRemoteDaily }))

import { IndexDetail } from './IndexDetail'
import type { IntradaySeries } from '../../../supabase/functions/stock-price/intradayParse'

/**
 * Task 164 §4.5. Fixture is the real `^N225` response of 2026-09-15, reduced.
 * `dayOpen` 63190.37 is the first bar's open, not the first close, and `dayLow`
 * 63067.18 is below every close — numbers derived from the close series alone
 * would be wrong, and a self-consistent fixture would hide that.
 */
const T0 = 1789441200

const series = (over: Partial<IntradaySeries> = {}): IntradaySeries => ({
  symbol: '^N225',
  range: '1d',
  interval: '1m',
  prevClose: 63492.99,
  dayOpen: 63190.37,
  dayHigh: 64101.0,
  dayLow: 63067.18,
  points: [63190.37, 63820.5, 63484.1].map((c, i) => ({ t: T0 + i * 60, c, v: 0 })),
  ...over,
})

const def = { region: 'JP' as const, label: '日經 225', ticker: '^N225' }

beforeEach(() => {
  fetchIntraday.mockReset()
  fetchIntraday.mockResolvedValue(series())
  fetchRemoteDaily.mockReset()
  fetchRemoteDaily.mockResolvedValue({ rows: [], granularity: '1d' })
})

afterEach(() => cleanup())

describe('IndexDetail — 當日統計帶', () => {
  it('六個欄位都在', async () => {
    render(<IndexDetail def={def} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('index-detail')).toBeTruthy())
    for (const label of ['開盤', '最高', '最低', '昨收', '漲跌點數', '漲跌幅']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('開高低取自 dayOpen/dayHigh/dayLow，不是收盤序列', async () => {
    render(<IndexDetail def={def} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('index-open')).toBeTruthy())
    const num = (id: string) => Number((screen.getByTestId(id).textContent ?? '').replace(/[,\s]/g, ''))
    expect(num('index-open')).toBeCloseTo(63190.37, 2)
    expect(num('index-high')).toBeCloseTo(64101.0, 2)
    expect(num('index-low')).toBeCloseTo(63067.18, 2)
  })
})

describe('IndexDetail — 區間按鈕', () => {
  it('七個區間，且沒有近 1 月', async () => {
    render(<IndexDetail def={def} onBack={() => {}} />)
    const row = await screen.findByTestId('index-range-buttons')
    expect(row.querySelectorAll('button')).toHaveLength(7)
    expect(screen.queryByRole('button', { name: '近 1 月' })).toBeNull()
  })

  it('切到近 6 月時改抓 5y 日線，不再打 intraday', async () => {
    render(<IndexDetail def={def} onBack={() => {}} />)
    await screen.findByTestId('index-range-buttons')
    fetchIntraday.mockClear()
    await userEvent.click(screen.getByRole('button', { name: '近 6 月' }))
    await waitFor(() => expect(fetchRemoteDaily).toHaveBeenCalledWith('^N225', '5y', 'IDX'))
    expect(fetchIntraday).not.toHaveBeenCalled()
  })

  it('切到全部時改抓 max', async () => {
    render(<IndexDetail def={def} onBack={() => {}} />)
    await screen.findByTestId('index-range-buttons')
    await userEvent.click(screen.getByRole('button', { name: '全部' }))
    await waitFor(() => expect(fetchRemoteDaily).toHaveBeenCalledWith('^N225', 'max', 'IDX'))
  })

  it('切到日線區間若抓取失敗，走勢圖清空而非殘留一日資料', async () => {
    render(<IndexDetail def={def} onBack={() => {}} />)
    await screen.findByTestId('index-range-buttons')
    fetchRemoteDaily.mockResolvedValue(null)
    await userEvent.click(screen.getByRole('button', { name: '近 6 月' }))
    await waitFor(() => expect(screen.getByText('無走勢資料')).toBeTruthy())
  })

  it('切換 def 標的時重設為 1d 且清空前一個標的數據', async () => {
    const { rerender } = render(<IndexDetail def={def} onBack={() => {}} />)
    await screen.findByTestId('index-range-buttons')
    fetchIntraday.mockClear()

    const usDef = { region: 'US' as const, label: '道瓊', ticker: '^DJI' }
    rerender(<IndexDetail def={usDef} onBack={() => {}} />)

    await waitFor(() => {
      expect(fetchIntraday).toHaveBeenCalledWith({ market: 'IDX', ticker: '^DJI' }, '1d')
    })
  })

  it('在 5d 區間點擊重新整理時同時強制重抓 5d 與 1d 當日資料', async () => {
    render(<IndexDetail def={def} onBack={() => {}} />)
    await screen.findByTestId('index-range-buttons')
    await userEvent.click(screen.getByRole('button', { name: '五日' }))

    await waitFor(() => {
      expect(fetchIntraday).toHaveBeenCalledWith({ market: 'IDX', ticker: '^N225' }, '5d')
    })

    fetchIntraday.mockClear()
    await userEvent.click(screen.getByRole('button', { name: /重新整理/ }))

    await waitFor(() => {
      expect(fetchIntraday).toHaveBeenCalledWith({ market: 'IDX', ticker: '^N225' }, '1d', { force: true })
      expect(fetchIntraday).toHaveBeenCalledWith({ market: 'IDX', ticker: '^N225' }, '5d', { force: true })
    })
  })
})

describe('IndexDetail — 不該出現的東西', () => {
  it('沒有三大法人、沒有收盤統計、沒有成交量', async () => {
    render(<IndexDetail def={def} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('index-detail')).toBeTruthy())
    expect(screen.queryByText(/三大法人/)).toBeNull()
    expect(screen.queryByText(/收盤統計/)).toBeNull()
    expect(screen.queryByText(/成交量/)).toBeNull()
    expect(screen.queryByText(/成交金額/)).toBeNull()
  })
})

describe('IndexDetail — 開閉盤說明', () => {
  it('寫出日本的本地時段與午休', async () => {
    render(<IndexDetail def={def} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('index-detail')).toBeTruthy())
    const strip = screen.getByTestId('index-session-hours').textContent ?? ''
    expect(strip).toMatch(/09:00/)
    expect(strip).toMatch(/15:30/)
    expect(strip).toMatch(/11:30/)
  })

  it('返回鍵呼叫 onBack', async () => {
    const onBack = vi.fn()
    render(<IndexDetail def={def} onBack={onBack} />)
    await waitFor(() => expect(screen.getByTestId('index-detail')).toBeTruthy())
    await userEvent.click(screen.getByTestId('index-back'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
