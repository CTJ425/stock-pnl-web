/**
 * Signup confirmation link: Supabase redirects back with the session in the URL hash.
 * The Supabase client consumes and clears that hash during its own async initialization,
 * so the hash must be parsed before `createClient` runs (see services/supabase.ts).
 */
export type AuthRedirectNotice =
  | { kind: 'signup-confirmed' }
  | { kind: 'error'; message: string }

export function parseAuthRedirectHash(hash: string): AuthRedirectNotice | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))

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
