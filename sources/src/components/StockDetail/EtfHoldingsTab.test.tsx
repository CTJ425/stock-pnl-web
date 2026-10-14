// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

const { fetchEtfHoldings } = vi.hoisted(() => ({ fetchEtfHoldings: vi.fn() }))
vi.mock('../../services/etfHoldingsProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/etfHoldingsProxy')>()),
  fetchEtfHoldings,
}))

import { EtfHoldingsTab } from './EtfHoldingsTab'
import type { EtfHoldingsDay } from '../../services/etfHoldingsProxy'

// 2026-10-12 figures from Yuanta's 0050 page; the stock list is padded to 50 rows.
const stocks = [
  { code: '2330', name: '台積電', shares: 565525249, weight: 56.39, market: 'TW' },
  { code: '2454', name: '聯發科', shares: 34056356, weight: 6.18, market: 'TW' },
  ...Array.from({ length: 48 }, (_, i) => ({ code: String(3000 + i), name: `股${i}`, shares: 1000, weight: 0.5, market: 'TW' })),
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
  data: { etf: '0050', fundName: '元大台灣卓越50基金', issuer: 'yuanta', sourceUrl: 'https://example.test/0050', updatedAt: '', days: [d] },
})

describe('EtfHoldingsTab', () => {
  beforeEach(() => {
    cleanup()
    fetchEtfHoldings.mockReset()
  })

  it('shows the issuer figures, the data date and the source link', async () => {
    fetchEtfHoldings.mockResolvedValue(ok(day()))
    render(<EtfHoldingsTab etf="0050" name="元大台灣50" />)
    expect((await screen.findAllByText('25,535.51 億')).length).toBeGreaterThan(0)
    expect(screen.getByText(/資料日 2026\/10\/12・元大投信公布（10\/12 16:06 更新）/)).toBeTruthy()
    // A Taiwan-only fund gets no market split.
    expect(screen.queryByRole('img', { name: /市場分布/ })).toBeNull()
    expect(screen.getByRole('link', { name: '元大投信官網原始頁面' }).getAttribute('href')).toBe('https://example.test/0050')
    expect(screen.getByText('114.47 元')).toBeTruthy()
    expect(screen.getByText('223.07 億')).toBeTruthy()
    const futures = screen.getByRole('table', { name: '期貨部位' })
    expect(within(futures).getByText('628')).toBeTruthy()
    expect(within(futures).getAllByText('2026/10')).toHaveLength(2)
  })

  it('draws concentration and the top 10 as charts, with all 50 rows one disclosure below', async () => {
    fetchEtfHoldings.mockResolvedValue(ok(day()))
    const { container } = render(<EtfHoldingsTab etf="0050" name="元大台灣50" />)
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
    const { container } = render(<EtfHoldingsTab etf="0050" name="元大台灣50" />)
    const assets = await screen.findByRole('img', { name: /資產配置/ })
    expect(assets.getAttribute('aria-label')).toContain('股票 25,401.94 億')
    expect(assets.querySelectorAll('.etfh-seg')).toHaveLength(2)
    expect(container.textContent).toContain('債券')
  })

  it('hides the futures block when the fund holds none', async () => {
    fetchEtfHoldings.mockResolvedValue(ok(day({ futures: [], assets: { stock: 1, etf: 0, bond: 0, futures: 0 } })))
    render(<EtfHoldingsTab etf="0050" name="元大台灣50" />)
    await screen.findByRole('img', { name: /資產配置/ })
    expect(screen.queryByRole('table', { name: '期貨部位' })).toBeNull()
  })

  it('says plainly when there is no file yet, and when reading failed', async () => {
    fetchEtfHoldings.mockResolvedValue({ kind: 'empty' })
    render(<EtfHoldingsTab etf="0050" name="元大台灣50" />)
    expect(await screen.findByText('還沒有這檔 ETF 的成分股資料')).toBeTruthy()
    cleanup()
    fetchEtfHoldings.mockRejectedValue(new Error('net'))
    render(<EtfHoldingsTab etf="0050" name="元大台灣50" />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    cleanup()
    fetchEtfHoldings.mockResolvedValue({ kind: 'invalid' })
    render(<EtfHoldingsTab etf="0050" name="元大台灣50" />)
    expect((await screen.findByRole('alert')).textContent).toContain('格式和網頁對不上')
  })

  it('says an unsupported issuer is not connected yet when there is no file', async () => {
    fetchEtfHoldings.mockResolvedValue({ kind: 'empty' })
    render(<EtfHoldingsTab etf="00878" name="國泰永續高股息" />)
    expect(await screen.findByText('國泰投信的成分股資料尚未串接')).toBeTruthy()
    expect(document.body.textContent).toContain('目前只接上元大投信、中國信託投信、群益投信；其他投信會一家一家加入。')
    cleanup()
    render(<EtfHoldingsTab etf="00999" name="某某ETF" />)
    expect(await screen.findByText('這檔 ETF 的投信成分股資料尚未串接')).toBeTruthy()
  })

  it('shows the file even when the name the user typed names no issuer (review RISK 1)', async () => {
    fetchEtfHoldings.mockResolvedValue(ok(day()))
    render(<EtfHoldingsTab etf="0050" name="台灣50" />)
    expect((await screen.findAllByText('25,535.51 億')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/尚未串接/)).toBeNull()
  })

  it('draws a market split for a cross-border fund and drops the asset bar when no NT$ totals exist', async () => {
    const cross = day({
      stocks: [
        { code: '3037', name: '欣興電子', shares: 999600, weight: 11.44, market: 'TW' },
        { code: '4062', name: 'Ibiden Co Ltd', shares: 465500, weight: 9.77, market: 'JP' },
        { code: '007660', name: 'Isu Petasys', shares: 1, weight: 3.1, market: 'KR' },
      ],
      futures: [],
      assets: null,
      fundSize: 10304880295,
      navTotal: 10304880295,
      publishedAt: null,
    })
    fetchEtfHoldings.mockResolvedValue({ kind: 'ok', data: { ...ok(cross).data, etf: '009828', issuer: 'ctbc' } })
    render(<EtfHoldingsTab etf="009828" name="中信台日韓PCB" />)
    const markets = await screen.findByRole('img', { name: /市場分布/ })
    expect(markets.getAttribute('aria-label')).toBe('市場分布：台灣 11.44%、日本 9.77%、韓國 3.10%、股票以外 75.69%')
    expect(screen.getByRole('link', { name: '中國信託投信官網原始頁面' })).toBeTruthy()
    expect(screen.queryByRole('img', { name: /資產配置/ })).toBeNull()
    expect(screen.getByText(/資料日 2026\/10\/12・中國信託投信公布，/)).toBeTruthy()
  })

  it('draws a futures-led fund (00685L) as exposure bars instead of stock charts', async () => {
    const lev = day({
      stocks: [],
      futures: [{ code: 'TX', name: '台指期', contracts: 15866, weight: 200.9432, month: '202610' }],
      assets: null,
      publishedAt: null,
    })
    fetchEtfHoldings.mockResolvedValue({ kind: 'ok', data: { ...ok(lev).data, etf: '00685L', issuer: 'capital' } })
    const { container } = render(<EtfHoldingsTab etf="00685L" name="群益臺灣加權正2" />)
    const bars = await screen.findByRole('list', { name: '期貨曝險權重' })
    expect(within(bars).getByText('200.94%')).toBeTruthy()
    expect(container.textContent).toContain('權重超過 100% 代表期貨部位比基金規模還大（槓桿）')
    // One futures line: its published weight is shown, nothing is summed.
    expect(container.textContent).not.toContain('合計')
    // The bar fills the track (scale = the largest weight); the 100 % mark sits just under half way.
    expect((container.querySelector('.etfh-bar-fill') as HTMLElement).style.width).toBe('100%')
    expect((container.querySelector('.etfh-bar-mark') as HTMLElement).style.left).toMatch(/^49\.7/)
    expect(screen.queryByRole('img', { name: /持股集中度/ })).toBeNull()
    expect(screen.queryByRole('list', { name: /前 \d+ 大持股權重/ })).toBeNull()
    expect(screen.getAllByText(/群益投信公布/).length).toBeGreaterThan(0)
  })

  it('marks an inverse futures line and keeps a 1-stock + futures fund (00631L) on the exposure view', async () => {
    const mixed = day({
      stocks: [{ code: '2330', name: '台積電', shares: 1000, weight: 3.2, market: 'TW' }],
      futures: [
        { code: 'TX', name: '臺股期貨', contracts: 900, weight: 150.4, month: '202610' },
        { code: 'TX', name: '臺股期貨', contracts: 10, weight: -1.1, month: '202611' },
      ],
      assets: null,
      publishedAt: null,
    })
    fetchEtfHoldings.mockResolvedValue({ kind: 'ok', data: { ...ok(mixed).data, etf: '00631L' } })
    const { container } = render(<EtfHoldingsTab etf="00631L" name="元大台灣50正2" />)
    await screen.findByRole('list', { name: '期貨曝險權重' })
    expect(screen.queryByRole('img', { name: /持股集中度/ })).toBeNull()
    expect(container.textContent).toContain('期貨權重合計 149.30%（本站相加）')
    expect(container.textContent).toContain('負的權重代表反向')
    expect(screen.getByText('反向')).toBeTruthy()
    expect(container.querySelectorAll('.etfh-bar-fill-inverse')).toHaveLength(1)
    expect(screen.getByText('看股票部位（1 檔）')).toBeTruthy()
  })

  it('keeps a stock fund with a small futures hedge on the stock charts', async () => {
    fetchEtfHoldings.mockResolvedValue(ok(day()))
    render(<EtfHoldingsTab etf="0050" name="元大台灣50" />)
    expect(await screen.findByRole('img', { name: /持股集中度/ })).toBeTruthy()
    expect(screen.queryByRole('list', { name: '期貨曝險權重' })).toBeNull()
  })
})
