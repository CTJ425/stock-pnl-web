// @vitest-environment jsdom
/**
 * "保持登入 7 天" at the context level: signIn decides the storage before the session is written,
 * a failed sign-in leaves no choice behind, and an open tab signs itself out past the 7-day cap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PERSIST_META_KEY } from '../services/authPersistence'

const signInWithPassword = vi.fn()
const signOut = vi.fn()
let authListener: ((event: string, session: unknown) => void) | null = null

vi.mock('../services/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseUrl: '',
  initialAuthNotice: null,
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: 'u1', email: 'a@b.c' } } } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authListener = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      signOut: (...args: unknown[]) => signOut(...args),
    },
  },
}))

const { AuthProvider, useAuth } = await import('./AuthContext')

function Probe({ remember }: { remember: boolean }) {
  const { signIn, user } = useAuth()
  return (
    <div>
      <span data-testid="email">{user?.email ?? '-'}</span>
      <button type="button" onClick={() => void signIn('a@b.c', 'pw', remember)}>
        登入
      </button>
    </div>
  )
}

describe('AuthContext persistence', () => {
  // This project does not set test.globals, so testing-library never auto-registers its cleanup.
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })
  beforeEach(() => {
    localStorage.clear()
    signInWithPassword.mockReset()
    signOut.mockReset()
    signOut.mockResolvedValue({ error: null })
    authListener = null
  })

  it('X1: signIn records the choice before calling Supabase', async () => {
    let metaAtCall: string | null = 'unset'
    signInWithPassword.mockImplementation(() => {
      metaAtCall = localStorage.getItem(PERSIST_META_KEY)
      return Promise.resolve({ error: null })
    })
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <Probe remember={false} />
      </AuthProvider>,
    )
    await screen.findByText('a@b.c')
    await user.click(screen.getByRole('button', { name: '登入' }))
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalled())
    expect(metaAtCall).toBe('session')
  })

  it('X2: a failed sign-in leaves no persistence choice behind', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'bad' } })
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <Probe remember />
      </AuthProvider>,
    )
    await screen.findByText('a@b.c')
    await user.click(screen.getByRole('button', { name: '登入' }))
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalled())
    await waitFor(() => expect(localStorage.getItem(PERSIST_META_KEY)).toBeNull())
  })

  it('X3: SIGNED_OUT forgets the choice so the next session starts from the default', async () => {
    localStorage.setItem(PERSIST_META_KEY, 'session')
    render(
      <AuthProvider>
        <Probe remember />
      </AuthProvider>,
    )
    await screen.findByText('a@b.c')
    authListener?.('SIGNED_OUT', null)
    expect(localStorage.getItem(PERSIST_META_KEY)).toBeNull()
  })

  it('X4: an open tab signs itself out locally once the 7 days have passed', async () => {
    localStorage.setItem(PERSIST_META_KEY, String(Date.now() - 1000))
    render(
      <AuthProvider>
        <Probe remember />
      </AuthProvider>,
    )
    await screen.findByText('a@b.c')
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: 'local' }))
  })

  it('X5: a login still inside the 7 days is left alone', async () => {
    localStorage.setItem(PERSIST_META_KEY, String(Date.now() + 60_000))
    render(
      <AuthProvider>
        <Probe remember />
      </AuthProvider>,
    )
    await screen.findByText('a@b.c')
    expect(signOut).not.toHaveBeenCalled()
  })
})
