import { describe, expect, it } from 'vitest'
import { syncEtfHoldings, type EtfHoldingsSyncDeps } from './etfHoldingsSync.ts'
import {
  ETF_0050_RULES,
  etfHoldingsPath,
  parseYuantaHoldings,
  yuantaHoldingsUrl,
  type EtfHoldingsDay,
  type EtfHoldingsFile,
} from './etfHoldings.ts'
import { YUANTA_0050_20261012 } from './etfHoldings.fixture.ts'

const PATH = etfHoldingsPath('0050')
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const day = (tradeDate = '2026-10-12'): EtfHoldingsDay => ({
  ...parseYuantaHoldings(clone(YUANTA_0050_20261012))!.day,
  tradeDate,
})
const fileWith = (...days: EtfHoldingsDay[]): EtfHoldingsFile => ({
  schema: 1,
  etf: '0050',
  fundName: '元大台灣卓越50基金',
  issuer: 'yuanta',
  sourceUrl: 'x',
  updatedAt: '2026-10-12T10:00:00.000Z',
  days,
})

/** Tue 2026-10-13 18:00 Taipei: the 10/13 file ought to be out. */
const EVENING = new Date('2026-10-13T10:00:00Z')
/** Tue 2026-10-13 10:00 Taipei: 10/12 is the newest that can exist. */
const MORNING = new Date('2026-10-13T02:00:00Z')

function harness(opts: { stored?: unknown; response?: unknown; uploadOk?: boolean; now?: Date }) {
  const fetched: string[] = []
  const uploads: Array<{ path: string; payload: EtfHoldingsFile }> = []
  const deps: EtfHoldingsSyncDeps = {
    fetchJson: async (url) => {
      fetched.push(url)
      return opts.response === undefined ? clone(YUANTA_0050_20261012) : opts.response
    },
    download: async <T>(path: string) => (path === PATH ? ((opts.stored ?? null) as T | null) : null),
    upload: async (path, payload) => {
      uploads.push({ path, payload: payload as EtfHoldingsFile })
      return opts.uploadOk ?? true
    },
    now: () => opts.now ?? MORNING,
  }
  return { deps, fetched, uploads }
}

describe('syncEtfHoldings', () => {
  it('writes the first day into an empty bucket', async () => {
    const h = harness({})
    const r = await syncEtfHoldings('0050', ETF_0050_RULES, h.deps)
    expect(r).toEqual({ etf: '0050', synced: true, tradeDate: '2026-10-12', reason: null })
    expect(h.fetched).toEqual([yuantaHoldingsUrl('0050')])
    expect(h.uploads).toHaveLength(1)
    const f = h.uploads[0].payload
    expect(f.schema).toBe(1)
    expect(f.fundName).toBe('元大台灣卓越50基金')
    expect(f.sourceUrl).toBe('https://www.yuantaetfs.com/product/detail/0050/ratio')
    expect(f.days.map((d) => d.tradeDate)).toEqual(['2026-10-12'])
  })

  it('asks nobody once the expected day is stored', async () => {
    const h = harness({ stored: fileWith(day('2026-10-12')), now: MORNING })
    const r = await syncEtfHoldings('0050', ETF_0050_RULES, h.deps)
    expect(r.reason).toBe('unchanged')
    expect(h.fetched).toEqual([])
    expect(h.uploads).toEqual([])
  })

  it('says not-published when the source still shows the stored day after 16:00', async () => {
    const h = harness({ stored: fileWith(day('2026-10-12')), now: EVENING })
    const r = await syncEtfHoldings('0050', ETF_0050_RULES, h.deps)
    expect(r).toEqual({ etf: '0050', synced: false, tradeDate: '2026-10-12', reason: 'not-published' })
    expect(h.fetched).toHaveLength(1)
    expect(h.uploads).toEqual([])
  })

  it('appends a new day in front of the stored ones', async () => {
    const h = harness({ stored: fileWith(day('2026-10-08')), now: EVENING })
    const r = await syncEtfHoldings('0050', ETF_0050_RULES, h.deps)
    expect(r.synced).toBe(true)
    expect(h.uploads[0].payload.days.map((d) => d.tradeDate)).toEqual(['2026-10-12', '2026-10-08'])
  })

  it('replaces the stored day when the source revised it', async () => {
    const stored = { ...day('2026-10-12'), navPerUnit: 114.46 }
    const h = harness({ stored: fileWith(stored), now: EVENING })
    const r = await syncEtfHoldings('0050', ETF_0050_RULES, h.deps)
    expect(r.synced).toBe(true)
    expect(h.uploads[0].payload.days).toHaveLength(1)
    expect(h.uploads[0].payload.days[0].navPerUnit).toBe(114.47)
  })

  it('refuses an older day than the stored newest', async () => {
    const h = harness({ stored: fileWith(day('2026-10-13')), now: new Date('2026-10-14T10:00:00Z') })
    const r = await syncEtfHoldings('0050', ETF_0050_RULES, h.deps)
    expect(r).toEqual({ etf: '0050', synced: false, tradeDate: '2026-10-13', reason: 'stale' })
    expect(h.uploads).toEqual([])
  })

  it('does not write a day that fails validation, and names the rule', async () => {
    const bad = clone(YUANTA_0050_20261012)
    bad.FundWeights.StockWeights = bad.FundWeights.StockWeights.slice(0, 20)
    const h = harness({ stored: fileWith(day('2026-10-08')), response: bad, now: EVENING })
    const r = await syncEtfHoldings('0050', ETF_0050_RULES, h.deps)
    expect(r).toEqual({ etf: '0050', synced: false, tradeDate: '2026-10-12', reason: 'invalid', rule: 'stock-count' })
    expect(h.uploads).toEqual([])
  })

  it('reports fetch-failed and parse-failed without writing', async () => {
    const a = harness({ response: null, now: EVENING })
    expect((await syncEtfHoldings('0050', ETF_0050_RULES, a.deps)).reason).toBe('fetch-failed')
    const b = harness({ response: { ResultCode: 1, ResultMsg: 'ERR' }, now: EVENING })
    expect((await syncEtfHoldings('0050', ETF_0050_RULES, b.deps)).reason).toBe('parse-failed')
    expect([...a.uploads, ...b.uploads]).toEqual([])
  })

  it('reports upload-failed', async () => {
    const h = harness({ uploadOk: false })
    expect(await syncEtfHoldings('0050', ETF_0050_RULES, h.deps)).toEqual({
      etf: '0050',
      synced: false,
      tradeDate: '2026-10-12',
      reason: 'upload-failed',
    })
  })

  it('replaces a stored file that is not ours instead of appending to it', async () => {
    const h = harness({ stored: { hello: 'world' }, now: EVENING })
    await syncEtfHoldings('0050', ETF_0050_RULES, h.deps)
    expect(h.uploads[0].payload.days).toHaveLength(1)
  })

  it('treats a failed read as an error, not as "no file": nothing fetched, nothing written', async () => {
    const h = harness({ now: EVENING })
    h.deps.download = async () => {
      throw new Error('storage 503')
    }
    const r = await syncEtfHoldings('0050', ETF_0050_RULES, h.deps)
    expect(r).toMatchObject({ synced: false, reason: 'error', detail: 'storage 503' })
    expect(h.fetched).toEqual([])
    expect(h.uploads).toEqual([])
  })

  it('drops a malformed stored day instead of failing on it every run', async () => {
    const h = harness({ stored: { ...fileWith(day('2026-10-08')), days: [null, day('2026-10-08')] }, now: EVENING })
    const r = await syncEtfHoldings('0050', ETF_0050_RULES, h.deps)
    expect(r.synced).toBe(true)
    expect(h.uploads[0].payload.days.map((d) => d.tradeDate)).toEqual(['2026-10-12', '2026-10-08'])
  })
})

describe('stock-report wiring', () => {
  // index.ts cannot be imported under vitest (Deno.serve at module scope), so read its source. The
  // dynamic import keeps Node types out of the Edge tsconfig (same idiom as tablePnlStyles.test.ts).
  async function indexSource(): Promise<string> {
    // @ts-ignore
    const fs = await import('node:fs'.slice(0))
    // @ts-ignore
    return fs.readFileSync(new URL('./index.ts', import.meta.url), 'utf8') as string
  }

  it('routes sync-etf-holdings behind the cron gate', async () => {
    expect(await indexSource()).toMatch(/\['sync-etf-holdings', \{ gate: 'cron',/)
  })

  it('runs the sync inside the generate-market-data phase', async () => {
    const src = await indexSource()
    const phase = src.slice(src.indexOf('async function runGeneratePhaseMarketData'))
    expect(phase.slice(0, phase.indexOf('\n}\n'))).toContain('await syncEtfHoldings0050()')
  })
})
