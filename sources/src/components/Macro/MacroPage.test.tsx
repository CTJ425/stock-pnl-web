// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'

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

  it('每個指標一格 KPI，值帶自己的單位', async () => {
    fetchMacro.mockResolvedValue(macro)
    render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    // 標籤取第一個文字節點：落後的指標會在同一列多掛一個徽章
    const labels = [...document.querySelectorAll('.kpi-label')].map((e) => e.firstChild?.textContent)
    expect(labels).toEqual(['核心 CPI', '非農就業', '消費者信心'])
    const values = [...document.querySelectorAll('.kpi-value')].map((e) => e.textContent)
    // % / 千人 / 指數 三種口徑各自成立
    expect(values).toEqual(['+2.57%', '+57 千人', '44.8'])
  })

  it('落後的指標掛徽章，跟上的不掛——五張卡都寫「最新」等於沒有訊號', async () => {
    fetchMacro.mockResolvedValue(macro)
    render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    // 三個指標的最新期別：CPI 與非農同為 2026-06，消費者信心停在 2026-05
    const badges = [...document.querySelectorAll('.mac-behind')].map((e) => e.textContent)
    expect(badges).toEqual(['落後 1 期'])
  })

  it('指標卡不再有走勢線（0.6.34）', async () => {
    fetchMacro.mockResolvedValue(macro)
    render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    expect(document.querySelectorAll('.kpi .mac-spark')).toHaveLength(0)
  })

  it('連 2 期以上才給「連續」chip，且不套漲跌色——升降本身無好壞之分', async () => {
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
    render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    const chips = [...document.querySelectorAll('.mac-streak')]
    expect(chips.map((e) => e.textContent)).toEqual(['連 3 期下降'])
    expect(chips[0].className).not.toMatch(/pnl-(up|down)/)
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
    render(<MacroPage />)
    await screen.findByText('美國總體經濟')
    // 缺值之後只剩 2.82 → 2.57 一段降幅，連 1 期不成趨勢
    expect(document.querySelectorAll('.mac-streak')).toHaveLength(0)
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

  it('走勢表以期別聯集為列，某指標缺該期時填「—」而非錯位', async () => {
    fetchMacro.mockResolvedValue(macro)
    render(<MacroPage />)
    await screen.findByText('近期走勢')
    const rows = [...document.querySelectorAll('.data-table tbody tr')]
    // 期別聯集 = 2026-04 / 2026-05 / 2026-06，由新到舊
    expect(rows.map((r) => r.querySelector('td')!.textContent)).toEqual([
      '2026 年 06 月',
      '2026 年 05 月',
      '2026 年 04 月',
    ])
    // 2026-04 那列只有消費者信心有值
    const apr = [...rows[2].querySelectorAll('td')].map((e) => e.textContent)
    expect(apr).toEqual(['2026 年 04 月', '—', '—', '49.8'])
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
