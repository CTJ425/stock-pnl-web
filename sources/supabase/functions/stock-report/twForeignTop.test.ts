import { describe, it, expect } from 'vitest'
import {
  FOREIGN_TOP_LIMIT,
  foreignTopFingerprint,
  parseForeignTop,
  twt38uUrl,
  type Twt38uResponse,
} from './twForeignTop'

/**
 * Rows taken verbatim from rwd/zh/fund/TWT38U on 2026-08-17.
 *
 * Kept byte-for-byte on purpose: the ticker and name columns are space-padded by TWSE
 * (`'6770  '`, `'力積電          '`) and the block-trade column is a single space rather than
 * an empty string when the flag is absent. Both bit the PROPOSED draft's field table.
 */
const FIELDS = [
  '',
  '證券代號',
  '證券名稱',
  '買進股數',
  '賣出股數',
  '買賣超股數',
  '買進股數',
  '賣出股數',
  '買賣超股數',
  '買進股數',
  '賣出股數',
  '買賣超股數',
]

const REAL: Twt38uResponse = {
  stat: 'OK',
  date: '20260817',
  fields: FIELDS,
  data: [
    // net > 0, no block trade, ETF with a letter in the code
    [
      ' ',
      '00403A',
      '主動統一升級50  ',
      '68,861,020',
      '14,041,150',
      '54,819,870',
      '0',
      '0',
      '0',
      '68,861,020',
      '14,041,150',
      '54,819,870',
    ],
    // net > 0, block trade flagged
    [
      '*',
      '3711  ',
      '日月光投控      ',
      '14,098,681',
      '4,444,576',
      '9,654,105',
      '0',
      '0',
      '0',
      '14,098,681',
      '4,444,576',
      '9,654,105',
    ],
    // net < 0, the day's largest net sell
    [
      ' ',
      '6770  ',
      '力積電          ',
      '58,356,907',
      '126,472,602',
      '-68,115,695',
      '0',
      '0',
      '0',
      '58,356,907',
      '126,472,602',
      '-68,115,695',
    ],
    // net < 0, smaller
    [
      ' ',
      '2887  ',
      '台新新光金      ',
      '22,826,534',
      '56,953,502',
      '-34,126,968',
      '0',
      '0',
      '0',
      '22,826,534',
      '56,953,502',
      '-34,126,968',
    ],
    // net === 0 — belongs to neither list
    [
      ' ',
      '00408A',
      '主動第一金優股息',
      '2,000',
      '2,000',
      '0',
      '0',
      '0',
      '0',
      '2,000',
      '2,000',
      '0',
    ],
  ],
}

/** One row, column 11 (合計買賣超) drives the ranking. */
function row(ticker: string, net: number, block = false): string[] {
  const buy = net > 0 ? String(net) : '0'
  const sell = net < 0 ? String(-net) : '0'
  return [block ? '*' : ' ', ticker, `n-${ticker}`, buy, sell, String(net), '0', '0', '0', buy, sell, String(net)]
}

function resp(rows: string[][], date = '20260817'): Twt38uResponse {
  return { stat: 'OK', date, fields: FIELDS, data: rows }
}

describe('twt38uUrl', () => {
  it('打帶日期的 rwd 端點', () => {
    const url = twt38uUrl('20260817')
    expect(url).toContain('/rwd/zh/fund/TWT38U')
    expect(url).toContain('date=20260817')
    expect(url).toContain('response=json')
  })
})

describe('parseForeignTop', () => {
  it('解析真實回應：去除補白、去除千分位、以第 11 欄（合計）為排名依據', () => {
    const p = parseForeignTop(REAL)!
    expect(p).not.toBeNull()

    expect(p.rawDate).toBe('20260817')
    expect(p.date).toBe('2026-08-17')

    // 買超：54,819,870 > 9,654,105
    expect(p.buyTop.map((x) => x.ticker)).toEqual(['00403A', '3711'])
    expect(p.buyTop[0]).toEqual({
      ticker: '00403A',
      name: '主動統一升級50',
      buy: 68_861_020,
      sell: 14_041_150,
      net: 54_819_870,
      block: false,
    })

    // 名稱與代號都要 trim
    expect(p.buyTop[1].ticker).toBe('3711')
    expect(p.buyTop[1].name).toBe('日月光投控')
  })

  it('鉅額交易註記：* 為 true，單一空白為 false', () => {
    const p = parseForeignTop(REAL)!
    expect(p.buyTop.find((x) => x.ticker === '3711')!.block).toBe(true)
    expect(p.buyTop.find((x) => x.ticker === '00403A')!.block).toBe(false)
  })

  it('賣超由最負的排最前面', () => {
    const p = parseForeignTop(REAL)!
    expect(p.sellTop.map((x) => x.ticker)).toEqual(['6770', '2887'])
    expect(p.sellTop[0].net).toBe(-68_115_695)
  })

  it('買賣超為 0 的列兩張榜都不收', () => {
    const p = parseForeignTop(REAL)!
    const all = [...p.buyTop, ...p.sellTop].map((x) => x.ticker)
    expect(all).not.toContain('00408A')
  })

  it('不信任上游排序：列序打亂後結果不變', () => {
    const ordered = parseForeignTop(REAL)!
    const shuffled = parseForeignTop({ ...REAL, data: [...REAL.data!].reverse() })!
    expect(shuffled.buyTop).toEqual(ordered.buyTop)
    expect(shuffled.sellTop).toEqual(ordered.sellTop)
  })

  it('超過上限時截斷到 FOREIGN_TOP_LIMIT', () => {
    const rows: string[][] = []
    for (let i = 0; i < 60; i++) rows.push(row(`A${String(i).padStart(3, '0')}`, 1000 - i))
    for (let i = 0; i < 60; i++) rows.push(row(`B${String(i).padStart(3, '0')}`, -(1000 - i)))
    const p = parseForeignTop(resp(rows))!
    expect(p.buyTop).toHaveLength(FOREIGN_TOP_LIMIT)
    expect(p.sellTop).toHaveLength(FOREIGN_TOP_LIMIT)
    expect(p.buyTop[0].net).toBe(1000)
    expect(p.sellTop[0].net).toBe(-1000)
  })

  it('不足 50 檔時只回實際筆數，不補位也不丟例外', () => {
    const p = parseForeignTop(resp([row('1101', 500), row('1102', -500)]))!
    expect(p.buyTop).toHaveLength(1)
    expect(p.sellTop).toHaveLength(1)
  })

  it('買賣超相同時以代號升冪決定名次，且多次呼叫結果一致', () => {
    const rows = [row('2330', 500), row('1101', 500), row('1216', 500)]
    const a = parseForeignTop(resp(rows))!
    const b = parseForeignTop(resp([...rows].reverse()))!
    expect(a.buyTop.map((x) => x.ticker)).toEqual(['1101', '1216', '2330'])
    expect(b.buyTop.map((x) => x.ticker)).toEqual(['1101', '1216', '2330'])
  })

  it('stat 非 OK、data 空、date 非八位數皆回 null', () => {
    expect(parseForeignTop({ ...REAL, stat: '很抱歉，沒有符合條件的資料!' })).toBeNull()
    expect(parseForeignTop({ ...REAL, data: [] })).toBeNull()
    expect(parseForeignTop({ ...REAL, data: undefined })).toBeNull()
    expect(parseForeignTop({ ...REAL, date: '2026-08-17' })).toBeNull()
    expect(parseForeignTop({ ...REAL, date: undefined })).toBeNull()
  })
})

describe('foreignTopFingerprint', () => {
  it('內容相同則指紋相同', () => {
    const a = parseForeignTop(REAL)!
    const b = parseForeignTop({ ...REAL, data: [...REAL.data!].reverse() })!
    expect(foreignTopFingerprint(a)).toBe(foreignTopFingerprint(b))
  })

  it('任一格改變就換指紋', () => {
    const base = parseForeignTop(resp([row('1101', 500), row('1102', -500)]))!
    const moved = parseForeignTop(resp([row('1101', 501), row('1102', -500)]))!
    expect(foreignTopFingerprint(moved)).not.toBe(foreignTopFingerprint(base))
  })

  it('欄位以 U+001F 分隔，避免 AUDIT-04 的黏合碰撞', () => {
    // 用空字串接會讓 ['12','3'] 與 ['1','23'] 都變成 '123'，兩筆不同的資料共用一個指紋。
    // 直接驗分隔符存在，比兩個「剛好不撞」的樣本更能守住這件事。
    const p = parseForeignTop(resp([row('1101', 500), row('1102', -500)]))!
    expect(foreignTopFingerprint(p)).toContain(String.fromCharCode(31))
  })
})
