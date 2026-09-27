// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuoteTab } from './QuoteTab'
import { quoteMeta } from './quoteMeta'
import type { PriceQuote } from '../../services/priceProxy'
import type { IntradaySeries } from '../../../supabase/functions/stock-price/intradayParse'
import type { ReportHolding } from '../../services/reportProxy'
import type { DailyRow, DailySeries, RemoteDaily } from '../../services/dailyProxy'
import type { DailyStatus } from './useDailySeries'
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

const fetchRemoteDailyMock = vi.hoisted(() =>
  vi.fn<(ticker: string, range: '5y' | 'max') => Promise<RemoteDaily | null>>(async () => null),
)
vi.mock('../../services/dailyProxy', async (importActual) => ({
  ...(await importActual<typeof import('../../services/dailyProxy')>()),
  fetchRemoteDaily: fetchRemoteDailyMock,
}))

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
    dailySeries?: DailySeries | null
    dailyStatus?: DailyStatus
  } = {},
) =>
  render(
    <QuoteTab
      quote={quote}
      ticker="2330"
      name="台積電"
      holding={opts.holding ?? null}
      latest={opts.latest ?? null}
      dailySeries={opts.dailySeries ?? null}
      dailyStatus={opts.dailyStatus ?? 'ready'}
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
    // BUG-050: the card infers the close from the fetch time when the matching time cannot prove it,
    // so an intraday case must carry an intraday `asOf` too — 03:05:23Z is Taipei 11:05.
    const intraday = show({
      ...closedQuote,
      tradeTime: '11:05:23',
      asOf: '2026-08-05T03:05:23.000Z',
    })
    expect(intraday.container.querySelector('.m-price .stamp')?.textContent).toContain('盤中')

    cleanup()
    // The same 11:05 match, refetched at Taipei 15:30: after the settle window no further price can
    // arrive, so this thin ticker is closed even though its matching time never reached 13:30.
    const thin = show({ ...closedQuote, tradeTime: '11:05:23' })
    expect(thin.container.querySelector('.m-price .stamp')?.textContent).toContain('收盤')
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

  it('指標摘要跟我的持股放在行情下方同一區', () => {
    show(closedQuote, { latest })
    const a = aside()!
    expect(a.textContent).toContain('指標摘要')
    expect(a.querySelector('.tech-summary')).toBeTruthy()
  })

  it('我的持股顯示持有、均價、市值、今日損益', () => {
    show(closedQuote, { holding })
    const a = aside()!.textContent!
    expect(a).toContain('持有')
    expect(a).toContain('均價')
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

  it('行情不再放三大法人 2 日卡片：同樣的數字改在籌碼分頁以長條圖呈現（2026-09-27）', () => {
    show(closedQuote)
    expect(document.querySelector('.institutional-block')).toBeNull()
    expect(screen.queryByText('三大法人買賣超動向')).toBeNull()
  })

  it('行情抬頭處顯示即時產業別徽章（優先取 quote.industry）', () => {
    const { container } = show({ ...closedQuote, industry: '半導體業' })
    const badge = container.querySelector('.quote-top-banner .quote-badge')
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toBe('半導體業')
  })

  it('若 quote.industry 未抵達，行情抬頭處由 getStockCategory 規則與字典後備提供標籤', () => {
    const { container } = show({ ...closedQuote, industry: null })
    const badge = container.querySelector('.quote-top-banner .quote-badge')
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toBe('半導體')
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

describe('QuoteTab 走勢區間', () => {
  /** n 根日線，收盤價 base + i */
  function makeDaily(n: number, base: number, startUtc = Date.UTC(2026, 0, 1)): DailySeries {
    const rows: DailyRow[] = []
    for (let i = 0; i < n; i++) {
      const d = new Date(startUtc + i * 86400000).toISOString().slice(0, 10)
      const close = base + i
      rows.push([d, close - 1, close + 1, close - 2, close, 1_000_000])
    }
    return { ticker: '2330', asOf: '2026-09-10T05:00:00.000Z', lastDate: rows[n - 1][0], rows }
  }

  beforeEach(() => {
    // 這個檔案的 cleanup 寫在別的 describe 裡，作用不到這裡；不清會留下上一個測試的 DOM。
    cleanup()
    fetchRemoteDailyMock.mockReset()
    fetchRemoteDailyMock.mockResolvedValue(null)
    fetchIntradayMock.mockReset()
    fetchIntradayMock.mockResolvedValue(series)
  })

  it('提供八個區間按鈕', () => {
    show(closedQuote, { dailySeries: makeDaily(60, 100) })
    const group = screen.getByRole('group', { name: '走勢區間' })
    const labels = [...group.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toEqual(['一日', '五日', '近 1 月', '近 6 月', '本年迄今', '近 1 年', '近 5 年', '全部'])
  })

  it('切到近 1 月改用日線，不再打盤中 API', async () => {
    const user = userEvent.setup()
    show(closedQuote, { dailySeries: makeDaily(60, 100) })
    const callsBefore = fetchIntradayMock.mock.calls.length

    await user.click(screen.getByRole('button', { name: '近 1 月' }))

    // 收盤價 100..159，近 1 月取最後 20 根 → 最新 159
    const chart = await screen.findByRole('group', { name: /近 1 月走勢/ })
    expect(chart.getAttribute('aria-label')).toContain('159')
    expect(fetchIntradayMock.mock.calls.length).toBe(callsBefore)
  })

  it('日線區間不顯示均價 —— 一年的累積均價沒有意義', async () => {
    const user = userEvent.setup()
    show(closedQuote, { dailySeries: makeDaily(60, 100) })
    // 盤中區間有均價（fixture 的 VWAP = 2406.25）
    await waitFor(() => expect(cellMap()['均價']).not.toBe('—'))

    await user.click(screen.getByRole('button', { name: '近 1 年' }))
    await screen.findByRole('group', { name: /近 1 年走勢/ })
    expect(cellMap()['均價']).toBe('—')
  })

  it('近 5 年切到全部時不可沿用前一個區間的資料', async () => {
    // 0.9.41 在技術面分頁踩過這個坑：清除舊資料只寫在其中一個分支，
    // 切換時舊資料會掛在新標籤下顯示，而且不出現載入指示。
    const user = userEvent.setup()
    let resolveMax: ((v: RemoteDaily) => void) | null = null
    fetchRemoteDailyMock.mockImplementation((_t, range) =>
      range === '5y'
        ? Promise.resolve({ rows: makeDaily(300, 500).rows, granularity: '1d' as const })
        : new Promise<RemoteDaily>((res) => {
            resolveMax = res
          }),
    )

    show(closedQuote, { dailySeries: makeDaily(60, 100) })

    await user.click(screen.getByRole('button', { name: '近 5 年' }))
    await screen.findByRole('group', { name: /近 5 年走勢/ })

    // 「全部」的回應還沒回來
    await user.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.queryByRole('group', { name: /近 5 年走勢/ })).toBeNull()
    expect(document.querySelector('.intraday-skeleton')).toBeTruthy()

    resolveMax!({ rows: makeDaily(120, 300).rows, granularity: '1mo' })
    const chart = await screen.findByRole('group', { name: /全部走勢/ })
    // 300..419 → 最新 419，絕不能是 5y 那批的 799。
    // 刻意讓兩批都低於 1000：fmt2 走 en-US 千分位，1019 會印成 "1,019.00"。
    expect(chart.getAttribute('aria-label')).toContain('419')
    expect(chart.getAttribute('aria-label')).not.toContain('799')
  })

  it('日線本身讀取失敗時要停止轉圈並報錯 —— dailyStatus 變化不帶動 dailySeries', async () => {
    // useDailySeries 失敗時只呼叫 setStatus('error')，series 仍是同一個 null。
    // 若 effect 的相依只看 dailySeries，這個轉換不會重跑，骨架就永遠停在載入中。
    const user = userEvent.setup()
    const props = (dailyStatus: DailyStatus) => (
      <QuoteTab
        quote={closedQuote}
        ticker="2330"
        name="台積電"
        holding={null}
        latest={null}
        dailySeries={null}
        dailyStatus={dailyStatus}
      />
    )
    const { rerender } = render(props('loading'))

    await user.click(screen.getByRole('button', { name: '近 1 月' }))
    expect(document.querySelector('.intraday-skeleton')).toBeTruthy()

    rerender(props('error'))

    expect(await screen.findByText('讀取走勢圖失敗，請稍後再試。')).toBeTruthy()
    expect(document.querySelector('.intraday-skeleton')).toBeNull()
  })

  it('遠端區間讀取失敗時顯示走勢圖失敗訊息', async () => {
    const user = userEvent.setup()
    fetchRemoteDailyMock.mockResolvedValue(null)
    show(closedQuote, { dailySeries: makeDaily(60, 100) })

    await user.click(screen.getByRole('button', { name: '全部' }))

    expect(await screen.findByText('讀取走勢圖失敗，請稍後再試。')).toBeTruthy()
  })
})
