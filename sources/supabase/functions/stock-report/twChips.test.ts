import { describe, it, expect } from 'vitest'
import {
  normNum,
  extractInstitutional,
  extractMargin,
  extractMarginDated,
  marginDatedOk,
  marginDatedFingerprint,
  marginDatedUrl,
  extractBorrow,
  extractBorrowDated,
  borrowDatedOk,
  borrowDatedDate,
  parseRocTitleDate,
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
    // Self 300/100 + Hedging 400/100
    expect(chip?.dealer).toEqual({ buy: 700, sell: 200, net: 500 })
  })

  it('三大法人合計：買進 / 賣出為五個 leg 加總，買賣超取官方 idx 18', () => {
    const resp = { stat: 'OK', fields: T86_FIELDS, data: [T86_ROW] }
    const chip = extractInstitutional(resp, '2303')
    // Buy 10000 + 0 + 1000 + 300 + 400 = 11700; sell 20000 + 0 + 3000 + 100 + 100 = 23200
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

// rwd stock-by-stock margin trading table (actual measurement 2026-07-22): field names are repeated and must be indexed by position
const MARGIN_FIELDS = [
  '代號', '名稱',
  '買進', '賣出', '現金償還', '前日餘額', '今日餘額', '次一營業日限額',
  '買進', '賣出', '現券償還', '前日餘額', '今日餘額', '次一營業日限額',
  '資券互抵', '註記',
]

// 2330 measured column
const MARGIN_ROW_2330 = [
  '2330', '台積電',
  '855', '662', '88', '31,823', '31,928', '6,483,092',
  '4', '5', '0', '98', '99', '6,483,092',
  '3', ' ',
]

const MARGIN_RESP = {
  stat: 'OK',
  tables: [
    // tables[0] is the total of the market. The first column is not "code name" and must be skipped.
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

// rwd coupon borrowing test response (captured on 2026-07-26): the code is wrapped in <a>, two columns in each column are matched, and the date is only in the title
const BORROW_RWD = {
  stat: 'OK',
  title: '115年07月27日 當日可借券賣出股數',
  fields: ['證券代號', '可借券賣出股數', '證券代號', '可借券賣出股數'],
  data: [
    [
      '<a href=https://mis.twse.com.tw/stock/fibest.jsp?stock=00400A target=_blank>00400A</a>',
      '17,284,535',
      '<a href=https://mis.twse.com.tw/stock/fibest.jsp?stock=006201 target=_blank>006201</a>',
      '78,603',
    ],
    [
      '<a href=https://mis.twse.com.tw/stock/fibest.jsp?stock=2330 target=_blank>2330</a>',
      '11,853,736',
      '<a href=https://mis.twse.com.tw/stock/fibest.jsp?stock= target=_blank>_</a>',
      '',
    ],
  ],
}

describe('parseRocTitleDate', () => {
  it('民國標題 → 西元日期', () => {
    expect(parseRocTitleDate('115年07月27日 當日可借券賣出股數')).toBe('2026-07-27')
    expect(parseRocTitleDate('99年1月5日 當日可借券賣出股數')).toBe('2010-01-05')
  })

  it('解析不出回 null（不要猜）', () => {
    expect(parseRocTitleDate('當日可借券賣出股數')).toBeNull()
    expect(parseRocTitleDate('')).toBeNull()
    expect(parseRocTitleDate(null)).toBeNull()
  })
})

describe('extractBorrowDated（rwd 版，自帶日期）', () => {
  it('去掉 <a> 標籤取代號，兩欄配對都要找得到', () => {
    expect(extractBorrowDated(BORROW_RWD, '00400A')?.availableVolume).toBe(17284535)
    expect(extractBorrowDated(BORROW_RWD, '006201')?.availableVolume).toBe(78603) // 第二欄
    expect(extractBorrowDated(BORROW_RWD, '2330')?.availableVolume).toBe(11853736)
  })

  it('查無代號回 null；末列的空配對不會誤判', () => {
    expect(extractBorrowDated(BORROW_RWD, '9999')).toBeNull()
    expect(extractBorrowDated(BORROW_RWD, '_')?.availableVolume).toBeNull()
  })

  it('資料日期取自 title —— 這是 OpenAPI 版做不到的事', () => {
    expect(borrowDatedDate(BORROW_RWD)).toBe('2026-07-27')
    expect(borrowDatedOk(BORROW_RWD)).toBe(true)
  })

  it('沒有可解析的日期就視為不可用（寧可不快取，也不要存成錯的日子）', () => {
    expect(borrowDatedOk({ stat: 'OK', title: '當日可借券賣出股數', data: [['2330', '1']] })).toBe(false)
    expect(borrowDatedOk({ stat: 'OK', title: '115年07月27日', data: [] })).toBe(false)
    expect(borrowDatedOk({})).toBe(false)
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

describe('marginDatedFingerprint（探針退休用的內容指紋）', () => {
  it('逐股表內容不同時，指紋必須不同', () => {
    const changed = {
      ...MARGIN_RESP,
      tables: [
        MARGIN_RESP.tables[0],
        { fields: MARGIN_FIELDS, data: [[...MARGIN_ROW_2330.slice(0, 2), '999', ...MARGIN_ROW_2330.slice(3)]] },
      ],
    }
    expect(marginDatedFingerprint(changed)).not.toBe(marginDatedFingerprint(MARGIN_RESP))
  })

  it('欄序不穩定不算改版：列順序調換視為同一份內容', () => {
    const row9999 = ['9999', '測試', ...MARGIN_ROW_2330.slice(2)]
    const a = { ...MARGIN_RESP, tables: [MARGIN_RESP.tables[0], { fields: MARGIN_FIELDS, data: [MARGIN_ROW_2330, row9999] }] }
    const b = { ...MARGIN_RESP, tables: [MARGIN_RESP.tables[0], { fields: MARGIN_FIELDS, data: [row9999, MARGIN_ROW_2330] }] }
    expect(marginDatedFingerprint(a)).toBe(marginDatedFingerprint(b))
  })

  it('不得是空內容的常數指紋（0.9.6 前的 bug：永遠 0:45h）', () => {
    expect(marginDatedFingerprint(MARGIN_RESP)).not.toBe('0:45h')
  })

  it('大盤合計表變動不算逐股資料改版', () => {
    const totalsChanged = {
      ...MARGIN_RESP,
      tables: [
        { fields: ['項目', '買進', '賣出'], data: [['融資(交易單位)', '77', '88']] },
        MARGIN_RESP.tables[1],
      ],
    }
    expect(marginDatedFingerprint(totalsChanged)).toBe(marginDatedFingerprint(MARGIN_RESP))
  })

  it('不可用的回應回 null（呼叫端已用 marginDatedOk 擋掉，這裡只保證不丟例外）', () => {
    expect(marginDatedFingerprint({ tables: [] })).toBeNull()
  })
})
