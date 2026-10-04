// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchSectorFlow } = vi.hoisted(() => ({ fetchSectorFlow: vi.fn() }))
vi.mock('../../services/sectorFlowProxy', () => ({ fetchSectorFlow }))

import { SectorFlowPage } from './SectorFlowPage'
import type { SectorFlowData, SectorFlowDay, SectorFlowRow } from '../../services/sectorFlowProxy'

const E8 = 1e8

function row(code: string, name: string, totalE8: number, over: Partial<SectorFlowRow> = {}): SectorFlowRow {
  return {
    code,
    name,
    parent: null,
    foreignTwd: totalE8 * E8,
    trustTwd: 0,
    dealerTwd: 0,
    totalTwd: totalE8 * E8,
    turnoverTwd: 100 * E8,
    stocks: 3,
    topBuy: [],
    topSell: [],
    ...over,
  }
}

const day = (date: string, rows: SectorFlowRow[], over: Partial<SectorFlowDay> = {}): SectorFlowDay => ({
  date,
  coverage: { listed: true, otc: true },
  rows,
  marketTurnoverTwd: 1000 * E8,
  estimateListedTotalTwd: 103.2 * E8,
  officialListedTotalTwd: 104.17 * E8,
  unpriced: 0,
  ...over,
})

const children = [
  row('24:design', 'IC 設計', -70, { parent: '24', foreignTwd: -77 * E8, trustTwd: 1 * E8, dealerTwd: 6 * E8 }),
  row('24:foundry', '晶圓製造', 32, { parent: '24' }),
  row('24:osat', '封裝測試', 10, { parent: '24' }),
  row('24:other', '設備、材料與其他', -42, { parent: '24' }),
]

const FILLER = Array.from({ length: 20 }, (_, i) => row(String(40 + i), `類股${i}`, i - 10))

const data: SectorFlowData = {
  asOf: '2026-10-02T10:00:00.000Z',
  days: [
    day('2026-10-01', [row('28', '電子零組件', 50), row('24', '半導體', -30), ...children]),
    day('2026-10-02', [
      row('28', '電子零組件', 234, { topBuy: [{ ticker: '3037', name: '欣興', netTwd: 90 * E8 }] }),
      row('25', '電腦及週邊', -114),
      row('24', '半導體', -70),
      ...children,
      ...FILLER,
    ]),
  ],
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/sector-flow')
})

afterEach(() => {
  cleanup()
  fetchSectorFlow.mockReset()
})

async function mount(result: unknown, focus?: string) {
  fetchSectorFlow.mockResolvedValue(result)
  const user = userEvent.setup()
  render(<SectorFlowPage focus={focus} />)
  await screen.findByText('類股資金流向')
  return user
}

/** The treemap and the table are folded away until asked for. */
async function openFold(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByText(name))
}

describe('SectorFlowPage', () => {
  it('opens with the day in three figures: the net, what was bought and what was sold', async () => {
    await mount({ kind: 'ok', data })
    expect(await screen.findByText(/10\/02\s+三大法人合計淨買超/)).toBeTruthy()
    // Leaves: buys 234 + 32 + 10 + (1..9) = 321; sells 114 + 70 + 42 + (1..10) = 281.
    expect(screen.getByText('+40.0 億')).toBeTruthy()
    expect(screen.getByText('買進的產業').nextElementSibling?.textContent).toBe('+321.0 億')
    expect(screen.getByText('賣出的產業').nextElementSibling?.textContent).toBe('-281.0 億')
    expect(screen.getByText('共 12 個類股')).toBeTruthy()
    expect(screen.getByText('共 13 個類股')).toBeTruthy()
  })

  it('shows where the buying went and where the selling came from, each as its own list', async () => {
    await mount({ kind: 'ok', data })
    const buy = await screen.findByRole('list', { name: /錢進了哪些產業/ })
    const buyItems = within(buy).getAllByRole('listitem')
    expect(buyItems).toHaveLength(6)
    expect(buyItems[0].textContent).toContain('電子零組件')
    expect(buyItems[0].textContent).toContain('72.9%')
    expect(buyItems[0].textContent).toContain('+234.0 億')
    expect(buyItems[5].textContent).toContain('其他 7 個類股')

    const sell = screen.getByRole('list', { name: /錢出了哪些產業/ })
    const sellItems = within(sell).getAllByRole('listitem')
    expect(sellItems[0].textContent).toContain('電腦及週邊')
    expect(sellItems[0].textContent).toContain('-114.0 億')
    expect(sellItems[5].textContent).toContain('其他 8 個類股')
  })

  it('lists semiconductors by their parts, tagged, so IC 設計 is not hidden by the parent', async () => {
    await mount({ kind: 'ok', data })
    const sell = await screen.findByRole('list', { name: /錢出了哪些產業/ })
    const ic = within(sell).getByText(/IC 設計/).closest('li')!
    expect(ic.textContent).toContain('半導體')
    expect(ic.textContent).toContain('-70.0 億')
    // The parent 半導體 is not a slice of its own: only the tags carry that word.
    const buy = screen.getByRole('list', { name: /錢進了哪些產業/ })
    expect(within(buy).getAllByText('半導體')).toHaveLength(2)
    expect(within(sell).getAllByText('半導體')).toHaveLength(2)
  })

  it('numbers the five biggest slices on the ring and in the list, 其他 unnumbered', async () => {
    await mount({ kind: 'ok', data })
    const buy = await screen.findByRole('list', { name: /錢進了哪些產業/ })
    const ranks = within(buy)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.sf-side-rank')?.textContent)
    expect(ranks).toEqual(['1', '2', '3', '4', '5', ''])
    const panel = screen.getByRole('region', { name: '錢進了哪些產業' })
    expect(panel.querySelectorAll('.sf-rank')).toHaveLength(5)
    expect(panel.querySelectorAll('circle')).toHaveLength(6)
  })

  it('says each ring is a share of its own side, and the centre repeats the total', async () => {
    await mount({ kind: 'ok', data })
    expect(await screen.findByText('每一塊是佔買進 +321.0 億的比例')).toBeTruthy()
    expect(screen.getByText('每一塊是佔賣出 -281.0 億的比例')).toBeTruthy()
    const panel = screen.getByRole('region', { name: '錢進了哪些產業' })
    expect(within(panel).getByText('買進合計')).toBeTruthy()
  })

  it('recolours for another investor group', async () => {
    const d: SectorFlowData = {
      asOf: data.asOf,
      days: [
        day('2026-10-02', [
          row('28', '電子零組件', 10, { foreignTwd: 7 * E8, trustTwd: 2 * E8, dealerTwd: 1 * E8 }),
          row('25', '電腦及週邊', -4, { foreignTwd: -6 * E8, trustTwd: 2 * E8, dealerTwd: 0 }),
        ]),
      ],
    }
    const user = await mount({ kind: 'ok', data: d })
    expect(await screen.findByText(/10\/02\s+三大法人合計淨買超/)).toBeTruthy()
    expect(screen.getByText('+6.0 億')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '外資' }))
    expect(await screen.findByText(/10\/02\s+外資淨買超/)).toBeTruthy()
    // 外資: +7 and -6, net +1.
    expect(screen.getByText('+1.0 億')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '投信' }))
    // 投信: +2 and +2, so the net and the buy side are both +4.0 (the hero is the label's next sibling).
    const label = await screen.findByText(/10\/02\s+投信淨買超/)
    expect(label.nextElementSibling?.textContent).toBe('+4.0 億')
  })

  it('says net selling when the sellers outweigh the buyers', async () => {
    const d: SectorFlowData = { asOf: data.asOf, days: [day('2026-10-02', [row('28', 'x', 3), row('25', 'y', -10)])] }
    await mount({ kind: 'ok', data: d })
    expect(await screen.findByText(/10\/02\s+三大法人合計淨賣超/)).toBeTruthy()
    expect(screen.getByText('-7.0 億')).toBeTruthy()
  })

  it('says so when one side is empty', async () => {
    const d: SectorFlowData = { asOf: data.asOf, days: [day('2026-10-02', [row('28', 'x', 3)])] }
    await mount({ kind: 'ok', data: d })
    expect(await screen.findByText('這段期間沒有賣超的類股。')).toBeTruthy()
  })

  it('switches to the 5-day window and names it', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(screen.getByRole('button', { name: '近 5 日' }))
    expect(await screen.findByText(/10\/01–10\/02（2 個交易日）\s+三大法人合計淨/)).toBeTruthy()
  })

  it('cannot pick 近 5 日 with one day of data', async () => {
    await mount({ kind: 'ok', data: { ...data, days: [data.days[1]] } })
    expect((screen.getByRole('button', { name: '近 5 日' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the treemap and the numbers folded away until asked for', async () => {
    const user = await mount({ kind: 'ok', data })
    const folds = await screen.findAllByText(/^看(方塊圖|詳細數字)/)
    expect(folds).toHaveLength(2)
    for (const f of folds) expect((f.closest('details') as HTMLDetailsElement).open).toBe(false)
    await openFold(user, /看方塊圖/)
    expect((screen.getByText(/看方塊圖/).closest('details') as HTMLDetailsElement).open).toBe(true)
  })

  it('draws a tile per sector, 半導體 with its four parts inside, each readable by name and figure', async () => {
    const user = await mount({ kind: 'ok', data })
    await openFold(user, /看方塊圖/)
    const group = await screen.findByRole('group', { name: /類股方塊圖/ })
    expect(within(group).getByRole('button', { name: /^電子零組件，買賣超 \+234\.0 億，佔成交 10\.0%/ })).toBeTruthy()
    expect(within(group).getByRole('button', { name: /^半導體合計，買賣超 -70\.0 億/ })).toBeTruthy()
    for (const n of ['IC 設計', '晶圓製造', '封裝測試', '設備、材料與其他']) {
      expect(within(group).getByRole('button', { name: new RegExp(`^${n}，買賣超`) })).toBeTruthy()
    }
  })

  it('says how to read the treemap before anything is selected', async () => {
    const user = await mount({ kind: 'ok', data })
    await openFold(user, /看方塊圖/)
    expect(await screen.findByText(/點任一個方塊/)).toBeTruthy()
    expect(screen.getByLabelText('圖例')).toBeTruthy()
  })

  it('opens the detail panel on a tile: a sentence, the four groups, and the movers', async () => {
    const user = await mount({ kind: 'ok', data })
    await openFold(user, /看方塊圖/)
    await user.click(await screen.findByRole('button', { name: /^IC 設計，買賣超/ }))
    const panel = screen.getByRole('complementary', { name: '類股細節' })
    expect(within(panel).getByText('IC 設計')).toBeTruthy()
    expect(within(panel).getByText('法人合計賣超 70.0 億，主要是外資賣超 77.0 億。')).toBeTruthy()
    expect(within(panel).getByText('-77.0 億')).toBeTruthy()
    expect(within(panel).getByText('+6.0 億')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /^電子零組件，買賣超/ }))
    const elec = screen.getByRole('complementary', { name: '類股細節' })
    expect(within(elec).getByText('買超主力')).toBeTruthy()
    expect(within(elec).getByText('欣興')).toBeTruthy()
    expect(within(elec).getByText('+90.0 億')).toBeTruthy()
  })

  it('puts the pick in the address bar without adding a history entry, and clears it again', async () => {
    const user = await mount({ kind: 'ok', data })
    await openFold(user, /看方塊圖/)
    const before = window.history.length
    await user.click(await screen.findByRole('button', { name: /^電子零組件，買賣超/ }))
    expect(window.location.hash).toBe('#/sector-flow/28')
    expect(window.history.length).toBe(before)

    await user.click(screen.getByRole('button', { name: /^電子零組件，買賣超/ }))
    expect(window.location.hash).toBe('#/sector-flow')
    expect(screen.getByText(/點任一個方塊/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /^電子零組件，買賣超/ }))
    await user.click(screen.getByRole('button', { name: '取消選取' }))
    expect(window.location.hash).toBe('#/sector-flow')
  })

  it('opens with the sector from a link already selected, and the treemap open around it', async () => {
    await mount({ kind: 'ok', data }, '24:design')
    const panel = await screen.findByRole('complementary', { name: '類股細節' })
    expect(within(panel).getByText('IC 設計')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^IC 設計，買賣超/ }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByText(/看方塊圖/).closest('details') as HTMLDetailsElement).open).toBe(true)
  })

  it('ignores a link to a sector this file does not have', async () => {
    await mount({ kind: 'ok', data }, '99')
    expect(await screen.findByText(/點任一個方塊/)).toBeTruthy()
  })

  it('shows the signed 億 figure per sector in the table, with the movers and the turnover share', async () => {
    const user = await mount({ kind: 'ok', data })
    await openFold(user, /看詳細數字/)
    const table = await screen.findByRole('table', { name: '類股資金流向' })
    const elec = within(table).getByText('電子零組件').closest('tr')!
    expect(within(elec).getByText('+234.0 億')).toBeTruthy()
    expect(within(elec).getByText('買超主力：欣興')).toBeTruthy()
    expect(within(elec).getByText('10.0%')).toBeTruthy()
  })

  it('marks the selected sector in the table', async () => {
    const user = await mount({ kind: 'ok', data })
    await openFold(user, /看方塊圖/)
    await user.click(await screen.findByRole('button', { name: /^電子零組件，買賣超/ }))
    const table = screen.getByRole('table', { name: '類股資金流向' })
    expect(within(table).getByText('電子零組件').closest('tr')!.getAttribute('aria-selected')).toBe('true')
  })

  it('opens 半導體 into its parts in the table by default and can fold them', async () => {
    const user = await mount({ kind: 'ok', data })
    await openFold(user, /看詳細數字/)
    const table = await screen.findByRole('table', { name: '類股資金流向' })
    expect(within(table).getByText('IC 設計')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '收合半導體細分' }))
    expect(within(table).queryByText('IC 設計')).toBeNull()
    await user.click(screen.getByRole('button', { name: '展開半導體細分' }))
    expect(within(table).getByText('IC 設計')).toBeTruthy()
  })

  it('lists the biggest buyers and sellers (and 半導體) first, the rest on request', async () => {
    const user = await mount({ kind: 'ok', data })
    await openFold(user, /看詳細數字/)
    const table = await screen.findByRole('table', { name: '類股資金流向' })
    expect(within(table).queryByText('類股10')).toBeNull()
    await user.click(screen.getByRole('button', { name: '顯示全部 23 類股' }))
    expect(within(table).getByText('類股10')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '只看買賣超最多與最少的類股' }))
    expect(within(table).queryByText('類股10')).toBeNull()
  })

  it('shows the estimate against the official figure, and says what it covers and what it does not claim', async () => {
    await mount({ kind: 'ok', data })
    expect(await screen.findByText(/估算合計 \+103\.2 億，證交所公布 \+104\.2 億（差 -0\.9%）/)).toBeTruthy()
    expect(screen.getByText(/涵蓋上市與上櫃/)).toBeTruthy()
    expect(screen.getByText(/不表示資金從賣出的產業轉到買進的產業/)).toBeTruthy()
  })

  it('warns when TPEx was missing', async () => {
    const d: SectorFlowData = {
      asOf: data.asOf,
      days: [day('2026-10-02', [row('28', 'x', 1)], { coverage: { listed: true, otc: false } })],
    }
    await mount({ kind: 'ok', data: d })
    expect(await screen.findByText(/部分日期只含上市/)).toBeTruthy()
  })

  it('says plainly when there is no file, a bad file, or the read failed', async () => {
    await mount({ kind: 'empty' })
    expect(await screen.findByText(/尚無類股資金流向資料/)).toBeTruthy()
    cleanup()
    await mount({ kind: 'invalid' })
    expect(await screen.findByText('資料格式不符，無法顯示')).toBeTruthy()
    cleanup()
    fetchSectorFlow.mockRejectedValue(new Error('network'))
    render(<SectorFlowPage />)
    expect(await screen.findByText(/讀取類股資金流向失敗/)).toBeTruthy()
  })
})
