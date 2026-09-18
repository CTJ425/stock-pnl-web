// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { fetchAdminStatus, loadAiSettings, loadAiSettingsView, saveAiSettings, clearAiSettings } =
  vi.hoisted(() => ({
    fetchAdminStatus: vi.fn(),
    loadAiSettings: vi.fn(),
    loadAiSettingsView: vi.fn(),
    saveAiSettings: vi.fn(),
    clearAiSettings: vi.fn(),
  }))
vi.mock('../../services/adminStatus', () => ({ fetchAdminStatus, isAdmin: vi.fn() }))
vi.mock('../../services/adminBackups', () => ({
  fetchAdminBackups: vi.fn().mockResolvedValue(null),
  requestBackupUrl: vi.fn(),
}))
vi.mock('../../services/aiSettings', () => ({
  loadAiSettings,
  loadAiSettingsView,
  saveAiSettings,
  clearAiSettings,
  validateAiSettings: () => null,
}))
const { loadAiPrompts } = vi.hoisted(() => ({ loadAiPrompts: vi.fn() }))
vi.mock('../../services/aiPrompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/aiPrompts')>()
  return { ...actual, loadAiPrompts, saveAiPrompts: vi.fn() }
})

import { AdminConsolePage } from './AdminConsolePage'

describe('AdminConsolePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Both sub-panels will load their own data, and they will all be "checked" to make them empty.
    fetchAdminStatus.mockResolvedValue(null)
    loadAiSettings.mockResolvedValue(null)
    loadAiSettingsView.mockResolvedValue({ settings: null, hasKey: false })
    loadAiPrompts.mockResolvedValue({ analysis: '', chat: '' })
  })
  afterEach(cleanup)

  it('五個項目都在側欄，預設停在資料更新的抓取狀況', async () => {
    render(<AdminConsolePage onExit={() => {}} />)
    const nav = screen.getByRole('navigation', { name: '管理後台頁面' })
    const items = [...nav.querySelectorAll('button')].map((b) => b.textContent)
    expect(items).toEqual(['帳號', '資料更新', 'AI 設定', 'Discord', '備份'])
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['抓取狀況', '手動更新', '執行記錄'])
    expect(screen.getByRole('tab', { name: '抓取狀況' }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText(/讀不到資料抓取狀況/)).toBeTruthy()
  })

  it('手動更新分頁列出五個可觸發的排程 job', async () => {
    render(<AdminConsolePage onExit={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: '手動更新' }))
    expect(await screen.findByRole('heading', { name: '手動更新' })).toBeTruthy()
    expect(screen.queryByText(/讀不到資料抓取狀況/)).toBeNull()
    // Labels appear both as row titles and checkbox aria-labels — just assert each job id is present.
    for (const job of [
      'generate-chips',
      'generate-market-data',
      'generate-history',
      'sync-market',
      'sync-macro',
      'sync-fx',
      'probe',
    ]) {
      expect(screen.getByText(job)).toBeTruthy()
    }
    expect(screen.queryByText('sync-top-tickers')).toBeNull()
    expect(screen.getByRole('button', { name: /全部執行/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /執行勾選項目/ })).toBeTruthy()
  })

  it('AI 設定同一頁顯示連線表單與提示詞', async () => {
    render(<AdminConsolePage onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 設定' }))
    expect(await screen.findByLabelText(/AI 服務供應商/)).toBeTruthy()
    expect(await screen.findByRole('heading', { name: '提示詞' })).toBeTruthy()
    // The capture status should not remain on the screen after cutting away.
    expect(screen.queryByText(/讀不到資料抓取狀況/)).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  /**
   * 161: google 的金鑰改由 ai-proxy 在伺服器端注入，openai-compatible 仍是瀏覽器直連。
   * 金鑰到底會不會下發，必須照供應商如實寫在畫面上，不能只寫在註解裡。
   */
  it('google 要寫明金鑰留在伺服器端', async () => {
    render(<AdminConsolePage onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 設定' }))
    await screen.findByLabelText(/AI 服務供應商/)
    expect(screen.getByText(/金鑰只存在伺服器端/)).toBeTruthy()
    expect(screen.queryByText(/金鑰會下發到每個登入者的瀏覽器/)).toBeNull()
  })

  it('openai-compatible 要照實寫明金鑰會下發到瀏覽器', async () => {
    render(<AdminConsolePage onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 設定' }))
    const select = await screen.findByLabelText(/AI 服務供應商/)
    fireEvent.change(select, { target: { value: 'openai-compatible' } })
    expect(screen.getByText(/金鑰會下發到每個登入者的瀏覽器/)).toBeTruthy()
  })

  it('提供離開後台的出口', () => {
    const onExit = vi.fn()
    render(<AdminConsolePage onExit={onExit} />)
    fireEvent.click(screen.getByRole('button', { name: /回到庫存總覽/ }))
    expect(onExit).toHaveBeenCalledOnce()
  })
})
