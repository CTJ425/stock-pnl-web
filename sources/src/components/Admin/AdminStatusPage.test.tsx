// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

const { fetchAdminStatus } = vi.hoisted(() => ({ fetchAdminStatus: vi.fn() }))
vi.mock('../../services/adminStatus', () => ({ fetchAdminStatus, isAdmin: vi.fn() }))

import { AdminStatusPage } from './AdminStatusPage'
import type { AdminStatus } from '../../services/adminStatus'

/** Verbatim taken from the actual response of admin-status in the test area on 2026-07-31 (excerpt)*/
const status: AdminStatus = {
  asOf: '2026-07-31T04:50:00.000Z',
  todayYmd: '20260731',
  schedules: [
    {
      jobid: 10,
      jobname: 'stock-report-nightly',
      schedule: '*/15 8-15 * * 1-5',
      active: true,
      action: 'generate-all',
      targetRef: 'wqetxuhncvfidqnklyew',
      lastRun: '2026-07-30T15:45:00.094Z',
      lastStatus: 'succeeded',
      runsToday: 0,
      failsToday: 0,
    },
    {
      jobid: 12,
      jobname: 'macro-daily',
      schedule: '0 13,15 * * *',
      active: true,
      action: 'sync-macro',
      targetRef: 'wqetxuhncvfidqnklyew',
      lastRun: '2026-07-30T15:00:00.124Z',
      lastStatus: 'succeeded',
      runsToday: 0,
      failsToday: 0,
    },
    {
      jobid: 14,
      jobname: 'market-daily',
      schedule: '0 8-10 * * 1-5',
      active: true,
      action: 'sync-market',
      targetRef: 'wqetxuhncvfidqnklyew',
      lastRun: '2026-07-30T10:00:00.000Z',
      lastStatus: 'succeeded',
      runsToday: 0,
      failsToday: 0,
    },
  ],
  manifest: { ymd: '20260730', dataDate: '2026-07-30', generatedAt: '2026-07-31T01:09:48.993Z' },
  chip: {
    ymd: '20260730',
    dataDate: '2026-07-30',
    sources: {
      institutional: { date: '2026-07-30', fetchedAt: '2026-07-30T08:15:04.519Z' },
      margin: { date: '2026-07-30', fetchedAt: '2026-07-30T13:00:03.949Z' },
      // Borrowing coupons was not caught until the next morning - the real situation, and the only one that should have a red light
      borrow: { date: '2026-07-31', fetchedAt: '2026-07-31T01:10:36.222Z' },
    },
  },
  coverage: { daily: 5, fundamental: 5, held: 5 },
  macro: {
    asOf: '2026-07-31T04:37:19.466Z',
    checkedAt: '2026-07-31T04:37:23.617Z',
    indicators: [
      {
        id: 'CPILFESL',
        label: '核心 CPI',
        unit: '%',
        latest: { period: '2026-06', value: 2.57 },
        previous: { period: '2026-05', value: 2.82 },
        // Calculated by the back end according to the official calendar; the official announcement date of the CPI 2026-07 period
        nextRelease: { date: '2026-08-12', period: '2026-07', estimated: false },
      },
      {
        // One period behind: other indicators to 2026-06, only it stops at 2026-05
        id: 'UMCSENT',
        label: '消費者信心',
        unit: '指數',
        latest: { period: '2026-05', value: 44.8 },
        previous: { period: '2026-04', value: 49.8 },
        // UMCSENT is not in the calendar (no updates, no intensive scanning)
        nextRelease: null,
      },
    ],
  },
  fx: { asOf: '2026-07-31T03:00:02.713Z', count: 8 },
  market: {
    schema: 2,
    // Taipei 18:00 on the data day (the last market-daily flight) - the timeline is judged to be on time accordingly
    asOf: '2026-07-30T10:00:00.000Z',
    days: 120,
    latestDate: '2026-07-31',
    // It is normal for the legal person to be one day later than the quantity (announced only at 15:00 and supplemented daily)
    latestInstitutionalDate: '2026-07-30',
    missingInstitutional: 1,
    missingBuySell: 12,
    missingCandle: 0,
  },
  batch: { runsToday: 1, runSig: 'x' },
  probe: { taipei_ymd: '20260730', taipei_time: '23:45', bwibbu_rows: 1081, borrow_rows: 1042 },
  durationMs: 928,
}

describe('AdminStatusPage', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('載入中顯示佔位', () => {
    fetchAdminStatus.mockReturnValue(new Promise(() => {}))
    render(<AdminStatusPage />)
    expect(screen.getByText('正在讀取資料抓取狀況…')).toBeTruthy()
  })

  it('非管理員（後端回 403 → null）顯示說明而非空白頁', async () => {
    fetchAdminStatus.mockResolvedValue(null)
    render(<AdminStatusPage />)
    expect(await screen.findByText('讀不到資料抓取狀況')).toBeTruthy()
    expect(screen.getByText(/只有管理員帳號看得到/)).toBeTruthy()
  })

  it('排程資訊逐列呈現，cron 表達式換算成台北時間的白話', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByRole('heading', { name: '排程' })
    expect(screen.getByText('stock-report-nightly')).toBeTruthy()
    expect(screen.getByText('週一至週五 16:00–23:45 每 15 分')).toBeTruthy()
    expect(screen.getByText('每日 21:00 / 23:00')).toBeTruthy()
  })

  it('顯示每個排程實際打的環境——BUG-003 就是測試區的 cron 打到正式區', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByRole('heading', { name: '排程' })
    // Each schedule column must indicate the target environment, so it is tied to the schedule number of the fixture rather than a hard-coded number.
    expect(screen.getAllByText('wqetxuhncvfidqnklyew').length).toBe(status.schedules.length)
  })

  it('台股全市場：抓取週期取自 pg_cron，三個缺口分開數（0.6.32）', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByRole('heading', { name: '台股全市場・量能與三大法人' })

    // Date strings appear all over the page, and assertions must be limited to this paragraph.
    const section = within(
      screen.getByRole('heading', { name: '台股全市場・量能與三大法人' }).closest('.section')!,
    )
    // The cycle directly translates market-daily's cron, and the front-end does not save a separate copy of the constants.
    expect(section.getByText('週一至週五 16:00 / 17:00 / 18:00')).toBeTruthy()
    expect(section.getByText('2026-07-31')).toBeTruthy() // 最新交易日
    expect(section.getByText('2026-07-30')).toBeTruthy() // 法人只到前一天，正常
    expect(section.getByText('1 天待補')).toBeTruthy()
    expect(section.getByText('12')).toBeTruthy() // 買賣金額回補進度
  })

  it('台股全市場：讀不到檔案時說清楚，不是印一排 0', async () => {
    fetchAdminStatus.mockResolvedValue({ ...status, market: null })
    render(<AdminStatusPage />)
    await screen.findByRole('heading', { name: '台股全市場・量能與三大法人' })
    expect(screen.getByText(/讀不到 market\/daily.json/)).toBeTruthy()
  })

  it('時間軸列出台股盤後鏈，借券顯示為次日補抓', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/台股盤後/)
    expect(screen.getByText('三大法人・個股')).toBeTruthy()
    expect(screen.getByText('融資融券')).toBeTruthy()
    expect(screen.getByText('借券賣出')).toBeTruthy()
    expect(screen.getAllByText(/次日 09:1\d/).length).toBeGreaterThan(0)
  })

  it('全市場法人自成一列，與個股 T86 分得開（0.6.33）', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/台股盤後/)
    // Two different pieces of information, the names must be distinguishable at a glance
    expect(screen.getByText('三大法人・全市場')).toBeTruthy()
    expect(screen.getByText('T86')).toBeTruthy()
    // The subtitle should indicate that this time is the output of the file, not the time when the legal person's amount is received.
    expect(screen.getByText('BFI82U・檔案產出時間')).toBeTruthy()
    // 18:00 output, boundary is 18:15 → on time, this column should not be included in "needs attention"
    expect(screen.queryByText('有 3 項需要注意')).toBeNull()
  })

  /*
   * 2026-08-05 Actual errors encountered: BFI82U in the whole market uses independent scheduling and captures the data of the day at 16:00.
   * For individual stocks T86, you have to wait for the 16:30 round. When the base date is tied to an individual stock report, the title stops at the previous day.
   * The acquired market-wide column was taken as the starting point at 15:00 of the previous day, and 25 hours was calculated and judged as a delay.
   */
  it('全市場先到手時，整條軸跟著跳到新一輪，個股顯示等待中（0.6.36-dev.2）', async () => {
    fetchAdminStatus.mockResolvedValue({
      ...status,
      asOf: '2026-07-31T08:20:00.000Z', // 台北 7/31 16:20
      market: {
        ...status.market!,
        latestInstitutionalDate: '2026-07-31',
        asOf: '2026-07-31T08:00:04.000Z', // 台北 7/31 16:00，本輪 +1 小時
      },
    })
    render(<AdminStatusPage />)
    // The headline follows the fastest source, rather than stopping at 7/30 of the individual stock report.
    await screen.findByText('台股盤後・2026-07-31 這一輪')

    const rowOf = (label: string) =>
      [...document.querySelectorAll('.ast-row')].find((r) => r.querySelector('b')?.textContent === label)!

    // Whole market: 16:00 arrival → drawn on the axis and not delayed
    const market = rowOf('三大法人・全市場')
    expect(market.querySelector('.ast-hit-t')?.textContent).toBe('16:00')
    expect(market.querySelector('.ast-pill')?.textContent).not.toBe('延遲')

    // Individual stock T86: Still stuck in the previous round → Dots are not drawn with the old timestamp, and it is displayed as waiting.
    const inst = rowOf('三大法人・個股')
    expect(inst.querySelector('.ast-hit-t')).toBeNull()
    expect(inst.querySelector('.ast-pill')?.textContent).toBe('等待中')
    // The date of the previous round is not displayed, otherwise it will be read that the current round has been obtained.
    expect(inst.querySelector('.ast-date')).toBeNull()
  })

  it('讀不到 market 時全市場那列是等待中，不會讓整頁壞掉（0.6.33）', async () => {
    fetchAdminStatus.mockResolvedValue({ ...status, market: null })
    render(<AdminStatusPage />)
    await screen.findByText(/台股盤後/)
    expect(screen.getByText('三大法人・全市場')).toBeTruthy()
  })

  it('法人 16:15 到手不算延遲——判定基準是批次班次不是公布時刻', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/台股盤後/)
    // Just count the time labels on the timeline: .ast-when is the copy that is displayed on the mobile phone.
    // But jsdom does not include CSS. Use getAllByText to count it together.
    const onAxis = [...document.querySelectorAll('.ast-hit-t')].map((e) => e.textContent)
    expect(onAxis.filter((t) => t === '16:15').length).toBe(2)
    // The legend writes this rule on the screen, otherwise it looks like a double standard
    expect(screen.getByText(/公布窗結束後的第一個批次班次/)).toBeTruthy()
  })

  it('總經落後一期的指標被標出來，其餘為最新', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/美國總體經濟/)
    expect(screen.getByText('落後 1 期')).toBeTruthy()
    expect(screen.getByText('最新')).toBeTruthy()
  })

  it('資料變動時間與最後檢查時間分開顯示（BUG-008 的兩個欄位）', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/美國總體經濟/)
    expect(screen.getByText(/資料變動於 .*最後檢查/)).toBeTruthy()
  })

  it('需要注意的項數出現在最上方的結論', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    // Borrowing delays + lagging consumer confidence = 2 items
    expect(await screen.findByText('有 2 項需要注意')).toBeTruthy()
  })

  it('不再出現任何個股新聞相關內容（0.6.13 移除）', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/台股盤後/)
    expect(screen.queryByText('個股新聞')).toBeNull()
    expect(screen.queryByText('新聞檔')).toBeNull()
  })

  it('總經班次軸標出兩班與各自是否已執行', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/今日班次/)
    // macro-daily is 0 13,15 UTC → Taipei 21:00 / 23:00
    expect(screen.getByText(/21:00・/)).toBeTruthy()
    expect(screen.getByText(/23:00・/)).toBeTruthy()
    expect(screen.getByText('美東發布')).toBeTruthy()
  })

  it('顯示下次抓取時間，並把推估的發布日標為推估', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/今日班次/)
    expect(screen.getByText('下次抓取')).toBeTruthy()
    // The next crawl is calculated by cron and is 100% certain; the release date is estimated, and the two cannot be confused.
    expect(screen.getByText('（官方公告日）')).toBeTruthy()
    expect(screen.getByText('下一筆新數據')).toBeTruthy()
  })

  it('排程列出各自的抓取範圍——光看 action 代號看不出負責哪些資料', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByRole('heading', { name: '排程' })
    expect(screen.getByText(/持股台股的三大法人/)).toBeTruthy()
    expect(screen.getByText(/FRED 五個序列/)).toBeTruthy()
  })

  it('下期預計用後端算好的官方公告日，前端不自備行事曆', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/今日班次/)
    // Switch to using the determined date calculated by the back-end according to the official calendar (no longer the interval self-promoted by the front-end)
    const rows = [...document.querySelectorAll('.data-table tbody tr')]
    const cpi = rows.find((r) => r.textContent?.includes('CPILFESL'))!
    expect(cpi.textContent).toContain('2026-08-12')
    expect(document.querySelector('.ast-next')?.textContent).toContain('2026-08-12')
  })

  it('落後的指標下期預計顯示「待定」——它連上一期都還沒發', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/今日班次/)
    const rows = [...document.querySelectorAll('.data-table tbody tr')]
    const umc = rows.find((r) => r.textContent?.includes('UMCSENT'))!
    expect(umc.textContent).toContain('待定')
  })

  it('檔案涵蓋以「幾檔 / 持股數」呈現', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText('匯率與檔案涵蓋')
    expect(screen.getByText('日線檔')).toBeTruthy()
    expect(screen.getAllByText('/ 5').length).toBeGreaterThan(0)
  })
})
