// @vitest-environment jsdom
/**
 * Change password from inside the account.
 * Supabase lets any live session call updateUser({ password }) with no proof of the old password,
 * so the context must re-authenticate with the current password before it changes anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const signInWithPassword = vi.fn()
const updateUser = vi.fn()

vi.mock('../services/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseUrl: '',
  initialAuthNotice: null,
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: 'u1', email: 'a@b.c' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      updateUser: (...args: unknown[]) => updateUser(...args),
    },
  },
}))

const { AuthProvider, useAuth } = await import('./AuthContext')

function Probe() {
  const { changePassword, user } = useAuth()
  return (
    <div>
      <span data-testid="email">{user?.email ?? '-'}</span>
      <button
        type="button"
        onClick={() => {
          void changePassword('old-pass', 'new-pass').then((err) => {
            document.title = err ?? 'OK'
          })
        }}
      >
        送出
      </button>
    </div>
  )
}

async function clickChange() {
  const user = userEvent.setup()
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
  await screen.findByText('a@b.c')
  await user.click(screen.getByRole('button', { name: '送出' }))
}

describe('AuthContext.changePassword', () => {
  // This project does not set test.globals, so testing-library never auto-registers its cleanup.
  afterEach(cleanup)

  beforeEach(() => {
    signInWithPassword.mockReset()
    updateUser.mockReset()
    document.title = ''
  })

  it('C1: re-authenticates with the current password, then sets the new one', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    updateUser.mockResolvedValue({ error: null })

    await clickChange()

    await waitFor(() => expect(document.title).toBe('OK'))
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.c', password: 'old-pass' })
    expect(updateUser).toHaveBeenCalledWith({ password: 'new-pass' })
  })

  it('C2: rejects a wrong current password and never calls updateUser', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    updateUser.mockResolvedValue({ error: null })

    await clickChange()

    await waitFor(() => expect(document.title).toBe('目前密碼不正確'))
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('C3: returns the Supabase error when the new password is refused', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    updateUser.mockResolvedValue({ error: { message: 'Password should be at least 6 characters' } })

    await clickChange()

    await waitFor(() =>
      expect(document.title).toBe('Password should be at least 6 characters'),
    )
  })
})
