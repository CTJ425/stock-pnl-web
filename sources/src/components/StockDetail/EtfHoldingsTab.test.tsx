// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

const { fetchEtfHoldings } = vi.hoisted(() => ({ fetchEtfHoldings: vi.fn() }))
vi.mock('../../services/etfHoldingsProxy', () => ({ fetchEtfHoldings }))

import { EtfHoldingsTab } from './EtfHoldingsTab'
import type { EtfHoldingsDay } from '../../services/etfHoldingsProxy'

// 2026-10-12 figures from Yuanta's 0050 page; the stock list is padded to 50 rows.
const stocks = [
  { code: '2330', name: '台積電', shares: 565525249, weight: 56.39 },
  { code: '2454', name: '聯發科', shares: 34056356, weight: 6.18 },
  ...Array.from({ length: 48 }, (_, i) => ({ code: String(3000 + i), name: `股${i}`, shares: 1000, weight: 0.5 })),
]
const day = (over: Partial<EtfHoldingsDay> = {}): EtfHoldingsDay => ({
  tradeDate: '2026-10-12',
  publishedAt: '2026-10-12 16:06:52',
  navTotal: 2553551300844,
  navPerUnit: 114.47,
  unitsOutstanding: 22307000000,
  fundSize: 2547140807580,
  assets: { stock: 2540194490501, etf: 0, bond: 0, futures: 7044587000 },
  stocks,
  futures: [
    { code: 'TX', name: '臺股期貨', contracts: 628, weight: 0.24, month: '202610' },
    { code: 'NYF', name: '台灣50ETF股票期貨', contracts: 738, weight: 0.03, month: '202610' },
  ],
  ...over,
})
const ok = (d: EtfHoldingsDay) => ({
  kind: 'ok',
  data: { etf: '0050', fundName: '元大台灣卓越50基金', sourceUrl: 'https://example.test/0050', updatedAt: '', days: [d] },
})

describe('EtfHoldingsTab', () => {
  beforeEach(() => {
    cleanup()
    fetchEtfHoldings.mockReset()
  })

  it('shows the issuer figures, the data date and the source link', async () => {
    fetchEtfHoldings.mockResolvedValue(ok(day()))
    render(<EtfHoldingsTab etf="0050" />)
    expect((await screen.findAllByText('25,535.51 億')).length).toBeGreaterThan(0)
    expect(screen.getByText(/資料日 2026\/10\/12・元大投信公布（10\/12 16:06 更新）/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '元大官網原始頁面' }).getAttribute('href')).toBe('https://example.test/0050')
    expect(screen.getByText('114.47 元')).toBeTruthy()
    expect(screen.getByText('223.07 億')).toBeTruthy()
    const futures = screen.getByRole('table', { name: '期貨部位' })
    expect(within(futures).getByText('628')).toBeTruthy()
    expect(within(futures).getAllByText('2026/10')).toHaveLength(2)
  })

  it('draws concentration and the top 10 as charts, with all 50 rows one disclosure below', async () => {
    fetchEtfHoldings.mockResolvedValue(ok(day()))
    const { container } = render(<EtfHoldingsTab etf="0050" />)
    const concentration = await screen.findByRole('img', { name: /持股集中度/ })
    expect(concentration.getAttribute('aria-label')).toContain('台積電 56.39%')
    expect(concentration.getAttribute('aria-label')).toContain('第 2–10 名')
    const bars = screen.getByRole('list', { name: '前 10 大持股權重' })
    expect(within(bars).getAllByRole('listitem')).toHaveLength(10)
    // Shared scale: the largest bar is the full track.
    expect((container.querySelector('.etfh-bar-fill') as HTMLElement).style.width).toBe('100%')
    const details = container.querySelector('details.chart-more') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(within(details).getByText('看全部 50 檔明細（股數、權重）')).toBeTruthy()
    const table = within(details).getByRole('table', { hidden: true, name: '股票持股' })
    expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(51)
    expect(within(table).getByText('565,525,249')).toBeTruthy()
    // No row links: 個股分析 can only open held or watched stocks (review BLOCKER, Task 200).
    expect(within(table).queryAllByRole('link', { hidden: true })).toHaveLength(0)
  })

  it('draws the asset mix as one bar and lists zero classes in the legend', async () => {
    fetchEtfHoldings.mockResolvedValue(ok(day()))
    const { container } = render(<EtfHoldingsTab etf="0050" />)
    const assets = await screen.findByRole('img', { name: /資產配置/ })
    expect(assets.getAttribute('aria-label')).toContain('股票 25,401.94 億')
    expect(assets.querySelectorAll('.etfh-seg')).toHaveLength(2)
    expect(container.textContent).toContain('債券')
  })

  it('hides the futures block when the fund holds none', async () => {
    fetchEtfHoldings.mockResolvedValue(ok(day({ futures: [], assets: { stock: 1, etf: 0, bond: 0, futures: 0 } })))
    render(<EtfHoldingsTab etf="0050" />)
    await screen.findByRole('img', { name: /資產配置/ })
    expect(screen.queryByRole('table', { name: '期貨部位' })).toBeNull()
  })

  it('says plainly when there is no file yet, and when reading failed', async () => {
    fetchEtfHoldings.mockResolvedValue({ kind: 'empty' })
    render(<EtfHoldingsTab etf="0050" />)
    expect(await screen.findByText('還沒有這檔 ETF 的成分股資料')).toBeTruthy()
    cleanup()
    fetchEtfHoldings.mockRejectedValue(new Error('net'))
    render(<EtfHoldingsTab etf="0050" />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    cleanup()
    fetchEtfHoldings.mockResolvedValue({ kind: 'invalid' })
    render(<EtfHoldingsTab etf="0050" />)
    expect((await screen.findByRole('alert')).textContent).toContain('格式和網頁對不上')
  })
})
