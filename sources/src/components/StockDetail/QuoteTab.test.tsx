// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { QuoteTab, quoteMeta } from './QuoteTab'
import type { PriceQuote } from '../../services/priceProxy'
import type { IntradaySeries } from '../../../supabase/functions/stock-price/intradayParse'
import type { ChipDay, ReportHolding } from '../../services/reportProxy'
import type { TechnicalView } from './technicalView'

/**
 * 0.9.17 (quote-yahoo-a): the card's seven `.rpt-card` boxes became a Yahoo-style header
 * (big price + 漲跌 + 交易日戳記) above an 8-cell statistics grid, with the intraday chart
 * and a right-hand rail below it.
 *
 * What the old seven-box test protected and this one still must:
 *   - 開高低量 that cannot be fetched show `—`, never `0` (the backup price path has no OHLCV);
 *   - a volume of 0 張 is a real answer and stays distinguishable from `—`;
 *   - during 試撮 the price is a **simulated matching price, not a trade**, and the card has to
 *     say so — that is what the old 預估 box existed for, and it is now a marker on the header.
 *
 * New in revision 3: 均價 and 成交金額 are derived from the intraday series, and the three
 * valuation numbers arrive from the fundamentals batch — a **different trading day** from the
 * live price beside them, which is why the 估值資料日 footnote is asserted here as behaviour.
 */
const fetchIntradayMock = vi.hoisted(() =>
  vi.fn<() => Promise<IntradaySeries | null>>(async () => null),
)
vi.mock('../../services/intradayProxy', () => ({ fetchIntraday: fetchIntradayMock }))

/** 2026-08-05 2330 measured response after closing */
const closedQuote: PriceQuote = {
  price: 2405,
  prevClose: 2320,
  open: 2385,
  high: 2415,
  low: 2370,
  volume: 31851,
  tradeDate: '20260805',
  tradeTime: '13:30:00',
  trial: false,
  asOf: '2026-08-05T07:30:00.000Z',
  source: 'edge',
  stale: false,
}

/**
 * VWAP = (2400×1000 + 2410×2000 + 2405×1000) / 4000 = 2406.25.
 * 成交金額 = 2406.25 × 31,851 張 × 1000 股 = 76,641,468,750 → 766.41 億.
 */
const series: IntradaySeries = {
  symbol: '2330.TW',
  range: '1d',
  interval: '1m',
  prevClose: 2320,
  points: [
    { t: 1786000000, c: 2400, v: 1000 },
    { t: 1786000060, c: 2410, v: 2000 },
    { t: 1786000120, c: 2405, v: 1000 },
  ],
}

/**
 * A position whose `unrealized` is deliberately NOT `qty × (price − avgCost)`
 * (that would be 3000 × (2405 − 2000) = 1,215,000). The card must print what it is
 * given: the page carries three different cost bases, and re-deriving here produces a
 * number that disagrees with 庫存總覽 for the very same position.
 */
const holding: ReportHolding = {
  qty: 3000,
  avgCost: 2000,
  price: 2405,
  unrealized: 999_111,
  roi: 0.1666,
}

const mockHistory: ChipDay[] = [
  {
    date: '2026-08-04',
    institutional: {
      foreign: { buy: 1000000, sell: 3000000, net: -2000000 },
      foreignDealer: { buy: 0, sell: 0, net: 0 },
      trust: { buy: 800000, sell: 300000, net: 500000 },
      dealer: { buy: 400000, sell: 500000, net: -100000 },
      total: { buy: 2200000, sell: 3800000, net: -1600000 },
    },
    margin: null,
  },
  {
    date: '2026-08-05',
    institutional: {
      foreign: { buy: 5000000, sell: 2000000, net: 3000000 },
      foreignDealer: { buy: 0, sell: 0, net: 0 },
      trust: { buy: 1500000, sell: 500000, net: 1000000 },
      dealer: { buy: 700000, sell: 200000, net: 500000 },
      total: { buy: 7200000, sell: 2700000, net: 4500000 },
    },
    margin: null,
  },
]

const latest = {
  date: '2026-08-04',
  ma5: 2358,
  ma20: 2301,
  ma60: 2187,
  k: 82.4,
  d: 74.1,
  bbUpper: 2412,
  bbMid: 2301,
  bbLower: 2190,
  rsi14: 66.2,
  macdHist: 12.4,
  volRatio: 1.21,
  alignment: '多頭排列',
} as unknown as TechnicalView['latest']

const show = (
  quote: PriceQuote | null,
  opts: {
    holding?: ReportHolding | null
    latest?: TechnicalView['latest'] | null
    history?: ChipDay[] | null
  } = {},
) =>
  render(
    <QuoteTab
      quote={quote}
      ticker="2330"
      name="台積電"
      holding={opts.holding ?? null}
      latest={opts.latest ?? null}
      history={opts.history ?? null}
    />,
  )

const aside = () => document.querySelector('.quote-aside')

/** Only the statistics grid — the rail deliberately does not reuse `.rpt-card`. */
const cells = () =>
  [...document.querySelectorAll('.m-stats .rpt-card')].map((el) => ({
    k: within(el as HTMLElement).getByText(/.+/, { selector: '.k' }).textContent,
    v: (el.querySelector('.v') as HTMLElement).textContent,
  }))

const cellMap = () => Object.fromEntries(cells().map((c) => [c.k, c.v]))

describe('QuoteTab', () => {
  beforeEach(() => {
    cleanup()
    fetchIntradayMock.mockReset()
    fetchIntradayMock.mockResolvedValue(null)
  })

  it('收盤後：統計格是 4×2 八格，沒有空格', () => {
    show(closedQuote)
    expect(cells()).toEqual([
      { k: '成交量', v: '31,851 張' },
      { k: '開盤', v: 'NT$2,385.00' },
      { k: '最高', v: 'NT$2,415.00' },
      { k: '最低', v: 'NT$2,370.00' },
      { k: '昨收', v: 'NT$2,320.00' },
      { k: '均價', v: '—' },
      { k: '漲跌幅', v: '+3.66%' },
      { k: '振幅', v: '1.94%' },
    ])
  })

  it('有分時資料時，均價是累計 VWAP 的最後一點', async () => {
    fetchIntradayMock.mockResolvedValue(series)
    show(closedQuote)
    await waitFor(() => expect(cellMap()['均價']).toBe('NT$2,406.25'))
    expect(cells()).toHaveLength(8)
  })

  it('成交價高於昨收 → 價格與漲跌都是紅色（台灣看盤習慣）', () => {
    const { container } = show(closedQuote)
    expect(container.querySelector('.m-price .big')?.className).toContain('pnl-up')
    expect(container.querySelector('.m-price .delta')?.className).toContain('pnl-up')
    expect(container.querySelector('.m-price .big')?.textContent).toBe('NT$2,405.00')
  })

  it('成交價低於昨收 → 綠色', () => {
    const { container } = show({ ...closedQuote, price: 2300 })
    expect(container.querySelector('.m-price .big')?.className).toContain('pnl-down')
  })

  it('交易日戳記標出收盤或盤中', () => {
    const { container } = show(closedQuote)
    expect(container.querySelector('.m-price .stamp')?.textContent).toContain('收盤')

    cleanup()
    const intraday = show({ ...closedQuote, tradeTime: '11:05:23' })
    expect(intraday.container.querySelector('.m-price .stamp')?.textContent).toContain('盤中')
  })

  it('沒有昨收就不判漲跌：漲跌顯示「—」且不上色', () => {
    const { container } = show({ ...closedQuote, prevClose: null })
    const delta = container.querySelector('.m-price .delta')!
    expect(delta.textContent).toBe('—')
    expect(delta.className).not.toContain('pnl-up')
    expect(delta.className).not.toContain('pnl-down')
    expect(cellMap()['漲跌幅']).toBe('—')
  })

  it('備援路徑沒有開高低量時各格顯示「—」，不是 0', () => {
    show({ ...closedQuote, open: null, high: null, low: null, volume: null, prevClose: null })
    const map = cellMap()
    expect(map['開盤']).toBe('—')
    expect(map['最高']).toBe('—')
    expect(map['最低']).toBe('—')
    expect(map['成交量']).toBe('—')
    expect(map['昨收']).toBe('—')
    expect(map['振幅']).toBe('—')
  })

  it('尚無成交量是 0 張，與「取不到」分開顯示', () => {
    show({ ...closedQuote, volume: 0 })
    expect(cellMap()['成交量']).toBe('0 張')
  })

  it('試撮中要標明這是預估價，不是成交價', () => {
    const { container } = show({ ...closedQuote, tradeTime: '08:45:00', trial: true })
    expect(screen.getByText('預估')).toBeTruthy()
    // The card head one level up calls this quote 試撮中 (see quoteMeta); the stamp inside the card
    // must not call the same number 盤中.
    expect(container.querySelector('.m-price .stamp')?.textContent).toContain('試撮中')
  })

  it('不是試撮就沒有預估標記', () => {
    show(closedQuote)
    expect(screen.queryByText('預估')).toBeNull()
  })

  it('指標摘要搬到右欄，不再是下面的獨立區塊', () => {
    show(closedQuote, { latest })
    const a = aside()!
    expect(a.textContent).toContain('指標摘要')
    expect(a.querySelector('.tech-summary')).toBeTruthy()
  })

  it('右上顯示持有、成本、市值、今日', () => {
    show(closedQuote, { holding })
    const a = aside()!.textContent!
    expect(a).toContain('持有')
    expect(a).toContain('成本')
    expect(a).toContain('市值')
    // 市值 = 3000 × 2405 = 7,215,000
    expect(a).toContain('7,215,000')
  })

  it('損益直接用傳進來的 unrealized，不在這裡重算', () => {
    show(closedQuote, { holding })
    const a = aside()!.textContent!
    // 若在此重算會得到 3000 × (2405 − 2000) = 1,215,000，而那個數字會和庫存總覽打架
    expect(a).toContain('999,111')
    expect(a).not.toContain('1,215,000')
  })

  it('報酬率也直接用傳進來的 roi', () => {
    show(closedQuote, { holding })
    expect(aside()!.textContent).toContain('16.66%')
  })

  it('沒有昨收就算不出今日損益', () => {
    show({ ...closedQuote, prevClose: null }, { holding })
    const a = aside()!.textContent!
    expect(a).toContain('999,111')
    expect(a).toContain('今日')
  })

  it('只是觀察沒有持有時，整個持股區塊不出現', () => {
    show(closedQuote, { holding: null })
    expect(aside()!.textContent).not.toContain('持有')
    expect(document.querySelector('.quote-aside-private')).toBeNull()
  })

  it('持有時顯示我的持股概況區塊', () => {
    show(closedQuote, { holding })
    const block = document.querySelector('.quote-aside-private')
    expect(block).toBeTruthy()
    expect(block!.textContent).toContain('持有')
  })

  it('抓不到報價時顯示空狀態，不畫出空的統計格', () => {
    show(null)
    expect(screen.getByText('目前抓不到這檔股票的報價。')).toBeTruthy()
    expect(document.querySelectorAll('.m-stats .rpt-card')).toHaveLength(0)
  })

  it('沒有法人歷史資料時，不顯示三大法人買賣超動向區塊', () => {
    show(closedQuote, { history: null })
    expect(document.querySelector('.institutional-block')).toBeNull()
  })

  it('有 2 日法人歷史資料時，在走勢圖下方顯示三大法人買賣超動向卡片（最新在左、前日在右）', () => {
    show(closedQuote, { history: mockHistory })
    const block = document.querySelector('.institutional-block')
    expect(block).toBeTruthy()
    expect(block!.textContent).toContain('三大法人買賣超動向')
    expect(block!.textContent).toContain('近 2 交易日')
    expect(block!.textContent).toContain('單位：張（每日約 15:30 公布）')

    const cards = document.querySelectorAll('.inst-day-card')
    expect(cards).toHaveLength(2)

    // Left card: 2026-08-05 (latest)
    const leftCard = cards[0]
    expect(leftCard.querySelector('.inst-day-title')!.textContent).toBe('08/05')
    expect(leftCard.querySelector('.inst-day-tag')!.textContent).toBe('最新')
    expect(leftCard.querySelector('.inst-day-tag')!.className).toContain('is-latest')
    expect(leftCard.querySelector('.inst-total-val')!.textContent).toBe('+4,500 張')
    expect(leftCard.querySelector('.inst-total-val')!.className).toContain('pnl-up')

    const leftLegs = leftCard.querySelectorAll('.inst-leg-cell')
    expect(leftLegs).toHaveLength(3)
    expect(leftLegs[0].querySelector('.inst-leg-k')!.textContent).toBe('外資')
    expect(leftLegs[0].querySelector('.inst-leg-v')!.textContent).toBe('+3,000')
    expect(leftLegs[0].querySelector('.inst-leg-v')!.className).toContain('pnl-up')

    expect(leftLegs[1].querySelector('.inst-leg-k')!.textContent).toBe('投信')
    expect(leftLegs[1].querySelector('.inst-leg-v')!.textContent).toBe('+1,000')
    expect(leftLegs[1].querySelector('.inst-leg-v')!.className).toContain('pnl-up')

    expect(leftLegs[2].querySelector('.inst-leg-k')!.textContent).toBe('自營商')
    expect(leftLegs[2].querySelector('.inst-leg-v')!.textContent).toBe('+500')
    expect(leftLegs[2].querySelector('.inst-leg-v')!.className).toContain('pnl-up')

    // Right card: 2026-08-04 (previous)
    const rightCard = cards[1]
    expect(rightCard.querySelector('.inst-day-title')!.textContent).toBe('08/04')
    expect(rightCard.querySelector('.inst-day-tag')!.textContent).toBe('前日')
    expect(rightCard.querySelector('.inst-day-tag')!.className).not.toContain('is-latest')
    expect(rightCard.querySelector('.inst-total-val')!.textContent).toBe('-1,600 張')
    expect(rightCard.querySelector('.inst-total-val')!.className).toContain('pnl-down')

    const rightLegs = rightCard.querySelectorAll('.inst-leg-cell')
    expect(rightLegs).toHaveLength(3)
    expect(rightLegs[0].querySelector('.inst-leg-k')!.textContent).toBe('外資')
    expect(rightLegs[0].querySelector('.inst-leg-v')!.textContent).toBe('-2,000')
    expect(rightLegs[0].querySelector('.inst-leg-v')!.className).toContain('pnl-down')

    expect(rightLegs[1].querySelector('.inst-leg-k')!.textContent).toBe('投信')
    expect(rightLegs[1].querySelector('.inst-leg-v')!.textContent).toBe('+500')
    expect(rightLegs[1].querySelector('.inst-leg-v')!.className).toContain('pnl-up')

    expect(rightLegs[2].querySelector('.inst-leg-k')!.textContent).toBe('自營商')
    expect(rightLegs[2].querySelector('.inst-leg-v')!.textContent).toBe('-100')
    expect(rightLegs[2].querySelector('.inst-leg-v')!.className).toContain('pnl-down')
  })

  it('只有 1 日法人歷史資料時，只顯示 1 張最新卡片', () => {
    show(closedQuote, { history: [mockHistory[1]] })
    const cards = document.querySelectorAll('.inst-day-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].querySelector('.inst-day-title')!.textContent).toBe('08/05')
    expect(cards[0].querySelector('.inst-day-tag')!.textContent).toBe('最新')
    expect(cards[0].querySelector('.inst-total-val')!.textContent).toBe('+4,500 張')
  })
})

describe('quoteMeta', () => {
  it('標出交易日、狀態與撮合時間', () => {
    expect(quoteMeta(closedQuote)).toBe('8/5 · 已收盤 · 13:30:00')
    expect(quoteMeta({ ...closedQuote, tradeTime: '11:05:23' })).toBe('8/5 · 盤中 · 11:05:23')
    expect(quoteMeta({ ...closedQuote, tradeTime: '08:45:00', trial: true })).toBe(
      '8/5 · 試撮中 · 08:45:00',
    )
  })

  it('快取價明講是快取；沒有報價就說沒有', () => {
    expect(quoteMeta({ ...closedQuote, stale: true })).toBe('8/5 · 已收盤 · 13:30:00 · 快取')
    expect(quoteMeta(null)).toBe('尚未取得')
  })

  it('美股 / 備援路徑沒有交易日時不硬湊', () => {
    expect(quoteMeta({ ...closedQuote, tradeDate: null, tradeTime: null })).toBe('盤中')
  })
})
