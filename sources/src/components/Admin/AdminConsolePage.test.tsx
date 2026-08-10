// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { fetchAdminStatus, loadAiSettings, saveAiSettings, clearAiSettings } = vi.hoisted(() => ({
  fetchAdminStatus: vi.fn(),
  loadAiSettings: vi.fn(),
  saveAiSettings: vi.fn(),
  clearAiSettings: vi.fn(),
}))
vi.mock('../../services/adminStatus', () => ({ fetchAdminStatus, isAdmin: vi.fn() }))
vi.mock('../../services/aiSettings', () => ({
  loadAiSettings,
  saveAiSettings,
  clearAiSettings,
  validateAiSettings: () => null,
}))

import { AdminConsolePage } from './AdminConsolePage'

describe('AdminConsolePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Both sub-panels will load their own data, and they will all be "checked" to make them empty.
    fetchAdminStatus.mockResolvedValue(null)
    loadAiSettings.mockResolvedValue(null)
  })
  afterEach(cleanup)

  it('五個項目都在側欄，預設停在抓取狀況', async () => {
    render(<AdminConsolePage onExit={() => {}} />)
    const nav = screen.getByRole('navigation', { name: '管理後台頁面' })
    const items = [...nav.querySelectorAll('button')].map((b) => b.textContent)
    expect(items).toEqual(['帳號', '抓取狀況', '手動更新', 'AI 連線', '提示詞'])
    expect(await screen.findByText(/讀不到資料抓取狀況/)).toBeTruthy()
  })

  it('手動更新面板列出五個可觸發的排程 job', async () => {
    render(<AdminConsolePage onExit={() => {}} />)
    const nav = screen.getByRole('navigation', { name: '管理後台頁面' })
    fireEvent.click([...nav.querySelectorAll('button')].find((b) => b.textContent === '手動更新')!)
    expect(await screen.findByRole('heading', { name: '手動更新' })).toBeTruthy()
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

  it('點側欄切換面板，AI 連線顯示設定表單', async () => {
    render(<AdminConsolePage onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 連線' }))
    expect(await screen.findByLabelText(/AI 服務供應商/)).toBeTruthy()
    // The capture status should not remain on the screen after cutting away.
    expect(screen.queryByText(/讀不到資料抓取狀況/)).toBeNull()
  })

  it('金鑰會下發到瀏覽器這件事要寫在畫面上，不能只寫在註解裡', async () => {
    render(<AdminConsolePage onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 連線' }))
    await screen.findByLabelText(/AI 服務供應商/)
    expect(screen.getByText(/金鑰會下發到每個登入者的瀏覽器/)).toBeTruthy()
  })

  it('提供離開後台的出口', () => {
    const onExit = vi.fn()
    render(<AdminConsolePage onExit={onExit} />)
    fireEvent.click(screen.getByRole('button', { name: /回到庫存總覽/ }))
    expect(onExit).toHaveBeenCalledOnce()
  })
})
