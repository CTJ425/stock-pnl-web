// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchSectorFlow } = vi.hoisted(() => ({ fetchSectorFlow: vi.fn() }))
vi.mock('../../services/sectorFlowProxy', () => ({ fetchSectorFlow }))

import { SectorFlowSection } from './SectorFlowSection'
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
  row('24:design', 'IC 設計', -70, { parent: '24' }),
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

afterEach(() => {
  cleanup()
  fetchSectorFlow.mockReset()
})

async function mount(result: unknown) {
  fetchSectorFlow.mockResolvedValue(result)
  const user = userEvent.setup()
  render(<SectorFlowSection />)
  await screen.findByText('類股資金流向')
  return user
}

describe('SectorFlowSection', () => {
  it('answers in words first: who bought, who sold, how semiconductors split', async () => {
    await mount({ kind: 'ok', data })
    expect(await screen.findByText(/買超最多的是電子零組件（\+234\.0 億）/)).toBeTruthy()
    expect(screen.getByText(/賣超最多的是電腦及週邊（-114\.0 億）/)).toBeTruthy()
    expect(screen.getByText(/半導體合計 -70\.0 億（IC 設計 -70\.0 億、晶圓製造 \+32\.0 億/)).toBeTruthy()
  })

  it('shows the signed 億 figure per sector, the movers behind it, and the share of turnover', async () => {
    await mount({ kind: 'ok', data })
    const table = await screen.findByRole('table', { name: '類股資金流向' })
    const elec = within(table).getByText('電子零組件').closest('tr')!
    expect(within(elec).getByText('+234.0 億')).toBeTruthy()
    expect(within(elec).getByText('買超主力：欣興')).toBeTruthy()
    expect(within(elec).getByText('10.0%')).toBeTruthy()
  })

  it('opens 半導體 into its children by default and can fold them', async () => {
    const user = await mount({ kind: 'ok', data })
    const table = await screen.findByRole('table', { name: '類股資金流向' })
    expect(within(table).getByText('IC 設計')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '收合半導體細分' }))
    expect(within(table).queryByText('IC 設計')).toBeNull()
    await user.click(screen.getByRole('button', { name: '展開半導體細分' }))
    expect(within(table).getByText('IC 設計')).toBeTruthy()
  })

  it('shows the biggest buyers and sellers (and 半導體) first, the rest on request', async () => {
    const user = await mount({ kind: 'ok', data })
    const table = await screen.findByRole('table', { name: '類股資金流向' })
    // 2 named sectors + 20 fillers + 半導體 = 23 sectors; the middle ones are folded.
    expect(within(table).queryByText('類股10')).toBeNull()
    expect(within(table).getByText('半導體')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '顯示全部 23 類股' }))
    expect(within(table).getByText('類股10')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '只看買賣超最多與最少的類股' }))
    expect(within(table).queryByText('類股10')).toBeNull()
  })

  it('switches to the 5-day total and drops the movers', async () => {
    const user = await mount({ kind: 'ok', data })
    await user.click(screen.getByRole('button', { name: '近 5 日' }))
    const table = await screen.findByRole('table', { name: '類股資金流向' })
    const elec = within(table).getByText('電子零組件').closest('tr')!
    expect(within(elec).getByText('+284.0 億')).toBeTruthy()
    expect(within(elec).queryByText(/買超主力/)).toBeNull()
    expect(screen.getByText(/10\/01–10\/02（2 個交易日）/)).toBeTruthy()
  })

  it('cannot pick 近 5 日 with one day of data', async () => {
    await mount({ kind: 'ok', data: { ...data, days: [data.days[1]] } })
    expect((screen.getByRole('button', { name: '近 5 日' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('switches the investor group', async () => {
    const d: SectorFlowData = {
      asOf: data.asOf,
      days: [day('2026-10-02', [row('28', '電子零組件', 10, { foreignTwd: 7 * E8, trustTwd: 2 * E8, dealerTwd: 1 * E8 })])],
    }
    const user = await mount({ kind: 'ok', data: d })
    expect(await screen.findByText('+10.0 億')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '外資' }))
    expect(await screen.findByText('+7.0 億')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '投信' }))
    expect(await screen.findByText('+2.0 億')).toBeTruthy()
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
    render(<SectorFlowSection />)
    expect(await screen.findByText(/讀取類股資金流向失敗/)).toBeTruthy()
  })
})
