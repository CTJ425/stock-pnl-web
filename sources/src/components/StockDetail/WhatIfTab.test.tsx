// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const { getFeeRate, getMinFee, useWorkspace } = vi.hoisted(() => ({
  getFeeRate: vi.fn(() => 0.001425),
  getMinFee: vi.fn(() => 20),
  useWorkspace: vi.fn(),
}))
vi.mock('../../utils/settings', () => ({ getFeeRate, getMinFee }))
vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))

import { WhatIfTab } from './WhatIfTab'

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  useWorkspace.mockReturnValue({ current: { id: 'ws-1', name: '主帳戶' } })
})

describe('WhatIfTab 費率取用', () => {
  // Every other caller scopes the rate to the workspace (AnalysisPage, DashboardPage,
  // TransactionForm). An unscoped read here would silently price the estimate with the
  // global rate while the workspace has its own.
  it('費率與最低手續費都按目前工作區取用', () => {
    render(<WhatIfTab ticker="2330" currentPrice={100} />)

    expect(getFeeRate).toHaveBeenCalledWith('ws-1')
    expect(getMinFee).toHaveBeenCalledWith(expect.any(String), 'ws-1')
  })

  it('沒有選定工作區時不丟例外', () => {
    useWorkspace.mockReturnValue({ current: null })
    expect(() => render(<WhatIfTab ticker="2330" currentPrice={100} />)).not.toThrow()
  })

  it('整股用 whole 級距，零股用 odd 級距', async () => {
    const { rerender } = render(<WhatIfTab ticker="2330" currentPrice={100} />)
    // 預設 1000 股是整股
    expect(getMinFee).toHaveBeenCalledWith('whole', 'ws-1')

    getMinFee.mockClear()
    const box = screen.getByLabelText('股數') as HTMLInputElement
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(box, { target: { value: '500' } })
    rerender(<WhatIfTab ticker="2330" currentPrice={100} />)

    expect(getMinFee).toHaveBeenCalledWith('odd', 'ws-1')
  })
})

describe('WhatIfTab 賣出價', () => {
  it('賣出價是可見的輸入，預設帶現價', async () => {
    render(<WhatIfTab ticker="2330" currentPrice={24.2} />)

    const sell = screen.getByLabelText('賣出價') as HTMLInputElement
    expect(sell.value).toBe('24.2')
    // 0.8.0 隱形假設「以現價賣出」，畫面上完全沒說，數字因此讀起來像壞掉。
    expect(screen.getByText(/現價 24\.2/)).toBeTruthy()
  })

  it('改賣出價，主數字跟著變', async () => {
    const { fireEvent } = await import('@testing-library/react')
    render(<WhatIfTab ticker="2330" currentPrice={24.2} />)

    const before = screen.getByTestId('whatif-pnl').textContent
    fireEvent.change(screen.getByLabelText('賣出價'), { target: { value: '30' } })
    const after = screen.getByTestId('whatif-pnl').textContent

    expect(after).not.toBe(before)
    expect(after).toMatch(/\+/)
  })

  it('沒有現價時三個輸入都可填，填完就算得出來', async () => {
    const { fireEvent } = await import('@testing-library/react')
    const { container } = render(<WhatIfTab ticker="2330" currentPrice={null} />)

    expect((screen.getByLabelText('賣出價') as HTMLInputElement).value).toBe('')
    expect(container.textContent).not.toMatch(/NaN|Infinity/)

    fireEvent.change(screen.getByLabelText('假想買進價'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('賣出價'), { target: { value: '110' } })

    expect(screen.getByTestId('whatif-pnl').textContent).toMatch(/\+/)
  })

  it('損益與報酬率是唯二的主數字，其餘明細收在小字', async () => {
    render(<WhatIfTab ticker="2330" currentPrice={24.2} />)

    expect(screen.getByTestId('whatif-pnl')).toBeTruthy()
    expect(screen.getByTestId('whatif-roi')).toBeTruthy()
    // 明細仍在，但不是主角
    const detail = screen.getByTestId('whatif-detail').textContent || ''
    for (const label of ['成本', '賣出可得', '手續費', '證交稅', '回本價']) {
      expect(detail).toContain(label)
    }
  })

  it('輸入不合法時給提示而不是 NaN', async () => {
    const { fireEvent } = await import('@testing-library/react')
    const { container } = render(<WhatIfTab ticker="2330" currentPrice={24.2} />)

    fireEvent.change(screen.getByLabelText('股數'), { target: { value: '0' } })

    expect(container.textContent).not.toMatch(/NaN|Infinity/)
    expect(screen.queryByTestId('whatif-pnl')).toBeNull()
  })
})
