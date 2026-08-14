// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const { fetchAdminStatus } = vi.hoisted(() => ({ fetchAdminStatus: vi.fn() }))
vi.mock('../../services/adminStatus', () => ({ fetchAdminStatus, isAdmin: vi.fn() }))

import { AdminStatusPage } from './AdminStatusPage'
import type { AdminStatus } from '../../services/adminStatus'

/** 2026-07-31 測試區 admin-status 實際回應範例 */
const status: AdminStatus = {
  asOf: '2026-07-31T04:50:00.000Z',
  todayYmd: '20260731',
  schedules: [
    {
      jobid: 10,
      jobname: 'stock-report-nightly',
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
        nextRelease: { date: '2026-08-12', period: '2026-07', estimated: false },
      },
    ],
  },
  fx: { asOf: '2026-07-31T03:00:02.713Z', count: 8 },
  market: {
    schema: 2,
    asOf: '2026-07-30T07:45:00.000Z',
    days: 120,
    latestDate: '2026-07-31',
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

  it('台股全市場：抓取週期取自 pg_cron，三個缺口分開數', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByRole('heading', { name: '台股全市場・量能與三大法人' })

    const section = within(
      screen.getByRole('heading', { name: '台股全市場・量能與三大法人' }).closest('.section')!,
    )
    expect(section.getByText('週一至週五 15:30 / 15:45')).toBeTruthy()
    expect(section.getByText('2026-07-31')).toBeTruthy() // 最新交易日
    expect(section.getByText('2026-07-30')).toBeTruthy() // 法人只到前一天
    expect(section.getByText('1 天待補')).toBeTruthy()
    expect(section.getByText('12')).toBeTruthy() // 買賣金額回補進度
  })

  it('台股全市場：讀不到檔案時說清楚，不是印一排 0', async () => {
    fetchAdminStatus.mockResolvedValue({ ...status, market: null })
    render(<AdminStatusPage />)
    await screen.findByRole('heading', { name: '台股全市場・量能與三大法人' })
    expect(screen.getByText(/讀不到 market\/daily.json/)).toBeTruthy()
  })

  it('檔案涵蓋以「幾檔 / 持股數」呈現', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText('匯率與檔案涵蓋')
    expect(screen.getByText('日線檔')).toBeTruthy()
    expect(screen.getAllByText('/ 5').length).toBeGreaterThan(0)
  })

  it('頂部呈現盤後探針命中戰情室', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    expect(await screen.findByText('⚡ 盤後探針命中戰情室')).toBeTruthy()
  })
})

describe('AdminStatusPage 排程同步狀態面板', () => {
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
    within((await screen.findByRole('heading', { name: '排程同步狀態' })).closest('.section')!)

  it('每個探針各占一列，窗還沒開的也在', async () => {
    render(<AdminStatusPage />)
    const p = await panel()
    expect(p.getByText('全市場法人 BFI82U')).toBeTruthy()
    expect(p.getByText('個股法人 T86')).toBeTruthy()
    expect(p.getByText('借券賣出')).toBeTruthy()
    expect(p.getByText('尚未探測')).toBeTruthy()
    expect(p.getByText('窗口未開')).toBeTruthy()
  })

  it('說明命中會觸發抓取、去哪裡看結果', async () => {
    render(<AdminStatusPage />)
    const p = await panel()
    expect(p.getByText(/命中代表/)).toBeTruthy()
    expect(p.getByText(/直接觸發對應的抓取/)).toBeTruthy()
    expect(p.getByText(/寫在該次紀錄的說明/)).toBeTruthy()
    expect(p.getByText(/抓取失敗的來源下一輪會自動重試/)).toBeTruthy()
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

  it('總經的探針決策也顯示在同一個面板，且說得出「為什麼不問」', async () => {
    fetchAdminStatus.mockResolvedValue({
      ...withProbe,
      probeExperiment: {
        ...withProbe.probeExperiment!,
        macroScan: {
          scan: false,
          reason: 'satisfied',
          dueIds: [],
          scansToday: 3,
          cap: 16,
          checkedAt: '2026-07-31T13:00:00.000Z',
        },
      },
    })
    render(<AdminStatusPage />)
    const p = await panel()
    expect(p.getByText('總經（FRED）')).toBeTruthy()
    expect(p.getByText('下一輪不問')).toBeTruthy()
    expect(p.getByText(/命中即收工/)).toBeTruthy()
    expect(p.getByText(/今日已問 3 \/ 16 次/)).toBeTruthy()
  })

  it('沒有 macroScan 時不畫那一列', async () => {
    render(<AdminStatusPage />)
    const p = await panel()
    expect(p.queryByText('總經（FRED）')).toBeNull()
  })

  it('頂部呈現盤後探針命中戰情室字卡', async () => {
    fetchAdminStatus.mockResolvedValue({
      ...withProbe,
      todayYmd: '20260731',
    })
    render(<AdminStatusPage />)
    expect(await screen.findByText('⚡ 盤後探針命中戰情室')).toBeTruthy()
    expect(await screen.findByText('全市場三大法人')).toBeTruthy()
  })
})
