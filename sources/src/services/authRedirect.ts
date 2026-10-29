/**
 * Signup confirmation link and Google sign-in: Supabase redirects back with the session in the
 * URL hash. The Supabase client consumes and clears that hash during its own async initialization,
 * so the hash must be parsed before `createClient` runs (see services/supabase.ts).
 * A failed redirect may carry its error in the query string instead; auth-js reads both, with the
 * query string taking precedence, and so does this.
 */
export type AuthRedirectNotice =
  | { kind: 'signup-confirmed' }
  | { kind: 'error'; message: string }

const ERROR_KEYS = ['error', 'error_code', 'error_description']

/**
 * The URL with the redirect's error fields removed, or null when it has none. auth-js throws on
 * an error before it cleans the URL, so without this every reload repeats the failed redirect:
 * the notice comes back and auth-js skips restoring the stored session.
 */
export function stripAuthRedirectError(href: string): string | null {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  if (!ERROR_KEYS.some((key) => url.searchParams.has(key) || hash.has(key))) return null
  for (const key of ERROR_KEYS) {
    url.searchParams.delete(key)
    hash.delete(key)
  }
  const rest = hash.toString()
  url.hash = rest ? `#${rest}` : ''
  return url.toString()
}

export function parseAuthRedirectHash(hash: string, search = ''): AuthRedirectNotice | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  new URLSearchParams(search).forEach((value, key) => params.set(key, value))

  const error = params.get('error')
  if (error) {
    const message = params.get('error_description') ?? params.get('error_code') ?? error
    return { kind: 'error', message }
  }

  if (params.get('access_token') && params.get('type') === 'signup') {
    return { kind: 'signup-confirmed' }
  }

  return null
}
