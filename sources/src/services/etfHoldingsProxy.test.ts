import { beforeEach, describe, expect, it, vi } from 'vitest'

const { downloadReportsJson } = vi.hoisted(() => ({ downloadReportsJson: vi.fn() }))
vi.mock('./reportsBucket', () => ({ downloadReportsJson }))

import { etfIssuerOf, fetchEtfHoldings, isEtfCode } from './etfHoldingsProxy'

const day = (tradeDate: string, over: Record<string, unknown> = {}) => ({
  tradeDate,
  publishedAt: '2026-10-12 16:06:52',
  navTotal: 2553551300844,
  navPerUnit: 114.47,
  unitsOutstanding: 22307000000,
  fundSize: 2547140807580,
  assets: { stock: 2540194490501, etf: 0, bond: 0, futures: 7044587000 },
  stocks: [{ code: '2330', name: '台積電', shares: 565525249, weight: 56.39 }],
  futures: [{ code: 'TX', name: '臺股期貨', contracts: 628, weight: 0.24, month: '202610' }],
  ...over,
})
const file = (days: unknown[]) => ({
  schema: 1,
  etf: '0050',
  fundName: '元大台灣卓越50基金',
  issuer: 'yuanta',
  sourceUrl: 'https://www.yuantaetfs.com/product/detail/0050/ratio',
  updatedAt: '2026-10-12T10:00:00.000Z',
  days,
})

describe('fetchEtfHoldings', () => {
  beforeEach(() => downloadReportsJson.mockReset())

  it('reads the file the Edge Function writes, newest day first', async () => {
    downloadReportsJson.mockResolvedValue(file([day('2026-10-08'), day('2026-10-12')]))
    const r = await fetchEtfHoldings('0050')
    expect(downloadReportsJson).toHaveBeenCalledWith('market/etf_holdings/0050.json')
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.data.days.map((d) => d.tradeDate)).toEqual(['2026-10-12', '2026-10-08'])
    expect(r.data.days[0].stocks[0]).toEqual({ code: '2330', name: '台積電', shares: 565525249, weight: 56.39, market: 'TW' })
    expect(r.data.fundName).toBe('元大台灣卓越50基金')
  })

  it('makes no request for a code that is not an ETF', async () => {
    expect(isEtfCode('2330')).toBe(false)
    expect(await fetchEtfHoldings('2330')).toEqual({ kind: 'empty' })
    expect(downloadReportsJson).not.toHaveBeenCalled()
  })

  it('reads any ETF code, and old files without market / issuer as Taiwan / unknown', async () => {
    downloadReportsJson.mockResolvedValue(file([day('2026-10-12')]))
    const r = await fetchEtfHoldings('0056')
    expect(downloadReportsJson).toHaveBeenCalledWith('market/etf_holdings/0056.json')
    expect(r.kind === 'ok' && r.data.days[0].stocks[0].market).toBe('TW')
  })

  it('accepts a day without NT$ asset totals (CTBC)', async () => {
    downloadReportsJson.mockResolvedValue({ ...file([day('2026-10-13', { assets: null })]), issuer: 'ctbc' })
    const r = await fetchEtfHoldings('009828')
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.data.days[0].assets).toBeNull()
    expect(r.data.issuer).toBe('ctbc')
  })

  it('tells the issuer from the short name (shared with the Edge sync)', () => {
    expect(etfIssuerOf('元大高股息')).toMatchObject({ id: 'yuanta', supported: true })
    expect(etfIssuerOf('中信台日韓PCB')).toMatchObject({ id: 'ctbc', label: '中國信託投信', supported: true })
    expect(etfIssuerOf('國泰永續高股息')).toMatchObject({ id: 'cathay', supported: false })
    expect(etfIssuerOf('群益台灣精選高息')).toMatchObject({ id: 'capital', supported: true })
    expect(etfIssuerOf('主動統一台股增長')).toMatchObject({ id: 'uni' })
    // Active ETFs put 「主動」 before the brand (review RISK 2): the brand still decides.
    expect(etfIssuerOf('主動元大AI新經濟')).toMatchObject({ id: 'yuanta', supported: true })
    expect(etfIssuerOf('主動中信ARK創新')).toMatchObject({ id: 'ctbc', supported: true })
    expect(etfIssuerOf('主動國泰動能高息')).toMatchObject({ id: 'cathay' })
    expect(etfIssuerOf('台積電')).toBeNull()
  })

  it('is empty without a file and invalid when no day is usable', async () => {
    downloadReportsJson.mockResolvedValue(null)
    expect(await fetchEtfHoldings('0050')).toEqual({ kind: 'empty' })
    downloadReportsJson.mockResolvedValue(file([day('2026-10-12', { stocks: [], futures: [] }), { tradeDate: 'x' }]))
    expect(await fetchEtfHoldings('0050')).toEqual({ kind: 'invalid' })
    downloadReportsJson.mockResolvedValue({ ...file([day('2026-10-12')]), schema: 0 })
    expect(await fetchEtfHoldings('0050')).toEqual({ kind: 'invalid' })
  })
})

describe('Edge → Web contract', () => {
  // The producer's real output, not a hand-built shape: a field renamed on one side fails here.
  it('reads back exactly what the Edge sync writes', async () => {
    const { syncEtfHoldings, yuantaSource } = await import('../../supabase/functions/stock-report/etfHoldingsSync.ts')
    const { ETF_0050_RULES } = await import('../../supabase/functions/stock-report/etfHoldings.ts')
    const { YUANTA_0050_20261012 } = await import('../../supabase/functions/stock-report/etfHoldings.fixture.ts')
    let written: unknown = null
    const source = yuantaSource(async () => JSON.parse(JSON.stringify(YUANTA_0050_20261012)))
    await syncEtfHoldings('0050', source, ETF_0050_RULES, {
      download: async () => null,
      upload: async (_path, payload) => {
        written = payload
        return true
      },
      now: () => new Date('2026-10-13T02:00:00Z'),
    })
    expect(written).not.toBeNull()
    downloadReportsJson.mockResolvedValue(JSON.parse(JSON.stringify(written)))
    const r = await fetchEtfHoldings('0050')
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    const producedDay = (written as { days: unknown[] }).days[0]
    expect(r.data.days[0]).toEqual(producedDay)
    expect(r.data.days[0].stocks).toHaveLength(50)
    expect(r.data.days[0].fundSize).toBe(2547140807580)
  })

  it('reads back a futures-led fund the Capital source writes (00685L: no stocks)', async () => {
    const { syncEtfHoldings } = await import('../../supabase/functions/stock-report/etfHoldingsSync.ts')
    const { DEFAULT_HOLDINGS_RULES } = await import('../../supabase/functions/stock-report/etfHoldings.ts')
    const { parseCapitalHoldings } = await import('../../supabase/functions/stock-report/etfHoldingsCapital.ts')
    const { CAPITAL_00685L_20261013 } = await import('../../supabase/functions/stock-report/etfHoldingsCapital.fixture.ts')
    let written: unknown = null
    await syncEtfHoldings(
      '00685L',
      {
        issuer: 'capital',
        publishHourTaipei: null,
        worstCaseMs: () => 0,
        sourceUrl: () => 'https://example.test',
        fetch: async () => JSON.parse(JSON.stringify(CAPITAL_00685L_20261013)),
        parse: parseCapitalHoldings,
      },
      DEFAULT_HOLDINGS_RULES,
      {
        download: async () => null,
        upload: async (_p, payload) => {
          written = payload
          return true
        },
        now: () => new Date('2026-10-14T03:00:00Z'),
      },
    )
    expect(written).not.toBeNull()
    downloadReportsJson.mockResolvedValue(JSON.parse(JSON.stringify(written)))
    const r = await fetchEtfHoldings('00685L')
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.data.days[0].stocks).toEqual([])
    expect(r.data.days[0].futures[0]).toMatchObject({ code: 'TX', weight: 200.9432 })
    expect(r.data.issuer).toBe('capital')
  })
})
