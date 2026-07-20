import { describe, expect, it } from 'vitest'
import { buildMisChannels, parseMisResponse } from '../../supabase/functions/stock-price/misParse.ts'

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
    expect(parseMisResponse(data)).toEqual([{ ticker: '2330', price: 605 }])
  })

  it('z 無效時退買一價 b 的第一檔', () => {
    const data = { msgArray: [{ c: '2330', z: '-', b: '604.00_603.00_602.00', y: '600.00' }] }
    expect(parseMisResponse(data)).toEqual([{ ticker: '2330', price: 604 }])
  })

  it('z 與 b 皆無效時退昨收 y（盤後 / 尚無成交）', () => {
    const data = { msgArray: [{ c: '2330', z: '-', b: '-', y: '600.00' }] }
    expect(parseMisResponse(data)).toEqual([{ ticker: '2330', price: 600 }])
  })

  it('支援千分位逗號價格', () => {
    const data = { msgArray: [{ c: '3008', z: '2,150.00' }] }
    expect(parseMisResponse(data)).toEqual([{ ticker: '3008', price: 2150 }])
  })

  it('全部無效的列直接略過', () => {
    const data = {
      msgArray: [
        { c: '9999', z: '-', b: '-', y: '-' },
        { c: '2330', z: '605.00' },
      ],
    }
    expect(parseMisResponse(data)).toEqual([{ ticker: '2330', price: 605 }])
  })

  it('同一代號多列時取第一列', () => {
    const data = {
      msgArray: [
        { c: '2330', z: '605.00' },
        { c: '2330', z: '999.00' },
      ],
    }
    expect(parseMisResponse(data)).toEqual([{ ticker: '2330', price: 605 }])
  })

  // 取自 mis.twse.com.tw 的實際回應（2026-07-20 盤中，欄位已精簡）：
  // z 為 '-' 是常態，無效 channel 會回傳 c 為空字串的佔位列
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
      { ticker: '2330', price: 2335 },
      { ticker: '0050', price: 99.85 },
      { ticker: '6488', price: 1235 },
    ])
  })

  it('缺 msgArray、非物件列、缺代號皆安全處理', () => {
    expect(parseMisResponse(null)).toEqual([])
    expect(parseMisResponse({})).toEqual([])
    expect(parseMisResponse({ msgArray: 'oops' })).toEqual([])
    expect(parseMisResponse({ msgArray: [null, 42, { z: '605.00' }] })).toEqual([])
  })
})
