// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { fetchMacro } = vi.hoisted(() => ({ fetchMacro: vi.fn() }))
vi.mock('../../services/macroProxy', () => ({ fetchMacro }))

import { MacroPage } from './MacroPage'
import type { MacroData } from '../../services/macroProxy'

const macro: MacroData = {
  asOf: '2026-07-28T07:33:38.000Z',
  // 同一天檢查過 —— 這種情況不該多印一段「最後檢查」（沒有資訊量）
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
      id: 'PAYEMS',
      label: '非農就業',
      kind: 'momThousands',
      unit: '千人',
      note: '較上月增減',
      latest: { period: '2026-06', value: 57 },
      previous: { period: '2026-05', value: 129 },
      // 發布時程不同：這一項少一期，走勢表不得因此錯位
      points: [{ period: '2026-06', value: 57 }],
    },
    {
      id: 'UMCSENT',
      label: '消費者信心',
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

  it('五個指標壓成一行 chip，只有名稱與最新值（0.6.35）', async () => {
    fetchMacro.mockResolvedValue(macro)
    const { container } = render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    const chips = [...container.querySelectorAll('.mac-chip')].map((e) => e.textContent)
    // % / 千人 / 指數 三種口徑各自成立
    expect(chips).toEqual(['核心 CPI+2.57%', '非農就業+57 千人', '消費者信心44.8'])
    // 舊的 KPI 卡整組移除，細節改由表格負責
    expect(container.querySelectorAll('.kpi-value')).toHaveLength(0)
    expect(container.querySelectorAll('.mac-chip .mac-spark')).toHaveLength(0)
  })

  it('一列一個指標，欄位為 指標／最新／較上期／趨勢／連續（0.6.35）', async () => {
    fetchMacro.mockResolvedValue(macro)
    const { container } = render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    const heads = [...container.querySelectorAll('.data-table thead th')].map((e) => e.textContent)
    expect(heads).toEqual(['指標', '最新', '較上期', '趨勢', '連續'])
    const rows = [...container.querySelectorAll('.table-scroll > .data-table > tbody > tr')]
    expect(rows.map((r) => r.querySelector('.mac-row-label')?.firstChild?.textContent)).toEqual([
      '核心 CPI',
      '非農就業',
      '消費者信心',
    ])
    // 指標說明由卡片底部搬進列裡，字卡瘦身後仍看得到
    expect(rows[0].querySelector('.mac-row-note')?.textContent).toBe('排除食品與能源後的年增率')
    // 兩點以上畫得出走勢線；非農只有一期，該格印「—」
    expect(rows[0].querySelectorAll('.mac-spark')).toHaveLength(1)
    expect(rows[1].querySelectorAll('.mac-spark')).toHaveLength(0)
  })

  it('落後的指標在列上掛徽章，跟上的不掛——五列都寫「最新」等於沒有訊號', async () => {
    fetchMacro.mockResolvedValue(macro)
    const { container } = render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    // 三個指標的最新期別：CPI 與非農同為 2026-06，消費者信心停在 2026-05
    const badges = [...container.querySelectorAll('.mac-row-label .badge')].map((e) => e.textContent)
    expect(badges).toEqual(['落後 1 期'])
  })

  it('全表依升降上色：非農「值是正的但比上期低」也是綠的（0.6.35）', async () => {
    /*
      這條測試鎖的是 0.6.35 那個刻意的取捨：0.6.34 之前非農依「數值正負」上色
      （+57 千人＝紅），現在全表統一看升降，所以它變綠。同一張表不能有兩套顏色規則。
    */
    fetchMacro.mockResolvedValue({
      ...macro,
      indicators: macro.indicators.map((ind) =>
        // 消費者信心改成比上期高，用來對照「升＝紅」
        ind.id === 'UMCSENT' ? { ...ind, previous: { period: '2026-04', value: 40 } } : ind,
      ),
    })
    const { container } = render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    const rows = [...container.querySelectorAll('.table-scroll > .data-table > tbody > tr')]

    const payroll = [...rows[1].querySelectorAll('td')]
    expect(payroll[1].textContent).toContain('+57 千人')
    expect(payroll[1].className).toContain('pnl-down')
    expect(payroll[2].textContent).toBe('−72')
    expect(payroll[2].className).toContain('pnl-down')

    const sentiment = [...rows[2].querySelectorAll('td')]
    expect(sentiment[2].textContent).toBe('+4.80')
    expect(sentiment[2].className).toContain('pnl-up')
  })

  it('連 2 期以上才在「連續」欄印字，否則給「—」而非留白', async () => {
    // 核心 CPI 連三期走低；非農只有一期、消費者信心只有兩期，都構不成趨勢
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
    expect(streaks).toEqual(['連 3 期下降', '—', '—'])
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
    // 缺值之後只剩 2.82 → 2.57 一段降幅，連 1 期不成趨勢
    const streaks = [...container.querySelectorAll('.table-scroll > .data-table > tbody > tr')].map(
      (r) => r.querySelectorAll('td')[4].textContent,
    )
    expect(streaks).toEqual(['—', '—', '—'])
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
    // 明細由新到舊，與父表相反（走勢線才由舊到新）
    const detailRows = [...container.querySelectorAll('.detail-row tbody tr')]
    expect(detailRows.map((r) => r.querySelector('td')!.textContent)).toEqual([
      '2026 年 06 月',
      '2026 年 05 月',
    ])

    await user.click(screen.getByRole('button', { name: '全部展開' }))
    expect(container.querySelectorAll('.detail-row')).toHaveLength(3)
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
    // 0.6.11 起 asOf 只在資料真的變動時才跳，月度數據一個月才動一次。
    // 少了這行，畫面上會像是壞掉了。
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
