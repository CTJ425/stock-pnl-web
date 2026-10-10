// @vitest-environment jsdom
/**
 * BUG-119: the 7-day cap with the real supabase-js client (only its fetch is faked). Anything that
 * reads the session after the deadline — auth-js's own refresh tick, or getSession() behind a
 * query — purges it first, so the tab must still end up signed out without waiting for the poll.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { PERSIST_META_KEY, authStorage } from '../services/authPersistence'

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

function fakeSession() {
  const now = Math.floor(Date.now() / 1000)
  const user = { id: 'u-1', aud: 'authenticated', role: 'authenticated', email: 'a@b.c', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u-1', role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now })}.sig`
  return { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt-1', user }
}

const fakeFetch: typeof fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input)
  const body = url.includes('/auth/v1/token') ? fakeSession() : url.includes('/auth/v1/user') ? fakeSession().user : {}
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

let client: SupabaseClient

vi.mock('../services/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseUrl: '',
  initialAuthNotice: null,
  get supabase() {
    return client
  },
}))

const { AuthProvider, useAuth } = await import('./AuthContext')

function Probe() {
  const { signIn, user } = useAuth()
  return (
    <div>
      <span data-testid="email">{user?.email ?? '-'}</span>
      <button type="button" onClick={() => void signIn('a@b.c', 'pw', true)}>
        登入
      </button>
    </div>
  )
}

describe('AuthContext 7-day cap with the real client', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    client = createClient('https://x.supabase.co', 'anon-key', {
      auth: { storage: authStorage },
      global: { fetch: fakeFetch },
    })
  })
  afterEach(async () => {
    cleanup()
    await client.auth.stopAutoRefresh()
  })

  it('E1: a session read after the deadline signs the open tab out, without waiting for the poll', async () => {
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await user.click(await screen.findByRole('button', { name: '登入' }))
    await screen.findByText('a@b.c')

    // The deadline passes. The next thing to look at the session is not the poll but a query.
    localStorage.setItem(PERSIST_META_KEY, String(Date.now() - 1000))
    const { data } = await client.auth.getSession()
    expect(data.session).toBeNull()

    await waitFor(() => expect(screen.getByTestId('email').textContent).toBe('-'))
    expect(Object.keys(localStorage).filter((k) => /^sb-.+-auth-token$/.test(k))).toEqual([])
    expect(localStorage.getItem(PERSIST_META_KEY)).toBeNull()
  })
})
