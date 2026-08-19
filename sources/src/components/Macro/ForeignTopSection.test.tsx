// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchForeignTop } = vi.hoisted(() => ({ fetchForeignTop: vi.fn() }))
vi.mock('../../services/foreignTopProxy', () => ({ fetchForeignTop }))

import { ForeignTopSection } from './ForeignTopSection'
import type { ForeignTopData } from '../../services/foreignTopProxy'

const data: ForeignTopData = {
  date: '2026-08-17',
  asOf: '2026-08-17T09:20:00.000Z',
  buyTop: [
    { ticker: '2330', name: '台積電', buy: 3_000_000, sell: 1_766_000, net: 1_234_000, block: true },
    { ticker: '2317', name: '鴻海', buy: 900_000, sell: 400_000, net: 500_000, block: false },
  ],
  sellTop: [
    { ticker: '6770', name: '力積電', buy: 1_000_000, sell: 3_000_000, net: -2_000_000, block: false },
  ],
}

afterEach(() => {
  cleanup()
  fetchForeignTop.mockReset()
})

async function mount(payload: ForeignTopData | null) {
  fetchForeignTop.mockResolvedValue(payload)
  const user = userEvent.setup()
  render(<ForeignTopSection />)
  // wait for the effect's promise to settle
  await screen.findByText('外資買賣超 TOP 50')
  return user
}

describe('ForeignTopSection', () => {
  it('預設顯示買超榜，切到賣超分頁後換成賣超榜', async () => {
    const user = await mount(data)

    expect(await screen.findByText('台積電')).toBeTruthy()
    expect(screen.getByText('鴻海')).toBeTruthy()
    expect(screen.queryByText('力積電')).toBeNull()

    await user.click(screen.getByRole('tab', { name: '賣超 TOP 50' }))

    expect(await screen.findByText('力積電')).toBeTruthy()
    expect(screen.queryByText('台積電')).toBeNull()
  })

  it('數量一律以張顯示，沒有張股切換', async () => {
    await mount(data)

    // 1,234,000 股 = 1,234.0 張；買進 3,000,000 股 = 3,000.0 張
    expect(await screen.findByText('1,234.0')).toBeTruthy()
    expect(screen.getByText('3,000.0')).toBeTruthy()
    expect(screen.queryByText('1,234,000')).toBeNull()

    expect(screen.queryByRole('button', { name: '股' })).toBeNull()
    expect(screen.queryByRole('button', { name: '張' })).toBeNull()
  })

  it('買賣超欄位標題標示單位為張', async () => {
    await mount(data)
    expect(await screen.findByText('買賣超(張)')).toBeTruthy()
  })

  it('只有鉅額交易的個股才掛鉅額標記', async () => {
    await mount(data)
    await screen.findByText('台積電')
    expect(screen.getAllByText('鉅額')).toHaveLength(1)
  })

  it('沒有快照時顯示空狀態且不丟例外', async () => {
    await mount(null)
    expect(await screen.findByText('尚無外資買賣超資料')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  // 時間以觀看者的時區呈現，所以斷言格式而不是某個固定時刻，避免測試綁死在 CI 的 TZ 上。
  it('標頭顯示資料更新時間，沿用其他總經區塊的 section-stamp 慣例', async () => {
    await mount(data)
    const stamp = await screen.findByText(/^資料更新於 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(stamp.className).toContain('section-stamp')
  })

  it('沒有快照時不顯示更新時間，不會出現「資料更新於 —」', async () => {
    await mount(null)
    await screen.findByText('尚無外資買賣超資料')
    expect(screen.queryByText(/資料更新於/)).toBeNull()
  })
})
