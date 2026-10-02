// BUG-109 — the official TW names the Discord holdings card labels with.
import { describe, expect, it, vi } from 'vitest'
import { memoTwNames, parseTwNames, TPEX_LIST_URL, TWSE_LIST_URL } from './twNames.ts'

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
  it('fetches each list once and keeps the names of the source that answered', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url === TPEX_LIST_URL) throw new Error('TPEx down')
      expect(url).toBe(TWSE_LIST_URL)
      return [{ Code: '0050', Name: '元大台灣50' }]
    })
    const load = memoTwNames(fetchJson as never)
    const [a, b] = await Promise.all([load(), load()])
    expect(a).toBe(b)
    expect(a.get('0050')).toBe('元大台灣50')
    expect(fetchJson).toHaveBeenCalledTimes(2)
  })
})
