import { describe, expect, it } from 'vitest'
import {
  buildMisChannels,
  parseMisResponse,
  toIndustry,
  MIS_INDUSTRY_MAP,
  type MisQuote,
} from '../../supabase/functions/stock-price/misParse.ts'

/**
 * The old case only feeds c/z/b/y, and only cares about price / prevClose.
 * Starting from 0.6.36, MisQuote has added opening high and low volume and trading day/matching time. This helper supplements their default values.
 * Let those cases maintain a strict comparison of toEqual (do not allow extra fields).
 */
const q = (partial: Pick<MisQuote, 'ticker' | 'price' | 'prevClose'>): MisQuote => ({
  open: null,
  high: null,
  low: null,
  volume: null,
  tradeDate: null,
  tradeTime: null,
  trial: false,
  industry: null,
  ...partial,
})

describe('buildMisChannels', () => {
  it('每檔同時產生 tse/otc channel', () => {
    expect(buildMisChannels(['2330'])).toEqual([['tse_2330.tw', 'otc_2330.tw']])
  })

  it('超過單次上限時分批，且同一代號的 channel 落在同一群組', () => {
    const tickers = Array.from({ length: 30 }, (_, i) => String(1000 + i))
    const groups = buildMisChannels(tickers)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveLength(50) // 25 檔 × 2
    expect(groups[1]).toHaveLength(10) // 5 檔 × 2
    for (const group of groups) {
      for (let i = 0; i < group.length; i += 2) {
        expect(group[i].replace('tse_', '')).toBe(group[i + 1].replace('otc_', ''))
      }
    }
  })

  it('空清單回傳空群組', () => {
    expect(buildMisChannels([])).toEqual([])
  })
})

describe('parseMisResponse', () => {
  it('取成交價 z', () => {
    const data = { msgArray: [{ c: '2330', z: '605.0000', y: '600.0000' }] }
    expect(parseMisResponse(data)).toEqual([q({ ticker: '2330', price: 605, prevClose: 600 })])
  })

  it('z 無效時退買一價 b 的第一檔', () => {
    const data = { msgArray: [{ c: '2330', z: '-', b: '604.00_603.00_602.00', y: '600.00' }] }
    expect(parseMisResponse(data)).toEqual([q({ ticker: '2330', price: 604, prevClose: 600 })])
  })

  it('z 與 b 皆無效時退昨收 y（盤後 / 尚無成交）', () => {
    const data = { msgArray: [{ c: '2330', z: '-', b: '-', y: '600.00' }] }
    expect(parseMisResponse(data)).toEqual([q({ ticker: '2330', price: 600, prevClose: 600 })])
  })

  // prevClose is the benchmark for coloring the rise and fall of the current price (0.6.34): it comes from the same response as the transaction price and does not require additional requests.
  it('昨收 y 一併帶出；y 無效時為 null（不拿成交價冒充基準）', () => {
    const data = { msgArray: [{ c: '2330', z: '605.00', y: '-' }] }
    expect(parseMisResponse(data)).toEqual([q({ ticker: '2330', price: 605, prevClose: null })])
  })

  it('支援千分位逗號價格', () => {
    const data = { msgArray: [{ c: '3008', z: '2,150.00' }] }
    expect(parseMisResponse(data)).toEqual([q({ ticker: '3008', price: 2150, prevClose: null })])
  })

  it('全部無效的列直接略過', () => {
    const data = {
      msgArray: [
        { c: '9999', z: '-', b: '-', y: '-' },
        { c: '2330', z: '605.00' },
      ],
    }
    expect(parseMisResponse(data)).toEqual([q({ ticker: '2330', price: 605, prevClose: null })])
  })

  it('同一代號多列時取第一列', () => {
    const data = {
      msgArray: [
        { c: '2330', z: '605.00' },
        { c: '2330', z: '999.00' },
      ],
    }
    expect(parseMisResponse(data)).toEqual([q({ ticker: '2330', price: 605, prevClose: null })])
  })

  // Actual response taken from mis.twse.com.tw (2026-07-20 intraday, fields have been streamlined):
  // It is normal for z to be '-'. If the channel is invalid, it will return a placeholder column where c is an empty string.
  it('解析真實 MIS 回應（含上市 / 上櫃 / 空佔位列）', () => {
    const data = {
      msgArray: [
        {
          c: '2330',
          n: '台積電',
          z: '-',
          b: '2335.0000_2330.0000_2325.0000_',
          a: '2340.0000_2345.0000_',
          y: '2290.0000',
          ex: 'tse',
        },
        { tv: '-', s: '-', c: '', z: '-' },
        { c: '0050', n: '元大台灣50', z: '-', b: '99.8500_99.8000_', y: '100.1500', ex: 'tse' },
        { c: '6488', n: '環球晶', z: '-', b: '1235.0000_1230.0000_', y: '1250.0000', ex: 'otc' },
      ],
    }
    expect(parseMisResponse(data)).toEqual([
      q({ ticker: '2330', price: 2335, prevClose: 2290 }),
      q({ ticker: '0050', price: 99.85, prevClose: 100.15 }),
      q({ ticker: '6488', price: 1235, prevClose: 1250 }),
    ])
  })

  it('缺 msgArray、非物件列、缺代號皆安全處理', () => {
    expect(parseMisResponse(null)).toEqual([])
    expect(parseMisResponse({})).toEqual([])
    expect(parseMisResponse({ msgArray: 'oops' })).toEqual([])
    expect(parseMisResponse({ msgArray: [null, 42, { z: '605.00' }] })).toEqual([])
  })

  /*
   * 0.6.36: The quotation card requires opening high and low volume and trading day/matching time, all in the same response.
   * The following is taken from the actual response of mis.twse.com.tw (2026-08-05 15:23, after the close - pay attention to this moment
   * The daily closing endpoint of TWSE OpenAPI is still stuck at 8/4, which is why "Today's Close" does not use this endpoint).
   */
  it('收盤後的真實回應：帶出開高低量、交易日與撮合時間', () => {
    const data = {
      msgArray: [
        {
          c: '2330',
          n: '台積電',
          z: '2405.0000',
          y: '2320.0000',
          o: '2385.0000',
          h: '2415.0000',
          l: '2370.0000',
          v: '31851',
          d: '20260805',
          t: '13:30:00',
          ip: '0',
          ex: 'tse',
        },
      ],
    }
    expect(parseMisResponse(data)).toEqual([
      {
        ticker: '2330',
        price: 2405,
        prevClose: 2320,
        open: 2385,
        high: 2415,
        low: 2370,
        volume: 31851,
        tradeDate: '20260805',
        tradeTime: '13:30:00',
        trial: false,
        industry: null,
      },
    ])
  })

  it('試撮階段 ip=1：成交價欄位是試撮價，開高低尚未成形', () => {
    const data = {
      msgArray: [
        { c: '2330', z: '2400.0000', y: '2320.0000', o: '-', h: '-', l: '-', v: '0', ip: '1' },
      ],
    }
    const [quote] = parseMisResponse(data)
    expect(quote.trial).toBe(true)
    expect(quote.price).toBe(2400)
    expect(quote.open).toBeNull()
    // The number of transactions that have not yet been completed is 0, not "cannot be obtained" - the two are displayed on the screen as 0 and "—" respectively.
    expect(quote.volume).toBe(0)
  })

  it('壞掉的交易日 / 撮合時間一律當取不到，不硬塞進畫面', () => {
    const data = {
      msgArray: [{ c: '2330', z: '605.00', d: '2026-08-05', t: '13:30', v: '-' }],
    }
    const [quote] = parseMisResponse(data)
    expect(quote.tradeDate).toBeNull()
    expect(quote.tradeTime).toBeNull()
    expect(quote.volume).toBeNull()
  })

  it('解析官方產業代碼 row.i 映射為中文產業名稱（33大類）', () => {
    const data = {
      msgArray: [
        { c: '2330', z: '605.00', i: '24' }, // 半導體業
        { c: '2603', z: '180.00', i: '15' }, // 航運業
        { c: '2701', z: '30.00', i: '16' },  // 觀光餐旅
        { c: '3293', z: '800.00', i: '32' }, // 文化創意業
        { c: '6806', z: '50.00', i: '35' },  // 綠能環保
        { c: '1101', z: '32.00', i: '1' },   // 水泥工業 (單碼補零)
        { c: '0050', z: '180.00', i: '00' }, // ETF (非33大類，為 null)
        { c: '9999', z: '10.00', i: '-' },   // 無效產業代碼為 null
      ],
    }
    const quotes = parseMisResponse(data)
    expect(quotes.find((q) => q.ticker === '2330')?.industry).toBe('半導體業')
    expect(quotes.find((q) => q.ticker === '2603')?.industry).toBe('航運業')
    expect(quotes.find((q) => q.ticker === '2701')?.industry).toBe('觀光餐旅')
    expect(quotes.find((q) => q.ticker === '3293')?.industry).toBe('文化創意業')
    expect(quotes.find((q) => q.ticker === '6806')?.industry).toBe('綠能環保')
    expect(quotes.find((q) => q.ticker === '1101')?.industry).toBe('水泥工業')
    expect(quotes.find((q) => q.ticker === '0050')?.industry).toBeNull()
    expect(quotes.find((q) => q.ticker === '9999')?.industry).toBeNull()
  })

  // BUG-045: 收盤最後一盤無成交（z: '-'）時，嚴禁退階取委買價 b[0]，必須回傳 null，讓系統切換 Yahoo 後備
  describe('BUG-045 收盤無撮合成交不退階委買價', () => {
    it('收盤後（t >= 13:30:00）若 z 為 "-"，不退委買價 b[0]，整筆忽略交由 Yahoo 接管', () => {
      const data = {
        msgArray: [
          {
            c: '5701',
            z: '-',
            b: '4.19_4.18_4.17_',
            y: '4.24',
            t: '13:30:00',
            d: '20260903',
          },
        ],
      }
      expect(parseMisResponse(data)).toEqual([])
    })

    it('收盤後（t > 13:30:00，如盤後零股/定價 14:30:00）若 z 為 "-"，同樣不退委買價', () => {
      const data = {
        msgArray: [
          {
            c: '5701',
            z: '-',
            b: '4.19_4.18_4.17_',
            y: '4.24',
            t: '14:30:00',
            d: '20260903',
          },
        ],
      }
      expect(parseMisResponse(data)).toEqual([])
    })

    it('盤中撮合時間（t < 13:30:00）若 z 為 "-"，仍正常退階買一價以供盤中估值', () => {
      const data = {
        msgArray: [
          {
            c: '5701',
            z: '-',
            b: '4.19_4.18_',
            y: '4.24',
            t: '11:00:00',
            d: '20260903',
          },
        ],
      }
      const quotes = parseMisResponse(data)
      expect(quotes).toHaveLength(1)
      expect(quotes[0].price).toBe(4.19)
    })

    it('若 t 為無效或空值但 ot >= 13:30:00，仍正確辨識收盤無成交而不退委買價', () => {
      const data = {
        msgArray: [
          {
            c: '5701',
            z: '-',
            b: '4.19_4.18_',
            y: '4.24',
            t: '-',
            ot: '14:30:00',
            d: '20260903',
          },
        ],
      }
      expect(parseMisResponse(data)).toEqual([])
    })
  })

  describe('toIndustry 產業代碼轉換函式', () => {
    it('覆蓋全部 33 大類官方產業代碼映射', () => {
      expect(Object.keys(MIS_INDUSTRY_MAP).length).toBeGreaterThanOrEqual(33)
      expect(toIndustry('01')).toBe('水泥工業')
      expect(toIndustry('15')).toBe('航運業')
      expect(toIndustry('16')).toBe('觀光餐旅')
      expect(toIndustry('24')).toBe('半導體業')
      expect(toIndustry('38')).toBe('居家生活')
    })

    it('支援單位數自動補零與數字型別', () => {
      expect(toIndustry('5')).toBe('電機機械')
      expect(toIndustry(5)).toBe('電機機械')
      expect(toIndustry(24)).toBe('半導體業')
    })

    it('直接傳入繁體中文產業名稱時能原樣保留', () => {
      expect(toIndustry('航運業')).toBe('航運業')
      expect(toIndustry('半導體業')).toBe('半導體業')
    })

    it('邊界與無效輸入回傳 null', () => {
      expect(toIndustry(null)).toBeNull()
      expect(toIndustry(undefined)).toBeNull()
      expect(toIndustry('')).toBeNull()
      expect(toIndustry('   ')).toBeNull()
      expect(toIndustry('-')).toBeNull()
      expect(toIndustry('00')).toBeNull()
      expect(toIndustry('99')).toBeNull()
      expect(toIndustry('INVALID')).toBeNull()
    })
  })
})
