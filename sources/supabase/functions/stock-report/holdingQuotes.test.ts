// Task 165 Phase 2 step 2b — spec docs/agent/specs/discord-holdings.md §2.2.
import { describe, expect, it } from 'vitest'
import { indexChartUrl, type IndexChartResponse } from './globalIndexClose.ts'
import { createQuoteCache, lastCompletedBar, makeChartFetch, quoteSymbols } from './holdingQuotes.ts'

const sec = (iso: string) => Date.parse(iso) / 1000
const TW_OFFSET = 8 * 3600

function chart(
  bars: Array<[string, number | null]>,
  opts: { gmtoffset?: number; regular?: { start: string; end: string } } = {},
): IndexChartResponse {
  return {
    chart: {
      result: [
        {
          meta: {
            gmtoffset: opts.gmtoffset,
            currentTradingPeriod: opts.regular
              ? { regular: { start: sec(opts.regular.start), end: sec(opts.regular.end) } }
              : undefined,
          },
          timestamp: bars.map(([t]) => sec(t)),
          indicators: { quote: [{ close: bars.map(([, c]) => c) }] },
        },
      ],
    },
  }
}

const TW_BARS: Array<[string, number | null]> = [
  ['2026-09-15T01:00:00Z', 100],
  ['2026-09-16T01:00:00Z', 101],
  ['2026-09-17T01:00:00Z', 102],
]
const TW_SESSION_0917 = { start: '2026-09-17T01:00:00Z', end: '2026-09-17T05:30:00Z' }

describe('lastCompletedBar', () => {
  it('keeps the last bar once its session has ended (17:15 Taipei)', () => {
    const resp = chart(TW_BARS, { gmtoffset: TW_OFFSET, regular: TW_SESSION_0917 })
    expect(lastCompletedBar(resp, sec('2026-09-17T09:15:00Z'))).toEqual({
      ymd: '2026-09-17',
      close: 102,
      prevClose: 101,
    })
  })

  it('drops the last bar while its session is still open', () => {
    const resp = chart(TW_BARS, { gmtoffset: TW_OFFSET, regular: TW_SESSION_0917 })
    expect(lastCompletedBar(resp, sec('2026-09-17T03:00:00Z'))).toEqual({
      ymd: '2026-09-16',
      close: 101,
      prevClose: 100,
    })
  })

  it('keeps the last bar when there is no trading period in meta', () => {
    const resp = chart(TW_BARS, { gmtoffset: TW_OFFSET })
    expect(lastCompletedBar(resp, sec('2026-09-17T03:00:00Z'))?.ymd).toBe('2026-09-17')
  })

  it('reads the date in the exchange timezone, not UTC', () => {
    // 2026-09-17T02:00Z is 2026-09-16 22:00 in New York (EDT, -4h).
    const resp = chart([['2026-09-17T02:00:00Z', 230.5]], { gmtoffset: -4 * 3600 })
    expect(lastCompletedBar(resp, sec('2026-09-17T09:15:00Z'))?.ymd).toBe('2026-09-16')
  })

  it('treats a missing gmtoffset as UTC', () => {
    const resp = chart([['2026-09-16T23:30:00Z', 10]])
    expect(lastCompletedBar(resp, sec('2026-09-17T09:15:00Z'))?.ymd).toBe('2026-09-16')
  })

  it('skips bars whose close is not a finite number', () => {
    const resp = chart(
      [
        ['2026-09-15T01:00:00Z', 100],
        ['2026-09-16T01:00:00Z', null],
        ['2026-09-17T01:00:00Z', 102],
      ],
      { gmtoffset: TW_OFFSET },
    )
    expect(lastCompletedBar(resp, sec('2026-09-17T09:15:00Z'))).toEqual({
      ymd: '2026-09-17',
      close: 102,
      prevClose: 100,
    })
  })

  it('sorts bars by time before picking', () => {
    const resp = chart(
      [
        ['2026-09-17T01:00:00Z', 102],
        ['2026-09-15T01:00:00Z', 100],
        ['2026-09-16T01:00:00Z', 101],
      ],
      { gmtoffset: TW_OFFSET },
    )
    expect(lastCompletedBar(resp, sec('2026-09-17T09:15:00Z'))).toEqual({
      ymd: '2026-09-17',
      close: 102,
      prevClose: 101,
    })
  })

  it('gives prevClose null when only one bar exists', () => {
    const resp = chart([['2026-09-17T01:00:00Z', 55.3]], { gmtoffset: TW_OFFSET })
    expect(lastCompletedBar(resp, sec('2026-09-17T09:15:00Z'))).toEqual({
      ymd: '2026-09-17',
      close: 55.3,
      prevClose: null,
    })
  })

  it('returns null when nothing usable is left', () => {
    const now = sec('2026-09-17T03:00:00Z')
    expect(lastCompletedBar({}, now)).toBeNull()
    expect(lastCompletedBar({ chart: { result: null } }, now)).toBeNull()
    expect(lastCompletedBar({ chart: { result: [] } }, now)).toBeNull()
    expect(lastCompletedBar(chart([]), now)).toBeNull()
    expect(lastCompletedBar(chart([['2026-09-16T01:00:00Z', null]]), now)).toBeNull()
    // the only bar belongs to the open session
    expect(
      lastCompletedBar(chart([['2026-09-17T01:00:00Z', 102]], { gmtoffset: TW_OFFSET, regular: TW_SESSION_0917 }), now),
    ).toBeNull()
  })
})

describe('quoteSymbols', () => {
  it('tries listed then OTC for Taiwan tickers', () => {
    expect(quoteSymbols('TPE', '2330')).toEqual(['2330.TW', '2330.TWO'])
  })

  it('uses the bare ticker for US', () => {
    expect(quoteSymbols('US', 'AAPL')).toEqual(['AAPL'])
  })
})

describe('createQuoteCache', () => {
  const NOW = sec('2026-09-17T09:15:00Z')
  const good = chart(TW_BARS, { gmtoffset: TW_OFFSET })
  const empty = chart([])

  function fakeFetch(answers: Record<string, unknown | Error>) {
    const calls: string[] = []
    const fetchJson = (url: string): Promise<unknown> => {
      calls.push(url)
      const a = answers[url]
      if (a instanceof Error) return Promise.reject(a)
      if (a === undefined) return Promise.reject(new Error(`HTTP 404 ${url}`))
      return Promise.resolve(a)
    }
    return { calls, fetchJson }
  }

  it('runs at most two key fetches at a time (spec Revision 4 R2)', async () => {
    let inFlight = 0
    let peak = 0
    const release: Array<() => void> = []
    const fetchJson = (): Promise<unknown> => {
      inFlight++
      peak = Math.max(peak, inFlight)
      return new Promise((resolve) => {
        release.push(() => {
          inFlight--
          resolve(good)
        })
      })
    }
    const cache = createQuoteCache(fetchJson, NOW)
    const pending = ['2330', '0050', '2303', '1229', '8033', '2454'].map((t) => cache.get('TPE', t))
    // let the queue start what it may
    await Promise.resolve()
    await Promise.resolve()
    expect(peak).toBeLessThanOrEqual(2)
    while (release.length > 0) {
      release.shift()!()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    }
    const quotes = await Promise.all(pending)
    expect(quotes).toHaveLength(6)
    for (const q of quotes) expect(q).toEqual({ ymd: '2026-09-17', close: 102, prevClose: 101 })
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('falls back to .TWO when .TW has no bars', async () => {
    const f = fakeFetch({ [indexChartUrl('6488.TW')]: empty, [indexChartUrl('6488.TWO')]: good })
    const cache = createQuoteCache(f.fetchJson, NOW)
    await expect(cache.get('TPE', '6488')).resolves.toEqual({ ymd: '2026-09-17', close: 102, prevClose: 101 })
    expect(f.calls).toEqual([indexChartUrl('6488.TW'), indexChartUrl('6488.TWO')])
  })

  it('falls back to .TWO when .TW rejects', async () => {
    const f = fakeFetch({ [indexChartUrl('6488.TW')]: new Error('network'), [indexChartUrl('6488.TWO')]: good })
    const cache = createQuoteCache(f.fetchJson, NOW)
    await expect(cache.get('TPE', '6488')).resolves.toEqual({ ymd: '2026-09-17', close: 102, prevClose: 101 })
  })

  it('stops at .TW when it answers', async () => {
    const f = fakeFetch({ [indexChartUrl('2330.TW')]: good, [indexChartUrl('2330.TWO')]: good })
    const cache = createQuoteCache(f.fetchJson, NOW)
    await cache.get('TPE', '2330')
    expect(f.calls).toEqual([indexChartUrl('2330.TW')])
  })

  it('resolves null, never rejects, when every symbol fails', async () => {
    const f = fakeFetch({ [indexChartUrl('9999.TW')]: new Error('boom'), [indexChartUrl('9999.TWO')]: { garbage: true } })
    const cache = createQuoteCache(f.fetchJson, NOW)
    await expect(cache.get('TPE', '9999')).resolves.toBeNull()
  })

  it('resolves null when fetchJson throws synchronously', async () => {
    const cache = createQuoteCache(() => {
      throw new Error('sync')
    }, NOW)
    await expect(cache.get('US', 'AAPL')).resolves.toBeNull()
  })

  it('fetches a US ticker once, by its bare symbol', async () => {
    const f = fakeFetch({ [indexChartUrl('AAPL')]: good })
    const cache = createQuoteCache(f.fetchJson, NOW)
    await cache.get('US', 'AAPL')
    expect(f.calls).toEqual([indexChartUrl('AAPL')])
  })

  it('memoizes by position key: same promise, one fetch sequence', async () => {
    const f = fakeFetch({ [indexChartUrl('6488.TW')]: empty, [indexChartUrl('6488.TWO')]: good })
    const cache = createQuoteCache(f.fetchJson, NOW)
    const p1 = cache.get('TPE', '6488')
    const p2 = cache.get('TPE', '6488')
    expect(p2).toBe(p1)
    await Promise.all([p1, p2])
    await cache.get('TPE', '6488')
    expect(f.calls).toHaveLength(2)
  })

  it('keeps markets apart: TPE and US with the same ticker are different keys', async () => {
    const f = fakeFetch({ [indexChartUrl('1234.TW')]: good, [indexChartUrl('1234')]: good })
    const cache = createQuoteCache(f.fetchJson, NOW)
    await cache.get('TPE', '1234')
    await cache.get('US', '1234')
    expect(f.calls).toEqual([indexChartUrl('1234.TW'), indexChartUrl('1234')])
  })

  it('applies the open-session rule with the cache clock', async () => {
    const f = fakeFetch({ [indexChartUrl('2330.TW')]: chart(TW_BARS, { gmtoffset: TW_OFFSET, regular: TW_SESSION_0917 }) })
    const cache = createQuoteCache(f.fetchJson, sec('2026-09-17T03:00:00Z'))
    await expect(cache.get('TPE', '2330')).resolves.toEqual({ ymd: '2026-09-16', close: 101, prevClose: 100 })
  })
})

describe('makeChartFetch', () => {
  const URL_ = indexChartUrl('2330.TW')
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

  function harness(answers: Array<Response | Error>) {
    const calls: Array<{ url: string; signal: AbortSignal | undefined; headers: Record<string, string> | undefined }> = []
    const sleeps: number[] = []
    const fetchImpl = ((url: string, init?: RequestInit) => {
      calls.push({ url, signal: init?.signal ?? undefined, headers: init?.headers as Record<string, string> | undefined })
      const a = answers.shift()
      if (!a) throw new Error('no more answers')
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a)
    }) as typeof fetch
    const get = makeChartFetch({ fetchImpl, sleep: async (ms) => void sleeps.push(ms) })
    return { calls, sleeps, get }
  }

  it('asks like a browser: Yahoo answers 429 to a request with no User-Agent (spec Revision 5)', async () => {
    const h = harness([ok({ chart: { result: [] } })])
    await h.get(URL_)
    expect(h.calls[0].headers?.['User-Agent']).toMatch(/^Mozilla\/5\.0 /)
    expect(h.calls[0].headers?.Accept).toBe('application/json')
  })

  it('returns parsed JSON on the first success, with a timeout signal', async () => {
    const h = harness([ok({ chart: { result: [] } })])
    await expect(h.get(URL_)).resolves.toEqual({ chart: { result: [] } })
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].url).toBe(URL_)
    expect(h.calls[0].signal).toBeInstanceOf(AbortSignal)
    expect(h.sleeps).toEqual([])
  })

  it('does not retry a 404 (an OTC ticker asked as .TW)', async () => {
    const h = harness([new Response('nope', { status: 404 })])
    await expect(h.get(URL_)).rejects.toThrow('HTTP 404')
    expect(h.calls).toHaveLength(1)
  })

  it.each([
    ['a network error', new TypeError('fetch failed')],
    ['a timeout', new DOMException('timed out', 'TimeoutError')],
    ['HTTP 500', new Response('', { status: 500 })],
    ['HTTP 429', new Response('', { status: 429 })],
  ])('retries once after %s', async (_label, first) => {
    const h = harness([first, ok({ ok: 1 })])
    await expect(h.get(URL_)).resolves.toEqual({ ok: 1 })
    expect(h.calls).toHaveLength(2)
    expect(h.sleeps).toEqual([500])
  })

  it('gives up after the second failure', async () => {
    const h = harness([new Response('', { status: 503 }), new TypeError('fetch failed')])
    await expect(h.get(URL_)).rejects.toThrow()
    expect(h.calls).toHaveLength(2)
  })

  it('rejects when the body is not JSON, without retrying', async () => {
    const h = harness([new Response('<html>', { status: 200 })])
    await expect(h.get(URL_)).rejects.toThrow()
    expect(h.calls).toHaveLength(1)
  })

  it('never rejects the quote cache built on it', async () => {
    const h = harness([new TypeError('x'), new TypeError('y'), new Response('', { status: 404 })])
    const cache = createQuoteCache(h.get, Date.parse('2026-09-17T09:15:00Z') / 1000)
    await expect(cache.get('TPE', '2330')).resolves.toBeNull()
  })
})
