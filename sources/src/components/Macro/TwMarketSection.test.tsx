// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const { fetchMarketDaily } = vi.hoisted(() => ({ fetchMarketDaily: vi.fn() }))
vi.mock('../../services/marketProxy', () => ({ fetchMarketDaily }))

import { TwMarketSection } from './TwMarketSection'
import type { MarketDay } from '../../services/marketProxy'
import type { Transaction } from '../../types/models'

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
  taiexOpen: 42780.42,
  taiexHigh: 43784.19,
  taiexLow: 42780.42,
  institutional,
})

const tx = (
  tx_date: string,
  tx_type: 'BUY' | 'SELL',
  price: number,
  qty: number,
  fee_tax: number,
): Transaction => ({
  id: `${tx_date}-${tx_type}-${price}`,
  workspace_id: 'ws',
  tx_date,
  market: 'TPE',
  ticker: '2330',
  name: '台積電',
  tx_type,
  price,
  qty,
  fee_tax,
  created_at: `${tx_date}T01:00:00.000Z`,
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
    const { container } = render(<TwMarketSection />)
    await screen.findByText('成交金額')

    // 同樣的數字也會出現在下方逐日表格，故限定在 KPI 區塊比對
    const kpis = () => [...container.querySelectorAll('.kpi-value')].map((e) => e.textContent)
    // 1,087,045,875,836 元 = 10870.5 億
    expect(kpis()).toContain('10870.5 億')
    // 買賣超帶正負號，方向必須看得出來
    expect(kpis()).toContain('+230.0 億')
    expect(kpis()).toContain('+120.0 億')
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
    const { container } = render(<TwMarketSection />)
    await screen.findByText('2026-08-03 全市場合計')

    const kpis = [...container.querySelectorAll('.kpi-value')].map((e) => e.textContent)
    expect(kpis).toContain('-165.2 億')
    // 成交金額仍然是最新那一天的
    expect(kpis).toContain('10870.5 億')
  })

  it('三張圖：大盤日 K、成交金額、法人買賣超', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        day('2026-08-04', 1_087_045_875_836, inst(23_000_000_000, 12_000_000_000)),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByText('每日成交金額（億元）')
    expect(container.querySelectorAll('.chart-wrap')).toHaveLength(3)
  })

  it('開高低還沒補到的日子不畫 K 線，不用收盤價冒充（會變成一排十字線）', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        { ...day('2026-08-04', 1_087_045_875_836, null), taiexOpen: null, taiexHigh: null, taiexLow: null },
      ],
    })
    render(<TwMarketSection />)
    // 標題會標明實際畫得出幾根
    expect(await screen.findByText('加權指數日 K（近 1 個交易日）')).toBeTruthy()
  })

  it('法人買賣超只畫最近 7 個交易日（與個股籌碼一致）', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      day(`2026-07-${String(i + 1).padStart(2, '0')}`, 8e11, inst(1e9, 5e8)),
    )
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-04T08:30:00.000Z', days: many })
    const { container } = render(<TwMarketSection />)

    await screen.findByText(/三大法人買賣超（億元）・近 7 個交易日/)
    // 第三張圖是法人：7 根長條（成交金額那張仍是 30 天）
    const bars = container.querySelectorAll('.chart-wrap')[2].querySelectorAll('rect[rx]')
    expect(bars).toHaveLength(7)
  })

  it('逐日買賣超表格：由新到舊，五個法人分欄，缺料給「—」', async () => {
    // 圖看得出方向、表看得出數字（使用者回報長條圖看不出以天為單位的金額）
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 885_506_043_091, inst(-16_519_607_403, -19_190_915_634)),
        day('2026-08-04', 1_087_045_875_836, null),
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByText('日期')

    const rows = container.querySelectorAll('.data-table tbody tr')
    expect(rows).toHaveLength(2)
    // 表由新到舊（圖由舊到新，兩者刻意相反）
    expect(rows[0].textContent).toContain('2026-08-04')
    // 最新那天還沒補到法人金額 → 整列「—」，不以 0 冒充（後兩欄是自己的交易，沒傳也是「—」）
    expect([...rows[0].querySelectorAll('td.num')].map((td) => td.textContent)).toEqual(
      Array(8).fill('—'),
    )
    // 前一天有資料：外資 −191.9 億、投信 +5.0 億、合計 −165.2 億
    const prev = [...rows[1].querySelectorAll('td.num')].map((td) => td.textContent)
    expect(prev[0]).toBe('-191.9 億')
    expect(prev[2]).toBe('+5.0 億')
    expect(prev[5]).toBe('-165.2 億')
  })

  it('逐日表格併入自己的台股買賣金額：同日加總、美股不計、視窗外不出現', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        // 8 天，表格只取最後 7 天 —— 7/24 落在視窗外
        ...['2026-07-24', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30'].map((d) =>
          day(d, 8e11, inst(1e9, 1e9)),
        ),
        day('2026-07-31', 8e11, inst(1e9, 1e9)),
        day('2026-08-01', 8e11, inst(1e9, 1e9)),
        day('2026-08-04', 8e11, inst(1e9, 1e9)),
      ],
      // 8/4 兩筆買進要加總、8/1 是賣出、7/31 只有美股、7/24 在視窗外
    })
    const { container } = render(
      <TwMarketSection
        transactions={[
          tx('2026-08-04', 'BUY', 1000, 100, 500),
          tx('2026-08-04', 'BUY', 500, 200, 300),
          tx('2026-08-01', 'SELL', 800, 100, 250),
          { ...tx('2026-07-31', 'BUY', 100, 10, 1), market: 'US' },
          tx('2026-07-24', 'BUY', 999, 999, 0),
        ]}
      />,
    )
    await screen.findByText('日期')

    const rows = container.querySelectorAll('.data-table tbody tr')
    expect(rows).toHaveLength(7)
    const mine = (row: Element) => {
      const cells = [...row.querySelectorAll('td.num')].map((td) => td.textContent)
      return cells.slice(-2) // 後兩欄才是自己的
    }
    // 8/4：買進 1000×100+500 = 100,500 加上 500×200+300 = 100,300 → 200,800
    expect(mine(rows[0])).toEqual(['NT$200,800', '—'])
    // 8/1：賣出 800×100-250 = 79,750
    expect(mine(rows[1])).toEqual(['—', 'NT$79,750'])
    // 7/31 只有美股交易 → 不計入
    expect(mine(rows[2])).toEqual(['—', '—'])
    // 7/24 落在 7 個交易日視窗之外 → 表格裡根本沒有這一列
    expect(container.textContent).not.toContain('2026-07-24')
  })

  it('查無資料時顯示空狀態，不是一片空白', async () => {
    fetchMarketDaily.mockResolvedValue(null)
    render(<TwMarketSection />)
    await waitFor(() => expect(screen.getByText(/市場資料尚未產生/)).toBeTruthy())
  })
})
