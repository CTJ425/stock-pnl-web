// @vitest-environment jsdom
/** Login page: show/hide password, and the "保持登入 7 天" choice reaching signIn. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const signIn = vi.fn()

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    signIn: (...args: unknown[]) => signIn(...args),
    signUp: vi.fn(),
    resetPassword: vi.fn(),
  }),
}))

const { AuthPage } = await import('./AuthPage')

describe('AuthPage', () => {
  // This project does not set test.globals, so testing-library never auto-registers its cleanup.
  afterEach(cleanup)
  beforeEach(() => {
    signIn.mockReset()
    signIn.mockResolvedValue(null)
  })

  it('A1: the password is hidden until the eye button is pressed, then hidden again', async () => {
    const user = userEvent.setup()
    render(<AuthPage />)
    const input = screen.getByLabelText('密碼')
    expect(input).toHaveProperty('type', 'password')

    await user.click(screen.getByRole('button', { name: '顯示密碼' }))
    expect(input).toHaveProperty('type', 'text')
    expect(screen.getByRole('button', { name: '隱藏密碼' })).toHaveProperty('ariaPressed', 'true')

    await user.click(screen.getByRole('button', { name: '隱藏密碼' }))
    expect(input).toHaveProperty('type', 'password')
  })

  it('A2: 保持登入 is checked by default and signIn gets remember=true', async () => {
    const user = userEvent.setup()
    render(<AuthPage />)
    expect(screen.getByLabelText('保持登入 7 天')).toHaveProperty('checked', true)

    await user.type(screen.getByLabelText('電子信箱'), 'a@b.c')
    await user.type(screen.getByLabelText('密碼'), 'secret-pass')
    await user.click(screen.getByRole('button', { name: '登入' }))
    expect(signIn).toHaveBeenCalledWith('a@b.c', 'secret-pass', true)
  })

  it('A3: unchecking 保持登入 sends remember=false', async () => {
    const user = userEvent.setup()
    render(<AuthPage />)
    await user.click(screen.getByLabelText('保持登入 7 天'))
    await user.type(screen.getByLabelText('電子信箱'), 'a@b.c')
    await user.type(screen.getByLabelText('密碼'), 'secret-pass')
    await user.click(screen.getByRole('button', { name: '登入' }))
    expect(signIn).toHaveBeenCalledWith('a@b.c', 'secret-pass', false)
  })

  it('A4: the remember option is only offered when signing in', async () => {
    const user = userEvent.setup()
    render(<AuthPage />)
    await user.click(screen.getByRole('button', { name: '立即註冊' }))
    expect(screen.queryByLabelText('保持登入 7 天')).toBeNull()
    // The sign-up password can be revealed too.
    expect(screen.getByRole('button', { name: '顯示密碼' })).toBeTruthy()
  })
})
