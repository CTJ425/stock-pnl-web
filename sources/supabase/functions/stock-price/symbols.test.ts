import { describe, it, expect } from 'vitest'
import { isValidSymbol, sanitizeSymbols } from './symbols.ts'

describe('isValidSymbol', () => {
  it.each([
    { market: 'TPE', ticker: '2330' },
    { market: 'TPE', ticker: '00679B' },
    { market: 'TPE', ticker: '6488' },
    { market: 'US', ticker: 'AAPL' },
    { market: 'US', ticker: 'BRK.B' },
    { market: 'US', ticker: 'BF-B' },
    { market: 'US', ticker: 'brk.b' },
    { market: 'IDX', ticker: '^TWII' },
    { market: 'IDX', ticker: '^GSPC' },
  ])('accepts %j', (symbol) => {
    expect(isValidSymbol(symbol)).toBe(true)
  })

  it.each([
    ['null', null],
    ['a number', 7],
    ['a string', '2330'],
    ['an array', ['TPE', '2330']],
    ['no ticker', { market: 'TPE' }],
    ['no market', { ticker: '2330' }],
    ['unknown market', { market: 'JP', ticker: '7203' }],
    ['numeric ticker', { market: 'TPE', ticker: 2330 }],
    ['empty ticker', { market: 'US', ticker: '' }],
    ['over-long ticker', { market: 'US', ticker: 'A'.repeat(17) }],
    ['space', { market: 'US', ticker: 'AA PL' }],
    ['query injection', { market: 'TPE', ticker: 'x&json=0' }],
    ['channel injection', { market: 'TPE', ticker: '2330.tw|tse_t00' }],
    ['path traversal', { market: 'US', ticker: '../etc' }],
    ['slash', { market: 'US', ticker: 'A/B' }],
    ['percent escape', { market: 'US', ticker: 'A%7CB' }],
    ['dot in a Taiwan code', { market: 'TPE', ticker: '2330.TW' }],
    ['caret in a Taiwan code', { market: 'TPE', ticker: '^TWII' }],
    ['9-char Taiwan code', { market: 'TPE', ticker: '123456789' }],
  ])('rejects %s', (_label, symbol) => {
    expect(isValidSymbol(symbol)).toBe(false)
  })
})

describe('sanitizeSymbols', () => {
  it('keeps the valid elements in order and drops the rest instead of failing the batch', () => {
    const got = sanitizeSymbols([
      { market: 'TPE', ticker: '2330' },
      null,
      { market: 'TPE', ticker: 'x&json=0' },
      { market: 'US', ticker: 'AAPL', extra: 'ignored' },
    ])
    expect(got).toEqual([
      { market: 'TPE', ticker: '2330' },
      { market: 'US', ticker: 'AAPL' },
    ])
  })

  it('returns nothing for a value that is not an array', () => {
    expect(sanitizeSymbols(undefined)).toEqual([])
    expect(sanitizeSymbols({ market: 'TPE', ticker: '2330' })).toEqual([])
    expect(sanitizeSymbols('2330')).toEqual([])
  })
})
