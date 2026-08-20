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
const watched = { rawAvgCost: null, heldQty: null }

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
    render(<WhatIfTab ticker="2330" currentPrice={600} rawAvgCost={512.34} heldQty={2000} />)

    // 這是本次需求的核心：庫存股要用「我的成本」起算，不是市價
    expect((screen.getByLabelText('買進價格') as HTMLInputElement).value).toBe('512.34')
    // 賣出價仍是現價 —— 「現在賣掉會怎樣」
    expect((screen.getByLabelText('賣出價格') as HTMLInputElement).value).toBe('600')
    expect(screen.getByText(/買進價預設為成交均價\s*512\.34（未含手續費）/)).toBeTruthy()
  })

  it('庫存個股：整張持股預設用「張」，股數換算成張數', () => {
    render(<WhatIfTab ticker="2330" currentPrice={600} rawAvgCost={500} heldQty={3000} />)

    expect((screen.getByLabelText('單位') as HTMLSelectElement).value).toBe('張')
    expect((screen.getByLabelText('股數') as HTMLInputElement).value).toBe('3')
  })

  it('庫存個股：零股持股預設用「股」，不硬湊成張', () => {
    render(<WhatIfTab ticker="2330" currentPrice={600} rawAvgCost={500} heldQty={1500} />)

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

  it('有持股時階梯以持有均價展開，均價／現價／回本三列都在', () => {
    render(<WhatIfTab ticker="2330" currentPrice={110} rawAvgCost={100} heldQty={1000} />)

    const table = screen.getByTestId('whatif-ladder').textContent || ''
    expect(screen.getByText(/賣出階梯 · 持有均價 ±10%/)).toBeTruthy()
    expect(screen.getByText('相對均價')).toBeTruthy()
    expect(table).toContain('均價')
    expect(table).toContain('現價')
    expect(table).toContain('回本')

    const kinds = screen
      .getAllByTestId('whatif-ladder-row')
      .map((r) => r.dataset.kind)
    expect(kinds.filter((k) => k === 'avgCost')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'current')).toHaveLength(1)
  })

  it('均價不整齊時階梯不會出現兩列一樣的價格', () => {
    render(<WhatIfTab ticker="2330" currentPrice={520} rawAvgCost={512.923} heldQty={1000} />)

    const rows = screen.getAllByTestId('whatif-ladder-row')
    // 只取價格文字，標籤（均價／現價／回本）另在 span 裡，不能拿來當區別
    const shown = rows.map((r) => r.querySelector('td')?.firstChild?.textContent || '')
    const avg = rows.filter((r) => r.dataset.kind === 'avgCost')

    expect(new Set(shown).size).toBe(shown.length)
    expect(avg).toHaveLength(1)
    // 均價就是錨點，相對欄應該是破折號而不是 -0.00%
    expect(avg[0].querySelectorAll('td')[1].textContent).toBe('—')
  })

  it('摘要列永遠列出現價、持有均價與回本，點了就帶進賣出價', () => {
    render(<WhatIfTab ticker="2330" currentPrice={130} rawAvgCost={100} heldQty={1000} />)

    const marks = screen.getAllByTestId('whatif-mark')
    expect(marks.map((m) => m.dataset.kind)).toEqual(['current', 'avgCost', 'breakEven'])
    // 現價離均價 +30%，舊的 ±10% 窗口看不到它
    expect(marks[0].textContent).toContain('130.00')
    expect(marks[0].textContent).toContain('+30.0')

    fireEvent.click(marks[0])
    expect((screen.getByLabelText('賣出價格') as HTMLInputElement).value).toBe('130')
  })

  it('觀察股票的摘要列只有現價與回本', () => {
    render(<WhatIfTab ticker="2330" currentPrice={110} {...watched} />)

    const marks = screen.getAllByTestId('whatif-mark')
    expect(marks.map((m) => m.dataset.kind)).toEqual(['current', 'breakEven'])
  })

  it('現價等於均價時標題退回持有均價 ±10%', () => {
    render(<WhatIfTab ticker="2330" currentPrice={110} rawAvgCost={110} heldQty={1000} />)

    expect(screen.getByText(/賣出階梯 · 持有均價 ±10%/)).toBeTruthy()
  })

  it('買進價用未含費的成交均價，手續費只算一次', () => {
    render(<WhatIfTab ticker="2330" currentPrice={110} rawAvgCost={100} heldQty={1000} />)

    expect((screen.getByLabelText('買進價格') as HTMLInputElement).value).toBe('100.00')

    const cost = Number(
      (screen.getByTestId('whatif-cost').textContent || '').replace(/[^\d.-]/g, ''),
    )
    // 價金 100,000 加一次 0.1425% 手續費約 142.5；算兩次會變成約 285
    expect(cost - 100000).toBeGreaterThan(0)
    expect(cost - 100000).toBeLessThanOrEqual(150)
  })

  it('提示說明買進價來自未含費的成交均價', () => {
    render(<WhatIfTab ticker="2330" currentPrice={110} rawAvgCost={100} heldQty={1000} />)

    expect(screen.getByText(/買進價預設為成交均價 100.00（未含手續費）/)).toBeTruthy()
  })

  /** PROD 0050 實測部位：4,000 股，rawCost 416,900、cost 417,492，現價 103.80 */
  const zero50 = { rawAvgCost: 416900 / 4000, avgCost: 417492 / 4000, heldQty: 4000 }
  const num = (testid: string) =>
    Number((screen.getByTestId(testid).textContent || '').replace(/[^\d.-]/g, ''))

  it('買進價與庫存總覽同一套進位：104.225 顯示 104.23', () => {
    render(<WhatIfTab ticker="0050" currentPrice={103.8} {...zero50} />)

    expect((screen.getByLabelText('買進價格') as HTMLInputElement).value).toBe('104.23')
  })

  it('投入成本就是持股的實際成本，不重算手續費', () => {
    render(<WhatIfTab ticker="0050" currentPrice={103.8} {...zero50} />)

    // 4,000 × 104.3730 = 417,492，含實付買進手續費 592
    expect(num('whatif-cost')).toBe(417492)
  })

  it('賣出價等於現價時，損益與庫存總覽的未實現損益一致', () => {
    render(<WhatIfTab ticker="0050" currentPrice={103.8} {...zero50} />)

    // 415,200 − 賣出手續費 591 − 證交稅 415 − 417,492
    expect(num('whatif-pnl')).toBe(-3298)
  })

  it('使用者改買進價時，手續費沿用這檔持股的實際費率', () => {
    render(<WhatIfTab ticker="0050" currentPrice={103.8} {...zero50} />)
    fireEvent.change(screen.getByLabelText('買進價格'), { target: { value: '100' } })

    // 實際費率 (104.3730 − 104.2250) / 104.2250 ≈ 0.142%，100 × 4,000 × 0.142% ≈ 568
    const cost = num('whatif-cost')
    expect(cost - 400000).toBeGreaterThan(540)
    expect(cost - 400000).toBeLessThan(600)
  })

  it('對帳單標明買進價未含費，並列出現價', () => {
    render(<WhatIfTab ticker="0050" currentPrice={103.8} {...zero50} />)

    expect(screen.getByText('成交均價（未含費）')).toBeTruthy()
    expect(screen.getByText('實付手續費')).toBeTruthy()
    expect(screen.getByText(/現價 103.80/)).toBeTruthy()
  })

  it('換到另一個工作區的同一檔股票時，輸入框跟著換成新的持股成本', () => {
    const { rerender } = render(
      <WhatIfTab ticker="0050" currentPrice={103.8} {...zero50} />,
    )
    expect((screen.getByLabelText('買進價格') as HTMLInputElement).value).toBe('104.23')

    // 同一檔股票、同一個元件，但持股換成另一個工作區的部位
    rerender(
      <WhatIfTab ticker="0050" currentPrice={103.8} rawAvgCost={90.5} avgCost={90.63} heldQty={2000} />,
    )

    expect((screen.getByLabelText('買進價格') as HTMLInputElement).value).toBe('90.50')
    expect((screen.getByLabelText('股數') as HTMLInputElement).value).toBe('2')
  })

  it('低價股的階梯不會塌成一列', () => {
    // 0.05 元股：±10% 只有 0.045~0.055，四捨五入後仍要留得下兩列
    render(<WhatIfTab ticker="2330" currentPrice={0.05} rawAvgCost={0.05} heldQty={1000} />)

    expect(screen.getByText(/賣出階梯 · 持有均價 ±10%/)).toBeTruthy()
    expect(screen.getAllByTestId('whatif-ladder-row').length).toBeGreaterThan(1)
  })

  it('現價在均價 ±10% 之外時，另成一簇並插一條分隔列', () => {
    render(<WhatIfTab ticker="2330" currentPrice={130} rawAvgCost={100} heldQty={1000} />)

    const gaps = screen.getAllByTestId('whatif-ladder-gap')
    expect(gaps).toHaveLength(1)
    // 分隔列不是價格列，也不能被點
    expect(gaps[0].getAttribute('data-testid')).toBe('whatif-ladder-gap')
    expect(gaps[0].hasAttribute('tabindex')).toBe(false)
    expect(
      screen.getAllByTestId('whatif-ladder-row').filter((r) => r.dataset.kind === 'current'),
    ).toHaveLength(1)
  })

  it('現價落在均價 ±10% 內時沒有分隔列', () => {
    render(<WhatIfTab ticker="2330" currentPrice={105} rawAvgCost={100} heldQty={1000} />)

    expect(screen.queryAllByTestId('whatif-ladder-gap')).toHaveLength(0)
  })

  it('觀察股票沒有均價，階梯維持以現價展開', () => {
    render(<WhatIfTab ticker="2330" currentPrice={110} {...watched} />)

    expect(screen.getByText(/賣出階梯 · 現價 ±10%/)).toBeTruthy()
    expect(screen.getByText('相對現價')).toBeTruthy()
    expect(screen.getByTestId('whatif-ladder').textContent || '').not.toContain('均價')
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

    // +10% 那一列：110 * 1.1 = 121
    expect((screen.getByLabelText('賣出價格') as HTMLInputElement).value).toBe('121')
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
