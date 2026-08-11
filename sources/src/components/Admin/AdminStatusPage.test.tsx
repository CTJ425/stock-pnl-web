// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

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
      // 0.7.2 sparse: T86 16:30/16:45 + margin 21:30/21:45
      schedule: '30,45 8,13 * * 1-5',
      active: true,
      action: 'generate-chips',
      targetRef: 'wqetxuhncvfidqnklyew',
      lastRun: '2026-07-30T13:45:00.094Z',
      lastStatus: 'succeeded',
      runsToday: 0,
      failsToday: 0,
    },
    {
      jobid: 12,
      jobname: 'macro-daily',
      // schema.sql / DEV live: dense scan, not the old two-slot 0 13,15
      schedule: '*/30 12-18 * * *',
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
      // 0.7.2 sparse: BFI 15:30 / 15:45 only
      schedule: '30,45 7 * * 1-5',
      active: true,
      action: 'sync-market',
      targetRef: 'wqetxuhncvfidqnklyew',
      lastRun: '2026-07-30T07:45:00.000Z',
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
    // Taipei 15:45 on the data day (0.7.2 last market-daily flight) — on time under sparse dueBy
    asOf: '2026-07-30T07:45:00.000Z',
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

  it('時間軸圖例分開交代兩套排程，且都取自 pg_cron（0.6.40）', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    const { container } = render(<AdminStatusPage />)
    await screen.findByRole('heading', { name: /台股盤後/ })

    /*
      Both schedules are named, and both come from the cron rows (0.7.2 sparse shifts).
      The schedule table itself is gone since 0.7.4 — the legend is now the only place the
      two cron expressions are spelled out, which is exactly why this test stays.
    */
    const legend = container.querySelector('.ast-rule')!
    expect(legend.textContent).toContain('週一至週五 16:30 / 16:45 / 21:30 / 21:45')
    expect(legend.textContent).toContain('週一至週五 15:30 / 15:45')
    expect(legend.textContent).toContain('三大法人・全市場')
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
    expect(section.getByText('週一至週五 15:30 / 15:45')).toBeTruthy()
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
    // Two different pieces of information, the names must be distinguishable at a glance.
    // Scoped to the axis since 0.6.40: the legend names the same row, so an unscoped query matches twice.
    const axis = within(document.querySelector<HTMLElement>('.ast-tl')!)
    expect(axis.getByText('三大法人・全市場')).toBeTruthy()
    expect(axis.getByText('T86')).toBeTruthy()
    // The subtitle should indicate that this time is the output of the file, not the time when the legal person's amount is received.
    expect(screen.getByText('BFI82U・檔案產出時間')).toBeTruthy()
    // 15:45 market asOf under sparse dueBy → on time; only borrow (+ macro lag) needs attention
    expect(screen.queryByText('有 3 項需要注意')).toBeNull()
  })

  /*
   * 2026-08-05 Actual errors encountered: BFI82U in the whole market uses independent scheduling and captures the data of the day early.
   * For individual stocks T86, you have to wait for the afternoon chips shifts. When the base date is tied to an individual stock report, the title stops at the previous day.
   * The acquired market-wide column was taken as the starting point at 15:00 of the previous day, and 25 hours was calculated and judged as a delay.
   */
  it('全市場先到手時，整條軸跟著跳到新一輪，個股顯示等待中（0.6.36-dev.2）', async () => {
    fetchAdminStatus.mockResolvedValue({
      ...status,
      asOf: '2026-07-31T08:20:00.000Z', // 台北 7/31 16:20
      market: {
        ...status.market!,
        latestInstitutionalDate: '2026-07-31',
        asOf: '2026-07-31T07:45:00.000Z', // 台北 7/31 15:45，稀疏第二班
      },
    })
    render(<AdminStatusPage />)
    // The headline follows the fastest source, rather than stopping at 7/30 of the individual stock report.
    await screen.findByText('台股盤後・2026-07-31 這一輪')

    const rowOf = (label: string) =>
      [...document.querySelectorAll('.ast-row')].find((r) => r.querySelector('b')?.textContent === label)!

    // Whole market: 15:45 arrival → drawn on the axis and not delayed
    const market = rowOf('三大法人・全市場')
    expect(market.querySelector('.ast-hit-t')?.textContent).toBe('15:45')
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
    expect(
      within(document.querySelector<HTMLElement>('.ast-tl')!).getByText('三大法人・全市場'),
    ).toBeTruthy()
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
    expect(screen.getByText(/公布窗結束後的第一個班次/)).toBeTruthy()
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

  it('總經班次軸：密集掃描顯示 pg_cron 白話而非假兩班', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/今日班次/)
    // macro-daily is */30 12-18 UTC → Taipei 20:00–02:30 /30m (dense, collapsed UI)
    expect(screen.getByText('密集掃描')).toBeTruthy()
    // Same phrase appears on the schedule table and the dense-shift axis — both from describeCron.
    expect(screen.getAllByText(/20:00–次日 02:30 每 30 分/).length).toBeGreaterThanOrEqual(1)
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

/*
  0.7.3 探針實驗的一源一列（0.7.4 改版）。這一組跟上面共用 fixture 但另外掛
  probeExperiment——排程那張表已經拿掉，這面板現在是後台唯一在講「哪個源幾點到」的地方。
*/
describe('AdminStatusPage 探針實驗面板', () => {
  const tick = (
    time: string,
    source: string,
    hit: boolean,
    extra: Record<string, unknown> = {},
  ) => ({ taipei_ymd: '20260731', taipei_time: time, source, hit, ok: true, ...extra })

  const withProbe: AdminStatus = {
    ...status,
    probeExperiment: {
      mode: 'probe-only',
      labels: {
        bfi82u: '全市場法人 BFI82U',
        t86: '個股法人 T86',
        borrow: '借券賣出',
      },
      order: ['bfi82u', 't86', 'borrow'],
      ticks: [
        tick('15:00', 'bfi82u', false, { note: '當日 BFI 尚未齊' }),
        tick('15:05', 'bfi82u', false),
        tick('15:10', 'bfi82u', true, {
          data_ymd: '20260731',
          rows: 1,
          note: '當日 BFI82U 含買進',
          duration_ms: 412,
          fingerprint: 'abcdef0123456789',
        }),
        tick('15:30', 't86', false, { note: '當日 T86 尚無資料' }),
      ],
    },
  }

  beforeEach(() => {
    fetchAdminStatus.mockResolvedValue(withProbe)
  })
  afterEach(cleanup)

  const panel = async () =>
    within((await screen.findByRole('heading', { name: /探針實驗/ })).closest('.section')!)

  it('每個探針各占一列，窗還沒開的也在——少一列會讓「沒探到」看起來像正常', async () => {
    render(<AdminStatusPage />)
    const p = await panel()
    expect(p.getByText('全市場法人 BFI82U')).toBeTruthy()
    expect(p.getByText('個股法人 T86')).toBeTruthy()
    // 借券今天一次都沒探到，仍然要有自己的列，並說明窗口未開
    expect(p.getByText('借券賣出')).toBeTruthy()
    expect(p.getByText('尚未探測')).toBeTruthy()
    expect(p.getByText('窗口未開')).toBeTruthy()
  })

  it('說明命中不等於已抓取，且不再宣稱「固定盤後 cron 已停用」（0.7.7）', async () => {
    render(<AdminStatusPage />)
    const p = await panel()
    /*
      A green cell means the upstream endpoint has the data, not that anything fetched it —— the probe writes
      source_probe_tick and nothing else. Without this sentence the panel reads as "hit, therefore updated",
      which is what sent someone looking for a bug that was not there.
    */
    expect(p.getByText(/命中只代表/)).toBeTruthy()
    expect(p.getByText(/探針本身不會觸發抓取/)).toBeTruthy()
    // The old copy asserted a cron state this page cannot see; it went stale the moment the schedules came back
    expect(p.queryByText(/已停用/)).toBeNull()
  })

  it('進度條一格一次探測，命中格數與摘要對得上', async () => {
    const { container } = render(<AdminStatusPage />)
    await panel()
    const rows = [...container.querySelectorAll('.apr-row')]
    const bfi = rows.find((r) => r.textContent?.includes('BFI82U'))!
    expect(bfi.querySelectorAll('.apr-seg')).toHaveLength(3)
    expect(bfi.querySelectorAll('.apr-seg-hit')).toHaveLength(1)
    expect(bfi.textContent).toContain('首次命中 15:10')
    expect(bfi.textContent).toContain('1 / 3 中')
  })

  it('尚未命中的源說「尚未命中」而不是留白', async () => {
    const { container } = render(<AdminStatusPage />)
    await panel()
    const t86 = [...container.querySelectorAll('.apr-row')].find((r) =>
      r.textContent?.includes('個股法人'),
    )!
    expect(t86.textContent).toContain('尚未命中')
    expect(t86.textContent).toContain('0 / 1 中')
  })

  it('展開後才列出逐次紀錄，收合時不占畫面', async () => {
    const { container } = render(<AdminStatusPage />)
    await panel()
    const bfi = [...container.querySelectorAll('.apr-row')].find((r) =>
      r.textContent?.includes('BFI82U'),
    )!
    expect(bfi.querySelector('.apr-log')).toBeNull()

    fireEvent.click(bfi.querySelector('.apr-head')!)
    const log = bfi.querySelector('.apr-log')!
    expect(log.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(log.textContent).toContain('當日 BFI82U 含買進')
    expect(log.textContent).toContain('412 ms')
    // 指紋只印前 8 碼：要看的是跟上一列一不一樣，不是雜湊本身
    expect(log.textContent).toContain('abcdef01')
    expect(log.textContent).not.toContain('abcdef0123456789')

    fireEvent.click(bfi.querySelector('.apr-head')!)
    expect(bfi.querySelector('.apr-log')).toBeNull()
  })

  it('一次都沒探到的列點不開', async () => {
    const { container } = render(<AdminStatusPage />)
    await panel()
    const borrow = [...container.querySelectorAll('.apr-row')].find((r) =>
      r.textContent?.includes('借券'),
    )!
    const head = borrow.querySelector('.apr-head') as HTMLButtonElement
    expect(head.disabled).toBe(true)
    fireEvent.click(head)
    expect(borrow.querySelector('.apr-log')).toBeNull()
  })

  it('排程表已移除，問題數不再把刻意停用的 cron 算成延遲', async () => {
    fetchAdminStatus.mockResolvedValue({
      ...withProbe,
      schedules: withProbe.schedules.map((s) => ({ ...s, active: false })),
    })
    render(<AdminStatusPage />)
    await screen.findByRole('heading', { name: /探針實驗/ })
    expect(screen.queryByRole('heading', { name: '排程' })).toBeNull()
    expect(screen.queryByText(/有 3 項需要注意/)).toBeNull()
  })
})
