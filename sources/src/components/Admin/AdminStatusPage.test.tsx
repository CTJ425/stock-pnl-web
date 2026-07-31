// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const { fetchAdminStatus } = vi.hoisted(() => ({ fetchAdminStatus: vi.fn() }))
vi.mock('../../services/adminStatus', () => ({ fetchAdminStatus, isAdmin: vi.fn() }))

import { AdminStatusPage } from './AdminStatusPage'
import type { AdminStatus } from '../../services/adminStatus'

/** 逐字取自 2026-07-31 測試區 admin-status 的實際回應（節錄） */
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
  ],
  manifest: { ymd: '20260730', dataDate: '2026-07-30', generatedAt: '2026-07-31T01:09:48.993Z' },
  chip: {
    ymd: '20260730',
    dataDate: '2026-07-30',
    sources: {
      institutional: { date: '2026-07-30', fetchedAt: '2026-07-30T08:15:04.519Z' },
      margin: { date: '2026-07-30', fetchedAt: '2026-07-30T13:00:03.949Z' },
      // 借券拖到隔天早上才抓到 —— 真實情況，也是唯一該亮紅燈的一項
      borrow: { date: '2026-07-31', fetchedAt: '2026-07-31T01:10:36.222Z' },
    },
  },
  coverage: { daily: 5, fundamental: 5, news: 5, held: 5 },
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
      },
      {
        // 落後一期：其他指標到 2026-06，只有它停在 2026-05
        id: 'UMCSENT',
        label: '消費者信心',
        unit: '指數',
        latest: { period: '2026-05', value: 44.8 },
        previous: { period: '2026-04', value: 49.8 },
      },
    ],
  },
  fx: { asOf: '2026-07-31T03:00:02.713Z', count: 8 },
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
    expect(screen.getAllByText('wqetxuhncvfidqnklyew').length).toBe(2)
  })

  it('時間軸列出台股盤後鏈，借券顯示為次日補抓', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/台股盤後/)
    expect(screen.getByText('三大法人')).toBeTruthy()
    expect(screen.getByText('融資融券')).toBeTruthy()
    expect(screen.getByText('借券賣出')).toBeTruthy()
    expect(screen.getAllByText(/次日 09:1\d/).length).toBeGreaterThan(0)
  })

  it('法人 16:15 到手不算延遲——判定基準是批次班次不是公布時刻', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/台股盤後/)
    // 只數時間軸上的時刻標籤：.ast-when 是手機才顯示的複本，
    // 但 jsdom 不套 CSS，用 getAllByText 會把它一起數進來
    const onAxis = [...document.querySelectorAll('.ast-hit-t')].map((e) => e.textContent)
    expect(onAxis.filter((t) => t === '16:15').length).toBe(2)
    // 圖例把這條規則寫在畫面上，否則看起來像雙標
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
    // 借券延遲 + 消費者信心落後 = 2 項
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
    // macro-daily 是 0 13,15 UTC → 台北 21:00 / 23:00
    expect(screen.getByText(/21:00・/)).toBeTruthy()
    expect(screen.getByText(/23:00・/)).toBeTruthy()
    expect(screen.getByText('美東發布')).toBeTruthy()
  })

  it('顯示下次抓取時間，並把推估的發布日標為推估', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/今日班次/)
    expect(screen.getByText('下次抓取')).toBeTruthy()
    // 下次抓取是 cron 算得出來的、100% 確定；發布日是推估的，兩者不可混為一談
    expect(screen.getByText('（依實測歸納的區間）')).toBeTruthy()
    expect(screen.getByText('下一筆新數據')).toBeTruthy()
  })

  it('排程列出各自的抓取範圍——光看 action 代號看不出負責哪些資料', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByRole('heading', { name: '排程' })
    expect(screen.getByText(/持股台股的三大法人/)).toBeTruthy()
    expect(screen.getByText(/FRED 五個序列/)).toBeTruthy()
  })

  it('下期預計顯示區間而非單一日期——實際發布日每月都在跳', async () => {
    fetchAdminStatus.mockResolvedValue(status)
    render(<AdminStatusPage />)
    await screen.findByText(/今日班次/)
    // 核心 CPI 已有 2026-06 → 下一期 2026-07 於 2026-08 的 10–14 日發布。
    // 同一字串會出現兩次（表格的「下期預計」與提示列的「下一筆新數據」），故分開驗
    const rows = [...document.querySelectorAll('.data-table tbody tr')]
    const cpi = rows.find((r) => r.textContent?.includes('CPILFESL'))!
    expect(cpi.textContent).toContain('08-10 ~ 14')
    expect(document.querySelector('.ast-next')?.textContent).toContain('08-10 ~ 14')
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
