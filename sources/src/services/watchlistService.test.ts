import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The query builder is chainable and awaited at the end, so one recording stub stands in for
 * every link of the chain and resolves to whatever the test preloaded.
 */
interface QueryStub {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  then: (onOk: (v: unknown) => unknown) => Promise<unknown>
}

const { from, getUser, setResult, setResults, lastQuery } = vi.hoisted(() => {
  // `queue` is consumed one entry per awaited query; the last entry repeats once drained, so a
  // single-result test needs no queue at all.
  let queue: unknown[] = [{ data: [], error: null }]
  let last: unknown = null
  const take = () => (queue.length > 1 ? queue.shift() : queue[0])
  const make = (): unknown => {
    const q: Record<string, unknown> = {}
    for (const k of ['select', 'insert', 'delete', 'upsert', 'order', 'eq']) {
      q[k] = vi.fn(() => q)
    }
    q.then = (onOk: (v: unknown) => unknown) => Promise.resolve(take()).then(onOk)
    last = q
    return q
  }
  return {
    from: vi.fn(() => make()),
    getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })),
    setResult: (r: unknown) => {
      queue = [r]
    },
    setResults: (rs: unknown[]) => {
      queue = rs
    },
    lastQuery: () => last as unknown as QueryStub,
  }
})

vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from, auth: { getUser } },
}))

import { WATCHLIST_MAX, addWatch, listWatchlist, removeWatch } from './watchlistService'

beforeEach(() => {
  vi.clearAllMocks()
  setResult({ data: [], error: null })
})

describe('listWatchlist', () => {
  it('依 sort_order 回傳觀察標的', async () => {
    setResult({
      data: [
        { ticker: '2330', name: '台積電', sort_order: 0 },
        { ticker: '2059', name: '川湖', sort_order: 1 },
      ],
      error: null,
    })

    const got = await listWatchlist()

    expect(from).toHaveBeenCalledWith('tw_watchlist')
    expect(got).toEqual([
      { ticker: '2330', name: '台積電', sortOrder: 0 },
      { ticker: '2059', name: '川湖', sortOrder: 1 },
    ])
  })

  it('查詢失敗時丟出中文錯誤', async () => {
    setResult({ data: null, error: { message: 'boom' } })
    await expect(listWatchlist()).rejects.toThrow(/觀察清單/)
  })

  it('沒有資料時回傳空陣列而不是 null', async () => {
    setResult({ data: null, error: null })
    expect(await listWatchlist()).toEqual([])
  })
})

describe('addWatch', () => {
  it('寫入時帶上 user_id，並排在現有清單之後', async () => {
    setResult({
      data: [{ ticker: '2330', name: '台積電', sort_order: 0 }],
      error: null,
    })

    await addWatch('2059', '川湖')

    expect(lastQuery().insert).toHaveBeenCalledWith({
      user_id: 'u1',
      ticker: '2059',
      name: '川湖',
      sort_order: 1,
    })
  })

  it('清單已滿時不送出請求，直接丟錯', async () => {
    setResult({
      data: Array.from({ length: WATCHLIST_MAX }, (_, i) => ({
        ticker: String(1000 + i),
        name: `N${i}`,
        sort_order: i,
      })),
      error: null,
    })

    await expect(addWatch('2059', '川湖')).rejects.toThrow(new RegExp(String(WATCHLIST_MAX)))
    expect(lastQuery().insert).not.toHaveBeenCalled()
  })

  it('代號格式不合法時直接丟錯', async () => {
    await expect(addWatch('!!', 'x')).rejects.toThrow(/代號/)
    expect(from).not.toHaveBeenCalled()
  })
})

describe('removeWatch', () => {
  it('以代號刪除（使用者範圍交給 RLS）', async () => {
    await removeWatch('2059')
    expect(lastQuery().delete).toHaveBeenCalled()
    expect(lastQuery().eq).toHaveBeenCalledWith('ticker', '2059')
  })
})

describe('資料庫上限錯誤', () => {
  it('trigger 擋下時翻成中文訊息，不把 Postgres 原文丟給使用者', async () => {
    // Two tabs can both pass the client-side cap check; the loser gets the trigger's raw text.
    // First query is the cap read (under the limit), second is the insert the trigger rejects.
    setResults([
      { data: [], error: null },
      { data: null, error: { message: 'tw_watchlist limit is 30' } },
    ])

    await expect(addWatch('2059', '川湖')).rejects.toThrow(
      new RegExp(`觀察清單最多只能有 ${WATCHLIST_MAX} 檔`),
    )
  })
})
