// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchSectorFlow } = vi.hoisted(() => ({ fetchSectorFlow: vi.fn() }))
vi.mock('../../services/sectorFlowProxy', () => ({ fetchSectorFlow }))

import { SectorFlowPage } from './SectorFlowPage'
import type { SectorFlowData, SectorFlowDay, SectorFlowRow, SectorTopStock } from '../../services/sectorFlowProxy'

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

const stocks = (prefix: string, n: number, sign: 1 | -1): SectorTopStock[] =>
  Array.from({ length: n }, (_, i) => ({ ticker: `${prefix}${i + 1}`, name: `${prefix}股${i + 1}`, netTwd: sign * (60 - i * 10) * E8 }))

const children = [
  row('24:design', 'IC 設計', -70, { parent: '24', foreignTwd: -77 * E8, trustTwd: 1 * E8, dealerTwd: 6 * E8, topSell: stocks('IC', 5, -1) }),
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
      row('28', '電子零組件', 234, {
        foreignTwd: 115 * E8,
        trustTwd: 85 * E8,
        dealerTwd: 34 * E8,
        topBuy: stocks('欣', 5, 1),
        topSell: stocks('賣', 2, -1),
        groupTops: {
          foreign: { buy: stocks('外', 5, 1), sell: [] },
          trust: { buy: stocks('投', 3, 1), sell: [] },
          dealer: { buy: [], sell: [] },
        },
      }),
      row('25', '電腦及週邊', -114, { topSell: stocks('電', 5, -1) }),
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
  vi.restoreAllMocks()
})

async function mount(result: unknown, focus?: string) {
  fetchSectorFlow.mockResolvedValue(result)
  const user = userEvent.setup()
  render(<SectorFlowPage focus={focus} />)
  await screen.findByText('類股資金流向')
  return user
}

const buyList = () => screen.findByRole('list', { name: /錢進了哪些產業/ })
const sellList = () => screen.findByRole('list', { name: /錢出了哪些產業/ })
const legendRow = (list: HTMLElement, name: RegExp) => within(list).getByRole('button', { name })

describe('SectorFlowPage: the day', () => {
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

  it('has no treemap any more', async () => {
    await mount({ kind: 'ok', data })
    await screen.findByText(/10\/02\s+三大法人合計淨買超/)
    expect(screen.queryByText(/方塊圖/)).toBeNull()
    expect(screen.queryByRole('group', { name: /類股方塊圖/ })).toBeNull()
  })

  it('shows where the buying went and where the selling came from, each as its own list', async () => {
    await mount({ kind: 'ok', data })
    const buyItems = within(await buyList()).getAllByRole('listitem')
    expect(buyItems).toHaveLength(6)
    expect(buyItems[0].textContent).toContain('電子零組件')
    expect(buyItems[0].textContent).toContain('72.9%')
    expect(buyItems[0].textContent).toContain('+234.0 億')
    expect(buyItems[5].textContent).toContain('其他 7 個類股')

    const sellItems = within(await sellList()).getAllByRole('listitem')
    expect(sellItems[0].textContent).toContain('電腦及週邊')
    expect(sellItems[0].textContent).toContain('-114.0 億')
    expect(sellItems[5].textContent).toContain('其他 8 個類股')
  })

  it('lists semiconductors by their parts, tagged, so IC 設計 is not hidden by the parent', async () => {
    await mount({ kind: 'ok', data })
    const sell = await sellList()
    const ic = within(sell).getByText(/IC 設計/).closest('li')!
    expect(ic.textContent).toContain('半導體')
    expect(ic.textContent).toContain('-70.0 億')
    expect(within(await buyList()).getAllByText('半導體')).toHaveLength(2)
    expect(within(sell).getAllByText('半導體')).toHaveLength(2)
  })

  it('numbers the five biggest slices on the ring and in the list, 其他 unnumbered', async () => {
    await mount({ kind: 'ok', data })
    const ranks = within(await buyList())
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.sf-side-rank')?.textContent)
    expect(ranks).toEqual(['1', '2', '3', '4', '5', ''])
    const panel = screen.getByRole('region', { name: '錢進了哪些產業' })
    expect(panel.querySelectorAll('.sf-rank')).toHaveLength(5)
    expect(panel.querySelectorAll('circle')).toHaveLength(6)
  })

  it('says each ring is a share of its own side, tells you to press, and the centre repeats the total', async () => {
    await mount({ kind: 'ok', data })
    expect(await screen.findByText(/每一塊是佔買進 \+321\.0 億的比例；點一塊或下面任一行看細節/)).toBeTruthy()
    expect(screen.getByText(/每一塊是佔賣出 -281\.0 億的比例/)).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '錢進了哪些產業' })).getByText('買進合計')).toBeTruthy()
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
    expect(screen.getByText('+1.0 億')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '投信' }))
    const label = await screen.findByText(/10\/02\s+投信淨買超/)
    expect(label.nextElementSibling?.textContent).toBe('+4.0 億')
  })

  it('says net selling when the sellers outweigh the buyers, and says so when one side is empty', async () => {
    const d: SectorFlowData = { asOf: data.asOf, days: [day('2026-10-02', [row('28', 'x', 3), row('25', 'y', -10)])] }
    await mount({ kind: 'ok', data: d })
    expect(await screen.findByText(/10\/02\s+三大法人合計淨賣超/)).toBeTruthy()
    expect(screen.getByText('-7.0 億')).toBeTruthy()
    cleanup()
    await mount({ kind: 'ok', data: { asOf: data.asOf, days: [day('2026-10-02', [row('28', 'x', 3)])] } })
    expect(await screen.findByText('這段期間沒有賣超的類股。')).toBeTruthy()
  })

  it('switches to the 5-day window and names it; one day of data cannot', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(screen.getByRole('button', { name: '近 5 日' }))
    expect(await screen.findByText(/10\/01–10\/02（2 個交易日）\s+三大法人合計淨/)).toBeTruthy()
    cleanup()
    await mount({ kind: 'ok', data: { ...data, days: [data.days[1]] } })
    expect((screen.getByRole('button', { name: '近 5 日' }) as HTMLButtonElement).disabled).toBe(true)
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

describe('SectorFlowPage: opening a sector in place', () => {
  it('opens under a legend row: a sentence, the four groups, the share, and the five biggest buyers', async () => {
    const user = await mount({ kind: 'ok', data })
    const row1 = legendRow(await buyList(), /電子零組件/)
    expect(row1.getAttribute('aria-expanded')).toBe('false')
    await user.click(row1)
    expect(row1.getAttribute('aria-expanded')).toBe('true')

    const detail = screen.getByRole('group', { name: '電子零組件細節' })
    // The detail sits inside the row's own list item, i.e. under the row that was pressed.
    expect(row1.closest('li')!.contains(detail)).toBe(true)
    expect(within(detail).getByText('法人合計買超 234.0 億，主要是外資買超 115.0 億。')).toBeTruthy()
    expect(within(detail).getByText('+85.0 億')).toBeTruthy()
    expect(within(detail).getByText(/成交 100\.0 億，佔全市場 10\.0%/)).toBeTruthy()
    expect(within(detail).getByText('買超主力前 5')).toBeTruthy()
    expect(within(detail).getByText('依三大法人合計排名')).toBeTruthy()
    const movers = within(detail).getByText('買超主力前 5').closest('div')!
    expect(within(movers).getAllByRole('listitem')).toHaveLength(5)
    expect(within(movers).getByText('欣股1')).toBeTruthy()
    expect(within(movers).getByText('+60.0 億')).toBeTruthy()
  })

  it('lists the sellers for a sector that sold, and only the side the figure points to', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(legendRow(await sellList(), /電腦及週邊/))
    const detail = screen.getByRole('group', { name: '電腦及週邊細節' })
    expect(within(detail).getByText('賣超主力前 5')).toBeTruthy()
    expect(within(detail).getByText('電股1')).toBeTruthy()
    expect(within(detail).queryByText('買超主力前 5')).toBeNull()
  })

  it('closes on a second press, and opens one sector at a time', async () => {
    const user = await mount({ kind: 'ok', data })
    const first = legendRow(await buyList(), /電子零組件/)
    await user.click(first)
    expect(screen.getAllByRole('group', { name: /細節$/ })).toHaveLength(1)
    await user.click(legendRow(await sellList(), /電腦及週邊/))
    expect(first.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getAllByRole('group', { name: /細節$/ })).toHaveLength(1)
    await user.click(legendRow(await sellList(), /電腦及週邊/))
    expect(screen.queryByRole('group', { name: /細節$/ })).toBeNull()
  })

  it('opens the same row when the ring itself is pressed, and brings it into view', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    await mount({ kind: 'ok', data })
    const panel = await screen.findByRole('region', { name: '錢進了哪些產業' })
    fireEvent.click(panel.querySelectorAll('circle')[0])
    expect(await screen.findByRole('group', { name: '電子零組件細節' })).toBeTruthy()
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    // The numeral is a shortcut for the same thing.
    fireEvent.click(panel.querySelectorAll('.sf-rank')[0])
    expect(screen.queryByRole('group', { name: '電子零組件細節' })).toBeNull()
  })

  it('dims the other slices of the ring once one is picked', async () => {
    const user = await mount({ kind: 'ok', data })
    const panel = await screen.findByRole('region', { name: '錢進了哪些產業' })
    expect(panel.querySelectorAll('.sf-slice-dim')).toHaveLength(0)
    await user.click(legendRow(await buyList(), /電子零組件/))
    expect(panel.querySelectorAll('.sf-slice-dim')).toHaveLength(5)
    const other = screen.getByRole('region', { name: '錢出了哪些產業' })
    expect(other.querySelectorAll('.sf-slice-dim')).toHaveLength(0)
  })

  it('opens 其他 into the sectors that were folded into it, and gives it no link of its own', async () => {
    const user = await mount({ kind: 'ok', data })
    const other = legendRow(await buyList(), /其他 7 個類股/)
    await user.click(other)
    expect(other.getAttribute('aria-expanded')).toBe('true')
    const folded = screen.getByRole('list', { name: '其他 7 個類股' })
    expect(within(folded).getAllByRole('listitem')).toHaveLength(7)
    expect(within(folded).getByText('類股17')).toBeTruthy()
    expect(within(folded).getByText('+7.0 億')).toBeTruthy()
    expect(window.location.hash).toBe('#/sector-flow')
  })

  it('follows the chosen investor group for the stocks, and says when a group has none', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(screen.getByRole('button', { name: '外資' }))
    await user.click(legendRow(await buyList(), /電子零組件/))
    let detail = screen.getByRole('group', { name: '電子零組件細節' })
    expect(within(detail).getByText('外資買超主力前 5')).toBeTruthy()
    expect(within(detail).getByText('依外資排名')).toBeTruthy()
    expect(within(detail).getByText('外股1')).toBeTruthy()
    expect(within(detail).queryByText('欣股1')).toBeNull()

    // The pick stays open when the group changes; 自營商 has no buyers or sellers listed for it.
    await user.click(screen.getByRole('button', { name: '自營商' }))
    detail = screen.getByRole('group', { name: '電子零組件細節' })
    expect(within(detail).queryByText(/主力前/)).toBeNull()
    expect(within(detail).getByText('法人合計買超 234.0 億，主要是外資買超 115.0 億。')).toBeTruthy()
  })

  it('says the group lists are missing on a file written before they existed', async () => {
    const old: SectorFlowData = {
      asOf: data.asOf,
      days: [day('2026-10-02', [row('28', '電子零組件', 10, { topBuy: stocks('欣', 2, 1) })])],
    }
    const user = await mount({ kind: 'ok', data: old })
    await user.click(screen.getByRole('button', { name: '外資' }))
    await user.click(legendRow(await buyList(), /電子零組件/))
    expect(screen.getByText(/這份資料還沒有外資各自的個股排名/)).toBeTruthy()
  })

  it('lists no stocks for a window of several days, and says why', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(screen.getByRole('button', { name: '近 5 日' }))
    await user.click(legendRow(await buyList(), /電子零組件/))
    expect(screen.getByText('個股只列單日的主力，切回「今日」就會看到。')).toBeTruthy()
  })

  it('puts the pick in the address bar without adding a history entry, and clears it again', async () => {
    const user = await mount({ kind: 'ok', data })
    const before = window.history.length
    await user.click(legendRow(await buyList(), /電子零組件/))
    expect(window.location.hash).toBe('#/sector-flow/28')
    expect(window.history.length).toBe(before)
    await user.click(legendRow(await buyList(), /電子零組件/))
    expect(window.location.hash).toBe('#/sector-flow')
  })

  it('opens a link to a named slice under its legend row, with the table left closed', async () => {
    await mount({ kind: 'ok', data }, '24:design')
    const detail = await screen.findByRole('group', { name: 'IC 設計細節' })
    expect(within(await sellList()).getByText(/IC 設計/).closest('li')!.contains(detail)).toBe(true)
    expect(within(detail).getByText('賣超主力前 5')).toBeTruthy()
    expect((screen.getByText('看詳細數字').closest('details') as HTMLDetailsElement).open).toBe(false)
  })

  it('opens a link to a sector that has no slice in the table, and opens the table', async () => {
    // 類股11 (+1.0) is one of the sectors folded into 其他 on the buy side.
    await mount({ kind: 'ok', data }, '51')
    const detail = await screen.findByRole('group', { name: '類股11細節' })
    expect(detail.closest('tr')).not.toBeNull()
    expect((screen.getByText('看詳細數字').closest('details') as HTMLDetailsElement).open).toBe(true)
  })

  it('ignores a link to a sector this file does not have', async () => {
    await mount({ kind: 'ok', data }, '99')
    await screen.findByText(/10\/02\s+三大法人合計淨買超/)
    expect(screen.queryByRole('group', { name: /細節$/ })).toBeNull()
  })
})

describe('SectorFlowPage: the table', () => {
  const openTable = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByText('看詳細數字'))
    return screen.findByRole('table', { name: '類股資金流向' })
  }

  it('keeps the numbers folded away until asked for', async () => {
    await mount({ kind: 'ok', data })
    const fold = (await screen.findByText('看詳細數字')).closest('details') as HTMLDetailsElement
    expect(fold.open).toBe(false)
  })

  it('shows the signed 億 figure per sector, with the bar and the turnover share', async () => {
    const user = await mount({ kind: 'ok', data })
    const table = await openTable(user)
    const elec = within(table).getByText('電子零組件').closest('tr')!
    expect(within(elec).getByText('+234.0 億')).toBeTruthy()
    expect(within(elec).getByText('10.0%')).toBeTruthy()
    expect(screen.getByText('點類股名稱，看那個產業的細節。')).toBeTruthy()
  })

  it('does not repeat the date inside a detail for a single day, and names the window for several', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(legendRow(await buyList(), /電子零組件/))
    expect(within(screen.getByRole('group', { name: '電子零組件細節' })).queryByText('10/02')).toBeNull()
    await user.click(screen.getByRole('button', { name: '近 5 日' }))
    expect(within(screen.getByRole('group', { name: '電子零組件細節' })).getByText(/10\/01–10\/02（2 個交易日）/)).toBeTruthy()
  })

  it('opens a sector under its own row when the name is pressed, and not under a ring', async () => {
    const user = await mount({ kind: 'ok', data })
    const table = await openTable(user)
    const name = within(table).getByRole('button', { name: '電子零組件' })
    await user.click(name)
    expect(name.getAttribute('aria-expanded')).toBe('true')
    const detail = within(table).getByRole('group', { name: '電子零組件細節' })
    expect(detail.closest('tr')!.previousElementSibling).toBe(name.closest('tr'))
    // One place at a time: the legend row of the same sector stays closed.
    expect(screen.getAllByRole('group', { name: '電子零組件細節' })).toHaveLength(1)
    expect(legendRow(await buyList(), /電子零組件/).getAttribute('aria-expanded')).toBe('false')
    await user.click(name)
    expect(within(table).queryByRole('group', { name: '電子零組件細節' })).toBeNull()
  })

  it('opens 半導體 into its parts by default and can fold them, separate from opening its detail', async () => {
    const user = await mount({ kind: 'ok', data })
    const table = await openTable(user)
    expect(within(table).getByText('IC 設計')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '收合半導體細分' }))
    expect(within(table).queryByText('IC 設計')).toBeNull()
    await user.click(screen.getByRole('button', { name: '展開半導體細分' }))
    expect(within(table).getByText('IC 設計')).toBeTruthy()
    await user.click(within(table).getByRole('button', { name: '半導體' }))
    expect(within(table).getByRole('group', { name: '半導體細節' })).toBeTruthy()
  })

  it('lists the biggest buyers and sellers (and 半導體) first, the rest on request', async () => {
    const user = await mount({ kind: 'ok', data })
    const table = await openTable(user)
    expect(within(table).queryByText('類股10')).toBeNull()
    await user.click(screen.getByRole('button', { name: '顯示全部 23 類股' }))
    expect(within(table).getByText('類股10')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '只看買賣超最多與最少的類股' }))
    expect(within(table).queryByText('類股10')).toBeNull()
  })
})
