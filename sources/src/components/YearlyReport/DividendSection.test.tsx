// @vitest-environment jsdom
/**
 * Task 183: the 股利 section. `dividendReport.test.ts` pins the arithmetic; this file pins what the
 * section actually shows — that the three totals close, that 總報酬 adds the year's realized P&L to
 * the dividends banked, that the two markets never merge, and that a market with no dividend
 * renders nothing at all rather than an empty block.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { computeLedger } from '../../utils/pnlEngine'
import type { Market, Transaction, TxType } from '../../types/models'
import { DividendSection } from './DividendSection'

const { useWorkspace } = vi.hoisted(() => ({ useWorkspace: vi.fn() }))
vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))

let seq = 0
function tx(over: Partial<Transaction> & { tx_date: string; ticker: string }): Transaction {
  seq += 1
  return {
    id: `tx-${seq}`,
    workspace_id: 'ws',
    market: 'TPE' as Market,
    name: over.ticker,
    tx_type: 'DIVIDEND' as TxType,
    price: 1,
    qty: 1000,
    fee_tax: 10,
    created_at: `2026-01-01T00:00:00.${String(seq).padStart(3, '0')}Z`,
    ...over,
  } as Transaction
}

/** The user's real 2026 dividends plus four more, so the top-4 fold has something to fold. */
function seed(): Transaction[] {
  seq = 0
  return [
    tx({ tx_date: '2026-02-12', ticker: '0050', name: '台灣50', price: 0.5, qty: 2000 }),
    tx({ tx_date: '2026-03-12', ticker: '2330', name: '台積電', price: 4.5, qty: 1000 }),
    tx({ tx_date: '2026-05-14', ticker: '0050', name: '台灣50', price: 0.55, qty: 2000 }),
    tx({ tx_date: '2026-06-11', ticker: '2330', name: '台積電', price: 5, qty: 1000 }),
    tx({ tx_date: '2026-07-15', ticker: '2884', name: '玉山金', price: 1.2, qty: 5000 }),
    tx({ tx_date: '2026-07-28', ticker: '2882', name: '國泰金', price: 2, qty: 1000 }),
    tx({ tx_date: '2026-08-05', ticker: '2609', name: '陽明', price: 2, qty: 14000, fee_tax: 601 }),
    tx({ tx_date: '2026-08-10', ticker: '0050', name: '台灣50', price: 0.6, qty: 2000 }),
    tx({ tx_date: '2026-09-10', ticker: '2330', name: '台積電', price: 5, qty: 1000 }),
    tx({ tx_date: '2026-09-18', ticker: '1101', name: '台泥', price: 1, qty: 2000 }),
  ]
}

function renderWith(transactions: Transaction[], currency: 'TWD' | 'USD' = 'TWD') {
  useWorkspace.mockReturnValue({ ledger: computeLedger(transactions), transactions })
  return render(<DividendSection title={currency === 'TWD' ? '台股 (TWD)' : '美股 (USD)'} currency={currency} />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DividendSection 合計', () => {
  it('配息總額 − 代扣費用 = 實收，三個數字都印出來', () => {
    renderWith(seed())
    const totals = document.querySelector('.div-totals')!
    expect(within(totals as HTMLElement).getByText('NT$55,800')).toBeTruthy()
    expect(within(totals as HTMLElement).getByText('NT$691')).toBeTruthy()
    expect(within(totals as HTMLElement).getByText('NT$55,109')).toBeTruthy()
    expect(within(totals as HTMLElement).getByText(/10 次配息 · 6 檔/)).toBeTruthy()
  })

  it('總報酬 = 這一年的已實現損益 + 股利實收', () => {
    // 買 500×1000 手續費 712，賣 600×1000 費稅 2,655 → 已實現 96,633。加上股利實收 55,109。
    renderWith([
      ...seed(),
      tx({ tx_date: '2026-01-10', ticker: '2330', name: '台積電', tx_type: 'BUY', price: 500, qty: 1000, fee_tax: 712 }),
      tx({ tx_date: '2026-06-01', ticker: '2330', name: '台積電', tx_type: 'SELL', price: 600, qty: 1000, fee_tax: 2655 }),
    ])
    const close = document.querySelector('.div-close')!
    expect(close.textContent).toContain('NT$151,742') // 96,633 + 55,109
    expect(close.textContent).toContain('NT$96,633')
    expect(close.textContent).toContain('NT$55,109')
  })

  it('沒有賣出時總報酬就等於股利實收', () => {
    renderWith(seed())
    const close = document.querySelector('.div-close')!
    expect(close.textContent).toContain('總報酬')
    expect(close.textContent).toContain('NT$55,109')
  })
})

describe('DividendSection 圖與明細', () => {
  it('每月長條的 aria 標籤說出該月的配息組成，尖峰月直接標數字', () => {
    renderWith(seed())
    expect(screen.getByLabelText(/8 月 配息總額 NT\$29,200：2609 陽明 NT\$28,000、0050 台灣50 NT\$1,200/)).toBeTruthy()
    expect(screen.getByLabelText('1 月 沒有配息')).toBeTruthy()
    expect(document.querySelector('.div-peak')!.textContent).toBe('29,200')
  })

  it('個股占比列出前 4 大並把其餘折成「其他」，百分比加起來是 100', () => {
    renderWith(seed())
    const items = [...document.querySelectorAll('.div-share li')]
    expect(items).toHaveLength(5)
    expect(items[0].textContent).toContain('2609')
    expect(items[4].textContent).toContain('其他 2 檔')
    const pcts = [...document.querySelectorAll('.div-share-pct')].map((e) => parseFloat(e.textContent!))
    expect(pcts).toEqual([50.2, 26, 10.7, 5.9, 7.2])
    expect(pcts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10)
  })

  it('其他即使金額大於第 4 名也還是排最後', () => {
    renderWith(seed())
    const items = [...document.querySelectorAll('.div-share li')]
    expect(items[3].textContent).toContain('NT$3,300') // 0050
    expect(items[4].textContent).toContain('NT$4,000') // 其他，比 0050 大
  })

  it('逐筆明細帶著可以自己驗算的欄位', () => {
    renderWith(seed())
    const rows = [...document.querySelectorAll('.div-tbl tbody tr')]
    expect(rows).toHaveLength(10)
    const yangming = rows.find((r) => r.textContent!.includes('2609'))!
    const cells = [...yangming.querySelectorAll('td')].map((c) => c.textContent)
    // 發放日 / 商品 / 除息股數 / 每股股利 / 配息總額 / 代扣費用 / 實收
    expect(cells[0]).toBe('2026-08-05')
    expect(cells[2]).toBe('14,000')
    expect(cells[3]).toBe('2')
    expect(cells[4]).toBe('NT$28,000')
    expect(cells[5]).toBe('NT$601')
    expect(cells[6]).toBe('NT$27,399')
  })

  it('明細的合計列等於上方的三個合計', () => {
    renderWith(seed())
    const foot = [...document.querySelectorAll('.div-tbl tfoot td')].map((c) => c.textContent)
    expect(foot).toEqual(['合計', '', '', '', 'NT$55,800', 'NT$691', 'NT$55,109'])
  })
})

describe('DividendSection 市場與年度', () => {
  it('台股與美股各自結算，金額不相加', () => {
    const txs = [
      ...seed(),
      tx({ tx_date: '2026-04-01', ticker: 'AAPL', name: 'Apple', market: 'US', price: 0.25, qty: 100, fee_tax: 8 }),
    ]
    const tw = renderWith(txs, 'TWD')
    expect(within(tw.container.querySelector('.div-totals') as HTMLElement).getByText('NT$55,800')).toBeTruthy()
    cleanup()
    const us = renderWith(txs, 'USD')
    const usTotals = us.container.querySelector('.div-totals') as HTMLElement
    expect(within(usTotals).getByText('US$25.00')).toBeTruthy()
    expect(usTotals.textContent).not.toContain('55,800')
  })

  it('這個市場沒有股利就整段不渲染', () => {
    const { container } = renderWith(seed(), 'USD')
    expect(container.querySelector('.div-section')).toBeNull()
  })

  it('只有股票股利時也不渲染 — 它不產生現金', () => {
    const { container } = renderWith([
      tx({ tx_date: '2026-04-02', ticker: '2330', tx_type: 'STOCK_DIVIDEND', price: 0, qty: 200, fee_tax: 0 }),
    ])
    expect(container.querySelector('.div-section')).toBeNull()
  })

  it('多個年度時給年度切換，切過去換成那一年的數字', () => {
    renderWith([
      ...seed(),
      tx({ tx_date: '2025-08-05', ticker: '2609', name: '陽明', price: 1, qty: 1000, fee_tax: 10 }),
    ])
    const picker = document.querySelector('.div-years')!
    expect([...picker.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['2026', '2025'])

    fireEvent.click(within(picker as HTMLElement).getByText('2025'))
    const totals = document.querySelector('.div-totals') as HTMLElement
    expect(within(totals).getByText('NT$1,000')).toBeTruthy()
    expect(within(totals).getByText(/1 次配息 · 1 檔/)).toBeTruthy()
  })

  it('只有一個年度時不顯示年度切換', () => {
    renderWith(seed())
    expect(document.querySelector('.div-years')).toBeNull()
  })
})
