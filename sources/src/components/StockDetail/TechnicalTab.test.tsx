// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TechnicalTab } from './TechnicalTab'
import type { DailySeries, RemoteDaily } from '../../services/dailyProxy'
import { fetchRemoteDaily } from '../../services/dailyProxy'

vi.mock('../../services/dailyProxy', async (importActual) => ({
  ...(await importActual<typeof import('../../services/dailyProxy')>()),
  fetchRemoteDaily: vi.fn(),
}))

const mockRemote = vi.mocked(fetchRemoteDaily)

afterEach(cleanup)
beforeEach(() => {
  mockRemote.mockReset()
})

function makeDailySeries(count = 60): DailySeries {
  const rows: DailySeries['rows'] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
    const close = 100 + i * 2
    const volume = (1000 + i * 50) * 1000 // shares
    rows.push([d, close - 1, close + 2, close - 2, close, volume])
  }
  return {
    ticker: '2330',
    asOf: '2026-08-07T09:00:00.000Z',
    lastDate: rows[rows.length - 1][0],
    rows,
  }
}

describe('TechnicalTab', () => {
  it('成交量表格採用 inst-matrix 樣式，包含 5 欄表頭與表尾 4 張走勢圖', () => {
    const series = makeDailySeries(60)
    render(<TechnicalTab ticker="2330" status="ready" series={series} />)

    const table = screen.getByRole('table', { name: '每日成交量矩陣' })
    expect(table.className).toContain('inst-matrix')

    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(headers).toEqual(['日期', '成交量', '量比', '收盤價', '漲跌幅'])

    // Body rows
    const rows = table.querySelectorAll('tbody tr')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].querySelectorAll('td.num')).toHaveLength(4)

    // Footer
    const tfoot = table.querySelector('tfoot')
    expect(tfoot).toBeTruthy()
    expect(tfoot?.querySelectorAll('.mac-spark')).toHaveLength(4)
    expect(table.textContent).toContain('日增量')
    expect(table.textContent).toContain('日上漲')
  })

  it('支援展開顯示全部交易日與收合', async () => {
    const user = userEvent.setup()
    const series = makeDailySeries(40)
    render(<TechnicalTab ticker="2330" status="ready" series={series} />)

    // 預設區間是「近 1 月」＝ 20 根，展開鈕不會出現。先切到「近 1 年」拿到全部 40 根。
    await user.click(screen.getByRole('button', { name: '近 1 年' }))

    const table = screen.getByRole('table', { name: '每日成交量矩陣' })
    // Initially collapsed to 20 rows
    expect(table.querySelectorAll('tbody tr')).toHaveLength(20)

    const toggleBtn = screen.getByRole('button', { name: /顯示全部/ })
    await user.click(toggleBtn)

    // Expanded to all 40 rows
    expect(table.querySelectorAll('tbody tr')).toHaveLength(40)

    await user.click(screen.getByRole('button', { name: /只顯示近 20 筆/ }))
    expect(table.querySelectorAll('tbody tr')).toHaveLength(20)
  })

  it('區間選擇器提供六個區間，且沒有近 3 月', () => {
    const series = makeDailySeries(60)
    render(<TechnicalTab ticker="2330" status="ready" series={series} />)

    const group = screen.getByRole('group', { name: '選擇顯示區間' })
    const labels = [...group.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toEqual(['近 1 月', '近 6 月', '本年迄今', '近 1 年', '近 5 年', '全部'])
  })
})

describe('TechnicalTab 長區間', () => {
  /**
   * 造 n 根遠端列。用**年份**當標記，不要用收盤價 ——
   * 成交量欄位會把 2,500,000 股印成「2,500 張」，收盤價 500 會在表格文字裡撞上它。
   */
  function makeRemote(n: number, year: number, granularity: '1d' | '1mo'): RemoteDaily {
    const rows: RemoteDaily['rows'] = []
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.UTC(year, 0, 1) + i * 86400000).toISOString().slice(0, 10)
      rows.push([d, 100, 101, 99, 100, 1_000_000])
    }
    return { rows, granularity }
  }

  it('切到近 5 年時改用 Edge Function 的列，不用檔案的列', async () => {
    const user = userEvent.setup()
    mockRemote.mockResolvedValue(makeRemote(300, 2018, '1d'))
    render(<TechnicalTab ticker="2330" status="ready" series={makeDailySeries(60)} />)

    await user.click(screen.getByRole('button', { name: '近 5 年' }))

    await waitFor(() => expect(mockRemote).toHaveBeenCalledWith('2330', '5y'))
    const table = await screen.findByRole('table', { name: '每日成交量矩陣' })
    // 檔案那批是 2026 年，遠端這批是 2018 年
    expect(table.textContent).toContain('2018-')
  })

  it('近 5 年切到全部時不可沿用前一個區間的列', async () => {
    // 這是最容易寫錯的地方：效果只在「非遠端區間」清掉舊資料的話，
    // 5y → 全部 會把 5y 的列掛在「全部」標籤下畫出來，而且不出現載入指示。
    const user = userEvent.setup()
    let resolveMax: ((v: RemoteDaily) => void) | null = null
    mockRemote.mockImplementation((_t, range) =>
      range === '5y'
        ? Promise.resolve(makeRemote(300, 2018, '1d'))
        : new Promise<RemoteDaily>((res) => {
            resolveMax = res
          }),
    )

    render(<TechnicalTab ticker="2330" status="ready" series={makeDailySeries(60)} />)
    await user.click(screen.getByRole('button', { name: '近 5 年' }))
    await screen.findByRole('table', { name: '每日成交量矩陣' })

    // 「全部」的回應還沒回來
    await user.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.queryByRole('table', { name: '每日成交量矩陣' })).toBeNull()
    expect(screen.getByText('正在讀取歷史股價…')).toBeTruthy()

    resolveMax!(makeRemote(120, 2015, '1mo'))
    const table = await screen.findByRole('table', { name: '每日成交量矩陣' })
    expect(table.textContent).toContain('2015-')
    expect(table.textContent).not.toContain('2018-')
  })

  it('遠端讀取失敗時說明是長區間失敗，不是整頁失敗', async () => {
    const user = userEvent.setup()
    mockRemote.mockResolvedValue(null)
    render(<TechnicalTab ticker="2330" status="ready" series={makeDailySeries(60)} />)

    await user.click(screen.getByRole('button', { name: '全部' }))

    expect(await screen.findByText('讀取長區間股價失敗，請稍後再試。')).toBeTruthy()
  })

  it('切回近 1 年時不再打 Edge Function，改用檔案的列', async () => {
    const user = userEvent.setup()
    mockRemote.mockResolvedValue(makeRemote(300, 2018, '1d'))
    render(<TechnicalTab ticker="2330" status="ready" series={makeDailySeries(60)} />)

    await user.click(screen.getByRole('button', { name: '近 5 年' }))
    await waitFor(() => expect(mockRemote).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: '近 1 年' }))
    const table = await screen.findByRole('table', { name: '每日成交量矩陣' })
    expect(table.textContent).not.toContain('2018-')
    expect(mockRemote).toHaveBeenCalledTimes(1)
  })
})
