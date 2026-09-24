import { describe, expect, it } from 'vitest'
import { formatViewHash, parseViewHash } from './viewRoute'

const VIEWS = ['dashboard', 'analysis', 'transactions'] as const

describe('parseViewHash', () => {
  it('reads a page and an optional ticker', () => {
    expect(parseViewHash('#/transactions', VIEWS)).toEqual({ view: 'transactions' })
    expect(parseViewHash('#/analysis/2330', VIEWS)).toEqual({ view: 'analysis', ticker: '2330' })
    expect(parseViewHash('#/analysis/', VIEWS)).toEqual({ view: 'analysis' })
  })

  it('treats an unknown page or a non-route hash as no route', () => {
    expect(parseViewHash('', VIEWS)).toBeNull()
    expect(parseViewHash('#/macro', VIEWS)).toBeNull()
    // Supabase auth redirect: must stay untouched for auth-js.
    expect(parseViewHash('#access_token=abc&type=recovery', VIEWS)).toBeNull()
  })

  it('survives a malformed escape in the ticker', () => {
    expect(parseViewHash('#/analysis/%E0%A4%A', VIEWS)).toEqual({ view: 'analysis' })
  })
})

describe('formatViewHash', () => {
  it('round-trips through parseViewHash, escaping the ticker', () => {
    for (const route of [{ view: 'dashboard' as const }, { view: 'analysis' as const, ticker: 'BRK/B' }]) {
      const hash = formatViewHash(route)
      expect(parseViewHash(hash, VIEWS)).toEqual(route)
    }
    expect(formatViewHash({ view: 'analysis', ticker: 'BRK/B' })).toBe('#/analysis/BRK%2FB')
  })
})
