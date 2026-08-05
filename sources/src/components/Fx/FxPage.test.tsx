// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'

const { fetchFx, fetchFxQuotes } = vi.hoisted(() => ({
  fetchFx: vi.fn(),
  fetchFxQuotes: vi.fn(),
}))
vi.mock('../../services/fxProxy', () => ({ fetchFx }))
vi.mock('../../services/fxQuoteProxy', () => ({ fetchFxQuotes }))

import { FxPage } from './FxPage'
import type { FxData, FxPoint } from '../../services/fxProxy'

/** A sequence of n days from old to new, with the last day fixed at 2026-07-29*/
function series(n: number, from: number, to: number): FxPoint[] {
  const out: FxPoint[] = []
  const end = Date.UTC(2026, 6, 29)
  for (let i = 0; i < n; i++) {
    const d = new Date(end - (n - 1 - i) * 86_400_000)
    out.push([d.toISOString().slice(0, 10), from + ((to - from) * i) / (n - 1)])
  }
  return out
}

/**
 * asOf is always relative to "the current time when the test is executed" and does not include a hard date.
 *
 * Expiration judgment (isStale) compares asOf and new Date(). If the date is hard-coded, these are the cases.
 * It will turn red on its own after 3 days; using vi.useFakeTimers() instead will make testing-library
 * findBy* can never wait (its waitFor is advanced by the real timer), and the entire test hangs directly.
 */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

const fx: FxData = {
  asOf: daysAgo(0),
  base: 'TWD',
  currencies: [
    {
      code: 'USD',
      name: '美元',
      decimals: 3,
      symbol: 'USDTWD=X',
      latest: 32.387,
      prevClose: 32.302,
      points: series(300, 31.5, 32.387),
    },
    {
      code: 'JPY',
      name: '日圓',
      decimals: 4,
      symbol: 'JPYTWD=X',
      latest: 0.1956,
      prevClose: 0.1972,
      points: series(300, 0.21, 0.1956),
    },
  ],
}

describe('FxPage', () => {
  beforeEach(() => {
    fetchFx.mockReset()
    fetchFxQuotes.mockReset()
    // Default "cannot get real-time quotation", and overwrite it in individual cases
    fetchFxQuotes.mockResolvedValue({})
    localStorage.clear()
  })
  afterEach(cleanup)

  it('載入中顯示提示', async () => {
    fetchFx.mockReturnValue(new Promise(() => {}))
    render(<FxPage />)
    expect(await screen.findByText('正在讀取匯率資料…')).toBeTruthy()
  })

  it('查無資料顯示空狀態', async () => {
    fetchFx.mockResolvedValue(null)
    render(<FxPage />)
    expect(await screen.findByText('匯率資料尚未產生。')).toBeTruthy()
  })

  it('列出所有幣別，數字用各自的小數位數', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    expect(await screen.findByText('外幣匯率')).toBeTruthy()
    // USD 3 digits, JPY 4 digits
    expect(screen.getByText('32.387')).toBeTruthy()
    expect(screen.getByText('0.1956')).toBeTruthy()
  })

  it('點卡片切換幣別，走勢圖跟著換', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('美元走勢')
    fireEvent.click(screen.getByRole('button', { name: /日圓 JPY/ }))
    expect(screen.getByText('日圓走勢')).toBeTruthy()
    expect(screen.queryByText('美元走勢')).toBeNull()
  })

  it('選中的幣別記進 localStorage，下次進來還原', async () => {
    fetchFx.mockResolvedValue(fx)
    const first = render(<FxPage />)
    await screen.findByText('美元走勢')
    fireEvent.click(screen.getByRole('button', { name: /日圓 JPY/ }))
    first.unmount()

    render(<FxPage />)
    expect(await screen.findByText('日圓走勢')).toBeTruthy()
  })

  it('記住的幣別已不存在時退回第一個，不是空白畫面', async () => {
    localStorage.setItem('fx.selectedCurrency', 'THB')
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    expect(await screen.findByText('美元走勢')).toBeTruthy()
  })

  it('升貶值用文字說明，不套損益的紅漲綠跌', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('外幣匯率')
    // USD 32.387 > Previous day 32.302 ⇒ You have to pay more to get Taiwan dollar ⇒ Taiwan dollar depreciates
    expect(screen.getByText('台幣貶值')).toBeTruthy()
    // JPY 0.1956 < Previous day 0.1972 ⇒ Taiwan dollar appreciates
    expect(screen.getByText('台幣升值')).toBeTruthy()
  })

  it('切換時間範圍會改變圖上的點數', async () => {
    fetchFx.mockResolvedValue(fx)
    const { container } = render(<FxPage />)
    await screen.findByText('美元走勢')
    /*
      數折線本身的座標數，不要數圓點。
      0.6.8 起超過 20 點就只畫 hover 那一顆圓點（260 顆會把線糊成毛毛蟲），
      圓點數量已經不再等於資料點數 —— 而 polyline 的 points 屬性本來就是更直接的斷言。
      取第一張圖（新臺幣/外幣）即可，兩張同區間點數必然相同。
    */
    const count = () =>
      (container.querySelector('.fx-chart polyline')?.getAttribute('points') ?? '')
        .split(' ')
        .filter(Boolean).length

    const threeMonths = count()
    fireEvent.click(screen.getByRole('tab', { name: '1 年' }))
    expect(count()).toBeGreaterThan(threeMonths)

    fireEvent.click(screen.getByRole('tab', { name: '6 個月' }))
    expect(count()).toBeLessThan(700)
    expect(count()).toBeGreaterThan(threeMonths)
  })

  it('走勢圖有兩個方向，標題各自標明是哪一邊', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('美元走勢')
    fireEvent.click(screen.getByRole('button', { name: /日圓 JPY/ }))

    expect(screen.getByText('新臺幣 / 日圓')).toBeTruthy()
    expect(screen.getByText('日圓 / 新臺幣')).toBeTruthy()
    expect(screen.getByText('1 TWD 可換的日圓')).toBeTruthy()
    expect(screen.getByText('1 JPY 可換的台幣')).toBeTruthy()
  })

  it('兩個方向各畫一張圖（同區間點數相同）', async () => {
    fetchFx.mockResolvedValue(fx)
    const { container } = render(<FxPage />)
    await screen.findByText('美元走勢')
    // Two SVGs in the trend block
    const charts = container.querySelectorAll('.fx-chart svg')
    expect(charts).toHaveLength(2)
  })

  it('反向的數值是正向的倒數，且用適合自己量級的小數位', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('美元走勢')
    fireEvent.click(screen.getByRole('button', { name: /日圓 JPY/ }))

    const texts = screen.getAllByText(/^高 /).map((el) => el.textContent ?? '')
    expect(texts).toHaveLength(2)
    // The reverse (NTD/JPY) magnitude is about 5, and the forward (JPY/NTD) magnitude is about 0.2
    const inv = texts.find((t) => /高 [45]\./.test(t))
    const fwd = texts.find((t) => /高 0\./.test(t))
    expect(inv).toBeTruthy()
    expect(fwd).toBeTruthy()
    // There should be no Infinity or a row of 0's on either side
    expect(texts.join()).not.toContain('Infinity')
    expect(texts.join()).not.toMatch(/高 0（/)
  })

  it('高低點日期在兩張圖上對調（1/x 的必然結果，不是 bug）', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('美元走勢')
    const [invText, fwdText] = screen.getAllByText(/^高 /).map((el) => el.textContent ?? '')
    const dateOf = (s: string, kind: '高' | '低') =>
      new RegExp(`${kind} [\\d.]+（(\\d{4}-\\d{2}-\\d{2})）`).exec(s)?.[1]
    expect(dateOf(invText, '高')).toBe(dateOf(fwdText, '低'))
    expect(dateOf(invText, '低')).toBe(dateOf(fwdText, '高'))
  })

  it('資料在 3 天內不顯示過期警示', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('外幣匯率')
    expect(screen.queryByText(/已超過 3 天未更新/)).toBeNull()
  })

  it('資料超過 3 天顯示過期警示（舊檔與新檔在畫面上長得一樣）', async () => {
    fetchFx.mockResolvedValue({ ...fx, asOf: daysAgo(5) })
    render(<FxPage />)
    expect(await screen.findByText(/已超過 3 天未更新/)).toBeTruthy()
    // Expired does not mean that you cannot view it, the numbers must still be displayed
    expect(screen.getByText('32.387')).toBeTruthy()
  })

  it('標示資料為市場中價、非銀行牌告匯率', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('外幣匯率')
    expect(screen.getByText(/不是銀行牌告匯率/)).toBeTruthy()
  })


  it('有即時報價時卡片顯示即時價，不是每日檔的收盤價', async () => {
    fetchFx.mockResolvedValue(fx)
    fetchFxQuotes.mockResolvedValue({
      USD: { price: 32.478, asOf: new Date().toISOString() },
    })
    render(<FxPage />)
    expect(await screen.findByText('32.478')).toBeTruthy()
    // The closing price of 32.387 should no longer appear on the card
    expect(screen.queryByText('32.387')).toBeNull()
  })

  it('即時價的日變動以每日檔的最後收盤為基期', async () => {
    fetchFx.mockResolvedValue(fx)
    fetchFxQuotes.mockResolvedValue({
      USD: { price: 32.478, asOf: new Date().toISOString() },
    })
    render(<FxPage />)
    await screen.findByText('32.478')
    // (32.478 / 32.387 - 1) * 100 = 0.28%
    expect(screen.getByText('▲ 0.28%')).toBeTruthy()
  })

  it('取不到即時報價時退回收盤價，並在畫面上說明', async () => {
    fetchFx.mockResolvedValue(fx)
    fetchFxQuotes.mockResolvedValue({})
    render(<FxPage />)
    await screen.findByText('外幣匯率')
    expect(screen.getByText('32.387')).toBeTruthy()
    expect(screen.getByText(/取不到即時報價/)).toBeTruthy()
  })

  it('有即時報價時明白標示是即時價、走勢圖是每日收盤', async () => {
    fetchFx.mockResolvedValue(fx)
    fetchFxQuotes.mockResolvedValue({
      USD: { price: 32.478, asOf: new Date().toISOString() },
    })
    render(<FxPage />)
    await screen.findByText('32.478')
    expect(screen.getByText(/市場即時中價/)).toBeTruthy()
    expect(screen.queryByText(/取不到即時報價/)).toBeNull()
  })

  it('只有部分幣別有即時報價時，其餘各自退回收盤價', async () => {
    fetchFx.mockResolvedValue(fx)
    fetchFxQuotes.mockResolvedValue({
      USD: { price: 32.478, asOf: new Date().toISOString() },
    })
    render(<FxPage />)
    await screen.findByText('32.478')
    // There is no real-time quote for JPY, still showing 0.1956 on the daily basis
    expect(screen.getByText('0.1956')).toBeTruthy()
  })

  it('走勢圖不受即時報價影響（歷史仍來自每日檔）', async () => {
    fetchFx.mockResolvedValue(fx)
    fetchFxQuotes.mockResolvedValue({
      USD: { price: 99.999, asOf: new Date().toISOString() },
    })
    const { container } = render(<FxPage />)
    await screen.findByText('99.999')
    const stats = screen.getAllByText(/^高 /).map((el) => el.textContent ?? '')
    expect(stats.join()).not.toContain('99.999')
    expect(container.querySelectorAll('.fx-chart svg')).toHaveLength(2)
  })

  it('按重新整理會強制重抓即時報價（忽略 TTL）', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('外幣匯率')
    fetchFxQuotes.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /重新整理/ }))
    await screen.findByText('外幣匯率')
    expect(fetchFxQuotes).toHaveBeenCalledWith(['USD', 'JPY'], true)
  })
})
