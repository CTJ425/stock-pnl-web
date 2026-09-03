// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transaction } from '../../types/models'
import { computeLedger } from '../../utils/pnlEngine'
import { DashboardPage } from './DashboardPage'

const { useWorkspace, useStockPrices } = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
  useStockPrices: vi.fn(),
}))

vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))
vi.mock('../../hooks/useStockPrices', () => ({ useStockPrices }))
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

function mockWorkspace(txs: Transaction[] = TXS) {
  useWorkspace.mockReturnValue({
    ledger: computeLedger(txs),
    current: { id: 'ws-1', name: '主要工作區' },
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

  // Task 142: with no SHORT rows the panel and the table both drop their short-side furniture.
  it('T3 沒有空單時不畫曝險條，主數字改叫持倉市值', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    const toNum = (el: HTMLElement) => Number(el.textContent!.replace(/[^0-9.-]/g, ''))
    expect(screen.queryByTestId('tw-exposure')).toBeNull()
    expect(screen.queryByText('淨額市值')).toBeNull()
    // 2330 多單 1000 × 1000 = 1,000,000
    expect(toNum(screen.getByTestId('tw-mktval'))).toBe(1_000_000)
  })

  it('T9 沒有空單時不渲染任何分組標題列', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.queryByTestId('holding-group-LONG')).toBeNull()
    expect(screen.queryByTestId('holding-group-SHORT')).toBeNull()
  })

  it('點擊台股持股列會觸發 onSelectTicker 並帶入代號與名稱', async () => {
    const user = userEvent.setup()
    const onSelectTicker = vi.fn()

    render(<DashboardPage onSelectTicker={onSelectTicker} />)

    const twRow = screen.getByTestId('holding-row-2330')
    expect(twRow).toBeTruthy()
    expect(twRow.getAttribute('style')).toContain('cursor: pointer')
    expect(twRow.getAttribute('title')).toBe('點擊查看個股分析')

    await user.click(twRow)
    expect(onSelectTicker).toHaveBeenCalledTimes(1)
    expect(onSelectTicker).toHaveBeenCalledWith('2330', '台積電')
  })

  it('美股持股列不提供點擊跳轉個股分析', async () => {
    const user = userEvent.setup()
    const onSelectTicker = vi.fn()

    render(<DashboardPage onSelectTicker={onSelectTicker} />)

    const usRow = screen.getByTestId('holding-row-AAPL')
    expect(usRow).toBeTruthy()
    expect(usRow.getAttribute('style') ?? '').not.toContain('cursor: pointer')
    expect(usRow.getAttribute('title')).toBeNull()

    await user.click(usRow)
    expect(onSelectTicker).not.toHaveBeenCalled()
  })

  it('未提供 onSelectTicker 時（例如本機離線模式），台股列維持不可點擊狀態', async () => {
    const user = userEvent.setup()

    render(<DashboardPage />)

    const twRow = screen.getByTestId('holding-row-2330')
    expect(twRow.getAttribute('style') ?? '').not.toContain('cursor: pointer')
    expect(twRow.getAttribute('title')).toBeNull()

    // Clicking won't throw errors
    await user.click(twRow)
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
    useWorkspace.mockReturnValue({
      ledger: computeLedger([...TXS, SHORT_TX]),
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
  it('T1 台股面板主數字改成淨額市值，且只加總台股', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    // 2330 多單 1000 × 1000 = 1,000,000（AAPL 是美股，不得加進來）
    // 2603 空單 1000 × 95 = 95,000 → 淨額 905,000
    expect(num(screen.getByTestId('tw-mktval'))).toBe(905_000)
    expect(screen.getByText('淨額市值')).toBeTruthy()
  })

  it('T2 曝險條列出多空兩個小計', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.getByTestId('tw-exposure')).toBeTruthy()
    expect(num(screen.getByTestId('tw-long-mktval'))).toBe(1_000_000)
    expect(num(screen.getByTestId('tw-short-mktval'))).toBe(95_000)
  })

  it('T4 美股面板永遠沒有曝險條（美股沒有融券）', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.queryByTestId('us-exposure')).toBeNull()
    expect(screen.queryByTestId('us-short-mktval')).toBeNull()
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

  it('T7 分組標題列帶檔數與小計市值', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    expect(screen.getByTestId('holding-group-LONG')).toBeTruthy()
    expect(screen.getByTestId('holding-group-SHORT')).toBeTruthy()
    // 台股多單只有 2330 一檔；空單只有 2603 一檔
    expect(num(screen.getByTestId('holding-group-LONG-mktval'))).toBe(1_000_000)
    expect(num(screen.getByTestId('holding-group-SHORT-mktval'))).toBe(95_000)
  })

  it('T14 只有一條腿有價格時，淨額不成立：不顯示數字也不畫曝險條', () => {
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
    expect(screen.queryByTestId('tw-exposure')).toBeNull()
    expect(screen.getByTestId('tw-mktval').textContent).not.toMatch(/[0-9]/)
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
    useWorkspace.mockReturnValue({
      ledger: computeLedger(BOTH_LEGS),
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
    // Task 142 起主數字是淨額，多頭小計搬到曝險條上，但保證不變。
    expect(num(screen.getByTestId('tw-long-mktval'))).toBe(1_000_000)
    expect(num(screen.getByTestId('tw-short-mktval'))).toBe(1_000_000)
    expect(num(screen.getByTestId('tw-mktval'))).toBe(0)
  })

  it('投入總成本每檔只算一次，不因為多空各一列而算兩次', () => {
    render(<DashboardPage onSelectTicker={vi.fn()} />)
    // 951,425；逐列加總會變成 1,902,850
    expect(num(screen.getByTestId('tw-cost'))).toBe(951_425)
  })
})
