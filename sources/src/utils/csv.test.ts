import { describe, expect, it } from 'vitest'
import type { Transaction } from '../types/models'
import { parseCsv, parseTransactionsCsv, parseTxDate, transactionsToCsv } from './csv'

describe('parseTxDate', () => {
  it('支援斜線與連字號並補零', () => {
    expect(parseTxDate('2026/07/15')).toBe('2026-07-15')
    expect(parseTxDate('2026-7-5')).toBe('2026-07-05')
  })
  it('拒絕無效日期', () => {
    expect(parseTxDate('2026/02/30')).toBeNull()
    expect(parseTxDate('not a date')).toBeNull()
  })
})

describe('parseCsv', () => {
  it('處理引號、跳脫雙引號與 CRLF', () => {
    expect(parseCsv('a,"b,1","c""x"\r\nd,e,f')).toEqual([
      ['a', 'b,1', 'c"x'],
      ['d', 'e', 'f'],
    ])
  })
})

describe('parseTransactionsCsv（舊試算表格式）', () => {
  const oldCsv = [
    '交易日期,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金,損益/收支',
    '2024/01/10,TPE:2330,台積電,買入,500,1000,712,-500712',
    '2024/06/03,AAPL,"Apple, Inc.",買入,180.5,10,0.26,',
    '2025/02/01,TPE:2330,台積電,賣出,700,500,1548,348452',
  ].join('\n')

  it('TPE: 前綴拆解、中文交易類型轉換', () => {
    const result = parseTransactionsCsv(oldCsv)
    expect(result.errors).toHaveLength(0)
    expect(result.total).toBe(3)
    expect(result.rows).toHaveLength(3)

    expect(result.rows[0]).toEqual({
      tx_date: '2024-01-10',
      market: 'TPE',
      ticker: '2330',
      name: '台積電',
      tx_type: 'BUY',
      price: 500,
      qty: 1000,
      fee_tax: 712,
    })
    expect(result.rows[1].market).toBe('US')
    expect(result.rows[1].ticker).toBe('AAPL')
    expect(result.rows[1].name).toBe('Apple, Inc.')
    expect(result.rows[1].fee_tax).toBeCloseTo(0.26, 6)
    expect(result.rows[2].tx_type).toBe('SELL')
  })

  it('逐列驗證：錯誤列回報列號，其餘列照常匯入', () => {
    const csv = [
      '交易日期,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金',
      'bad-date,TPE:2330,台積電,買入,500,1000,712',
      '2024/01/10,TPE:2330,台積電,轉倉,500,1000,712',
      '2024/01/10,TPE:2330,台積電,買入,500,-5,712',
      '2024/01/11,TPE:2330,台積電,買入,500,1000,712',
    ].join('\n')
    const result = parseTransactionsCsv(csv)
    expect(result.total).toBe(4)
    expect(result.rows).toHaveLength(1)
    expect(result.errors.map((e) => e.line)).toEqual([2, 3, 4])
  })

  it('無市場資訊時以代號樣式判斷（純數字 → 台股）', () => {
    const csv = ['交易日期,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金', '2024/01/10,2330,台積電,買入,500,1000,712'].join('\n')
    const result = parseTransactionsCsv(csv)
    expect(result.rows[0].market).toBe('TPE')
  })

  it('容忍貨幣符號與千分位', () => {
    const csv = ['交易日期,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金', '2024/01/10,TPE:2330,台積電,買入,"NT$500.00","1,000",712'].join('\n')
    const result = parseTransactionsCsv(csv)
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].price).toBe(500)
    expect(result.rows[0].qty).toBe(1000)
  })
})

describe('transactionsToCsv → parseTransactionsCsv 往返', () => {
  it('欄位無損', () => {
    const txs: Transaction[] = [
      {
        id: '1',
        workspace_id: 'w',
        tx_date: '2024-01-10',
        market: 'TPE',
        ticker: '2330',
        name: '台積電',
        tx_type: 'BUY',
        price: 500,
        qty: 1000,
        fee_tax: 712,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: '2',
        workspace_id: 'w',
        tx_date: '2024-06-03',
        market: 'US',
        ticker: 'AAPL',
        name: 'Apple, Inc.',
        tx_type: 'SELL',
        price: 180.5,
        qty: 10,
        fee_tax: 0.26,
        created_at: '2026-01-01T00:00:01Z',
      },
    ]
    const result = parseTransactionsCsv(transactionsToCsv(txs))
    expect(result.errors).toHaveLength(0)
    expect(result.rows).toHaveLength(2)
    for (let i = 0; i < txs.length; i++) {
      expect(result.rows[i]).toEqual({
        tx_date: txs[i].tx_date,
        market: txs[i].market,
        ticker: txs[i].ticker,
        name: txs[i].name,
        tx_type: txs[i].tx_type,
        price: txs[i].price,
        qty: txs[i].qty,
        fee_tax: txs[i].fee_tax,
      })
    }
  })

  it('含多個工作區的備份檔（舊版總覽匯出）整批拒絕匯入，防跨券商成本污染', () => {
    const csv = [
      '工作區,交易日期,市場,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金',
      '券商A,2024-01-10,TPE,2330,台積電,買入,500,1000,712',
      '券商B,2024-02-10,TPE,2330,台積電,買入,600,1000,854',
    ].join('\r\n')
    const result = parseTransactionsCsv(csv)
    expect(result.rows).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain('工作區')
  })

  it('含單一工作區欄值的備份檔可正常匯入', () => {
    const csv = [
      '工作區,交易日期,市場,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金',
      '券商A,2024-01-10,TPE,2330,台積電,買入,500,1000,712',
    ].join('\r\n')
    const result = parseTransactionsCsv(csv)
    expect(result.errors).toHaveLength(0)
    expect(result.rows).toHaveLength(1)
  })
})
