// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const { fetchAdminBackups, requestBackupUrl, previewBackupRestore, applyBackupRestore } = vi.hoisted(() => ({
  fetchAdminBackups: vi.fn(),
  requestBackupUrl: vi.fn(),
  previewBackupRestore: vi.fn(),
  applyBackupRestore: vi.fn(),
}))
vi.mock('../../services/adminBackups', () => ({
  fetchAdminBackups,
  requestBackupUrl,
  previewBackupRestore,
  applyBackupRestore,
}))

import { BackupsSection } from './BackupsSection'
import type { AccountBackups } from '../../services/adminBackups'

const UID = '0754d012-7a86-477f-8009-f81531281caf'
const UID2 = '11111111-2222-3333-4444-555555555555'

const rows: AccountBackups[] = [
  {
    userId: UID,
    email: 'a@example.com',
    fileCount: 2,
    newestDate: '2026-08-24',
    totalBytes: 1024 * 1024 * 2,
    files: [
      { name: '2026-08-24.json', date: '2026-08-24', size: 1024 * 1024, createdAt: '2026-08-24T18:00:00.000Z' },
      { name: '2026-08-23.json', date: '2026-08-23', size: 1024 * 1024, createdAt: null },
    ],
    lastRun: { runDate: '2026-08-24', status: 'ok', error: null, transactionCount: 62 },
  },
  {
    userId: UID2,
    email: 'b@example.com',
    fileCount: 0,
    newestDate: null,
    totalBytes: 0,
    files: [],
    lastRun: null,
  },
]

const preview = {
  applied: false,
  backupDate: '2026-08-24',
  tables: {
    workspaces: { inFile: 2, present: 2, missing: 0 },
    transactions: { inFile: 62, present: 10, missing: 52 },
    user_settings: { inFile: 1, present: 1, missing: 0 },
  },
}

async function openFirstFile() {
  await screen.findByText('a@example.com')
  fireEvent.click(screen.getByRole('button', { name: /a@example\.com/ }))
  await screen.findByText('2026-08-24.json')
}

describe('BackupsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchAdminBackups.mockResolvedValue(rows)
    requestBackupUrl.mockResolvedValue({ url: 'https://signed.example/x' })
    previewBackupRestore.mockResolvedValue(preview)
    applyBackupRestore.mockResolvedValue({ ...preview, applied: true })
  })
  afterEach(cleanup)

  it('列出每個帳號的備份份數、最新日期與總大小', async () => {
    render(<BackupsSection />)
    expect(await screen.findByText('a@example.com')).toBeTruthy()
    const row = screen.getByText('a@example.com').closest('tr')!
    expect(within(row).getByText('2')).toBeTruthy()
    expect(within(row).getByText('2026-08-24')).toBeTruthy()
    expect(within(row).getByText(/2\.0 MB/)).toBeTruthy()
  })

  it('沒有備份的帳號仍然列出，且不顯示假的日期', async () => {
    render(<BackupsSection />)
    const row = (await screen.findByText('b@example.com')).closest('tr')!
    expect(within(row).getByText('0')).toBeTruthy()
    expect(within(row).getByText('—')).toBeTruthy()
  })

  it('展開帳號後才列出檔案，且每個檔案都有下載按鈕', async () => {
    render(<BackupsSection />)
    await screen.findByText('a@example.com')
    expect(screen.queryByRole('button', { name: /下載/ })).toBeNull()

    const toggle = screen.getByRole('button', { name: /a@example\.com/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    expect(await screen.findByText('2026-08-24.json')).toBeTruthy()
    expect(screen.getByText('2026-08-23.json')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /下載/ })).toHaveLength(2)
  })

  it('下載會帶「帳號/檔名」的完整路徑，並開新分頁', async () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    render(<BackupsSection />)
    await screen.findByText('a@example.com')
    fireEvent.click(screen.getByRole('button', { name: /a@example\.com/ }))
    await screen.findByText('2026-08-24.json')

    fireEvent.click(screen.getAllByRole('button', { name: /下載/ })[0])
    await waitFor(() => expect(requestBackupUrl).toHaveBeenCalledWith(`${UID}/2026-08-24.json`))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed.example/x', '_blank', 'noopener'))
    vi.unstubAllGlobals()
  })

  it('下載失敗時把後端訊息顯示在畫面上，而且不開分頁', async () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    requestBackupUrl.mockResolvedValue({ error: '找不到備份檔' })
    render(<BackupsSection />)
    await screen.findByText('a@example.com')
    fireEvent.click(screen.getByRole('button', { name: /a@example\.com/ }))
    await screen.findByText('2026-08-24.json')

    fireEvent.click(screen.getAllByRole('button', { name: /下載/ })[0])
    expect(await screen.findByText('找不到備份檔')).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('讀不到資料時說明這一頁只有管理員看得到', async () => {
    fetchAdminBackups.mockResolvedValue(null)
    render(<BackupsSection />)
    expect(await screen.findByText(/只有管理員/)).toBeTruthy()
  })

  it('重新整理會再抓一次', async () => {
    render(<BackupsSection />)
    await screen.findByText('a@example.com')
    expect(fetchAdminBackups).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /重新整理/ }))
    await waitFor(() => expect(fetchAdminBackups).toHaveBeenCalledTimes(2))
  })

  it('畫面要寫明下載連結是短效的，且只有管理員能取得', async () => {
    render(<BackupsSection />)
    await screen.findByText('a@example.com')
    expect(screen.getByText(/短效|有效期限|即將失效/)).toBeTruthy()
  })

  it('顯示最近一次備份的狀態，失敗時把錯誤訊息帶出來', async () => {
    fetchAdminBackups.mockResolvedValue([
      { ...rows[0], lastRun: { runDate: '2026-08-24', status: 'error', error: 'upload failed', transactionCount: 0 } },
    ])
    render(<BackupsSection />)
    const row = (await screen.findByText('a@example.com')).closest('tr')!
    expect(within(row).getByText(/upload failed/)).toBeTruthy()
  })
})

describe('BackupsSection 還原', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchAdminBackups.mockResolvedValue(rows)
    requestBackupUrl.mockResolvedValue({ url: 'https://signed.example/x' })
    previewBackupRestore.mockResolvedValue(preview)
    applyBackupRestore.mockResolvedValue({ ...preview, applied: true })
  })
  afterEach(cleanup)

  it('第一次點還原只做預覽，絕對不寫入', async () => {
    render(<BackupsSection />)
    await openFirstFile()
    fireEvent.click(screen.getAllByRole('button', { name: /還原/ })[0])
    await waitFor(() => expect(previewBackupRestore).toHaveBeenCalledWith(`${UID}/2026-08-24.json`))
    expect(applyBackupRestore).not.toHaveBeenCalled()
  })

  it('預覽要逐表列出「檔案／已存在／將新增」的數字', async () => {
    render(<BackupsSection />)
    await openFirstFile()
    fireEvent.click(screen.getAllByRole('button', { name: /還原/ })[0])
    expect(await screen.findByText(/52/)).toBeTruthy()
    expect(screen.getByText(/62/)).toBeTruthy()
  })

  it('畫面必須寫明還原不會覆蓋或刪除現有資料', async () => {
    render(<BackupsSection />)
    await openFirstFile()
    fireEvent.click(screen.getAllByRole('button', { name: /還原/ })[0])
    expect(await screen.findByText(/不會覆蓋或刪除/)).toBeTruthy()
  })

  it('按下確認還原才真的寫入', async () => {
    render(<BackupsSection />)
    await openFirstFile()
    fireEvent.click(screen.getAllByRole('button', { name: /還原/ })[0])
    fireEvent.click(await screen.findByRole('button', { name: /確認還原/ }))
    await waitFor(() => expect(applyBackupRestore).toHaveBeenCalledWith(`${UID}/2026-08-24.json`))
  })

  it('取消就關掉確認區塊，且沒有寫入', async () => {
    render(<BackupsSection />)
    await openFirstFile()
    fireEvent.click(screen.getAllByRole('button', { name: /還原/ })[0])
    fireEvent.click(await screen.findByRole('button', { name: /取消/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /確認還原/ })).toBeNull())
    expect(applyBackupRestore).not.toHaveBeenCalled()
  })

  it('沒有缺漏時說明資料完整，並停用確認鈕', async () => {
    previewBackupRestore.mockResolvedValue({
      ...preview,
      tables: {
        workspaces: { inFile: 2, present: 2, missing: 0 },
        transactions: { inFile: 62, present: 62, missing: 0 },
        user_settings: { inFile: 1, present: 1, missing: 0 },
      },
    })
    render(<BackupsSection />)
    await openFirstFile()
    fireEvent.click(screen.getAllByRole('button', { name: /還原/ })[0])
    expect(await screen.findByText(/資料完整/)).toBeTruthy()
    expect((await screen.findByRole('button', { name: /確認還原/ })).hasAttribute('disabled')).toBe(true)
  })

  it('預覽被後端拒絕時顯示理由，且不出現確認鈕', async () => {
    previewBackupRestore.mockResolvedValue({ error: '備份檔的帳號與路徑不符' })
    render(<BackupsSection />)
    await openFirstFile()
    fireEvent.click(screen.getAllByRole('button', { name: /還原/ })[0])
    expect(await screen.findByText('備份檔的帳號與路徑不符')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /確認還原/ })).toBeNull()
  })

  it('還原成功後重新抓一次清單', async () => {
    render(<BackupsSection />)
    await openFirstFile()
    expect(fetchAdminBackups).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getAllByRole('button', { name: /還原/ })[0])
    fireEvent.click(await screen.findByRole('button', { name: /確認還原/ }))
    await waitFor(() => expect(fetchAdminBackups).toHaveBeenCalledTimes(2))
  })
})
