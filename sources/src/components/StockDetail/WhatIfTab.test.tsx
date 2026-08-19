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

describe('WhatIfTab 沒有報價時', () => {
  // A newly watched ticker has no quote until the nightly batch runs, so this is the
  // first thing such a user sees. It must read as "not yet", not as broken.
  it('currentPrice 為 null 時顯示提示，不出現 NaN 或 Infinity', () => {
    const { container } = render(<WhatIfTab ticker="2059" currentPrice={null} />)

    expect(container.textContent).not.toMatch(/NaN|Infinity/)
    expect(screen.getByLabelText('假想買進價')).toHaveProperty('value', '')
  })
})
