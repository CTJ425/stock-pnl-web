import { describe, expect, it } from 'vitest'
import { pagedSelect } from './pagedSelect.ts'

type Page = { data: number[] | null; error: { message: string } | null }

describe('pagedSelect', () => {
  it('reads every page until a short one, passing inclusive [from, to] ranges', async () => {
    const calls: Array<[number, number]> = []
    const rows = Array.from({ length: 2500 }, (_, i) => i)
    const { data, error } = await pagedSelect<number>(async (from, to): Promise<Page> => {
      calls.push([from, to])
      return { data: rows.slice(from, to + 1), error: null }
    })
    expect(error).toBeNull()
    expect(data).toHaveLength(2500)
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('returns what it has plus the error when a page fails', async () => {
    let n = 0
    const { data, error } = await pagedSelect<number>(async (): Promise<Page> => {
      n += 1
      return n === 1
        ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null }
        : { data: null, error: { message: 'boom' } }
    })
    expect(data).toHaveLength(1000)
    expect(error?.message).toBe('boom')
  })

  it('treats a null page as empty', async () => {
    const { data, error } = await pagedSelect<number>(async (): Promise<Page> => ({ data: null, error: null }))
    expect(data).toEqual([])
    expect(error).toBeNull()
  })
})
