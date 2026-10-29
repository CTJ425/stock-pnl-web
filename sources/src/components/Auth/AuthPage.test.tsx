// @vitest-environment jsdom
/** Login page: show/hide password, the "保持登入 7 天" choice reaching signIn, and Google sign-in. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const signIn = vi.fn()
const signInWithGoogle = vi.fn()

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    signIn: (...args: unknown[]) => signIn(...args),
    signInWithGoogle: (...args: unknown[]) => signInWithGoogle(...args),
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
    signInWithGoogle.mockReset()
    signInWithGoogle.mockResolvedValue(null)
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

  it('A5: the Google button carries the 保持登入 choice', async () => {
    const user = userEvent.setup()
    render(<AuthPage />)
    await user.click(screen.getByLabelText('保持登入 7 天'))
    await user.click(screen.getByRole('button', { name: '使用 Google 帳戶登入' }))
    expect(signInWithGoogle).toHaveBeenCalledWith(false)
  })

  it('A6: a redirect that cannot start is reported and the button is usable again', async () => {
    signInWithGoogle.mockResolvedValue('provider is not enabled')
    const user = userEvent.setup()
    render(<AuthPage />)
    await user.click(screen.getByRole('button', { name: '使用 Google 帳戶登入' }))
    expect(await screen.findByText('無法前往 Google 登入：provider is not enabled')).toBeTruthy()
    expect(screen.getByRole('button', { name: '使用 Google 帳戶登入' })).toHaveProperty('disabled', false)
  })

  it('A7: Google is offered on sign-up but not on the password-reset form', async () => {
    const user = userEvent.setup()
    render(<AuthPage />)
    await user.click(screen.getByRole('button', { name: '立即註冊' }))
    expect(screen.getByRole('button', { name: '使用 Google 帳戶註冊' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '返回登入' }))
    await user.click(screen.getByRole('button', { name: '忘記密碼？' }))
    expect(screen.queryByRole('button', { name: /使用 Google 帳戶/ })).toBeNull()
  })

  it('A8: a Google sign-up keeps the default 保持登入, even if it was unchecked on the sign-in form', async () => {
    const user = userEvent.setup()
    render(<AuthPage />)
    await user.click(screen.getByLabelText('保持登入 7 天'))
    await user.click(screen.getByRole('button', { name: '立即註冊' }))
    await user.click(screen.getByRole('button', { name: '使用 Google 帳戶註冊' }))
    expect(signInWithGoogle).toHaveBeenCalledWith(true)
  })

  it('A9: coming back from Google with the back button makes the form usable again', async () => {
    signInWithGoogle.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    render(<AuthPage />)
    await user.click(screen.getByRole('button', { name: '使用 Google 帳戶登入' }))
    expect(screen.getByRole('button', { name: '使用 Google 帳戶登入' })).toHaveProperty('disabled', true)
    const back = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(back, 'persisted', { value: true })
    act(() => {
      window.dispatchEvent(back)
    })
    expect(screen.getByRole('button', { name: '使用 Google 帳戶登入' })).toHaveProperty('disabled', false)
  })
})
