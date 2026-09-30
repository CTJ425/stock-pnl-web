// @vitest-environment jsdom
/**
 * Task 176 區間收益, the parts only the component decides: which window it opens on, what a preset
 * click does to the table, and the two different "nothing here" answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { computeLedger } from '../../utils/pnlEngine'
import type { Transaction, TxType } from '../../types/models'
import { RangeSection } from './RangeSection'

let seq = 0
function tx(
  date: string,
  type: TxType,
  price: number,
  qty: number,
  fee = 0,
  over: Partial<Transaction> = {},
): Transaction {
  seq++
  return {
    id: `tx-${seq}`,
    workspace_id: 'ws',
    tx_date: date,
    market: 'TPE',
    ticker: '2330',
    name: '台積電',
    tx_type: type,
    price,
    qty,
    fee_tax: fee,
    created_at: `2020-01-01T00:00:00.${String(seq).padStart(3, '0')}Z`,
    ...over,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  // 2026-09-30 in Asia/Taipei, whatever the host time zone is.
  vi.setSystemTime(new Date('2026-09-30T04:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

const from = () => screen.getByLabelText('起') as HTMLInputElement
const to = () => screen.getByLabelText('訖') as HTMLInputElement

describe('RangeSection', () => {
  it('預設近 1 年，日期欄位填的是今天往回推一年', () => {
    render(
      <RangeSection
        ledger={computeLedger([
          tx('2025-02-10', 'BUY', 500, 1000, 712),
          tx('2026-07-11', 'SELL', 600, 1000, 2655),
        ])}
      />,
    )
    expect(screen.getByRole('button', { name: '近 1 年' }).getAttribute('aria-pressed')).toBe('true')
    expect(from().value).toBe('2025-09-30')
    expect(to().value).toBe('2026-09-30')
  })

  it('按「去年」重算區間，表格跟著換成那一年的賣出', () => {
    render(
      <RangeSection
        ledger={computeLedger([
          tx('2025-02-10', 'BUY', 500, 1000, 712),
          tx('2025-06-20', 'SELL', 600, 1000, 2655),
          tx('2026-03-05', 'BUY', 700, 1000, 997),
          tx('2026-07-11', 'SELL', 650, 1000, 2877),
        ])}
      />,
    )
    // 近 1 年只看得到 2026-07-11 那筆
    fireEvent.click(screen.getByRole('button', { name: '展開 2330 區間內的逐筆賣出' }))
    expect(screen.getByText(/2026-07-11/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '去年' }))
    expect(from().value).toBe('2025-01-01')
    expect(to().value).toBe('2025-12-31')
    // The drill-down stays open across a preset change — same stock, same question, new window.
    expect(screen.getByRole('button', { name: '收合 2330 區間內的逐筆賣出' })).toBeTruthy()
    expect(screen.getByText(/2025-06-20/)).toBeTruthy()
    expect(screen.queryByText(/2026-07-11/)).toBeNull()
  })

  it('改日期欄位就切到「自訂」', () => {
    render(
      <RangeSection
        ledger={computeLedger([
          tx('2025-02-10', 'BUY', 500, 1000, 712),
          tx('2026-07-11', 'SELL', 600, 1000, 2655),
        ])}
      />,
    )
    fireEvent.change(from(), { target: { value: '2026-01-01' } })
    expect(screen.getByRole('button', { name: '自訂' }).getAttribute('aria-pressed')).toBe('true')
    expect(from().value).toBe('2026-01-01')
  })

  it('區間內沒有賣出也沒有股利時，說的是「沒有落袋的賺賠」而不是沒有資料', () => {
    render(
      <RangeSection
        ledger={computeLedger([
          tx('2020-02-10', 'BUY', 500, 1000, 712),
          tx('2020-06-20', 'SELL', 600, 1000, 2655),
        ])}
      />,
    )
    expect(screen.getByText(/這段期間沒有賣出，也沒有領到股利/)).toBeTruthy()
  })

  it('起始日晚於結束日時擋下來，不畫表格', () => {
    render(
      <RangeSection
        ledger={computeLedger([
          tx('2025-02-10', 'BUY', 500, 1000, 712),
          tx('2026-07-11', 'SELL', 600, 1000, 2655),
        ])}
      />,
    )
    fireEvent.change(from(), { target: { value: '2026-12-31' } })
    expect(screen.getByText(/起始日晚於結束日/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('完全沒有賣出與股利的帳本不顯示這個區塊', () => {
    const { container } = render(<RangeSection ledger={computeLedger([tx('2026-03-05', 'BUY', 700, 1000, 997)])} />)
    expect(container.innerHTML).toBe('')
  })

  it('只有台股時不出現台股／美股切換；兩邊都有才出現', () => {
    const twOnly = computeLedger([
      tx('2025-02-10', 'BUY', 500, 1000, 712),
      tx('2026-07-11', 'SELL', 600, 1000, 2655),
    ])
    const { unmount } = render(<RangeSection ledger={twOnly} />)
    expect(screen.queryByRole('group', { name: '區間收益幣別' })).toBeNull()
    unmount()

    const both = computeLedger([
      tx('2025-02-10', 'BUY', 500, 1000, 712),
      tx('2026-07-11', 'SELL', 600, 1000, 2655),
      tx('2026-01-07', 'BUY', 180, 10, 0, { market: 'US', ticker: 'AAPL', name: 'Apple Inc.' }),
      tx('2026-02-07', 'SELL', 200, 10, 0, { market: 'US', ticker: 'AAPL', name: 'Apple Inc.' }),
    ])
    render(<RangeSection ledger={both} />)
    const seg = screen.getByRole('group', { name: '區間收益幣別' })
    fireEvent.click(within(seg).getByRole('button', { name: '美股' }))
    expect(screen.getByText(/AAPL/)).toBeTruthy()
    expect(screen.queryByText(/2330/)).toBeNull()
  })

  it('合計列印出區間內的已實現、股利與總報酬', () => {
    render(
      <RangeSection
        ledger={computeLedger([
          tx('2025-02-10', 'BUY', 500, 1000, 712),
          tx('2026-07-11', 'SELL', 600, 1000, 2655),
          tx('2026-08-15', 'DIVIDEND', 3.5, 1000, 100),
        ])}
      />,
    )
    // 已實現 600,000 − 2,655 − 500,712 = 96,633；股利 3,400；總報酬 100,033
    const foot = screen.getByRole('table').querySelector('tfoot')!
    expect(foot.textContent).toContain('96,633')
    expect(foot.textContent).toContain('3,400')
    expect(foot.textContent).toContain('100,033')
    expect(screen.getByText('區間總報酬').parentElement!.textContent).toContain('100,033')
  })
})
