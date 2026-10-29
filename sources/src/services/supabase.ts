/**
 * Supabase client initialization.
 * If the environment variable is not set, null is returned and the application is downgraded to "native mode".
 * (localStorage storage, no login required), convenient for use before creating a Supabase project.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseAuthRedirectHash, stripAuthRedirectError, type AuthRedirectNotice } from './authRedirect'
import { authStorage, clearChoiceWithoutSession } from './authPersistence'

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL
const anonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured: boolean = Boolean(
  url && anonKey && !url.startsWith('YOUR_') && !anonKey.startsWith('YOUR_'),
)

/** Public base URL for turning root-relative backend URLs (e.g. signed storage links) absolute. */
export const supabaseUrl: string = (url ?? '').replace(/\/$/, '')

// Captured before `createClient` runs: auth-js consumes and clears the URL hash during its
// own async init, so reading it here is the only way the app can ever see it.
export const initialAuthNotice: AuthRedirectNotice | null =
  typeof window !== 'undefined'
    ? parseAuthRedirectHash(window.location.hash, window.location.search)
    : null

// A failed redirect (Google cancelled, expired email link): clean the URL before auth-js reads it,
// and drop a "保持登入" choice that no session ever came back for.
if (typeof window !== 'undefined' && initialAuthNotice?.kind === 'error') {
  const clean = stripAuthRedirectError(window.location.href)
  if (clean) window.history.replaceState(window.history.state, '', clean)
  clearChoiceWithoutSession()
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, { auth: { storage: authStorage } })
  : null
