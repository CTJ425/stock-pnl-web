import { describe, expect, it } from 'vitest'
import { safeStack } from './log.ts'

describe('safeStack', () => {
  it('keeps the message line and only the first 3 frames', () => {
    const err = new Error('boom')
    err.stack = ['Error: boom', '    at a (x.ts:1:1)', '    at b (x.ts:2:2)', '    at c (x.ts:3:3)', '    at d (x.ts:4:4)'].join('\n')
    expect(safeStack(err)?.split('\n')).toEqual(['Error: boom', '    at a (x.ts:1:1)', '    at b (x.ts:2:2)', '    at c (x.ts:3:3)'])
  })

  it('masks anything shaped like a long token', () => {
    const err = new Error('x')
    err.stack = 'Error: fetch https://h/p?sig=abcdefghijklmnopqrstuvwxyz0123456789 failed'
    // '=' is in the token alphabet, so the key and the value are masked together.
    expect(safeStack(err)).toBe('Error: fetch https://h/p?[redacted] failed')
  })

  it('returns undefined for a non-Error or an Error without a stack', () => {
    expect(safeStack('plain')).toBeUndefined()
    const err = new Error('x')
    err.stack = undefined
    expect(safeStack(err)).toBeUndefined()
  })
})
