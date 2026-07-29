// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'

const { fetchFx } = vi.hoisted(() => ({ fetchFx: vi.fn() }))
vi.mock('../../services/fxProxy', () => ({ fetchFx }))

import { FxPage } from './FxPage'
import type { FxData, FxPoint } from '../../services/fxProxy'

/** 由舊到新的 n 天序列，最後一天固定為 2026-07-29 */
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
 * asOf 一律相對於「執行測試的當下」，不寫死日期。
 *
 * 過期判斷（isStale）比的是 asOf 與 new Date()，寫死日期的話這幾個案例
 * 過了 3 天就會自己變紅；而改用 vi.useFakeTimers() 會讓 testing-library 的
 * findBy* 永遠等不到（它的 waitFor 靠真實 timer 推進），整支測試直接掛住。
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

const twdInput = () => screen.getByLabelText('新台幣 TWD') as HTMLInputElement

describe('FxPage', () => {
  beforeEach(() => {
    fetchFx.mockReset()
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
    // USD 3 位、JPY 4 位
    expect(screen.getByText('32.387')).toBeTruthy()
    expect(screen.getByText('0.1956')).toBeTruthy()
  })

  it('預設選第一個幣別，換算器帶入預設金額', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    expect(await screen.findByText('台幣 ⇄ 美元')).toBeTruthy()
    expect(twdInput().value).toBe('1000')
    // 1000 / 32.387 = 30.8766…
    expect((screen.getByLabelText('美元 USD') as HTMLInputElement).value).toBe('30.88')
  })

  it('改台幣金額，外幣即時換算', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('台幣 ⇄ 美元')
    fireEvent.change(twdInput(), { target: { value: '32387' } })
    expect((screen.getByLabelText('美元 USD') as HTMLInputElement).value).toBe('1,000.00')
  })

  it('改外幣金額，台幣反向換算', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('台幣 ⇄ 美元')
    fireEvent.change(screen.getByLabelText('美元 USD'), { target: { value: '100' } })
    expect(twdInput().value).toBe('3,238.70')
  })

  it('使用者輸入到一半的小數點不會被改寫（游標會跳掉）', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('台幣 ⇄ 美元')
    fireEvent.change(twdInput(), { target: { value: '12.' } })
    expect(twdInput().value).toBe('12.')
  })

  it('清空輸入時另一邊也是空的，不填 0', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('台幣 ⇄ 美元')
    fireEvent.change(twdInput(), { target: { value: '' } })
    expect((screen.getByLabelText('美元 USD') as HTMLInputElement).value).toBe('')
  })

  it('點卡片切換幣別，換算器與走勢圖跟著換', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('台幣 ⇄ 美元')
    fireEvent.click(screen.getByRole('button', { name: /日圓 JPY/ }))
    expect(screen.getByText('台幣 ⇄ 日圓')).toBeTruthy()
    expect(screen.getByText('日圓走勢')).toBeTruthy()
  })

  it('選中的幣別記進 localStorage，下次進來還原', async () => {
    fetchFx.mockResolvedValue(fx)
    const first = render(<FxPage />)
    await screen.findByText('台幣 ⇄ 美元')
    fireEvent.click(screen.getByRole('button', { name: /日圓 JPY/ }))
    first.unmount()

    render(<FxPage />)
    expect(await screen.findByText('台幣 ⇄ 日圓')).toBeTruthy()
  })

  it('記住的幣別已不存在時退回第一個，不是空白畫面', async () => {
    localStorage.setItem('fx.selectedCurrency', 'THB')
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    expect(await screen.findByText('台幣 ⇄ 美元')).toBeTruthy()
  })

  it('升貶值用文字說明，不套損益的紅漲綠跌', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('外幣匯率')
    // USD 32.387 > 前一日 32.302 ⇒ 台幣要付更多才換得到 ⇒ 台幣貶值
    expect(screen.getByText('台幣貶值')).toBeTruthy()
    // JPY 0.1956 < 前一日 0.1972 ⇒ 台幣升值
    expect(screen.getByText('台幣升值')).toBeTruthy()
  })

  it('切換時間範圍會改變圖上的點數', async () => {
    fetchFx.mockResolvedValue(fx)
    const { container } = render(<FxPage />)
    await screen.findByText('美元走勢')
    const count = () => container.querySelectorAll('svg circle').length

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
    // 走勢區塊內兩張 SVG
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
    // 反向（新臺幣/日圓）量級約 5，正向（日圓/新臺幣）量級約 0.2
    const inv = texts.find((t) => /高 [45]\./.test(t))
    const fwd = texts.find((t) => /高 0\./.test(t))
    expect(inv).toBeTruthy()
    expect(fwd).toBeTruthy()
    // 兩邊都不該出現 Infinity 或一整排 0
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
    // 過期不等於不能看，數字仍要顯示
    expect(screen.getByText('32.387')).toBeTruthy()
  })

  it('標示資料為市場中價、非銀行牌告匯率', async () => {
    fetchFx.mockResolvedValue(fx)
    render(<FxPage />)
    await screen.findByText('外幣匯率')
    expect(screen.getByText(/不是銀行牌告匯率/)).toBeTruthy()
  })

  it('匯率缺值時不顯示 Infinity', async () => {
    fetchFx.mockResolvedValue({
      ...fx,
      currencies: [{ ...fx.currencies[0], latest: null, prevClose: null }],
    })
    render(<FxPage />)
    await screen.findByText('台幣 ⇄ 美元')
    expect(document.body.textContent).not.toContain('Infinity')
    expect(document.body.textContent).not.toContain('NaN')
    expect((screen.getByLabelText('美元 USD') as HTMLInputElement).value).toBe('')
  })
})
