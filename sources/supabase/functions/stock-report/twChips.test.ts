import { describe, it, expect } from 'vitest'
import {
  normNum,
  extractInstitutional,
  extractMargin,
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
  it('依代號比對並映射外資/投信/自營/合計（含負值）', () => {
    const resp = { stat: 'OK', fields: T86_FIELDS, data: [T86_ROW] }
    const chip = extractInstitutional(resp, '2303')
    expect(chip).toEqual({
      foreign: -10000,
      foreignDealer: 0,
      trust: -2000,
      dealer: 500,
      total: -11500,
    })
  })

  it('相容 tables[0] 結構', () => {
    const resp = { tables: [{ fields: T86_FIELDS, data: [T86_ROW] }] }
    expect(extractInstitutional(resp, '2303')?.total).toBe(-11500)
  })

  it('查無代號回 null', () => {
    const resp = { stat: 'OK', fields: T86_FIELDS, data: [T86_ROW] }
    expect(extractInstitutional(resp, '9999')).toBeNull()
  })
})

describe('extractMargin', () => {
  it('算出融資/融券變化（今日−前日）', () => {
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
