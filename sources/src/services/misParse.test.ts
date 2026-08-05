import { describe, expect, it } from 'vitest'
import {
  buildMisChannels,
  parseMisResponse,
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
})
