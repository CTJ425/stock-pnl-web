// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchMarketDaily } = vi.hoisted(() => ({ fetchMarketDaily: vi.fn() }))
vi.mock('../../services/marketProxy', () => ({ fetchMarketDaily }))

import { TwMarketSection } from './TwMarketSection'
import type { MarketDay } from '../../services/marketProxy'

const side = (total: number, foreign: number) => ({
  foreignTwd: foreign,
  foreignDealerTwd: 0,
  trustTwd: 5e8,
  dealerSelfTwd: -1e8,
  dealerHedgeTwd: -2e8,
  totalTwd: total,
})

/** 預設不帶買進 / 賣出（模擬 0.6.32 之前補到的舊資料）；要明細的測試自己補上 */
const inst = (total: number, foreign: number) => ({
  ...side(total, foreign),
  buy: null,
  sell: null,
})

/** 有買進 / 賣出明細的一天 */
const instFull = (total: number, foreign: number) => ({
  ...side(total, foreign),
  buy: side(4e11, 3.5e11),
  sell: side(4e11 - total, 3.5e11 - foreign),
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
    // 最新那天還沒補到法人金額 → 六個法人欄整列「—」，不以 0 冒充
    // （第 7 個 td.num 是趨勢欄，那天沒有合計就沒有走勢，同樣是「—」）
    expect([...rows[0].querySelectorAll('td.num')].map((td) => td.textContent)).toEqual(
      Array(7).fill('—'),
    )
    // 前一天有資料：外資 −191.9 億、投信 +5.0 億、合計 −165.2 億
    const prev = [...rows[1].querySelectorAll('td.num')].map((td) => td.textContent)
    expect(prev[0]).toBe('-191.9 億')
    expect(prev[2]).toBe('+5.0 億')
    expect(prev[5]).toBe('-165.2 億')
  })

  it('展開某一天可看到六個單位的買進 / 賣出，舊資料沒有明細就沒有展開鈕（0.6.32）', async () => {
    const user = userEvent.setup()
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [
        day('2026-08-03', 8e11, inst(-1.65e10, -1.9e10)), // 舊資料：只有差額
        day('2026-08-04', 8e11, instFull(1.445e10, 1.127e10)), // 有買賣明細
      ],
    })
    const { container } = render(<TwMarketSection />)
    await screen.findByText('日期')

    // 只有帶明細的那天給展開鈕，舊資料那天不給（點了也沒東西可看）
    const toggles = screen.getAllByRole('button', { name: /展開 .* 的買進賣出明細/ })
    expect(toggles).toHaveLength(1)
    expect(toggles[0].getAttribute('aria-label')).toContain('2026-08-04')

    expect(container.querySelectorAll('.detail-row')).toHaveLength(0)
    await user.click(toggles[0])

    const detail = container.querySelector('.detail-row')!
    expect(detail.textContent).toContain('2026-08-04 明細')
    // 用子代選擇器：`tbody tr` 會連內層 thead 那列一起選到 —— 它的 tbody 祖先是**外層**那個
    const unitRows = detail.querySelectorAll('tbody > tr')
    expect(unitRows).toHaveLength(6)
    const cells = [...unitRows[0].querySelectorAll('td')].map((td) => td.textContent)
    // 外資：買進 3500 億、賣出 3500−112.7 = 3387.3 億、買賣超 +112.7 億
    expect(cells).toEqual(['外資', '3500.0 億', '3387.3 億', '+112.7 億'])

    // 再點一次收合
    await user.click(screen.getByRole('button', { name: /收合 .* 的買進賣出明細/ }))
    expect(container.querySelectorAll('.detail-row')).toHaveLength(0)
  })

  it('趨勢欄：連續同向天數，且走勢不受表格只顯示 7 列的限制（0.6.32）', async () => {
    // 10 天連續買超 —— 表格只列最後 7 天，但趨勢要數滿 10 天
    const days = Array.from({ length: 10 }, (_, i) =>
      day(`2026-08-${String(i + 1).padStart(2, '0')}`, 8e11, inst(1e9 * (i + 1), 1e9)),
    )
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-10T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByText('日期')

    const rows = container.querySelectorAll('.data-table tbody tr')
    expect(rows).toHaveLength(7)
    // 最新一列（8/10）：連 10 日買超，表格外那 3 天也算進去了
    expect(rows[0].textContent).toContain('連 10 日買超')
    // 最舊那列（8/04）是第 4 天
    expect(rows[6].textContent).toContain('連 4 日買超')
  })

  it('趨勢欄：轉向當天不算連續，走勢線畫得出來', async () => {
    const days = [
      day('2026-08-01', 8e11, inst(-3e9, -1e9)),
      day('2026-08-02', 8e11, inst(-2e9, -1e9)),
      day('2026-08-03', 8e11, inst(5e9, 1e9)), // 由賣超轉買超
    ]
    fetchMarketDaily.mockResolvedValue({ asOf: '2026-08-03T08:30:00.000Z', days })
    const { container } = render(<TwMarketSection />)
    await screen.findByText('日期')

    const rows = container.querySelectorAll('.data-table tbody tr')
    // 轉向當天只有 1 天同向 → 不印「連 N 日」（連 1 日不是趨勢）
    expect(rows[0].textContent).not.toContain('連')
    // 前一天是連 2 日賣超
    expect(rows[1].textContent).toContain('連 2 日賣超')
    // 三個點畫得出走勢線
    expect(container.querySelectorAll('.data-table .mac-spark').length).toBeGreaterThan(0)
  })

  it('抓取週期寫在卡片上，使用者不必去猜多久更新一次（0.6.32）', async () => {
    fetchMarketDaily.mockResolvedValue({
      asOf: '2026-08-04T08:30:00.000Z',
      days: [day('2026-08-04', 8e11, inst(1e9, 1e9))],
    })
    render(<TwMarketSection />)
    expect(await screen.findByText(/抓取週期/)).toBeTruthy()
    expect(screen.getByText(/16:00 \/ 17:00 \/ 18:00，僅平日/)).toBeTruthy()
    expect(screen.getByText('market-daily')).toBeTruthy()
  })

  it('查無資料時顯示空狀態，不是一片空白', async () => {
    fetchMarketDaily.mockResolvedValue(null)
    render(<TwMarketSection />)
    await waitFor(() => expect(screen.getByText(/市場資料尚未產生/)).toBeTruthy())
  })
})
