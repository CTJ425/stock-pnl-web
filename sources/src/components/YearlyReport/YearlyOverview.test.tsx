// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Transaction, TxType } from '../../types/models'
import { computeLedger } from '../../utils/pnlEngine'
import { YearlyOverview } from './YearlyOverview'

let seq = 0
function tx(date: string, ticker: string, type: TxType, price: number, qty: number, fee = 0): Transaction {
  seq++
  return {
    id: `t${seq}`,
    workspace_id: 'ws',
    tx_date: date,
    market: 'TPE',
    ticker,
    name: ticker === '2330' ? '台積電' : '鴻海',
    tx_type: type,
    price,
    qty,
    fee_tax: fee,
    created_at: `2026-01-01T00:00:00.${String(seq).padStart(3, '0')}Z`,
  }
}

const LEDGER = computeLedger([
  tx('2024-01-10', '2330', 'BUY', 500, 1000),
  tx('2024-06-01', '2330', 'SELL', 600, 1000),
  tx('2025-01-10', '2317', 'BUY', 200, 1000),
  tx('2025-03-01', '2317', 'SELL', 150, 1000),
])

afterEach(cleanup)

describe('YearlyOverview', () => {
  it('opens on the latest year and lists its stocks', () => {
    render(<YearlyOverview ledger={LEDGER} />)
    expect(screen.getByRole('heading', { name: '2025 年各檔貢獻' })).toBeTruthy()
    expect(screen.getByRole('list', { name: '2025 年各檔已實現損益' }).textContent).toContain('-NT$50,000')
  })

  it('clicking a year bar switches the list to that year', () => {
    const { container } = render(<YearlyOverview ledger={LEDGER} />)
    // One transparent hit column per year; the first is 2024.
    const hits = [...container.querySelectorAll('svg rect[fill="transparent"]')]
    fireEvent.click(hits[0])
    expect(screen.getByRole('heading', { name: '2024 年各檔貢獻' })).toBeTruthy()
    expect(screen.getByRole('list', { name: '2024 年各檔已實現損益' }).textContent).toContain('+NT$100,000')
  })

  it('draws the running total after every sell', () => {
    render(<YearlyOverview ledger={LEDGER} />)
    expect(screen.getByRole('heading', { name: '累計已實現損益' })).toBeTruthy()
  })

  it('renders nothing when no year has a sell or a dividend', () => {
    const { container } = render(<YearlyOverview ledger={computeLedger([tx('2025-01-10', '2330', 'BUY', 500, 1000)])} />)
    expect(container.innerHTML).toBe('')
  })
})
