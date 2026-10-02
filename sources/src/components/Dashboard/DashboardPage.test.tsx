// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transaction } from '../../types/models'
import { computeLedger } from '../../utils/pnlEngine'
import { DashboardPage } from './DashboardPage'

const { useWorkspace, useStockPrices, useUsdTwdRate } = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
  useStockPrices: vi.fn(),
  useUsdTwdRate: vi.fn(),
}))

vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))
vi.mock('../../hooks/useStockPrices', () => ({ useStockPrices }))
vi.mock('../../hooks/useUsdTwdRate', () => ({ useUsdTwdRate }))
vi.mock('./WatchSection', () => ({
  WatchSection: () => <div data-testid="watch-section" />,
}))

const TXS: Transaction[] = [
  {
    id: 'tx1',
    workspace_id: 'ws-1',
    tx_date: '2026-08-01',
    market: 'TPE',
    ticker: '2330',
    name: '台積電',
    tx_type: 'BUY',
    price: 950,
    qty: 1000,
    fee_tax: 1425,
    created_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 'tx2',
    workspace_id: 'ws-1',
    tx_date: '2026-08-01',
    market: 'US',
    ticker: 'AAPL',
    name: 'Apple Inc',
    tx_type: 'BUY',
    price: 200,
    qty: 10,
    fee_tax: 0,
    created_at: '2026-08-01T00:00:00Z',
  },
]

function mockWorkspace(txs: Transaction[] = TXS, current: Record<string, unknown> = {}) {
  useUsdTwdRate.mockReturnValue(null)
  useWorkspace.mockReturnValue({
    ledger: computeLedger(txs),
    transactions: txs,
    current: { id: 'ws-1', name: '主要工作區', ...current },
    loading: false,
    error: null,
  })
  useStockPrices.mockReturnValue({
    prices: {
      'TPE:2330': { price: 1000, prevClose: 980, asOf: '', source: 'twse', stale: false, trial: false },
      'US:AAPL': { price: 220, prevClose: 215, asOf: '', source: 'finnhub', stale: false, trial: false },
    },
    loading: false,
    refreshedAt: new Date('2026-08-25T10:00:00Z'),
    refresh: vi.fn(),
  })
}

describe('DashboardPage', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockWorkspace()
  })

  // 2026-09-26 redesign: without SHORT rows there is no long/short split, and the figure is 持倉市值.
  it('T3 沒有空單時不拆多空，主數字叫持倉市值', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    const toNum = (el: HTMLElement) => Number(el.textContent!.replace(/[^0-9.-]/g, ''))
    expect(screen.queryByTestId('tw-short-mktval')).toBeNull()
    expect(screen.queryByText(/淨額市值/)).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: /持倉市值/ })).toBeTruthy()
    // 2330 多單 1000 × 1000 = 1,000,000
    expect(toNum(screen.getByTestId('tw-mktval'))).toBe(1_000_000)
  })

  it('T9 沒有空單時不渲染任何分組標題列', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.queryByTestId('holding-group-LONG')).toBeNull()
    expect(screen.queryByTestId('holding-group-SHORT')).toBeNull()
  })

  it('點擊台股持股列展開明細，明細裡的「個股分析」帶入代號與名稱', async () => {
    const user = userEvent.setup()
    const onSelectTicker = vi.fn()

    render(<DashboardPage onSelectTicker={onSelectTicker} />)

    const toggle = within(screen.getByTestId('holding-row-2330')).getByRole('button', { expanded: false })
    await user.click(screen.getByTestId('holding-row-2330'))
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(onSelectTicker).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '個股分析' }))
    expect(onSelectTicker).toHaveBeenCalledTimes(1)
    expect(onSelectTicker).toHaveBeenCalledWith('2330', '台積電')

    // Clicking the row again folds it.
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: '個股分析' })).toBeNull()
  })

  it('美股持股列展開後沒有「個股分析」', async () => {
    const user = userEvent.setup()
    const onSelectTicker = vi.fn()

    render(<DashboardPage onSelectTicker={onSelectTicker} />)

    await user.click(screen.getByTestId('holding-row-AAPL'))
    expect(screen.getByText('未實現損益的三種算法')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '個股分析' })).toBeNull()
    expect(onSelectTicker).not.toHaveBeenCalled()
  })

  it('未提供 onSelectTicker 時（例如本機離線模式），台股明細不提供「個股分析」', async () => {
    const user = userEvent.setup()

    render(<DashboardPage />)

    await user.click(screen.getByTestId('holding-row-2330'))
    expect(screen.getByText('未實現損益的三種算法')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '個股分析' })).toBeNull()
  })

  it('無持股時顯示空狀態提示', () => {
    mockWorkspace([])
    render(<DashboardPage />)
    expect(screen.getByText(/目前沒有持股/)).toBeTruthy()
  })
})

describe('DashboardPage — 融券空單（Task 141 Stage B）', () => {
  const SHORT_TX: Transaction = {
    id: 'tx3',
    workspace_id: 'ws-1',
    tx_date: '2026-08-02',
    market: 'TPE',
    ticker: '2603',
    name: '長榮',
    tx_type: 'SELL',
    price: 100,
    qty: 1000,
    fee_tax: 522,
    tx_nature: 'SHORT',
    created_at: '2026-08-02T00:00:00Z',
  }

  const num = (el: HTMLElement) => Number(el.textContent!.replace(/[^0-9.-]/g, ''))

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    useUsdTwdRate.mockReturnValue(null)
    useWorkspace.mockReturnValue({
      ledger: computeLedger([...TXS, SHORT_TX]),
      transactions: [...TXS, SHORT_TX],
      current: { id: 'ws-1', name: '主要工作區' },
      loading: false,
      error: null,
    })
    useStockPrices.mockReturnValue({
      prices: {
        'TPE:2330': { price: 1000, prevClose: 980, asOf: '', source: 'twse', stale: false, trial: false },
        'TPE:2603': { price: 95, prevClose: 98, asOf: '', source: 'twse', stale: false, trial: false },
        'US:AAPL': { price: 220, prevClose: 215, asOf: '', source: 'finnhub', stale: false, trial: false },
      },
      loading: false,
      refreshedAt: new Date('2026-08-25T10:00:00Z'),
      refresh: vi.fn(),
    })
  })

  it('空單自成一列，多頭列的 testid 不變', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.getByTestId('holding-row-2603-SHORT')).toBeTruthy()
    // 既有的多頭列 testid 不得改動
    expect(screen.getByTestId('holding-row-2330')).toBeTruthy()
  })

  // Task 142: the three-row <tfoot> moved into the market panel and the group caption rows.
  it('T1 有空單時市值改叫淨額市值，台股淨額只加總台股', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    // 2330 多單 1000 × 1000 = 1,000,000（AAPL 是美股，不得加進來）
    // 2603 空單 1000 × 95 = 95,000 → 淨額 905,000
    expect(num(screen.getByTestId('tw-mktval'))).toBe(905_000)
    expect(screen.getByRole('heading', { level: 2, name: /淨額市值/ })).toBeTruthy()
  })

  it('T2 淨額市值下列出多空兩個小計', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(num(screen.getByTestId('tw-long-mktval'))).toBe(1_000_000)
    expect(num(screen.getByTestId('tw-short-mktval'))).toBe(95_000)
  })

  it('T4 美股沒有融券，不列多空拆分', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.queryByTestId('us-short-mktval')).toBeNull()
    expect(num(screen.getByTestId('us-mktval'))).toBe(2_200)
  })

  it('T5 持股表不再有表尾三行', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.queryByTestId('totals-long')).toBeNull()
    expect(screen.queryByTestId('totals-short')).toBeNull()
    expect(screen.queryByTestId('totals-net')).toBeNull()
  })

  it('T6 持股表不再有「方向」欄', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.queryByText('方向')).toBeNull()
  })

  it('T7 多空分組列僅帶檔數，且橫跨全表格欄位', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    const longGroup = screen.getByTestId('holding-group-LONG')
    const shortGroup = screen.getByTestId('holding-group-SHORT')
    expect(longGroup).toBeTruthy()
    expect(shortGroup).toBeTruthy()
    expect(longGroup.textContent).toContain('多單・1 檔')
    expect(shortGroup.textContent).toContain('空單・1 檔')
    expect(screen.queryByTestId('holding-group-LONG-mktval')).toBeNull()
    expect(screen.queryByTestId('holding-group-SHORT-mktval')).toBeNull()
    expect(longGroup.querySelectorAll('td')).toHaveLength(1)
    expect(shortGroup.querySelectorAll('td')).toHaveLength(1)
    expect(longGroup.querySelector('td')?.getAttribute('colspan')).toBe('6')
    expect(shortGroup.querySelector('td')?.getAttribute('colspan')).toBe('6')
  })

  it('T14 只有一條腿有價格時，淨額不成立：不顯示數字', () => {
    // 空單 2603 沒有報價 → shortMkt 為 null。把它當成 0 會印出 1,000,000 這個看起來
    // 合理但錯誤的淨額，並讓曝險條變成 100/0 的單段條。
    useStockPrices.mockReturnValue({
      prices: {
        'TPE:2330': { price: 1000, prevClose: 980, asOf: '', source: 'twse', stale: false, trial: false },
      },
      loading: false,
      refreshedAt: new Date('2026-08-25T10:00:00Z'),
      refresh: vi.fn(),
    })
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.getByTestId('tw-mktval').textContent).not.toMatch(/[0-9]/)
  })

  it('T15 空單明細看得到建倉價與賣出實收，不印「—」', async () => {
    const user = userEvent.setup()
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    await user.click(screen.getByTestId('holding-row-2603-SHORT'))
    const detail = document.querySelector('.hl-detail') as HTMLElement
    const block = within(detail).getByText('空單').closest('.hl-detail-block') as HTMLElement
    // 2603 融券賣出 1000 股 @100，費稅 522 → 實收 99,478；未含費價金 100,000
    expect(block.textContent).toContain('99,478')
    expect(block.textContent).toContain('100,000')
    // 建倉均價：含費實收 99.48 / 未含費成交 100.00 —— 這是「我在幾塊放空」的答案
    expect(block.textContent).toContain('99.48')
    expect(block.textContent).toContain('100.00')
    expect(block.textContent).toContain('賣出・未含費')
    expect(block.textContent).not.toContain('—')
  })

  it('T16 台股只有空單時，總覽照樣出得來：淨額為負、多方 0、成本 0', () => {
    // 沒有多單時 twLongRows 是空的。sumOrNull 對空陣列回傳 null，而 null 在面板裡代表
    // 「報價還沒到」——舊行為把整個台股面板畫成骨架灰條，主數字、曝險尺與成本都不顯示。
    useWorkspace.mockReturnValue({
      ledger: computeLedger([SHORT_TX]),
      transactions: [SHORT_TX],
      current: { id: 'ws-1', name: '主要工作區' },
      loading: false,
      error: null,
    })
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    // 多方 0 − 空方 95,000 → 淨額 −95,000
    expect(num(screen.getByTestId('tw-mktval'))).toBe(-95_000)
    expect(num(screen.getByTestId('tw-long-mktval'))).toBe(0)
    expect(num(screen.getByTestId('tw-short-mktval'))).toBe(95_000)
    // 投入總成本只算多單，沒有多單就是 0，不是骨架條
    expect(num(screen.getByTestId('tw-cost'))).toBe(0)
    expect(screen.getByTestId('tw-cost').querySelector('.skeleton')).toBeNull()
  })

  it('T8 空單列帶 row-short，多頭列不帶', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.getByTestId('holding-row-2603-SHORT').className).toContain('row-short')
    expect(screen.getByTestId('holding-row-2330').className).not.toContain('row-short')
  })

  it('警告文案不再宣稱以持有股數為上限', () => {
    useWorkspace.mockReturnValue({
      ledger: computeLedger([
        { ...SHORT_TX, id: 'tx4', tx_date: '2026-08-03', tx_type: 'BUY', price: 95, qty: 1500, fee_tax: 203 },
        SHORT_TX,
      ]),
      current: { id: 'ws-1', name: '主要工作區' },
      loading: false,
      error: null,
    })
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.queryByText(/已以持有股數為上限計算/)).toBeNull()
    expect(screen.getByText(/超額回補/)).toBeTruthy()
  })
})

describe('DashboardPage — 多空並存時的 KPI 加總（Task 141）', () => {
  // 2330：波段持股 1000 股 @950（成本 951,425），另有融券空單 1000 股 @1000
  // 融券賣出 1,000,000：手續費 1425 + 稅 3000 + 借券費 800 = 5225；淨收 994,775
  const BOTH_LEGS: Transaction[] = [
    TXS[0],
    {
      id: 'tx5',
      workspace_id: 'ws-1',
      tx_date: '2026-08-02',
      market: 'TPE',
      ticker: '2330',
      name: '台積電',
      tx_type: 'SELL',
      price: 1000,
      qty: 1000,
      fee_tax: 5225,
      tx_nature: 'SHORT',
      created_at: '2026-08-02T00:00:00Z',
    },
  ]

  const num = (el: HTMLElement) => Number(el.textContent!.replace(/[^0-9.-]/g, ''))

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    useUsdTwdRate.mockReturnValue(null)
    useWorkspace.mockReturnValue({
      ledger: computeLedger(BOTH_LEGS),
      transactions: BOTH_LEGS,
      current: { id: 'ws-1', name: '主要工作區' },
      loading: false,
      error: null,
    })
    useStockPrices.mockReturnValue({
      prices: {
        'TPE:2330': { price: 1000, prevClose: 980, asOf: '', source: 'twse', stale: false, trial: false },
      },
      loading: false,
      refreshedAt: new Date('2026-08-25T10:00:00Z'),
      refresh: vi.fn(),
    })
  })

  it('T10 多頭小計只算多頭，不把空單的買回成本加進去', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    // 多頭 1000 股 × 1000 = 1,000,000。加上空單會變成 2,000,000。
    // 主數字是淨額，多頭小計列在淨額市值下，但保證不變。
    expect(num(screen.getByTestId('tw-long-mktval'))).toBe(1_000_000)
    expect(num(screen.getByTestId('tw-short-mktval'))).toBe(1_000_000)
    expect(num(screen.getByTestId('tw-mktval'))).toBe(0)
  })

  it('投入總成本每檔只算一次，不因為多空各一列而算兩次', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    // 951,425；逐列加總會變成 1,902,850
    expect(num(screen.getByTestId('tw-cost'))).toBe(951_425)
  })

  const DISCOUNTED_TX: Transaction = {
    id: 'tx-2303',
    workspace_id: 'ws-1',
    tx_date: '2026-08-01',
    market: 'TPE',
    ticker: '2303',
    name: '聯電',
    tx_type: 'BUY',
    price: 135.5,
    qty: 1000,
    fee_tax: 58,
    created_at: '2026-08-01T00:00:00Z',
  }

  function mockDiscounted(current: Record<string, unknown> = {}) {
    useWorkspace.mockReturnValue({
      ledger: computeLedger([DISCOUNTED_TX]),
      transactions: [DISCOUNTED_TX],
      current: { id: 'ws-1', name: '主要工作區', ...current },
      loading: false,
      error: null,
    })
    useStockPrices.mockReturnValue({
      prices: {
        'TPE:2303': { price: 125, prevClose: 126, asOf: '', source: 'twse', stale: false, trial: false },
      },
      loading: false,
      refreshedAt: new Date('2026-08-25T10:00:00Z'),
      refresh: vi.fn(),
    })
  }

  it('展開後的三種算法並列：牌告口徑（券商 APP 月退制）的金額與報酬率', async () => {
    mockDiscounted()
    const user = userEvent.setup()
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    await user.click(screen.getByTestId('holding-row-2303'))
    const list = screen.getByTestId('method-list')
    expect(list.textContent).toContain('-NT$11,111')
    expect(list.textContent).toContain('-8.20%')
    expect(screen.getByTestId('method-net')).toBeTruthy()
    expect(screen.getByTestId('method-raw')).toBeTruthy()
  })

  it('月退制的折扣工作區：主表、小計與算法說明都改用牌告口徑', async () => {
    localStorage.setItem('stock-pnl-web/fee-rate/ws-1', '0.000399')
    try {
      mockDiscounted({ fee_rate: 0.000399, fee_rebate: 'monthly', sell_fee_basis: 'list' })
      const user = userEvent.setup()
      render(<DashboardPage onSelectTicker={vi.fn()} />)
      // Task 189: 月退 settlement took floor(135,500 × 0.1425%) = 193, not the recorded 58, and the
      // app keeps that in cost: −11,111 − 135 = −11,246.
      expect(screen.getByTestId('holding-row-2303').textContent).toContain('-NT$11,246')
      expect(screen.getByTestId('tw-subtotal').textContent).toContain('-NT$11,246')
      expect(screen.getByRole('button', { name: /台股依牌告 0.1425% 計成本與預扣/ })).toBeTruthy()
      await user.click(screen.getByTestId('holding-row-2303'))
      expect(screen.getByTestId('method-list').textContent).toContain('目前採用')
      expect(screen.getByTestId('method-list').textContent).toContain('月退：成本裡的買進手續費也用牌告算')
      expect(screen.getByTestId('method-net').textContent).not.toContain('目前採用')
      expect(screen.getByText('券商 App 成本').nextElementSibling?.textContent).toContain('NT$135,693')
    } finally {
      localStorage.removeItem('stock-pnl-web/fee-rate/ws-1')
    }
  })

  // Task 189 regression guard: PROD Ron的投資組合 is 月退 with no sell basis saved and matched the
  // 元大 app on 0.10.20; it must not move until its owner saves the new settings.
  it('月退但沒存過新設定的舊工作區：數字和 0.10.20 一樣，不加牌告成本', () => {
    localStorage.setItem('stock-pnl-web/fee-rate/ws-1', '0.000399')
    try {
      mockDiscounted({ fee_rate: 0.000399, fee_rebate: 'monthly' })
      render(<DashboardPage onSelectTicker={vi.fn()} />)
      expect(screen.getByTestId('holding-row-2303').textContent).toContain('-NT$11,111')
      expect(screen.getByRole('button', { name: /台股依牌告 0.1425% 預扣/ })).toBeTruthy()
      expect(screen.queryByText('券商 App 成本')).toBeNull()
    } finally {
      localStorage.removeItem('stock-pnl-web/fee-rate/ws-1')
    }
  })

  it('日退＋牌告預扣（元大）：成本照記錄的手續費，賣出用牌告', () => {
    localStorage.setItem('stock-pnl-web/fee-rate/ws-1', '0.000399')
    try {
      mockDiscounted({ fee_rate: 0.000399, fee_rebate: 'instant', sell_fee_basis: 'list' })
      render(<DashboardPage onSelectTicker={vi.fn()} />)
      expect(screen.getByTestId('holding-row-2303').textContent).toContain('-NT$11,111')
      expect(screen.getByRole('button', { name: /台股依牌告 0.1425% 預扣/ })).toBeTruthy()
      expect(screen.queryByText('券商 App 成本')).toBeNull()
    } finally {
      localStorage.removeItem('stock-pnl-web/fee-rate/ws-1')
    }
  })

  it('現折（或沒設定）時沿用折扣後費率，算法說明寫出實際費率', () => {
    localStorage.setItem('stock-pnl-web/fee-rate/ws-1', '0.000399')
    try {
      mockDiscounted({ fee_rate: 0.000399, fee_rebate: null })
      render(<DashboardPage onSelectTicker={vi.fn()} />)
      expect(screen.getByRole('button', { name: /台股依折扣後 0.0399% 預扣/ })).toBeTruthy()
      expect(screen.getByTestId('holding-row-2303').textContent).not.toContain('-NT$11,111')
    } finally {
      localStorage.removeItem('stock-pnl-web/fee-rate/ws-1')
    }
  })

  it('算法說明就地打開這個工作區的手續費設定', async () => {
    mockDiscounted()
    const user = userEvent.setup()
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    const basis = screen.getByRole('button', { name: /台股依/ })
    expect(basis.getAttribute('aria-expanded')).toBe('false')
    await user.click(basis)
    expect(basis.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('heading', { name: '主要工作區的手續費設定' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /月退/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: '主要工作區的手續費設定' })).toBeNull()
  })

  it('持股列數值單元格帶上 pnl-up 與 pnl-down 類別（漲跌幅、未實現淨損益）', () => {
    // 獲利情境：2330 買進 950，現價 1000（昨收 980，漲）
    mockWorkspace()
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    const cell = (row: HTMLElement, c: string) => row.querySelector(`td[data-c="${c}"]`) as HTMLElement
    const rowWin = screen.getByTestId('holding-row-2330')
    expect(cell(rowWin, 'chg').className).toContain('pnl-up')
    expect(cell(rowWin, 'unr').className).toContain('pnl-up')

    // 虧損情境：2330 買進 1050，現價 1000（昨收 1020，跌）
    const lossTx: Transaction = {
      id: 'tx-loss',
      workspace_id: 'ws-1',
      tx_date: '2026-08-01',
      market: 'TPE',
      ticker: '2330',
      name: '台積電',
      tx_type: 'BUY',
      price: 1050,
      qty: 1000,
      fee_tax: 1496,
      created_at: '2026-08-01T00:00:00Z',
    }
    useWorkspace.mockReturnValue({
      ledger: computeLedger([lossTx]),
      transactions: [lossTx],
      current: { id: 'ws-1', name: '主要工作區' },
      loading: false,
      error: null,
    })
    useStockPrices.mockReturnValue({
      prices: {
        'TPE:2330': { price: 1000, prevClose: 1020, asOf: '', source: 'twse', stale: false, trial: false },
      },
      loading: false,
      refreshedAt: new Date('2026-08-25T10:00:00Z'),
      refresh: vi.fn(),
    })
    cleanup()
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    const rowLoss = screen.getByTestId('holding-row-2330')
    expect(cell(rowLoss, 'chg').className).toContain('pnl-down')
    expect(cell(rowLoss, 'unr').className).toContain('pnl-down')
  })

  it('現價依昨收上色：漲紅、跌綠；平盤、快取、沒有昨收都不上色', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ price: 1000, prevClose: 980, stale: false }, 'hl-px pnl-up'],
      [{ price: 1000, prevClose: 1020, stale: false }, 'hl-px pnl-down'],
      [{ price: 1000, prevClose: 1000, stale: false }, 'hl-px'],
      [{ price: 1000, prevClose: 980, stale: true }, 'hl-px'],
      [{ price: 1000, prevClose: null, stale: false }, 'hl-px'],
    ]
    for (const [quote, expected] of cases) {
      cleanup()
      mockWorkspace()
      useStockPrices.mockReturnValue({
        prices: { 'TPE:2330': { asOf: '', source: 'twse', trial: false, ...quote } },
        loading: false,
        refreshedAt: new Date('2026-08-25T10:00:00Z'),
        refresh: vi.fn(),
      })
      render(<DashboardPage onSelectTicker={vi.fn()} />)
      const px = screen.getByTestId('holding-row-2330').querySelector('.hl-px') as HTMLElement
      expect(px.className).toBe(expected)
    }
  })
})


// Task 158 #16 / Task 159 D11, D12, D13: page structure, first-run actions, and quotes that never arrive.
describe('DashboardPage — structure, empty account, missing quotes', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockWorkspace()
  })

  it('opens with the statement totals, then the 持股明細 grouped by market', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 2, name: /未實現淨損益/ })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '持股明細' })).toBeTruthy()
    expect(screen.getByTestId('holding-market-tw').textContent).toContain('台股小計')
    expect(screen.getByTestId('holding-market-us').textContent).toContain('美股小計')
    // 排序按鈕已移除（2026-09-28），固定依市值排列
    expect(screen.queryByRole('group', { name: '排序' })).toBeNull()
    expect(screen.getByText(/依市值排列/)).toBeTruthy()
  })

  it('unrealized P&L: without a USD rate the headline is the TW figure alone, and says so', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    const twSplit = document.querySelector('.stmt-tot-lead .stmt-sub b')!.textContent
    expect(screen.getByTestId('total-unrealized').textContent).toBe(twSplit)
    expect(screen.getByRole('heading', { level: 2, name: /未實現淨損益（台股）/ })).toBeTruthy()
    expect(screen.getByText(/沒有匯率，未合計/)).toBeTruthy()
  })

  it('unrealized P&L: with a USD rate both markets combine in TWD', () => {
    useUsdTwdRate.mockReturnValue(32)
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.queryByRole('heading', { level: 2, name: /未實現淨損益（台股）/ })).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: /持倉市值（台幣合計）/ })).toBeTruthy()
    expect(screen.queryByText(/沒有匯率/)).toBeNull()
  })

  it('replaces the all-zero summary with two actions when there are no holdings', async () => {
    mockWorkspace([])
    const onAddTransaction = vi.fn()
    const onGoToTransactions = vi.fn()
    const user = userEvent.setup()
    render(<DashboardPage onAddTransaction={onAddTransaction} onGoToTransactions={onGoToTransactions} />)

    expect(screen.queryByTestId('tw-mktval')).toBeNull()
    expect(screen.queryByTestId('tw-exposure')).toBeNull()
    expect(screen.getByText(/目前沒有持股/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '新增第一筆交易' }))
    expect(onAddTransaction).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '匯入 CSV' }))
    expect(onGoToTransactions).toHaveBeenCalledTimes(1)
  })

  it('shows a dash and a retry instead of a skeleton when a US quote is still missing after loading', async () => {
    const refresh = vi.fn()
    useStockPrices.mockReturnValue({
      prices: {
        'TPE:2330': { price: 1000, prevClose: 980, asOf: '', source: 'twse', stale: false, trial: false },
      },
      loading: false,
      refreshedAt: new Date('2026-08-25T10:00:00Z'),
      refresh,
    })
    const user = userEvent.setup()
    const { container } = render(<DashboardPage onSelectTicker={vi.fn()} />)

    expect(container.querySelector('.skeleton')).toBeNull()
    expect(screen.getByText('目前取不到美股報價')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '重試' }))
    expect(refresh).toHaveBeenCalled()
  })

  it('keeps the skeleton while quotes are still loading', () => {
    useStockPrices.mockReturnValue({ prices: {}, loading: true, refreshedAt: null, refresh: vi.fn() })
    const { container } = render(<DashboardPage onSelectTicker={vi.fn()} />)

    expect(container.querySelector('.skeleton')).not.toBeNull()
    expect(screen.queryByText('目前取不到美股報價')).toBeNull()
  })
})

/**
 * BUG-087. The 牌告 row withholds the halved 現股當沖 tax on a lot bought today, and has to say so:
 * with no trade at all the figure moves back overnight, which is unreadable without a label.
 * The clock is pinned because the component reads today's Taipei date itself.
 */
describe('DashboardPage — 當日買進的牌告口徑標註當沖稅率（BUG-087）', () => {
  // 2026-09-29 13:00 Taipei = 05:00 UTC
  const NOW = new Date('2026-09-29T05:00:00Z')

  const SAME_DAY_TX: Transaction = {
    id: 'tx-6560',
    workspace_id: 'ws-1',
    tx_date: '2026-09-29',
    market: 'TPE',
    ticker: '6560',
    name: '欣普羅',
    tx_type: 'BUY',
    price: 32.6,
    qty: 1000,
    fee_tax: 46,
    created_at: '2026-09-29T01:00:00Z',
  }

  function mount(tx: Transaction) {
    useWorkspace.mockReturnValue({
      ledger: computeLedger([tx]),
      transactions: [tx],
      current: { id: 'ws-1', name: '主要工作區' },
      loading: false,
      error: null,
    })
    useStockPrices.mockReturnValue({
      prices: { 'TPE:6560': { price: 32.4, prevClose: 32.6, asOf: '', source: 'twse', stale: false, trial: false } },
      loading: false,
      refreshedAt: NOW,
      refresh: vi.fn(),
    })
    useUsdTwdRate.mockReturnValue({ rate: null, asOf: null, loading: false, error: null })
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('買進當天：牌告列顯示 −NT$340 並附上當沖稅率說明', async () => {
    mount(SAME_DAY_TX)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    await user.click(screen.getByTestId('holding-row-6560'))
    const list = screen.getByTestId('method-list')
    expect(list.textContent).toContain('-NT$340')
    expect(list.textContent).toContain('當沖 0.15%')
    // 自己的口徑不受影響
    expect(screen.getByTestId('method-net').textContent).toContain('-NT$389')
  })

  it('前一天買進的批次：牌告列是 −NT$389，沒有當沖說明', async () => {
    mount({ ...SAME_DAY_TX, tx_date: '2026-09-26', created_at: '2026-09-26T01:00:00Z' })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    await user.click(screen.getByTestId('holding-row-6560'))
    const list = screen.getByTestId('method-list')
    expect(list.textContent).toContain('-NT$389')
    expect(list.textContent).not.toContain('當沖')
  })
})
