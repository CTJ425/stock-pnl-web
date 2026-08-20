// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'

const { getFeeRate, getMinFee, useWorkspace } = vi.hoisted(() => ({
  getFeeRate: vi.fn(() => 0.001425),
  getMinFee: vi.fn(() => 20),
  useWorkspace: vi.fn(),
}))
vi.mock('../../utils/settings', () => ({ getFeeRate, getMinFee }))
vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))

import { WhatIfTab } from './WhatIfTab'

/** A watched stock: no holding, so no average cost and no held quantity. */
const watched = { avgCost: null, heldQty: null }

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
    render(<WhatIfTab ticker="2330" currentPrice={100} {...watched} />)

    expect(getFeeRate).toHaveBeenCalledWith('ws-1')
    expect(getMinFee).toHaveBeenCalledWith(expect.any(String), 'ws-1')
  })

  it('沒有選定工作區時不丟例外', () => {
    useWorkspace.mockReturnValue({ current: null })
    expect(() =>
      render(<WhatIfTab ticker="2330" currentPrice={100} {...watched} />),
    ).not.toThrow()
  })

  it('整股用 whole 級距，零股用 odd 級距', () => {
    render(<WhatIfTab ticker="2330" currentPrice={100} {...watched} />)
    // 預設 1 張 = 1000 股，是整股
    expect(getMinFee).toHaveBeenCalledWith('whole', 'ws-1')

    getMinFee.mockClear()
    // 換成「股」再填 500，才是零股
    fireEvent.change(screen.getByLabelText('單位'), { target: { value: '股' } })
    fireEvent.change(screen.getByLabelText('股數'), { target: { value: '500' } })

    expect(getMinFee).toHaveBeenCalledWith('odd', 'ws-1')
  })
})

describe('WhatIfTab 預設值：庫存股用平均成本，觀察股用現價', () => {
  it('觀察股票：買進價預設帶現價，且說明來源是現價', () => {
    render(<WhatIfTab ticker="2330" currentPrice={24.2} {...watched} />)

    expect((screen.getByLabelText('買進價格') as HTMLInputElement).value).toBe('24.2')
    expect((screen.getByLabelText('賣出價格') as HTMLInputElement).value).toBe('24.2')
    expect(screen.getByText(/買進價預設為現價\s*24\.2/)).toBeTruthy()
  })

  it('庫存個股：買進價預設帶平均成本，不是現價', () => {
    render(<WhatIfTab ticker="2330" currentPrice={600} avgCost={512.34} heldQty={2000} />)

    // 這是本次需求的核心：庫存股要用「我的成本」起算，不是市價
    expect((screen.getByLabelText('買進價格') as HTMLInputElement).value).toBe('512.34')
    // 賣出價仍是現價 —— 「現在賣掉會怎樣」
    expect((screen.getByLabelText('賣出價格') as HTMLInputElement).value).toBe('600')
    expect(screen.getByText(/買進價預設為平均成本\s*512\.34/)).toBeTruthy()
  })

  it('庫存個股：整張持股預設用「張」，股數換算成張數', () => {
    render(<WhatIfTab ticker="2330" currentPrice={600} avgCost={500} heldQty={3000} />)

    expect((screen.getByLabelText('單位') as HTMLSelectElement).value).toBe('張')
    expect((screen.getByLabelText('股數') as HTMLInputElement).value).toBe('3')
  })

  it('庫存個股：零股持股預設用「股」，不硬湊成張', () => {
    render(<WhatIfTab ticker="2330" currentPrice={600} avgCost={500} heldQty={1500} />)

    expect((screen.getByLabelText('單位') as HTMLSelectElement).value).toBe('股')
    expect((screen.getByLabelText('股數') as HTMLInputElement).value).toBe('1500')
  })

  it('沒有現價時輸入都可填，填完就算得出來，過程不出現 NaN', () => {
    const { container } = render(
      <WhatIfTab ticker="2330" currentPrice={null} {...watched} />,
    )

    expect((screen.getByLabelText('賣出價格') as HTMLInputElement).value).toBe('')
    expect(container.textContent).not.toMatch(/NaN|Infinity/)

    fireEvent.change(screen.getByLabelText('買進價格'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('賣出價格'), { target: { value: '110' } })

    expect(screen.getByTestId('whatif-pnl').textContent).toMatch(/\+/)
  })
})

describe('WhatIfTab 單位切換', () => {
  it('「1 張」與「1000 股」算出同一個損益', () => {
    const { unmount } = render(
      <WhatIfTab ticker="2330" currentPrice={110} {...watched} />,
    )
    fireEvent.change(screen.getByLabelText('買進價格'), { target: { value: '100' } })
    const byLot = screen.getByTestId('whatif-pnl').textContent
    unmount()

    render(<WhatIfTab ticker="2330" currentPrice={110} {...watched} />)
    fireEvent.change(screen.getByLabelText('買進價格'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('單位'), { target: { value: '股' } })
    fireEvent.change(screen.getByLabelText('股數'), { target: { value: '1000' } })

    expect(screen.getByTestId('whatif-pnl').textContent).toBe(byLot)
  })

  it('切換單位不會偷改使用者已經填好的數字', () => {
    render(<WhatIfTab ticker="2330" currentPrice={110} {...watched} />)

    fireEvent.change(screen.getByLabelText('股數'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('單位'), { target: { value: '股' } })

    // TransactionForm 會就地換算，這裡刻意不換 —— 這是試算沙盒，改使用者正在打的字很煩人
    expect((screen.getByLabelText('股數') as HTMLInputElement).value).toBe('7')
  })
})

describe('WhatIfTab 畫面結構：階梯在上、對帳單在下', () => {
  it('損益、報酬率、費用合計各一行，且費用是扣掉的', () => {
    render(<WhatIfTab ticker="2330" currentPrice={110} {...watched} />)
    fireEvent.change(screen.getByLabelText('買進價格'), { target: { value: '100' } })

    expect(screen.getByTestId('whatif-pnl')).toBeTruthy()
    expect(screen.getByTestId('whatif-roi')).toBeTruthy()

    const fees = screen.getByTestId('whatif-fees').textContent || ''
    expect(fees).toMatch(/含手續費與證交稅/)
    expect(fees).toMatch(/-/)
  })

  it('損益是淨利：低於不計費用的純價差', () => {
    render(<WhatIfTab ticker="2330" currentPrice={110} {...watched} />)
    fireEvent.change(screen.getByLabelText('買進價格'), { target: { value: '100' } })

    // 1 張，純價差 (110-100)*1000 = 10,000；扣掉買賣手續費與證交稅後必須更少
    const pnl = Number(
      (screen.getByTestId('whatif-pnl').textContent || '').replace(/[^\d.-]/g, ''),
    )
    expect(pnl).toBeGreaterThan(0)
    expect(pnl).toBeLessThan(10000)
  })

  it('賣出階梯攤開現價 ±10%，並標出現價與回本兩列', () => {
    render(<WhatIfTab ticker="2330" currentPrice={110} {...watched} />)
    fireEvent.change(screen.getByLabelText('買進價格'), { target: { value: '100' } })

    const rows = screen.getAllByTestId('whatif-ladder-row')
    expect(rows).toHaveLength(10)
    expect(rows.filter((r) => r.dataset.kind === 'current')).toHaveLength(1)
    expect(rows.filter((r) => r.dataset.kind === 'breakEven')).toHaveLength(1)

    const table = screen.getByTestId('whatif-ladder').textContent || ''
    expect(table).toContain('現價')
    expect(table).toContain('回本')
  })

  it('點階梯任一列就把那個價格帶進賣出價，階梯本身不跟著跑', () => {
    render(<WhatIfTab ticker="2330" currentPrice={110} {...watched} />)
    fireEvent.change(screen.getByLabelText('買進價格'), { target: { value: '100' } })

    const before = screen
      .getAllByTestId('whatif-ladder-row')
      .map((r) => r.textContent)
    fireEvent.click(screen.getAllByTestId('whatif-ladder-row')[0])

    // −10% 那一列：110 * 0.9 = 99
    expect((screen.getByLabelText('賣出價格') as HTMLInputElement).value).toBe('99')
    // 標題承諾的是「現價 ±10%」，所以錨點是報價，不是使用者打的賣出價
    expect(
      screen.getAllByTestId('whatif-ladder-row').map((r) => r.textContent),
    ).toEqual(before)
  })

  it('對帳單是一張共用列的表：同一列的買進與賣出必然對齊', () => {
    render(<WhatIfTab ticker="2330" currentPrice={110} {...watched} />)
    fireEvent.change(screen.getByLabelText('買進價格'), { target: { value: '100' } })

    // 兩欄各自排版時，左欄的股數是輸入框、右欄只是一行字，價金以下整段錯開。
    // 共用列的結構讓每個項目只出現一次，買進與賣出各是那一列的一格。
    const keys = screen
      .getAllByTestId('whatif-ledger-key')
      .map((el) => el.textContent)
    expect(keys).toEqual(['價格', '股數', '價金', '費用', '小計'])
  })

  it('對帳單把投入成本、實收與回本價攤在檯面上', () => {
    const { container } = render(
      <WhatIfTab ticker="2330" currentPrice={110} {...watched} />,
    )
    fireEvent.change(screen.getByLabelText('買進價格'), { target: { value: '100' } })

    expect(screen.getByTestId('whatif-cost')).toBeTruthy()
    expect(screen.getByTestId('whatif-proceeds')).toBeTruthy()
    expect(screen.getByTestId('whatif-breakeven')).toBeTruthy()

    const text = container.textContent || ''
    for (const shown of ['投入成本', '實收', '回本']) {
      expect(text).toContain(shown)
    }
    expect(text).not.toMatch(/NaN|Infinity/)
  })

  it('輸入不合法時給提示而不是 NaN，階梯與對帳單一起收起來', () => {
    const { container } = render(
      <WhatIfTab ticker="2330" currentPrice={24.2} {...watched} />,
    )

    fireEvent.change(screen.getByLabelText('股數'), { target: { value: '0' } })

    expect(container.textContent).not.toMatch(/NaN|Infinity/)
    expect(screen.queryByTestId('whatif-pnl')).toBeNull()
    expect(screen.queryByTestId('whatif-ladder')).toBeNull()
  })
})
