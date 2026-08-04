// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const { fetchMarketDaily } = vi.hoisted(() => ({ fetchMarketDaily: vi.fn() }))
vi.mock('../../services/marketProxy', () => ({ fetchMarketDaily }))

import { TwMarketSection } from './TwMarketSection'
import type { MarketDay } from '../../services/marketProxy'

const inst = (total: number, foreign: number) => ({
  foreignTwd: foreign,
  foreignDealerTwd: 0,
  trustTwd: 5e8,
  dealerSelfTwd: -1e8,
  dealerHedgeTwd: -2e8,
  totalTwd: total,
})

const day = (date: string, value: number, institutional: MarketDay['institutional']): MarketDay => ({
  date,
  tradeVolumeShares: 11_000_000_000,
  tradeValueTwd: value,
  transactions: 4_000_000,
  taiex: 43386.41,
  changePoints: 266.66,
  institutional,
})

describe('TwMarketSection', () => {
  afterEach(() => {
    cleanup()
    fetchMarketDaily.mockReset()
  })

  it('金額一律換算成億元顯示（來源是元，直接印沒有人讀得懂）', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        day('2026-08-04', 1_087_045_875_836, inst(23_000_000_000, 12_000_000_000)),
      ],
    })
    render(<TwMarketSection />)

    // 1,087,045,875,836 元 = 10870.5 億
    expect(await screen.findByText('10870.5 億')).toBeTruthy()
    // 買賣超帶正負號，方向必須看得出來
    expect(screen.getByText('+230.0 億')).toBeTruthy()
    expect(screen.getByText('+120.0 億')).toBeTruthy()
  })

  it('最新一天還沒補到法人金額時，退回最近一筆有的並說明是哪一天', async () => {
    // 法人金額約 15:00–15:30 才公布、且逐日回補，剛收盤那幾小時本來就會缺
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        day('2026-08-04', 1_087_045_875_836, null),
      ],
    })
    render(<TwMarketSection />)

    expect(await screen.findByText('-165.2 億')).toBeTruthy()
    expect(screen.getByText('2026-08-03 全市場合計')).toBeTruthy()
    // 成交金額仍然是最新那一天的
    expect(screen.getByText('10870.5 億')).toBeTruthy()
  })

  it('兩張圖：成交金額與法人買賣超各一張', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        day('2026-08-04', 1_087_045_875_836, inst(23_000_000_000, 12_000_000_000)),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByText('每日成交金額（億元）')
    expect(container.querySelectorAll('.chart-wrap')).toHaveLength(2)
  })

  it('查無資料時顯示空狀態，不是一片空白', async () => {
    fetchMarketDaily.mockResolvedValue(null)
    render(<TwMarketSection />)
    await waitFor(() => expect(screen.getByText(/市場資料尚未產生/)).toBeTruthy())
  })
})
