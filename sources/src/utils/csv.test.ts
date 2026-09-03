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

describe('parseNumber 會計負數括號格式（BUG-037）', () => {
  const head = '交易日期,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金'

  it('括號金額視為負數，因此被三個數值欄位一致地拒絕，而不是變成 NaN', () => {
    const csv = [head, '2024/01/10,TPE:2330,台積電,買入,500,1000,"(1,500)"'].join('\n')
    const result = parseTransactionsCsv(csv)
    expect(result.rows).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain('手續費')
  })

  it('括號單價同樣被拒絕', () => {
    const csv = [head, '2024/01/10,TPE:2330,台積電,買入,"(500)",1000,712'].join('\n')
    const result = parseTransactionsCsv(csv)
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0].message).toContain('交易單價')
  })

  it('括號內已帶負號屬格式錯誤，不得被兩次取負變成正數', () => {
    // "(-500)" 若先判括號再取負，會得到 +500 並通過 price >= 0 檢查，把錯誤資料靜靜收進來
    const csv = [head, '2024/01/10,TPE:2330,台積電,買入,"(-500)",1000,712'].join('\n')
    const result = parseTransactionsCsv(csv)
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0].message).toContain('交易單價')
  })

  it('非括號的正常數值不受影響', () => {
    const csv = [head, '2024/01/10,TPE:2330,台積電,買入,"NT$500.00","1,000","1,500"'].join('\n')
    const result = parseTransactionsCsv(csv)
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].fee_tax).toBe(1500)
  })
})


describe('交易性質 融券（Task 141 Stage B）', () => {
  it('匯入接受「融券」與 SHORT 兩種寫法', () => {
    const csv = [
      '交易日期,市場,股票代號,股票名稱,交易類型,交易性質,交易單價,交易股數,手續費 / 稅金',
      '2026-03-02,台股,2603,長榮,賣出,融券,100,1000,522',
      '2026-03-03,台股,2603,長榮,買入,SHORT,95,1000,135',
    ].join('\n')
    const res = parseTransactionsCsv(csv)
    expect(res.errors).toHaveLength(0)
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].tx_nature).toBe('SHORT')
    expect(res.rows[1].tx_nature).toBe('SHORT')
  })

  it('匯出寫成「融券」，再匯入回來仍是 SHORT', () => {
    const out = transactionsToCsv([
      {
        id: 't1', workspace_id: 'ws', tx_date: '2026-03-02', market: 'TPE',
        ticker: '2603', name: '長榮', tx_type: 'SELL', price: 100, qty: 1000,
        fee_tax: 522, tx_nature: 'SHORT', created_at: '2026-03-02T01:00:00.000Z',
      },
    ])
    expect(out).toContain('融券')
    expect(parseTransactionsCsv(out).rows[0].tx_nature).toBe('SHORT')
  })
})

describe('交易性質與分項費用欄位（Task 137 §C）', () => {
  const SPLIT = '交易日期,市場,股票代號,股票名稱,交易類型,交易性質,交易單價,交易股數,手續費,證交稅'

  it('分項手續費與證交稅相加寫回 fee_tax', () => {
    const csv = [SPLIT, '2026-08-18,TPE,2344,華邦電,賣出,當沖,188.5,1000,80,282'].join('\n')
    const r = parseTransactionsCsv(csv)
    expect(r.errors).toEqual([])
    expect(r.rows[0].fee_tax).toBe(362)
    expect(r.rows[0].tx_nature).toBe('DAY_TRADE')
  })

  it('交易性質接受中文標籤與英文代碼', () => {
    const csv = [
      SPLIT,
      '2026-08-18,TPE,2344,華邦電,賣出,當沖,188.5,1000,80,282',
      '2026-08-19,TPE,2330,台積電,買入,DAY_TRADE,1000,1000,142,0',
      '2026-08-20,TPE,2330,台積電,買入,現股,1000,1000,142,0',
      '2026-08-21,TPE,2330,台積電,買入,MARGIN,1000,1000,142,0',
    ].join('\n')
    const r = parseTransactionsCsv(csv)
    expect(r.errors).toEqual([])
    expect(r.rows.map((x) => x.tx_nature)).toEqual(['DAY_TRADE', 'DAY_TRADE', 'SPOT', 'MARGIN'])
  })

  it('無法辨識的交易性質逐列回報，其餘列照常匯入', () => {
    const csv = [
      SPLIT,
      '2026-08-18,TPE,2344,華邦電,賣出,期貨,188.5,1000,80,282',
      '2026-08-19,TPE,2330,台積電,買入,現股,1000,1000,142,0',
    ].join('\n')
    const r = parseTransactionsCsv(csv)
    expect(r.rows).toHaveLength(1)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].line).toBe(2)
    expect(r.errors[0].message).toContain('交易性質')
  })

  it('沒有交易性質欄位的檔案，行為與現在完全相同', () => {
    const csv = [
      '交易日期,市場,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金',
      '2026-08-18,TPE,2344,華邦電,賣出,188.5,1000,362',
    ].join('\n')
    const r = parseTransactionsCsv(csv)
    expect(r.errors).toEqual([])
    expect(r.rows[0].fee_tax).toBe(362)
    expect(r.rows[0].tx_nature).toBeUndefined()
  })

  it('只有合併欄位時不得被分項比對搶走：手續費 / 稅金 仍是總額', () => {
    // header.findIndex(h => h.includes('手續費')) 對「手續費」與「手續費 / 稅金」都成立，
    // 分項欄位必須用精確比對且兩欄同時存在才算數
    const csv = [
      '交易日期,市場,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金',
      '2026-05-20,TPE,2330,台積電,賣出,2415,50,413',
    ].join('\n')
    expect(parseTransactionsCsv(csv).rows[0].fee_tax).toBe(413)
  })

  it('匯出的表頭同時帶分項欄位與舊的合併欄位', () => {
    const header = transactionsToCsv([]).replace('\uFEFF', '').split('\r\n')[0]
    expect(header).toBe(
      '交易日期,市場,股票代號,股票名稱,交易類型,交易性質,交易單價,交易股數,手續費,證交稅,手續費 / 稅金',
    )
  })

  it('匯出再匯入：交易性質保留，未標記者維持不存在', () => {
    const txs: Transaction[] = [
      {
        id: '1', workspace_id: 'w', tx_date: '2026-08-18', market: 'TPE', ticker: '2344',
        name: '華邦電', tx_type: 'SELL', price: 188.5, qty: 1000, fee_tax: 362,
        tx_nature: 'DAY_TRADE', created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: '2', workspace_id: 'w', tx_date: '2026-05-20', market: 'TPE', ticker: '2330',
        name: '台積電', tx_type: 'SELL', price: 2415, qty: 50, fee_tax: 413,
        created_at: '2026-01-01T00:00:01Z',
      },
    ]
    const r = parseTransactionsCsv(transactionsToCsv(txs))
    expect(r.errors).toEqual([])
    expect(r.rows[0].tx_nature).toBe('DAY_TRADE')
    expect(r.rows[0].fee_tax).toBe(362)
    expect(r.rows[1].tx_nature).toBeUndefined()
    expect(r.rows[1].fee_tax).toBe(413)
  })

  it('匯出的分項金額相加等於原本的 fee_tax', () => {
    const txs: Transaction[] = [
      {
        id: '1', workspace_id: 'w', tx_date: '2026-08-18', market: 'TPE', ticker: '2344',
        name: '華邦電', tx_type: 'SELL', price: 188.5, qty: 1000, fee_tax: 362,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    const cells = transactionsToCsv(txs).trim().split('\r\n')[1].split(',')
    // 手續費 80、證交稅 282（減半稅率）、合併欄位 362
    expect(cells.slice(-3)).toEqual(['80', '282', '362'])
  })
})
