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

describe('SectorFlowPage', () => {
  it('answers in words first: who bought, who sold, how semiconductors split', async () => {
    await mount({ kind: 'ok', data })
    expect(await screen.findByText(/買超最多的是電子零組件（\+234\.0 億）/)).toBeTruthy()
    expect(screen.getByText(/賣超最多的是電腦及週邊（-114\.0 億）/)).toBeTruthy()
    expect(screen.getByText(/半導體合計 -70\.0 億（IC 設計 -70\.0 億、晶圓製造 \+32\.0 億/)).toBeTruthy()
  })

  it('draws a tile per sector, 半導體 with its four parts inside, each readable by name and figure', async () => {
    await mount({ kind: 'ok', data })
    const group = await screen.findByRole('group', { name: /類股方塊圖/ })
    expect(within(group).getByRole('button', { name: /^電子零組件，買賣超 \+234\.0 億，佔成交 10\.0%/ })).toBeTruthy()
    expect(within(group).getByRole('button', { name: /^半導體合計，買賣超 -70\.0 億/ })).toBeTruthy()
    for (const n of ['IC 設計', '晶圓製造', '封裝測試', '設備、材料與其他']) {
      expect(within(group).getByRole('button', { name: new RegExp(`^${n}，買賣超`) })).toBeTruthy()
    }
  })

  it('says how to read the picture before anything is selected', async () => {
    await mount({ kind: 'ok', data })
    expect(await screen.findByText(/點任一個方塊/)).toBeTruthy()
    expect(screen.getByLabelText('圖例')).toBeTruthy()
  })

  it('opens the detail panel on a tile: a sentence, the four groups, and the movers', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(await screen.findByRole('button', { name: /^IC 設計，買賣超/ }))
    const panel = screen.getByRole('complementary', { name: '類股細節' })
    expect(within(panel).getByText('IC 設計')).toBeTruthy()
    expect(within(panel).getByText('法人合計賣超 70.0 億，主要是外資賣超 77.0 億。')).toBeTruthy()
    expect(within(panel).getByText('外資')).toBeTruthy()
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

  it('opens with the sector from a link already selected, including a semiconductor part', async () => {
    await mount({ kind: 'ok', data }, '24:design')
    const panel = await screen.findByRole('complementary', { name: '類股細節' })
    expect(within(panel).getByText('IC 設計')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^IC 設計，買賣超/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('ignores a link to a sector this file does not have', async () => {
    await mount({ kind: 'ok', data }, '99')
    expect(await screen.findByText(/點任一個方塊/)).toBeTruthy()
  })

  it('shows the signed 億 figure per sector in the table, with the movers and the turnover share', async () => {
    await mount({ kind: 'ok', data })
    const table = await screen.findByRole('table', { name: '類股資金流向' })
    const elec = within(table).getByText('電子零組件').closest('tr')!
    expect(within(elec).getByText('+234.0 億')).toBeTruthy()
    expect(within(elec).getByText('買超主力：欣興')).toBeTruthy()
    expect(within(elec).getByText('10.0%')).toBeTruthy()
  })

  it('marks the selected sector in the table', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(await screen.findByRole('button', { name: /^電子零組件，買賣超/ }))
    const table = screen.getByRole('table', { name: '類股資金流向' })
    expect(within(table).getByText('電子零組件').closest('tr')!.getAttribute('aria-selected')).toBe('true')
  })

  it('opens 半導體 into its parts in the table by default and can fold them', async () => {
    const user = await mount({ kind: 'ok', data })
    const table = await screen.findByRole('table', { name: '類股資金流向' })
    expect(within(table).getByText('IC 設計')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '收合半導體細分' }))
    expect(within(table).queryByText('IC 設計')).toBeNull()
    await user.click(screen.getByRole('button', { name: '展開半導體細分' }))
    expect(within(table).getByText('IC 設計')).toBeTruthy()
  })

  it('lists the biggest buyers and sellers (and 半導體) first, the rest on request', async () => {
    const user = await mount({ kind: 'ok', data })
    const table = await screen.findByRole('table', { name: '類股資金流向' })
    expect(within(table).queryByText('類股10')).toBeNull()
    await user.click(screen.getByRole('button', { name: '顯示全部 23 類股' }))
    expect(within(table).getByText('類股10')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '只看買賣超最多與最少的類股' }))
    expect(within(table).queryByText('類股10')).toBeNull()
  })

  it('switches to the 5-day total, drops the movers and says why', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(screen.getByRole('button', { name: '近 5 日' }))
    const table = await screen.findByRole('table', { name: '類股資金流向' })
    const elec = within(table).getByText('電子零組件').closest('tr')!
    expect(within(elec).getByText('+284.0 億')).toBeTruthy()
    expect(within(elec).queryByText(/買超主力/)).toBeNull()
    expect(screen.getByText(/10\/01–10\/02（2 個交易日）/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /^電子零組件，買賣超/ }))
    expect(screen.getByText('個股只列單日的主力，切回「今日」就會看到。')).toBeTruthy()
  })

  it('cannot pick 近 5 日 with one day of data', async () => {
    await mount({ kind: 'ok', data: { ...data, days: [data.days[1]] } })
    expect((screen.getByRole('button', { name: '近 5 日' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('recolours for another investor group without moving anything', async () => {
    const d: SectorFlowData = {
      asOf: data.asOf,
      days: [day('2026-10-02', [row('28', '電子零組件', 10, { foreignTwd: 7 * E8, trustTwd: 2 * E8, dealerTwd: 1 * E8 })])],
    }
    const user = await mount({ kind: 'ok', data: d })
    expect(await screen.findByRole('button', { name: /^電子零組件，買賣超 \+10\.0 億/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '外資' }))
    expect(await screen.findByRole('button', { name: /^電子零組件，買賣超 \+7\.0 億/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '投信' }))
    expect(await screen.findByRole('button', { name: /^電子零組件，買賣超 \+2\.0 億/ })).toBeTruthy()
  })

  it('shows the estimate against the official figure, and says what it covers', async () => {
    await mount({ kind: 'ok', data })
    expect(await screen.findByText(/估算合計 \+103\.2 億，證交所公布 \+104\.2 億（差 -0\.9%）/)).toBeTruthy()
    expect(screen.getByText(/涵蓋上市與上櫃/)).toBeTruthy()
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
