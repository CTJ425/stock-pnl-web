// @vitest-environment jsdom
/** The two password dialogs: every password they ask for can be revealed, each on its own. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    changePassword: vi.fn(),
    updatePassword: vi.fn(),
    dismissRecovery: vi.fn(),
  }),
}))

const { ChangePasswordModal, RecoveryPasswordModal } = await import('./PasswordModals')

describe('PasswordModals', () => {
  // This project does not set test.globals, so testing-library never auto-registers its cleanup.
  afterEach(cleanup)

  it('M1: ChangePasswordModal reveals current, new and confirm independently', async () => {
    const user = userEvent.setup()
    render(<ChangePasswordModal onClose={() => {}} />)
    const labels = ['目前密碼', '新密碼', '確認新密碼']
    for (const label of labels) {
      expect(screen.getByLabelText(label)).toHaveProperty('type', 'password')
    }

    await user.click(screen.getByRole('button', { name: '顯示新密碼' }))
    expect(screen.getByLabelText('新密碼')).toHaveProperty('type', 'text')
    expect(screen.getByLabelText('目前密碼')).toHaveProperty('type', 'password')
    expect(screen.getByLabelText('確認新密碼')).toHaveProperty('type', 'password')

    await user.click(screen.getByRole('button', { name: '顯示確認新密碼' }))
    expect(screen.getByLabelText('確認新密碼')).toHaveProperty('type', 'text')
  })

  it('M2: RecoveryPasswordModal reveals new and confirm', async () => {
    const user = userEvent.setup()
    render(<RecoveryPasswordModal />)
    await user.click(screen.getByRole('button', { name: '顯示新密碼' }))
    await user.click(screen.getByRole('button', { name: '顯示確認新密碼' }))
    expect(screen.getByLabelText('新密碼')).toHaveProperty('type', 'text')
    expect(screen.getByLabelText('確認新密碼')).toHaveProperty('type', 'text')
  })
})
