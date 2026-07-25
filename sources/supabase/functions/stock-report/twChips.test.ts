import { describe, it, expect } from 'vitest'
import {
  normNum,
  extractInstitutional,
  extractMargin,
  extractMarginDated,
  marginDatedOk,
  marginDatedUrl,
  extractBorrow,
} from './twChips.ts'

describe('normNum', () => {
  it('去逗號、保留負號、空值回 null', () => {
    expect(normNum('129,530,868')).toBe(129530868)
    expect(normNum('-1,307,604')).toBe(-1307604)
    expect(normNum('')).toBeNull()
    expect(normNum(' ')).toBeNull()
    expect(normNum('--')).toBeNull()
    expect(normNum(null)).toBeNull()
    expect(normNum('0')).toBe(0)
  })
})

const T86_FIELDS = [
  '證券代號',
  '證券名稱',
  '外陸資買進股數(不含外資自營商)',
  '外陸資賣出股數(不含外資自營商)',
  '外陸資買賣超股數(不含外資自營商)',
  '外資自營商買進股數',
  '外資自營商賣出股數',
  '外資自營商買賣超股數',
  '投信買進股數',
  '投信賣出股數',
  '投信買賣超股數',
  '自營商買賣超股數',
  '自營商買進股數(自行買賣)',
  '自營商賣出股數(自行買賣)',
  '自營商買賣超股數(自行買賣)',
  '自營商買進股數(避險)',
  '自營商賣出股數(避險)',
  '自營商買賣超股數(避險)',
  '三大法人買賣超股數',
]

const T86_ROW = [
  '2303', '聯電            ',
  '10,000', '20,000', '-10,000',
  '0', '0', '0',
  '1,000', '3,000', '-2,000',
  '500',
  '300', '100', '200',
  '400', '100', '300',
  '-11,500',
]

describe('extractInstitutional', () => {
  it('每個法人都拆出買進 / 賣出 / 買賣超（含負值）', () => {
    const resp = { stat: 'OK', fields: T86_FIELDS, data: [T86_ROW] }
    const chip = extractInstitutional(resp, '2303')
    expect(chip?.foreign).toEqual({ buy: 10000, sell: 20000, net: -10000 })
    expect(chip?.foreignDealer).toEqual({ buy: 0, sell: 0, net: 0 })
    expect(chip?.trust).toEqual({ buy: 1000, sell: 3000, net: -2000 })
  })

  it('自營商買進 / 賣出由「自行買賣」+「避險」相加，買賣超取官方欄位', () => {
    const resp = { stat: 'OK', fields: T86_FIELDS, data: [T86_ROW] }
    const chip = extractInstitutional(resp, '2303')
    // 自行 300/100 + 避險 400/100
    expect(chip?.dealer).toEqual({ buy: 700, sell: 200, net: 500 })
  })

  it('三大法人合計：買進 / 賣出為五個 leg 加總，買賣超取官方 idx 18', () => {
    const resp = { stat: 'OK', fields: T86_FIELDS, data: [T86_ROW] }
    const chip = extractInstitutional(resp, '2303')
    // 買進 10000 + 0 + 1000 + 300 + 400 = 11700；賣出 20000 + 0 + 3000 + 100 + 100 = 23200
    expect(chip?.total).toEqual({ buy: 11700, sell: 23200, net: -11500 })
  })

  it('相容 tables[0] 結構', () => {
    const resp = { tables: [{ fields: T86_FIELDS, data: [T86_ROW] }] }
    expect(extractInstitutional(resp, '2303')?.total.net).toBe(-11500)
  })

  it('查無代號回 null', () => {
    const resp = { stat: 'OK', fields: T86_FIELDS, data: [T86_ROW] }
    expect(extractInstitutional(resp, '9999')).toBeNull()
  })
})

// rwd 逐股融資融券表（實測 2026-07-22）：欄位名稱重複，必須用位置索引
const MARGIN_FIELDS = [
  '代號', '名稱',
  '買進', '賣出', '現金償還', '前日餘額', '今日餘額', '次一營業日限額',
  '買進', '賣出', '現券償還', '前日餘額', '今日餘額', '次一營業日限額',
  '資券互抵', '註記',
]

// 2330 實測列
const MARGIN_ROW_2330 = [
  '2330', '台積電',
  '855', '662', '88', '31,823', '31,928', '6,483,092',
  '4', '5', '0', '98', '99', '6,483,092',
  '3', ' ',
]

const MARGIN_RESP = {
  stat: 'OK',
  tables: [
    // tables[0] 是大盤合計，第一欄不是「代號」，必須跳過
    { fields: ['項目', '買進', '賣出'], data: [['融資(交易單位)', '1', '2']] },
    { fields: MARGIN_FIELDS, data: [MARGIN_ROW_2330] },
  ],
}

describe('extractMarginDated', () => {
  it('以位置索引取值，拆出融資 / 融券的買進 / 賣出 / 償還', () => {
    const m = extractMarginDated(MARGIN_RESP, '2330')
    expect(m).toEqual({
      marginBuy: 855,
      marginSell: 662,
      marginRedeem: 88,
      marginPrev: 31823,
      marginToday: 31928,
      marginChange: 105,
      marginLimit: 6483092,
      shortBuy: 4,
      shortSell: 5,
      shortRedeem: 0,
      shortPrev: 98,
      shortToday: 99,
      shortChange: 1,
      shortLimit: 6483092,
      offset: 3,
      source: 'rwd',
    })
  })

  it('自動挑出第一欄為「代號」的逐股表，忽略大盤合計表', () => {
    expect(marginDatedOk(MARGIN_RESP)).toBe(true)
    expect(extractMarginDated(MARGIN_RESP, '9999')).toBeNull()
  })

  it('欄數不足 / 欄序變動時視為不可用（呼叫端回退 OpenAPI）', () => {
    const broken = { tables: [{ fields: ['代號', '名稱', '買進'], data: [['2330', '台積電', '1']] }] }
    expect(marginDatedOk(broken)).toBe(false)
    expect(extractMarginDated(broken, '2330')).toBeNull()
    expect(marginDatedOk({ tables: [] })).toBe(false)
  })

  it('URL 帶 date 與 selectType=ALL', () => {
    expect(marginDatedUrl('20260722')).toContain('date=20260722')
    expect(marginDatedUrl('20260722')).toContain('selectType=ALL')
  })
})

describe('extractMargin（OpenAPI fallback）', () => {
  it('算出融資/融券變化（今日−前日），買進 / 賣出為 null', () => {
    const rows = [
      {
        股票代號: '2303', 股票名稱: '聯電',
        融資今日餘額: '220,752', 融資前日餘額: '213,376', 融資限額: '3,144,246',
        融券今日餘額: '1,408', 融券前日餘額: '2,265', 融券限額: '3,144,246',
        資券互抵: '144',
      } as Record<string, string>,
    ]
    const m = extractMargin(rows, '2303')
    expect(m?.marginChange).toBe(7376)
    expect(m?.shortChange).toBe(-857)
    expect(m?.offset).toBe(144)
    expect(m?.marginLimit).toBe(3144246)
    expect(m?.marginBuy).toBeNull()
    expect(m?.shortSell).toBeNull()
    expect(m?.source).toBe('openapi')
  })

  it('查無代號回 null', () => {
    expect(extractMargin([], '2303')).toBeNull()
  })
})

describe('extractBorrow', () => {
  it('比對 TWSECode 或 GRETAICode 兩欄', () => {
    const rows = [
      { TWSECode: '2303', TWSEAvailableVolume: '100,267', GRETAICode: '006201', GRETAIAvailableVolume: '82,503' },
    ]
    expect(extractBorrow(rows, '2303')?.availableVolume).toBe(100267)
    expect(extractBorrow(rows, '006201')?.availableVolume).toBe(82503)
    expect(extractBorrow(rows, '9999')).toBeNull()
  })
})
