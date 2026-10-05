// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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

/** n consecutive days, each buying 電子零組件 +10 and selling 電腦及週邊 −4, so a window of k days nets +6k. */
const daysOf = (n: number): SectorFlowData => ({
  asOf: data.asOf,
  days: Array.from({ length: n }, (_, i) =>
    day(`2026-09-${String(24 + i)}`, [
      row('28', '電子零組件', 10, { topBuy: stocks('欣', 2, 1) }),
      row('25', '電腦及週邊', -4),
    ]),
  ),
})

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

/** A tile of the treemap, by sector name (the table's name buttons are named by the sector alone). */
const tile = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}，買賣超`) })
const aside = () => screen.getByRole('complementary', { name: '類股細節' })

describe('SectorFlowPage: the day', () => {
  it('opens with the day on one line: the net, what was bought and what was sold', async () => {
    await mount({ kind: 'ok', data })
    const label = await screen.findByText(/10\/02\s+三大法人合計淨買超/)
    // Leaves: buys 234 + 32 + 10 + (1..9) = 321; sells 114 + 70 + 42 + (1..10) = 281.
    expect(label.nextElementSibling?.textContent).toBe('+40.0 億')
    const sides = screen.getByText(/^買進的產業/).textContent
    expect(sides).toContain('+321.0 億（12 個類股）')
    expect(sides).toContain('-281.0 億（13 個類股）')
  })

  it('draws a treemap and no rings: one tile per sector, 半導體 as a header over its four parts', async () => {
    await mount({ kind: 'ok', data })
    const map = await screen.findByRole('group', { name: /類股方塊圖：面積是成交金額，紅色買超、綠色賣超/ })
    // 23 sectors minus the parent 半導體 (drawn as a header) plus its four parts, plus the header itself.
    expect(within(map).getAllByRole('button')).toHaveLength(22 + 4 + 1)
    expect(within(map).getByRole('button', { name: /^半導體合計，買賣超 -70\.0 億/ })).toBeTruthy()
    for (const part of ['IC 設計', '晶圓製造', '封裝測試', '設備、材料與其他']) {
      expect(within(map).getByRole('button', { name: new RegExp(`^${part}，買賣超`) })).toBeTruthy()
    }
    expect(document.querySelectorAll('svg circle')).toHaveLength(0)
    expect(screen.queryByText(/錢進了哪些產業|錢出了哪些產業/)).toBeNull()
  })

  it('names each tile with its signed figure and its share of the turnover, so colour never carries the sign alone', async () => {
    await mount({ kind: 'ok', data })
    await screen.findByRole('group', { name: /類股方塊圖/ })
    expect(tile('電子零組件').getAttribute('aria-label')).toBe('電子零組件，買賣超 +234.0 億，佔成交 10.0%')
    expect(tile('電腦及週邊').getAttribute('aria-label')).toContain('買賣超 -114.0 億')
  })

  it('says how to read the picture, and that a tile can be pressed', async () => {
    await mount({ kind: 'ok', data })
    const legend = await screen.findByRole('list', { name: '怎麼看方塊圖' })
    expect(legend.textContent).toContain('面積是成交金額')
    expect(legend.textContent).toContain('紅色：買超')
    expect(legend.textContent).toContain('綠色：賣超')
    expect(legend.textContent).toContain('點一塊看細節')
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
    expect(tile('電腦及週邊').getAttribute('aria-label')).toContain('買賣超 -6.0 億')
    await user.click(screen.getByRole('button', { name: '投信' }))
    const label = await screen.findByText(/10\/02\s+投信淨買超/)
    expect(label.nextElementSibling?.textContent).toBe('+4.0 億')
  })

  it('keeps every tile where it was when the investor group changes, because the area is turnover', async () => {
    const user = await mount({ kind: 'ok', data })
    await screen.findByRole('group', { name: /類股方塊圖/ })
    const place = () => (tile('電子零組件') as HTMLElement).style.cssText
    const before = place()
    await user.click(screen.getByRole('button', { name: '外資' }))
    expect(place()).toBe(before)
  })

  it('says net selling when the sellers outweigh the buyers, and counts an empty side as none', async () => {
    const d: SectorFlowData = { asOf: data.asOf, days: [day('2026-10-02', [row('28', 'x', 3), row('25', 'y', -10)])] }
    await mount({ kind: 'ok', data: d })
    expect(await screen.findByText(/10\/02\s+三大法人合計淨賣超/)).toBeTruthy()
    expect(screen.getByText('-7.0 億')).toBeTruthy()
    cleanup()
    await mount({ kind: 'ok', data: { asOf: data.asOf, days: [day('2026-10-02', [row('28', 'x', 3)])] } })
    expect((await screen.findByText(/^買進的產業/)).textContent).toContain('（0 個類股）')
  })

  it('offers a window only when the file holds enough days to fill it, and says why not', async () => {
    await mount({ kind: 'ok', data: daysOf(1) })
    const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
    expect(btn('今日').disabled).toBe(false)
    expect(btn('近 3 日').disabled).toBe(true)
    expect(btn('近 5 日').disabled).toBe(true)
    expect(btn('近 3 日').title).toBe('資料累積中：目前 1 天，近 3 日需要 3 天')
    expect(screen.getByText(/資料累積中，目前有 1 個交易日.*滿 3 天可看近 3 日，滿 5 天可看近 5 日/)).toBeTruthy()
  })

  it('keeps 近 3 日 closed with two days, so a name never covers fewer days than it says', async () => {
    await mount({ kind: 'ok', data })
    expect((screen.getByRole('button', { name: '近 3 日' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '近 5 日' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens 近 3 日 at three days, sums exactly those three, and names them', async () => {
    const user = await mount({ kind: 'ok', data: daysOf(3) })
    expect((screen.getByRole('button', { name: '近 3 日' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '近 5 日' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/目前有 3 個交易日.*滿 5 天可看近 5 日/)).toBeTruthy()
    expect(screen.queryByText(/滿 3 天可看近 3 日/)).toBeNull()

    await user.click(screen.getByRole('button', { name: '近 3 日' }))
    const label = await screen.findByText(/09\/24–09\/26（3 個交易日）\s+三大法人合計淨買超/)
    expect(label.nextElementSibling?.textContent).toBe('+18.0 億')
    expect(screen.getByRole('button', { name: '近 3 日' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('takes only the last three of five days for 近 3 日, and all five for 近 5 日', async () => {
    const user = await mount({ kind: 'ok', data: daysOf(5) })
    expect(screen.queryByText(/資料累積中/)).toBeNull()
    await user.click(screen.getByRole('button', { name: '近 3 日' }))
    expect((await screen.findByText(/09\/26–09\/28（3 個交易日）/)).nextElementSibling?.textContent).toBe('+18.0 億')
    await user.click(screen.getByRole('button', { name: '近 5 日' }))
    expect((await screen.findByText(/09\/24–09\/28（5 個交易日）/)).nextElementSibling?.textContent).toBe('+30.0 億')
    await user.click(screen.getByRole('button', { name: '今日' }))
    expect((await screen.findByText(/09\/28\s+三大法人合計淨買超/)).nextElementSibling?.textContent).toBe('+6.0 億')
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

describe('SectorFlowPage: opening a sector from the map', () => {
  it('asks for a press while nothing is picked', async () => {
    await mount({ kind: 'ok', data })
    await screen.findByRole('group', { name: /類股方塊圖/ })
    expect(within(aside()).getByText('點一塊方塊，看那個類股的法人買賣與主力個股。')).toBeTruthy()
  })

  it('opens beside the map: a name, a sentence, the four groups, the share, and the five biggest buyers', async () => {
    const user = await mount({ kind: 'ok', data })
    await screen.findByRole('group', { name: /類股方塊圖/ })
    expect(tile('電子零組件').getAttribute('aria-pressed')).toBe('false')
    await user.click(tile('電子零組件'))
    expect(tile('電子零組件').getAttribute('aria-pressed')).toBe('true')

    expect(within(aside()).getByRole('heading', { name: '電子零組件' })).toBeTruthy()
    const detail = within(aside()).getByRole('group', { name: '電子零組件細節' })
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
    await user.click(await screen.findByRole('button', { name: /^電腦及週邊，買賣超/ }))
    const detail = within(aside()).getByRole('group', { name: '電腦及週邊細節' })
    expect(within(detail).getByText('賣超主力前 5')).toBeTruthy()
    expect(within(detail).getByText('電股1')).toBeTruthy()
    expect(within(detail).queryByText('買超主力前 5')).toBeNull()
  })

  it('opens one sector at a time, and closes on a second press or on the close button', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(await screen.findByRole('button', { name: /^電子零組件，買賣超/ }))
    expect(screen.getAllByRole('group', { name: /細節$/ })).toHaveLength(1)
    await user.click(tile('電腦及週邊'))
    expect(tile('電子零組件').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByRole('group', { name: /細節$/ })).toHaveLength(1)
    expect(screen.getByRole('group', { name: '電腦及週邊細節' })).toBeTruthy()
    await user.click(tile('電腦及週邊'))
    expect(screen.queryByRole('group', { name: /細節$/ })).toBeNull()

    await user.click(tile('電子零組件'))
    await user.click(screen.getByRole('button', { name: '關閉電子零組件細節' }))
    expect(screen.queryByRole('group', { name: /細節$/ })).toBeNull()
    expect(window.location.hash).toBe('#/sector-flow')
  })

  it('brings the detail into view, since on a phone it sits under the map', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const user = await mount({ kind: 'ok', data })
      await user.click(await screen.findByRole('button', { name: /^電子零組件，買賣超/ }))
      await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' }))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('opens a semiconductor part, and the 半導體 header for the whole', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(await screen.findByRole('button', { name: /^IC 設計，買賣超/ }))
    const detail = within(aside()).getByRole('group', { name: 'IC 設計細節' })
    expect(within(detail).getByText('賣超主力前 5')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^半導體合計，買賣超/ }))
    expect(within(aside()).getByRole('group', { name: '半導體細節' })).toBeTruthy()
  })

  it('follows the chosen investor group for the stocks, and says when a group has none', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(screen.getByRole('button', { name: '外資' }))
    await user.click(tile('電子零組件'))
    let detail = within(aside()).getByRole('group', { name: '電子零組件細節' })
    expect(within(detail).getByText('外資買超主力前 5')).toBeTruthy()
    expect(within(detail).getByText('依外資排名')).toBeTruthy()
    expect(within(detail).getByText('外股1')).toBeTruthy()
    expect(within(detail).queryByText('欣股1')).toBeNull()

    // The pick stays open when the group changes; 自營商 has no buyers or sellers listed for it.
    await user.click(screen.getByRole('button', { name: '自營商' }))
    detail = within(aside()).getByRole('group', { name: '電子零組件細節' })
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
    await user.click(tile('電子零組件'))
    expect(screen.getByText(/這份資料還沒有外資各自的個股排名/)).toBeTruthy()
  })

  it('lists no stocks for a window of several days, and says why', async () => {
    const user = await mount({ kind: 'ok', data: daysOf(3) })
    await user.click(screen.getByRole('button', { name: '近 3 日' }))
    await user.click(tile('電子零組件'))
    expect(screen.getByText('個股只列單日的主力，切回「今日」就會看到。')).toBeTruthy()
  })

  it('does not repeat the date inside a detail for a single day, and names the window for several', async () => {
    const user = await mount({ kind: 'ok', data: daysOf(3) })
    await user.click(tile('電子零組件'))
    expect(within(screen.getByRole('group', { name: '電子零組件細節' })).queryByText(/09\/26/)).toBeNull()
    await user.click(screen.getByRole('button', { name: '近 3 日' }))
    expect(within(screen.getByRole('group', { name: '電子零組件細節' })).getByText(/09\/24–09\/26（3 個交易日）/)).toBeTruthy()
  })

  it('puts the pick in the address bar without adding a history entry, and clears it again', async () => {
    const user = await mount({ kind: 'ok', data })
    const before = window.history.length
    await user.click(await screen.findByRole('button', { name: /^電子零組件，買賣超/ }))
    expect(window.location.hash).toBe('#/sector-flow/28')
    expect(window.history.length).toBe(before)
    await user.click(tile('電子零組件'))
    expect(window.location.hash).toBe('#/sector-flow')
  })

  it('opens a link to a sector beside the map, with the table left closed', async () => {
    await mount({ kind: 'ok', data }, '24:design')
    const detail = await screen.findByRole('group', { name: 'IC 設計細節' })
    expect(aside().contains(detail)).toBe(true)
    expect(within(detail).getByText('賣超主力前 5')).toBeTruthy()
    expect(tile('IC 設計').getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByText('看詳細數字').closest('details') as HTMLDetailsElement).open).toBe(false)
  })

  it('opens a link to a sector with no tile under its table row, and opens the table', async () => {
    // A sector nobody traded in the window has no area on the map, but it is in the table.
    const d: SectorFlowData = {
      asOf: data.asOf,
      days: [day('2026-10-02', [row('28', '電子零組件', 10), row('77', '無成交類股', 5, { turnoverTwd: 0 })])],
    }
    await mount({ kind: 'ok', data: d }, '77')
    const detail = await screen.findByRole('group', { name: '無成交類股細節' })
    expect(detail.closest('tr')).not.toBeNull()
    expect(aside().contains(detail)).toBe(false)
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

  it('shows the signed 億 figure and the turnover share per sector, with no bar', async () => {
    const user = await mount({ kind: 'ok', data })
    const table = await openTable(user)
    const elec = within(table).getByText('電子零組件').closest('tr')!
    expect(within(elec).getByText('+234.0 億')).toBeTruthy()
    expect(within(elec).getByText('10.0%')).toBeTruthy()
    expect(screen.getByText('點類股名稱，看那個產業的細節。')).toBeTruthy()
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['類股', '買賣超', '佔成交'])
    expect(table.querySelector('.sf-bar')).toBeNull()
  })

  it('opens a sector under its own row when the name is pressed, and not beside the map', async () => {
    const user = await mount({ kind: 'ok', data })
    const table = await openTable(user)
    const name = within(table).getByRole('button', { name: '電子零組件' })
    await user.click(name)
    expect(name.getAttribute('aria-expanded')).toBe('true')
    const detail = within(table).getByRole('group', { name: '電子零組件細節' })
    expect(detail.closest('tr')!.previousElementSibling).toBe(name.closest('tr'))
    // One place at a time: the panel beside the map stays on its prompt, though the tile shows the pick.
    expect(screen.getAllByRole('group', { name: '電子零組件細節' })).toHaveLength(1)
    expect(within(aside()).queryByRole('group')).toBeNull()
    expect(tile('電子零組件').getAttribute('aria-pressed')).toBe('true')
    await user.click(name)
    expect(within(table).queryByRole('group', { name: '電子零組件細節' })).toBeNull()
  })

  it('moves the detail to the map when a tile is pressed after a table row', async () => {
    const user = await mount({ kind: 'ok', data })
    const table = await openTable(user)
    await user.click(within(table).getByRole('button', { name: '電子零組件' }))
    await user.click(tile('電子零組件'))
    expect(within(table).queryByRole('group', { name: '電子零組件細節' })).toBeNull()
    expect(within(aside()).getByRole('group', { name: '電子零組件細節' })).toBeTruthy()
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
