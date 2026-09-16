// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchIndexQuotes } = vi.hoisted(() => ({ fetchIndexQuotes: vi.fn() }))
vi.mock('../../services/indexQuotes', () => ({ fetchIndexQuotes }))

import { GlobalIndices } from './GlobalIndices'

/** Task 164 §4.6. `asOf` is the Edge fetch time; the card renders it in Asia/Taipei. */
const quote = (ticker: string, price: number, asOf: string | null) => ({
  ticker,
  price,
  prevClose: price - 10,
  asOf,
})

beforeEach(() => {
  fetchIndexQuotes.mockReset()
  fetchIndexQuotes.mockResolvedValue({
    '^TWII': quote('^TWII', 46009.85, '2026-09-15T05:30:00.000Z'),
    '^N225': quote('^N225', 63484.1, '2026-09-15T05:25:03.000Z'),
    '^DJI': quote('^DJI', 52573.3, null),
  })
})

afterEach(() => cleanup())

describe('GlobalIndices — 台灣群組', () => {
  it('新增加權指數卡，代碼是 ^TWII', async () => {
    render(<GlobalIndices onSelect={() => {}} />)
    const card = await screen.findByTestId('gix-card-^TWII')
    expect(card.textContent).toMatch(/加權指數/)
  })

  it('四個群組標題都在', async () => {
    render(<GlobalIndices onSelect={() => {}} />)
    await screen.findByTestId('gix-card-^TWII')
    for (const name of ['台灣', '日本', '韓國', '美國']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })

  it('每個群組都寫出開閉盤時間', async () => {
    render(<GlobalIndices onSelect={() => {}} />)
    await screen.findByTestId('gix-card-^TWII')
    for (const region of ['TW', 'JP', 'KR', 'US']) {
      const text = screen.getByTestId(`gix-hours-${region}`).textContent ?? ''
      expect(text).toMatch(/\d{2}:\d{2}/)
    }
  })
})

describe('GlobalIndices — 報價時間', () => {
  it('有 asOf 的卡片顯示台北時間', async () => {
    render(<GlobalIndices onSelect={() => {}} />)
    const stamp = await screen.findByTestId('gix-stamp-^N225')
    // 2026-09-15T05:25:03Z = 13:25 Asia/Taipei
    expect(stamp.textContent).toMatch(/13:25/)
  })

  it('沒有 asOf 的卡片不顯示時間列，但仍可點擊', async () => {
    render(<GlobalIndices onSelect={() => {}} />)
    await screen.findByTestId('gix-card-^DJI')
    expect(screen.queryByTestId('gix-stamp-^DJI')).toBeNull()
  })
})

describe('GlobalIndices — 點擊下鑽', () => {
  it('點卡片以該指數與報價呼叫 onSelect', async () => {
    const onSelect = vi.fn()
    render(<GlobalIndices onSelect={onSelect} />)
    const card = await screen.findByTestId('gix-card-^N225')
    await userEvent.click(card)
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    expect(onSelect.mock.calls[0][0]).toMatchObject({ ticker: '^N225', region: 'JP' })
    expect(onSelect.mock.calls[0][1]).toMatchObject({ ticker: '^N225', price: 63484.1 })
  })

  it('尚未取得報價的卡片一樣可以點', async () => {
    fetchIndexQuotes.mockResolvedValue({})
    const onSelect = vi.fn()
    render(<GlobalIndices onSelect={onSelect} />)
    const card = await screen.findByTestId('gix-card-^N225')
    await userEvent.click(card)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
