import { describe, it, expect } from 'vitest'
import {
  WATCHLIST_MAX,
  addWatchItem,
  pruneWatchlist,
  removeWatchItem,
  type WatchItem,
} from './twWatchlist'

const item = (ticker: string, name = ticker): WatchItem => ({ ticker, name })

describe('pruneWatchlist', () => {
  it('drops held tickers and de-dupes', () => {
    const items = [item('2059', '川湖'), item('2330'), item('2059'), item('2303')]
    expect(pruneWatchlist(items, ['2330', '2317']).map((i) => i.ticker)).toEqual(['2059', '2303'])
  })

  it('empty holdings leaves list intact (order preserved)', () => {
    const items = [item('2059'), item('2303')]
    expect(pruneWatchlist(items, []).map((i) => i.ticker)).toEqual(['2059', '2303'])
  })
})

describe('addWatchItem', () => {
  it('appends when under cap and not held', () => {
    const r = addWatchItem([item('2059')], { ticker: '2303', name: '聯電' }, [])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.items.map((i) => i.ticker)).toEqual(['2059', '2303'])
  })

  it('rejects held / duplicate / full / invalid', () => {
    expect(addWatchItem([], { ticker: '2330', name: '台積電' }, ['2330']).ok).toBe(false)
    expect(addWatchItem([item('2303')], { ticker: '2303', name: '聯電' }, []).ok).toBe(false)
    const full = Array.from({ length: WATCHLIST_MAX }, (_, i) => item(String(2000 + i)))
    const fullResult = addWatchItem(full, { ticker: '2330', name: 'x' }, [])
    expect(fullResult.ok).toBe(false)
    if (!fullResult.ok) expect(fullResult.reason).toBe('full')
    expect(addWatchItem([], { ticker: '', name: 'x' }, []).ok).toBe(false)
  })
})

describe('removeWatchItem', () => {
  it('removes by ticker', () => {
    expect(removeWatchItem([item('2059'), item('2303')], '2059').map((i) => i.ticker)).toEqual([
      '2303',
    ])
  })
})
