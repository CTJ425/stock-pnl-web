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
const signInWithOAuth = vi.fn()
let sessionUser: Record<string, unknown> = { id: 'u1', email: 'a@b.c' }
const signOut = vi.fn()
let authListener: ((event: string, session: unknown) => void) | null = null

vi.mock('../services/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseUrl: '',
  initialAuthNotice: null,
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: sessionUser } } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authListener = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      signInWithOAuth: (...args: unknown[]) => signInWithOAuth(...args),
      signOut: (...args: unknown[]) => signOut(...args),
    },
  },
}))

const { AuthProvider, useAuth } = await import('./AuthContext')

function Probe({ remember }: { remember: boolean }) {
  const { signIn, signInWithGoogle, user } = useAuth()
  return (
    <div>
      <span data-testid="email">{user?.email ?? '-'}</span>
      <span data-testid="has-password">{String(user?.hasPassword)}</span>
      <button type="button" onClick={() => void signIn('a@b.c', 'pw', remember)}>
        登入
      </button>
      <button type="button" onClick={() => void signInWithGoogle(remember)}>
        Google
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
    signInWithOAuth.mockReset()
    sessionUser = { id: 'u1', email: 'a@b.c' }
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

  it('X6: Google sign-in records the choice before leaving and returns to this page', async () => {
    let metaAtCall: string | null = 'unset'
    signInWithOAuth.mockImplementation(() => {
      metaAtCall = localStorage.getItem(PERSIST_META_KEY)
      return Promise.resolve({ data: {}, error: null })
    })
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <Probe remember={false} />
      </AuthProvider>,
    )
    await screen.findByText('a@b.c')
    await user.click(screen.getByRole('button', { name: 'Google' }))
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled())
    expect(metaAtCall).toBe('session')
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
  })

  it('X7: a Google redirect that cannot start leaves no persistence choice behind', async () => {
    signInWithOAuth.mockResolvedValue({ data: {}, error: { message: 'bad' } })
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <Probe remember />
      </AuthProvider>,
    )
    await screen.findByText('a@b.c')
    await user.click(screen.getByRole('button', { name: 'Google' }))
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled())
    await waitFor(() => expect(localStorage.getItem(PERSIST_META_KEY)).toBeNull())
  })

  it('X8: an account that only has a Google identity has no password', async () => {
    sessionUser = { id: 'u1', email: 'a@b.c', app_metadata: { providers: ['google'] } }
    render(
      <AuthProvider>
        <Probe remember />
      </AuthProvider>,
    )
    await screen.findByText('a@b.c')
    expect(screen.getByTestId('has-password').textContent).toBe('false')
  })

  it('X9: an email account later linked to Google keeps its password', async () => {
    sessionUser = { id: 'u1', email: 'a@b.c', app_metadata: { providers: ['email', 'google'] } }
    render(
      <AuthProvider>
        <Probe remember />
      </AuthProvider>,
    )
    await screen.findByText('a@b.c')
    expect(screen.getByTestId('has-password').textContent).toBe('true')
  })
})
