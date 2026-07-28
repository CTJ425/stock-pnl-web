// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'

const { fetchMacro } = vi.hoisted(() => ({ fetchMacro: vi.fn() }))
vi.mock('../../services/macroProxy', () => ({ fetchMacro }))

import { MacroPage } from './MacroPage'
import type { MacroData } from '../../services/macroProxy'

const macro: MacroData = {
  asOf: '2026-07-28T07:33:38.000Z',
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
    const labels = [...document.querySelectorAll('.kpi-label')].map((e) => e.textContent)
    expect(labels).toEqual(['核心 CPI', '非農就業', '消費者信心'])
    const values = [...document.querySelectorAll('.kpi-value')].map((e) => e.textContent)
    // % / 千人 / 指數 三種口徑各自成立
    expect(values).toEqual(['+2.57%', '+57 千人', '44.8'])
  })

  it('標示資料產出時間', async () => {
    fetchMacro.mockResolvedValue(macro)
    render(<MacroPage />)
    expect(await screen.findByText(/資料更新於 2026-07-28 \d{2}:\d{2}/)).toBeTruthy()
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
