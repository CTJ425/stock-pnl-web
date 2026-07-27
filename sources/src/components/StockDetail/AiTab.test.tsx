// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { AiTab } from './AiTab'

const {
  loadAiSettings,
  saveAiSettings,
  clearAiSettings,
  isAiAdmin,
  fetchDailySeries,
  fetchNews,
  createAiProvider,
} = vi.hoisted(() => ({
  loadAiSettings: vi.fn(),
  saveAiSettings: vi.fn(),
  clearAiSettings: vi.fn(),
  isAiAdmin: vi.fn(),
  fetchDailySeries: vi.fn(),
  fetchNews: vi.fn(),
  createAiProvider: vi.fn(),
}))

vi.mock('../../services/aiSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/aiSettings')>()
  return {
    ...actual,
    loadAiSettings,
    saveAiSettings,
    clearAiSettings,
    isAiAdmin,
  }
})

vi.mock('../../services/dailyProxy', () => ({
  fetchDailySeries,
}))

vi.mock('../../services/newsProxy', () => ({
  fetchNews,
}))

vi.mock('../../services/aiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/aiClient')>()
  return {
    ...actual,
    createAiProvider,
  }
})

import { AiError } from '../../services/aiClient'
import type { ReportData } from '../../services/reportProxy'

const dummyReport: ReportData = {
  schema: 3,
  ticker: '2330',
  name: '台積電',
  market: 'TPE',
  dataDate: '2026-07-22',
  generatedAt: '2026-07-22T20:30:00Z',
  holding: null,
  institutional: null,
  margin: null,
  borrow: null,
  history: [],
  streaks: { foreign: 0, foreignDealer: 0, trust: 0, dealer: 0, total: 0, margin: 0, short: 0 },
  notes: [],
}

const dummyDaily = {
  ticker: '2330',
  rows: [
    ['2026-07-20', 980, 1000, 970, 990, 10000] as const,
    ['2026-07-21', 990, 1020, 985, 1010, 12000] as const,
    ['2026-07-22', 1010, 1030, 1000, 1025, 15000] as const,
  ],
}

describe('AiTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchDailySeries.mockResolvedValue(dummyDaily)
    fetchNews.mockResolvedValue(null)
    isAiAdmin.mockResolvedValue(true)
  })

  afterEach(() => {
    cleanup()
  })

  it('未設定 AI 服務時應顯示設定表單，且畫面不出現任何 AI 生成文字', async () => {
    loadAiSettings.mockResolvedValue(null)

    render(<AiTab ticker="2330" name="台積電" report={dummyReport} fundamental={null} />)

    await screen.findByText('未設定 AI 服務供應商')

    expect(screen.getByLabelText(/AI 服務供應商/)).toBeTruthy()
    expect(screen.queryByText(/免責聲明/)).toBeNull()
  })

  it('已設定 AI 服務時，點擊「產生解讀」應觸發 AI 完成並顯示結果與免責聲明', async () => {
    loadAiSettings.mockResolvedValue({
      provider: 'google',
      baseUrl: '',
      model: 'gemini-2.5-flash',
      apiKey: 'test-key',
    })

    const mockComplete = vi.fn().mockResolvedValue('這是 Mock 的 AI 數據解讀結果。')
    createAiProvider.mockReturnValue({
      kind: 'google',
      complete: mockComplete,
    })

    render(<AiTab ticker="2330" name="台積電" report={dummyReport} fundamental={null} />)

    const btn = await screen.findByRole('button', { name: '產生解讀' })
    fireEvent.click(btn)

    await screen.findByText('這是 Mock 的 AI 數據解讀結果。')

    expect(screen.getByText(/免責聲明/)).toBeTruthy()
    expect(mockComplete).toHaveBeenCalledTimes(1)
  })

  it('基本面與新聞有資料時應一併餵進 prompt；新聞為 null 時仍可完成解讀', async () => {
    loadAiSettings.mockResolvedValue({
      provider: 'google',
      baseUrl: '',
      model: 'gemini-2.5-flash',
      apiKey: 'test-key',
    })
    fetchNews.mockResolvedValue({
      ticker: '2330',
      asOf: '2026-07-27T09:35:00.000Z',
      items: [
        {
          title: '台積電先進製程需求強勁',
          source: '自由財經',
          publishedAt: '2026-07-27T02:08:08.000Z',
        },
      ],
    })

    const mockComplete = vi.fn().mockResolvedValue('含基本面與消息面的解讀。')
    createAiProvider.mockReturnValue({ kind: 'google', complete: mockComplete })

    render(
      <AiTab
        ticker="2330"
        name="台積電"
        report={dummyReport}
        fundamental={{
          ticker: '2330',
          asOf: '2026-07-27T09:31:00.000Z',
          dataDate: '2026-07-25',
          industry: '半導體業',
          valuation: {
            peRatio: 31.59,
            dividendYieldPercent: 0.94,
            pbRatio: 10.34,
            dataDate: '2026-07-24',
          },
          revenueUnit: '千元',
          revenueMonths: [
            {
              yearMonth: '2026-06',
              revenueThousandTwd: 442679969,
              momPercent: 6.16,
              yoyPercent: 67.87,
              cumulativeYoyPercent: 35.61,
            },
          ],
          notes: [],
        }}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '產生解讀' }))
    await screen.findByText('含基本面與消息面的解讀。')

    const { user } = mockComplete.mock.calls[0][0] as { user: string }
    expect(user).toContain('半導體業')
    expect(user).toContain('本益比 31.59')
    expect(user).toContain('台積電先進製程需求強勁')
  })

  it('新聞查無資料時不阻斷解讀，prompt 帶缺料文案', async () => {
    loadAiSettings.mockResolvedValue({
      provider: 'google',
      baseUrl: '',
      model: 'gemini-2.5-flash',
      apiKey: 'test-key',
    })
    fetchNews.mockResolvedValue(null)

    const mockComplete = vi.fn().mockResolvedValue('沒有新聞也能解讀。')
    createAiProvider.mockReturnValue({ kind: 'google', complete: mockComplete })

    render(<AiTab ticker="2330" name="台積電" report={dummyReport} fundamental={null} />)

    fireEvent.click(await screen.findByRole('button', { name: '產生解讀' }))
    await screen.findByText('沒有新聞也能解讀。')

    const { user } = mockComplete.mock.calls[0][0] as { user: string }
    expect(user).toContain('請勿臆測消息面')
    expect(user).toContain('請勿臆測任何基本面數據')
  })

  it('非管理員不應看到設定表單與「AI 設定」按鈕，但仍可產生解讀', async () => {
    isAiAdmin.mockResolvedValue(false)
    loadAiSettings.mockResolvedValue({
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3',
      apiKey: '',
    })

    const mockComplete = vi.fn().mockResolvedValue('非管理員也拿得到解讀。')
    createAiProvider.mockReturnValue({
      kind: 'openai-compatible',
      complete: mockComplete,
    })

    render(<AiTab ticker="2330" name="台積電" report={dummyReport} fundamental={null} />)

    const btn = await screen.findByRole('button', { name: '產生解讀' })
    expect(screen.queryByRole('button', { name: /AI 設定/ })).toBeNull()
    expect(screen.getByText(/僅管理員可修改/)).toBeTruthy()

    fireEvent.click(btn)
    await screen.findByText('非管理員也拿得到解讀。')
  })

  it('非管理員且全站未設定時，應顯示聯絡管理員的提示而非設定表單', async () => {
    isAiAdmin.mockResolvedValue(false)
    loadAiSettings.mockResolvedValue(null)

    render(<AiTab ticker="2330" name="台積電" report={dummyReport} fundamental={null} />)

    await screen.findByText(/請聯絡管理員完成設定/)
    expect(screen.queryByLabelText(/AI 服務供應商/)).toBeNull()
    expect(screen.queryByRole('button', { name: '前往設定' })).toBeNull()
  })

  it('當產生過程失敗時應顯示錯誤訊息與「重試」按鈕', async () => {
    loadAiSettings.mockResolvedValue({
      provider: 'google',
      baseUrl: '',
      model: 'gemini-2.5-flash',
      apiKey: 'test-key',
    })

    const mockComplete = vi.fn().mockRejectedValue(new AiError('auth', 'API Key 無效'))
    createAiProvider.mockReturnValue({
      kind: 'google',
      complete: mockComplete,
    })

    render(<AiTab ticker="2330" name="台積電" report={dummyReport} fundamental={null} />)

    const btn = await screen.findByRole('button', { name: '產生解讀' })
    fireEvent.click(btn)

    await screen.findByText('API Key 無效')
    expect(screen.getByRole('button', { name: '重試' })).toBeTruthy()
  })
})
