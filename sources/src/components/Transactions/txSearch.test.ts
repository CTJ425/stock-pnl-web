import { describe, expect, it } from 'vitest'
import type { Transaction } from '../../types/models'
import { filterTransactions } from './txSearch'

const mockTxs: Transaction[] = [
  {
    id: 'tx-1',
    workspace_id: 'ws1',
    tx_date: '2024-01-10',
    market: 'TPE',
    ticker: '2330',
    name: '台積電',
    tx_type: 'BUY',
    price: 500,
    qty: 1000,
    fee_tax: 712,
    created_at: '2024-01-10T00:00:00Z',
  },
  {
    id: 'tx-2',
    workspace_id: 'ws1',
    tx_date: '2024-02-01',
    market: 'US',
    ticker: 'AAPL',
    name: 'Apple Inc.',
    tx_type: 'BUY',
    price: 180,
    qty: 10,
    fee_tax: 1,
    created_at: '2024-02-01T00:00:00Z',
  },
  {
    id: 'tx-3',
    workspace_id: 'ws1',
    tx_date: '2024-03-01',
    market: 'US',
    ticker: 'NVDA',
    name: 'NVIDIA Corporation',
    tx_type: 'BUY',
    price: 800,
    qty: 5,
    fee_tax: 2,
    created_at: '2024-03-01T00:00:00Z',
  },
]

describe('txSearch (純函式過濾邏輯)', () => {
  it('U1: 空字串 / 全空白關鍵字回傳全部交易', () => {
    expect(filterTransactions(mockTxs, '')).toEqual(mockTxs)
    expect(filterTransactions(mockTxs, '   ')).toEqual(mockTxs)
  })

  it('U2: 代號部分比對 "233" 命中 2330', () => {
    const res = filterTransactions(mockTxs, '233')
    expect(res).toHaveLength(1)
    expect(res[0].ticker).toBe('2330')
  })

  it('U3: 代號不分大小寫 "aapl" 命中 AAPL', () => {
    const res = filterTransactions(mockTxs, 'aapl')
    expect(res).toHaveLength(1)
    expect(res[0].ticker).toBe('AAPL')
  })

  it('U4: 名稱子字串 "台積" 命中台積電', () => {
    const res = filterTransactions(mockTxs, '台積')
    expect(res).toHaveLength(1)
    expect(res[0].name).toBe('台積電')
  })

  it('U5: 美股中文譯名 "蘋果" 透過 displayStockName 命中 AAPL', () => {
    const res = filterTransactions(mockTxs, '蘋果')
    expect(res).toHaveLength(1)
    expect(res[0].ticker).toBe('AAPL')
  })

  it('U6: 美股原始名稱 "apple" 不分大小寫命中 Apple Inc.', () => {
    const res = filterTransactions(mockTxs, 'apple')
    expect(res).toHaveLength(1)
    expect(res[0].ticker).toBe('AAPL')
  })

  it('U7: 無任何命中 "9999" 回傳空陣列', () => {
    const res = filterTransactions(mockTxs, '9999')
    expect(res).toHaveLength(0)
  })

  it('U8: 關鍵字前後空白 "  2330  " 與 "2330" 結果相同', () => {
    const res1 = filterTransactions(mockTxs, '  2330  ')
    const res2 = filterTransactions(mockTxs, '2330')
    expect(res1).toEqual(res2)
    expect(res1).toHaveLength(1)
  })
})
