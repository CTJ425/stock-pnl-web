/**
 * Signup confirmation link: Supabase redirects back with the session in the URL hash.
 * The Supabase client consumes and clears that hash during its own async initialization,
 * so the app must read the hash first and turn it into a notice for the user.
 */
import { describe, expect, it } from 'vitest'
import { parseAuthRedirectHash, stripAuthRedirectError } from './authRedirect'

describe('parseAuthRedirectHash', () => {
  it('R1: reports a confirmed signup when the hash carries an access token and type=signup', () => {
    const hash =
      '#access_token=eyJhbGc&expires_in=3600&refresh_token=abc&token_type=bearer&type=signup'
    expect(parseAuthRedirectHash(hash)).toEqual({ kind: 'signup-confirmed' })
  })

  it('R2: ignores a password recovery redirect, which has its own modal', () => {
    const hash = '#access_token=eyJhbGc&expires_in=3600&token_type=bearer&type=recovery'
    expect(parseAuthRedirectHash(hash)).toBeNull()
  })

  it('R3: ignores an empty hash and a hash with no auth fields', () => {
    expect(parseAuthRedirectHash('')).toBeNull()
    expect(parseAuthRedirectHash('#section=dashboard')).toBeNull()
  })

  it('R4: reports an expired or invalid link as an error with the decoded description', () => {
    const hash =
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    expect(parseAuthRedirectHash(hash)).toEqual({
      kind: 'error',
      message: 'Email link is invalid or has expired',
    })
  })

  it('R5: falls back to the error code when the redirect carries no description', () => {
    expect(parseAuthRedirectHash('#error=server_error')).toEqual({
      kind: 'error',
      message: 'server_error',
    })
  })

  it('R6: reads an error from the query string, where a failed Google sign-in can put it', () => {
    expect(
      parseAuthRedirectHash('', '?error=access_denied&error_description=User+cancelled'),
    ).toEqual({ kind: 'error', message: 'User cancelled' })
  })

  it('R7: a Google sign-in that succeeded shows no notice (the session itself is the result)', () => {
    const hash = '#access_token=eyJhbGc&expires_in=3600&provider_token=ya29&refresh_token=abc&token_type=bearer'
    expect(parseAuthRedirectHash(hash, '')).toBeNull()
  })
})

describe('stripAuthRedirectError', () => {
  it('S1: removes the error fields from the query string and keeps the rest of the URL', () => {
    expect(
      stripAuthRedirectError('https://x.dev/app/?tab=1&error=access_denied&error_description=No#keep=1'),
    ).toBe('https://x.dev/app/?tab=1#keep=1')
  })

  it('S2: removes the error fields from the hash', () => {
    expect(
      stripAuthRedirectError('https://x.dev/#error=access_denied&error_code=otp_expired&error_description=x'),
    ).toBe('https://x.dev/')
  })

  it('S3: leaves a URL without an error alone', () => {
    expect(stripAuthRedirectError('https://x.dev/#access_token=a&type=signup')).toBeNull()
  })
})
