// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const { useWorkspace, fetchFundamental } = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
  fetchFundamental: vi.fn(),
}))
vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))
vi.mock('../../services/fundamentalProxy', () => ({ fetchFundamental }))

import { HoldingProfitSection } from './HoldingProfitSection'

/** 只有元件真正讀到的欄位；其餘 Holding 欄位對這一區沒有意義 */
function holding(key: string, ticker: string, name: string, market: 'TPE' | 'US') {
  return { key, ticker, name, market }
}

function quarter(yq: string, gross: number) {
  return {
    yearQuarter: yq,
    revenueMillionTwd: 1000,
    grossMarginPercent: gross,
    operatingMarginPercent: gross - 10,
    pretaxMarginPercent: gross - 9,
    netMarginPercent: gross - 14,
  }
}

describe('HoldingProfitSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspace.mockReturnValue({
      ledger: {
        holdings: [
          holding('TPE:2330', '2330', '台積電', 'TPE'),
          holding('TPE:0050', '0050', '元大台灣50', 'TPE'),
          holding('US:AAPL', 'AAPL', 'Apple Inc.', 'US'),
        ],
      },
    })
    fetchFundamental.mockImplementation(async (ticker: string) =>
      ticker === '2330'
        ? { profitQuarters: [quarter('2025-Q4', 57.1), quarter('2026-Q1', 59.2)] }
        : null,
    )
  })
  afterEach(cleanup)

  it('一列一檔，四項利率各一欄', async () => {
    render(<HoldingProfitSection />)
    await screen.findByText('台積電')
    const heads = [...document.querySelectorAll('thead th')].map((e) => e.textContent)
    expect(heads).toEqual(['持股', '最新季別', '毛利率', '營益率', '稅前純益率', '稅後純益率'])
    expect(document.querySelectorAll('tbody tr')).toHaveLength(3)
  })

  it('數值不帶正負號——毛利率不是變化量，掛 + 會讀成「比上季多 59%」', async () => {
    render(<HoldingProfitSection />)
    expect(await screen.findByText('59.20%')).toBeTruthy()
    expect(screen.queryByText('+59.20%')).toBeNull()
  })

  it('美股與 ETF 顯示「—」，而且不對它們發請求', async () => {
    render(<HoldingProfitSection />)
    await screen.findByText('台積電')
    // 只有台股會被查；0050 是台股故仍會查，AAPL 不查
    await waitFor(() => expect(fetchFundamental).toHaveBeenCalledWith('2330'))
    expect(fetchFundamental).toHaveBeenCalledWith('0050')
    expect(fetchFundamental).not.toHaveBeenCalledWith('AAPL')

    const rows = [...document.querySelectorAll('tbody tr')]
    const aapl = rows.find((r) => r.textContent?.includes('AAPL'))!
    expect(aapl.textContent).toContain('—')
  })

  it('有資料的那一列畫四條走勢線', async () => {
    render(<HoldingProfitSection />)
    await screen.findByText('台積電')
    expect(document.querySelectorAll('.hp-spark polyline')).toHaveLength(4)
  })

  it('標題列出最新季別', async () => {
    render(<HoldingProfitSection />)
    expect(await screen.findByText(/最新季別 2026 Q1/)).toBeTruthy()
  })

  it('全部持股都沒有季報時走空狀態，並說明為什麼是空的', async () => {
    fetchFundamental.mockResolvedValue(null)
    render(<HoldingProfitSection />)
    expect(await screen.findByText('持股的季度獲利能力尚未產生。')).toBeTruthy()
    expect(screen.getByText(/若你的持股都是 ETF 或美股/)).toBeTruthy()
  })

  it('沒有持股時也不報錯，直接走空狀態', async () => {
    useWorkspace.mockReturnValue({ ledger: { holdings: [] } })
    render(<HoldingProfitSection />)
    expect(await screen.findByText('持股的季度獲利能力尚未產生。')).toBeTruthy()
    expect(fetchFundamental).not.toHaveBeenCalled()
  })
})
