// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchMacro } = vi.hoisted(() => ({ fetchMacro: vi.fn() }))
vi.mock('../../services/macroProxy', () => ({ fetchMacro }))

import { MacroPage } from './MacroPage'
import type { MacroData } from '../../services/macroProxy'

const macro: MacroData = {
  asOf: '2026-07-28T07:33:38.000Z',
  // Inspected on the same day - In this case, there should not be an extra paragraph of "Final Inspection" (no information)
  checkedAt: '2026-07-28T07:33:38.000Z',
  region: '美國',
  indicators: [
    {
      id: 'CPILFESL',
      label: '核心 CPI',
      kind: 'yoy',
      unit: '%',
      note: '排除食品與能源後的年增率',
      latest: { period: '2026-06', value: 2.57 },
      previous: { period: '2026-05', value: 2.82 },
      points: [
        { period: '2026-05', value: 2.82 },
        { period: '2026-06', value: 2.57 },
      ],
    },
    {
      id: 'DFEDTARU',
      label: 'FOMC 目標利率',
      kind: 'rate',
      unit: '%',
      note: '聯邦基金目標利率區間',
      latest: { period: '2025-12-10', value: 4.5, valueLow: 4.25 },
      previous: { period: '2025-09-17', value: 4.75, valueLow: 4.5 },
      points: [
        { period: '2025-09-17', value: 4.75, valueLow: 4.5 },
        { period: '2025-12-10', value: 4.5, valueLow: 4.25 },
      ],
    },
    {
      id: 'PAYEMS',
      label: '非農就業 NFP',
      kind: 'momThousands',
      unit: '千人',
      note: '較上月增減',
      latest: { period: '2026-06', value: 57 },
      previous: { period: '2026-05', value: 129 },
      // The release schedule is different: this item is missing one issue, and the trend chart must not be misaligned because of this.
      points: [{ period: '2026-06', value: 57 }],
    },
    {
      id: 'UMCSENT',
      label: '消費者信心 UMCSENT',
      kind: 'index',
      unit: '指數',
      note: '密大指數',
      latest: { period: '2026-05', value: 44.8 },
      previous: { period: '2026-04', value: 49.8 },
      points: [
        { period: '2026-04', value: 49.8 },
        { period: '2026-05', value: 44.8 },
      ],
    },
  ],
}

describe('MacroPage', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('載入中顯示佔位', () => {
    fetchMacro.mockReturnValue(new Promise(() => {}))
    render(<MacroPage />)
    expect(screen.getByText('正在讀取總體經濟資料…')).toBeTruthy()
  })

  it('查無資料時的空狀態，文案不提「盤後批次」（總經跟台股盤後無關）', async () => {
    fetchMacro.mockResolvedValue(null)
    render(<MacroPage />)
    expect(await screen.findByText('總體經濟資料尚未產生。')).toBeTruthy()
    expect(screen.getByText(/每日排程完成後會自動補上/)).toBeTruthy()
    expect(screen.queryByText(/盤後批次/)).toBeNull()
  })

  it('指標壓成一行 chip，只有名稱與最新值（0.6.35）；rate 顯示區間無 + 前綴', async () => {
    fetchMacro.mockResolvedValue(macro)
    const { container } = render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    const chips = [...container.querySelectorAll('.mac-chip')].map((e) => e.textContent)
    // % growth / rate range / thousand people / index
    expect(chips).toEqual([
      '核心 CPI+2.57%',
      'FOMC 目標利率4.25–4.50%',
      '非農就業 NFP+57 千人',
      '消費者信心 UMCSENT44.8',
    ])
    // The entire set of old KPI cards has been removed, and the details are now handled by the form.
    expect(container.querySelectorAll('.kpi-value')).toHaveLength(0)
    expect(container.querySelectorAll('.mac-chip .mac-spark')).toHaveLength(0)
  })

  it('chip 列與近期走勢表同卡，不再拆成兩張（0.6.38）', async () => {
    fetchMacro.mockResolvedValue(macro)
    const { container } = render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    // The US block is one card: the chips and the table sit inside the same .glass as the refresh button,
    // which is the point of the merge —— split apart, the 資料更新於 stamp looked as if it only covered the chips.
    const card = container.querySelector('.section.glass')!
    expect(within(card as HTMLElement).getByText('美國總體經濟')).toBeTruthy()
    expect(card.querySelector('.mac-chip-row')).toBeTruthy()
    expect(card.querySelector('.data-table')).toBeTruthy()
    expect(within(card as HTMLElement).getByText('近期走勢・近 12 期')).toBeTruthy()
  })

  it('一列一個指標，欄位為 指標／最新／較上期／趨勢／連續（0.6.35）', async () => {
    fetchMacro.mockResolvedValue(macro)
    const { container } = render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    const heads = [...container.querySelectorAll('.data-table thead th')].map((e) => e.textContent)
    expect(heads).toEqual(['指標', '最新', '較上期', '趨勢', '連續'])
    const rows = [...container.querySelectorAll('.table-scroll > .data-table > tbody > tr')]
    expect(rows.map((r) => r.querySelector('.mac-row-label')?.textContent)).toEqual([
      '核心 CPI',
      'FOMC 目標利率',
      '非農就業 NFP',
      '消費者信心 UMCSENT',
    ])
    // The indicator description has been moved from the bottom of the card to the column, and can still be seen after the word card is slimmed down.
    expect(rows[0].querySelector('.mac-row-note')?.textContent).toBe('排除食品與能源後的年增率')
    // A trend line can be drawn at more than two points; non-farm has only one point → no spark
    expect(rows[0].querySelectorAll('.mac-spark')).toHaveLength(1)
    expect(rows[2].querySelectorAll('.mac-spark')).toHaveLength(0)
  })

  it('總經頁不顯示「落後 N 期」——避免誤以為沒更新（後台抓取狀況才顯示）', async () => {
    fetchMacro.mockResolvedValue(macro)
    const { container } = render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    // Fixture still has UMCSENT one month behind PAYEMS; end-user page must not badge it.
    expect(container.querySelectorAll('.mac-row-label .badge')).toHaveLength(0)
    expect(screen.queryByText(/落後 \d+ 期/)).toBeNull()
  })

  it('全表依升降上色：非農「值是正的但比上期低」也是綠的（0.6.35）', async () => {
    /*
      This test pins the deliberate trade-off from 0.6.35: before 0.6.34 non-farm payrolls were coloured by the
      sign of the value (+57k = red); the whole table now reads rise/fall, so it turns green. One table cannot
      carry two colour rules.
    */
    fetchMacro.mockResolvedValue({
      ...macro,
      indicators: macro.indicators.map((ind) =>
        // Consumer confidence is changed to be higher than the previous period, used to compare "rising = red"
        ind.id === 'UMCSENT' ? { ...ind, previous: { period: '2026-04', value: 40 } } : ind,
      ),
    })
    const { container } = render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    const rows = [...container.querySelectorAll('.table-scroll > .data-table > tbody > tr')]

    const payroll = [...rows[2].querySelectorAll('td')]
    expect(payroll[1].textContent).toContain('+57 千人')
    expect(payroll[1].className).toContain('pnl-down')
    expect(payroll[2].textContent).toBe('−72')
    expect(payroll[2].className).toContain('pnl-down')

    const sentiment = [...rows[3].querySelectorAll('td')]
    expect(sentiment[2].textContent).toBe('+4.80')
    expect(sentiment[2].className).toContain('pnl-up')
  })

  it('連 2 期以上才在「連續」欄印字，否則給「—」而非留白', async () => {
    // Core CPI fell for three consecutive periods; non-farm payrolls only fell for one period, and consumer confidence only fell for two periods, neither of which constitutes a trend.
    fetchMacro.mockResolvedValue({
      ...macro,
      indicators: macro.indicators.map((ind) =>
        ind.id === 'CPILFESL'
          ? {
              ...ind,
              points: [
                { period: '2026-03', value: 3.1 },
                { period: '2026-04', value: 2.95 },
                { period: '2026-05', value: 2.82 },
                { period: '2026-06', value: 2.57 },
              ],
            }
          : ind,
      ),
    })
    const { container } = render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    const streaks = [...container.querySelectorAll('.table-scroll > .data-table > tbody > tr')].map(
      (r) => r.querySelectorAll('td')[4].textContent,
    )
    expect(streaks).toEqual(['連 3 期下降', '—', '—', '—'])
  })

  it('缺值中斷連續：不把兩段不相干的走勢接起來', async () => {
    fetchMacro.mockResolvedValue({
      ...macro,
      indicators: macro.indicators.map((ind) =>
        ind.id === 'CPILFESL'
          ? {
              ...ind,
              points: [
                { period: '2026-03', value: 3.1 },
                { period: '2026-04', value: null },
                { period: '2026-05', value: 2.82 },
                { period: '2026-06', value: 2.57 },
              ],
            }
          : ind,
      ),
    })
    const { container } = render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    // After the missing value, there is only a period of decline from 2.82 → 2.57, which is not a trend for one period in a row.
    const streaks = [...container.querySelectorAll('.table-scroll > .data-table > tbody > tr')].map(
      (r) => r.querySelectorAll('td')[4].textContent,
    )
    expect(streaks).toEqual(['—', '—', '—', '—'])
  })

  it('點＋展開該指標的逐期明細；「全部展開」一次開完（0.6.35）', async () => {
    const user = userEvent.setup()
    fetchMacro.mockResolvedValue(macro)
    const { container } = render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    expect(container.querySelectorAll('.detail-row')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /展開 核心 CPI/ }))
    expect(container.querySelectorAll('.detail-row')).toHaveLength(1)
    expect(screen.getByText('核心 CPI 明細')).toBeTruthy()
    // The details are from new to old, which is opposite to the parent table (the trend line is from old to new)
    const detailRows = [...container.querySelectorAll('.detail-row tbody tr')]
    expect(detailRows.map((r) => r.querySelector('td')!.textContent)).toEqual([
      '2026 年 06 月',
      '2026 年 05 月',
    ])

    await user.click(screen.getByRole('button', { name: '全部展開' }))
    expect(container.querySelectorAll('.detail-row')).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: '全部收起' }))
    expect(container.querySelectorAll('.detail-row')).toHaveLength(0)
  })

  it('顏色的意思要寫出來——紅不等於好消息', async () => {
    fetchMacro.mockResolvedValue(macro)
    render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    expect(screen.getByText(/升降本身沒有好壞之分/)).toBeTruthy()
  })

  it('標示資料產出時間', async () => {
    fetchMacro.mockResolvedValue(macro)
    render(<MacroPage />)
    expect(await screen.findByText(/資料更新於 2026-07-28 \d{2}:\d{2}/)).toBeTruthy()
  })

  it('同日檢查過時不多印「最後檢查」——那只會重複 asOf，沒有資訊量', async () => {
    fetchMacro.mockResolvedValue(macro)
    render(<MacroPage />)
    await screen.findByText(/資料更新於/)
    expect(screen.queryByText(/最後檢查/)).toBeNull()
  })

  it('資料已數日未變時補上「最後檢查」，讓沒發布與排程掛掉分得開', async () => {
    // Starting from 0.6.11, asOf only jumps when the data really changes, and monthly data only moves once a month.
    // Without this line, the screen will look broken.
    fetchMacro.mockResolvedValue({ ...macro, checkedAt: '2026-07-31T13:00:01.000Z' })
    render(<MacroPage />)
    expect(await screen.findByText(/最後檢查 2026-07-31 \d{2}:\d{2}/)).toBeTruthy()
    expect(screen.getByText(/資料更新於 2026-07-28 \d{2}:\d{2}/)).toBeTruthy()
  })

  it('舊檔沒有 checkedAt 時照常渲染，不印空括號', async () => {
    fetchMacro.mockResolvedValue({ ...macro, checkedAt: '' })
    render(<MacroPage />)
    await screen.findByText(/資料更新於/)
    expect(screen.queryByText(/最後檢查/)).toBeNull()
  })

  it('重新整理鈕會重抓', async () => {
    fetchMacro.mockResolvedValue(macro)
    render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    expect(fetchMacro).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /重新整理/ }))
    expect(fetchMacro).toHaveBeenCalledTimes(2)
  })

  it('不再有「與您正在查看的個股無關」那句補救文案（已是獨立頁面）', async () => {
    fetchMacro.mockResolvedValue(macro)
    render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    expect(screen.queryByText(/正在查看的個股/)).toBeNull()
  })
})
