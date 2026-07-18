import { describe, expect, it } from 'vitest'
import type { Market, Transaction, TxType, Workspace } from '../types/models'
import { aggregateWorkspaces } from './aggregate'

let seq = 0
function tx(input: {
  ws: string
  date: string
  market: Market
  ticker: string
  type: TxType
  price: number
  qty: number
  fee?: number
}): Transaction {
  seq++
  return {
    id: `tx-${seq}`,
    workspace_id: input.ws,
    tx_date: input.date,
    market: input.market,
    ticker: input.ticker,
    name: input.ticker,
    tx_type: input.type,
    price: input.price,
    qty: input.qty,
    fee_tax: input.fee ?? 0,
    created_at: `2026-01-01T00:00:00.${String(seq).padStart(3, '0')}Z`,
  }
}

const WS: Workspace[] = [
  { id: 'ws-a', name: '玉山', created_at: '2026-01-01T00:00:00Z' },
  { id: 'ws-b', name: '元大', created_at: '2026-01-02T00:00:00Z' },
]

describe('aggregateWorkspaces（跨工作區彙總）', () => {
  it('同代號跨工作區的移動平均成本各自獨立、不互相污染', () => {
    const { holdings, ledger } = aggregateWorkspaces(WS, [
      // 玉山：100 元買 1000 股後以 110 賣出 500 股
      tx({ ws: 'ws-a', date: '2026-01-10', market: 'TPE', ticker: '0050', type: 'BUY', price: 100, qty: 1000 }),
      tx({ ws: 'ws-a', date: '2026-02-01', market: 'TPE', ticker: '0050', type: 'SELL', price: 110, qty: 500 }),
      // 元大：同一檔但 90 元買入，成本不同
      tx({ ws: 'ws-b', date: '2026-01-15', market: 'TPE', ticker: '0050', type: 'BUY', price: 90, qty: 1000 }),
    ])

    // 各工作區一列，成本各自維持
    expect(holdings).toHaveLength(2)
    const a = holdings.find((h) => h.workspaceId === 'ws-a')
    const b = holdings.find((h) => h.workspaceId === 'ws-b')
    expect(a?.workspaceName).toBe('玉山')
    expect(a?.qty).toBe(500)
    expect(a?.avgCost).toBeCloseTo(100, 6) // 不受元大 90 元影響
    expect(b?.qty).toBe(1000)
    expect(b?.avgCost).toBeCloseTo(90, 6) // 不受玉山 100 元影響

    // 玉山賣出的已實現以自家成本 100 計：(110-100)*500 = 5000
    expect(ledger.summary.realizedTw).toBeCloseTo(5000, 6)
  })

  it('年度彙總：跨工作區加總、代號明細合併', () => {
    const { ledger } = aggregateWorkspaces(WS, [
      tx({ ws: 'ws-a', date: '2026-01-10', market: 'TPE', ticker: '2330', type: 'BUY', price: 500, qty: 100, fee: 20 }),
      tx({ ws: 'ws-b', date: '2026-03-05', market: 'TPE', ticker: '2330', type: 'BUY', price: 600, qty: 100, fee: 25 }),
      tx({ ws: 'ws-b', date: '2025-06-01', market: 'US', ticker: 'AAPL', type: 'BUY', price: 100, qty: 10, fee: 1 }),
    ])

    expect(ledger.years).toEqual([2025, 2026])
    const y = ledger.yearly[2026]
    expect(y.count).toBe(2)
    expect(y.fees).toBe(45)
    expect(y.buyAmt).toBeCloseTo(500 * 100 + 20 + 600 * 100 + 25, 6)
    // 同代號合併為單一明細
    expect(Object.keys(y.tickers)).toEqual(['TPE:2330'])
    expect(y.tickers['TPE:2330'].count).toBe(2)
    expect(ledger.summary.count).toBe(3)
  })

  it('警告訊息加上工作區名稱前綴；無交易的工作區不影響結果', () => {
    const { ledger, holdings } = aggregateWorkspaces(WS, [
      tx({ ws: 'ws-b', date: '2026-01-10', market: 'TPE', ticker: '2603', type: 'SELL', price: 100, qty: 100 }),
    ])
    expect(ledger.warnings).toHaveLength(1)
    expect(ledger.warnings[0].startsWith('[元大]')).toBe(true)
    expect(holdings).toHaveLength(0)
  })

  it('無任何交易時回傳空彙總', () => {
    const { ledger, holdings } = aggregateWorkspaces(WS, [])
    expect(holdings).toHaveLength(0)
    expect(ledger.years).toHaveLength(0)
    expect(ledger.summary.count).toBe(0)
  })
})
