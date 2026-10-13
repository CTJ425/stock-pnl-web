// BUG-109 — the official TW names the Discord holdings card labels with.
import { describe, expect, it, vi } from 'vitest'
import { memoTwNames, parseTwNames, TPEX_LIST_URL } from './twNames.ts'
import { TWSE_OPENAPI_LIST_URL, TWSE_STOCK_DAY_ALL_URL } from '../_shared/twseList.ts'

describe('parseTwNames', () => {
  it('reads both exchange shapes; the first list wins a shared code', () => {
    const names = parseTwNames(
      // TWSE OpenAPI STOCK_DAY_AVG_ALL, checked 2026-10-02.
      [{ Code: '0050', Name: '元大台灣50' }, { Code: '00981A', Name: '主動統一台股增長' }],
      [{ SecuritiesCompanyCode: '6488', CompanyName: '環球晶' }, { SecuritiesCompanyCode: '0050', CompanyName: 'x' }],
    )
    expect(names.get('0050')).toBe('元大台灣50')
    expect(names.get('00981A')).toBe('主動統一台股增長')
    expect(names.get('6488')).toBe('環球晶')
  })

  it('skips a source that is not a list and rows without a code or a name', () => {
    const names = parseTwNames(null, [{ Code: '', Name: 'a' }, { Code: '1234' }, { Code: '2303', Name: '聯電' }])
    expect([...names]).toEqual([['2303', '聯電']])
  })
})

describe('memoTwNames', () => {
  const CSV_HEAD = '日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數'

  it('fetches each list once and keeps the names of the source that answered', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      expect(url).toBe(TPEX_LIST_URL)
      throw new Error('TPEx down')
    })
    const fetchText = vi.fn(async (url: string) => {
      expect(url).toBe(TWSE_STOCK_DAY_ALL_URL)
      return `${CSV_HEAD}\n"1151012","0050","元大台灣50","1","1","1","1","1","100","0","1"`
    })
    const load = memoTwNames(fetchJson as never, fetchText)
    const [a, b] = await Promise.all([load(), load()])
    expect(a).toBe(b)
    expect(a.get('0050')).toBe('元大台灣50')
    expect(fetchText).toHaveBeenCalledTimes(1)
    expect(fetchJson).toHaveBeenCalledTimes(1)
  })

  // BUG-120: STOCK_DAY_ALL down → the OpenAPI, with its warrants dropped.
  it('falls back to the OpenAPI without warrants when STOCK_DAY_ALL fails', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url === TPEX_LIST_URL) return []
      expect(url).toBe(TWSE_OPENAPI_LIST_URL)
      return [{ Code: '2330', Name: '台積電' }, { Code: '030001', Name: '友達台新6A購01' }]
    })
    const load = memoTwNames(fetchJson as never, async () => {
      throw new Error('Signal timed out.')
    })
    const names = await load()
    expect(names.get('2330')).toBe('台積電')
    expect(names.has('030001')).toBe(false)
  })
})
