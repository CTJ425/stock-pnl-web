// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { fetchAdminUsers, setUserAdmin } = vi.hoisted(() => ({
  fetchAdminUsers: vi.fn(),
  setUserAdmin: vi.fn(),
}))
vi.mock('../../services/adminUsers', () => ({ fetchAdminUsers, setUserAdmin }))

import { AccountsSection } from './AccountsSection'

const users = [
  {
    id: 'u1',
    email: 'zrchen0425@gmail.com',
    createdAt: '2026-03-12T02:00:00.000Z',
    lastActiveAt: '2026-08-04T04:05:00.000Z',
    admin: true,
  },
  {
    id: 'u2',
    email: 'alice.wu@example.com',
    createdAt: '2026-05-02T02:00:00.000Z',
    lastActiveAt: null,
    admin: false,
  },
]

describe('AccountsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchAdminUsers.mockResolvedValue(users)
    setUserAdmin.mockResolvedValue(null)
  })
  afterEach(cleanup)

  it('逐列列出帳號，開關反映目前權限', async () => {
    render(<AccountsSection />)
    await screen.findByText('zrchen0425@gmail.com')
    expect(screen.getByText(/共 2 個帳號・1 位管理員/)).toBeTruthy()
    const switches = screen.getAllByRole('switch')
    expect(switches.map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false'])
  })

  it('欄位是「最近活動」不是「最後登入」——後者一直沒登出就永遠不會動', async () => {
    render(<AccountsSection />)
    await screen.findByText('zrchen0425@gmail.com')
    expect(screen.getByRole('columnheader', { name: '最近活動' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: '最後登入' })).toBeNull()
    // 這個時間是「最近一次連線」，畫面要把這件事講出來
    expect(screen.getByText(/最近一次連線/)).toBeTruthy()
  })

  it('把「要重新登入才生效」寫在畫面上——不寫會被當成按了沒反應', async () => {
    render(<AccountsSection />)
    await screen.findByText('zrchen0425@gmail.com')
    expect(screen.getByText(/改完權限，該帳號要重新登入才會生效/)).toBeTruthy()
  })

  it('切換權限成功後才更新畫面', async () => {
    render(<AccountsSection />)
    await screen.findByText('alice.wu@example.com')
    fireEvent.click(screen.getAllByRole('switch')[1])
    await waitFor(() => expect(setUserAdmin).toHaveBeenCalledWith('u2', true))
    await waitFor(() =>
      expect(screen.getAllByRole('switch')[1].getAttribute('aria-checked')).toBe('true'),
    )
  })

  it('後端拒絕時顯示它給的理由，且畫面不得改變', async () => {
    setUserAdmin.mockResolvedValue('不能取消自己的管理員權限')
    render(<AccountsSection />)
    await screen.findByText('zrchen0425@gmail.com')
    fireEvent.click(screen.getAllByRole('switch')[0])

    expect(await screen.findByText('不能取消自己的管理員權限')).toBeTruthy()
    // 樂觀更新會讓失敗看起來像成功，所以刻意等成功才改
    expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('true')
  })

  it('讀不到清單時說明可能的原因，不留白畫面', async () => {
    fetchAdminUsers.mockResolvedValue(null)
    render(<AccountsSection />)
    expect(await screen.findByText(/讀不到帳號清單/)).toBeTruthy()
  })
})
