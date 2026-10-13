// BUG-120 — the TWSE list source the twlist action and the Discord card names read.
import { describe, expect, it, vi } from 'vitest'
import {
  isTwseWarrantCode,
  loadTwseRows,
  parseStockDayAllCsv,
  TWSE_OPENAPI_LIST_URL,
  TWSE_STOCK_DAY_ALL_URL,
} from './twseList.ts'

// First lines of STOCK_DAY_ALL?response=open_data, fetched 2026-10-13.
const CSV = [
  '日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數',
  '"1151012","00400A","主動國泰動能高息","25397979","408070398","15.96","16.23","15.94","16.20","0.0500","7081"',
  '"1151012","2330","台積電","1","1","2530.00","2550.00","2520.00","2540.00","10.0000","1"',
].join('\n')

const BOM = String.fromCharCode(0xfeff)

describe('parseStockDayAllCsv', () => {
  it('reads code, name and close by header into the OpenAPI row shape', () => {
    expect(parseStockDayAllCsv(CSV)).toEqual([
      { Code: '00400A', Name: '主動國泰動能高息', ClosingPrice: '16.20' },
      { Code: '2330', Name: '台積電', ClosingPrice: '2540.00' },
    ])
  })

  it('finds a header cell that a BOM sits on', () => {
    // BOM on a column the parser needs, so a parser that kept it would miss 證券代號.
    const text = `${BOM}證券代號,證券名稱,收盤價\n"2330","台積電","2540.00"`
    expect(parseStockDayAllCsv(text)).toEqual([{ Code: '2330', Name: '台積電', ClosingPrice: '2540.00' }])
  })

  it('handles CRLF, a quoted comma and an escaped quote', () => {
    const text = CSV.split('\n')[0] + '\r\n"1151012","9999","甲,乙""丙","1","1","1","1","1","12.5","0","1"\r\n'
    expect(parseStockDayAllCsv(text)).toEqual([{ Code: '9999', Name: '甲,乙"丙', ClosingPrice: '12.5' }])
  })

  it('returns [] for a body that is not the expected CSV, so the caller falls back', () => {
    expect(parseStockDayAllCsv('<html>error</html>')).toEqual([])
    expect(parseStockDayAllCsv('')).toEqual([])
  })
})

describe('isTwseWarrantCode', () => {
  it('matches warrant and CBBC codes, not stocks or ETFs', () => {
    for (const c of ['030001', '04001T', '060002', '080000']) expect(isTwseWarrantCode(c)).toBe(true)
    for (const c of ['2330', '0050', '00981A', '00625K', '020011', '00400A']) expect(isTwseWarrantCode(c)).toBe(false)
  })
})

describe('loadTwseRows', () => {
  const onlyCsv = async (url: string) => {
    expect(url).toBe(TWSE_STOCK_DAY_ALL_URL)
    return CSV
  }

  it('uses STOCK_DAY_ALL and never touches the OpenAPI when it answers', async () => {
    const fetchJson = vi.fn()
    const onFallback = vi.fn()
    const rows = await loadTwseRows(onlyCsv, fetchJson, onFallback)
    expect(rows.map((r) => r.Code)).toEqual(['00400A', '2330'])
    expect(fetchJson).not.toHaveBeenCalled()
    expect(onFallback).not.toHaveBeenCalled()
  })

  it('reports why STOCK_DAY_ALL failed and falls back to the OpenAPI without warrants', async () => {
    const onFallback = vi.fn()
    const fetchJson = vi.fn(async (url: string) => {
      expect(url).toBe(TWSE_OPENAPI_LIST_URL)
      return [{ Code: '2330', Name: '台積電' }, { Code: '030001', Name: '友達台新6A購01' }]
    })
    const rows = await loadTwseRows(async () => '<html>blocked</html>', fetchJson, onFallback)
    expect(rows).toEqual([{ Code: '2330', Name: '台積電' }])
    expect(onFallback).toHaveBeenCalledWith('STOCK_DAY_ALL 無可用資料')
  })

  it('rejects with both reasons when both sources fail', async () => {
    const fail = async () => {
      throw new Error('Signal timed out.')
    }
    await expect(loadTwseRows(fail, fail, () => {})).rejects.toThrow(
      'STOCK_DAY_ALL Signal timed out.; OpenAPI Signal timed out.',
    )
  })
})
