// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { fetchAdminStatus } = vi.hoisted(() => ({ fetchAdminStatus: vi.fn() }))
vi.mock('../../services/adminStatus', () => ({ fetchAdminStatus, isAdmin: vi.fn() }))
vi.mock('../../services/adminBackups', () => ({
  fetchAdminBackups: vi.fn().mockResolvedValue(null),
  requestBackupUrl: vi.fn(),
}))
import { AdminConsolePage } from './AdminConsolePage'

describe('AdminConsolePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchAdminStatus.mockResolvedValue(null)
  })
  afterEach(cleanup)

  it('四個項目都在側欄，預設停在資料更新的抓取狀況', async () => {
    render(<AdminConsolePage onExit={() => {}} />)
    const nav = screen.getByRole('navigation', { name: '管理後台頁面' })
    const items = [...nav.querySelectorAll('button')].map((b) => b.textContent)
    expect(items).toEqual(['帳號', '資料更新', 'Discord', '備份'])
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

  it('提供離開後台的出口', () => {
    const onExit = vi.fn()
    render(<AdminConsolePage onExit={onExit} />)
    fireEvent.click(screen.getByRole('button', { name: /回到庫存總覽/ }))
    expect(onExit).toHaveBeenCalledOnce()
  })
})
