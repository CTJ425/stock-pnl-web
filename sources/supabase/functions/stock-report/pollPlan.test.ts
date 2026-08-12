import { describe, it, expect } from 'vitest'
import {
  decideSkip,
  fingerprint,
  nextT86State,
  rowsFingerprint,
  marginSigPart,
  runSignature,
  MAX_RUNS_PER_DAY,
  t86Fingerprint,
  T86_STABLE_POLLS,
  type T86State,
} from './pollPlan.ts'

describe('fingerprint', () => {
  it('相同內容給相同指紋、不同內容給不同指紋', () => {
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }))
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }))
  })

  it('只有數值改變（長度相同）也要測得出來', () => {
    // This is the true state of T86 being rewritten: the number of transactions remains unchanged, and the transaction super figures of certain levels are corrected.
    // Only the length or number of strokes will be missed, so the fingerprint must contain content hash.
    const a = fingerprint([['2609', '4705359', '6411000']])
    const b = fingerprint([['2609', '4705359', '6411001']])
    expect(a).not.toBe(b)
  })

  it('undefined 不會炸', () => {
    expect(() => fingerprint(undefined)).not.toThrow()
  })
})

describe('t86Fingerprint', () => {
  // 2026-07-27 Actual test in the official area: The same data was captured twice, and the content of column 1334 is the same as the set.
  // However, the order of the same columns in the last column will be changed. The shape is restored below using the three actually observed columns.
  const rowA = ['6606', '建德工業', '17,000', '13,000', '4,000', '5,000']
  const rowB = ['1614', '三洋電', '18,000', '15,000', '3,000', '5,000']
  const rowC = ['1516', '川飛', '4,000', '0', '4,000', '5,000']
  const resp = (rows: string[][]) => ({
    stat: 'OK', date: '20260727', title: 'T86', fields: ['代號'], total: rows.length, data: rows,
  })

  it('列順序不同但內容相同 → 相同指紋（沒有這條就永遠不會定稿）', () => {
    expect(t86Fingerprint(resp([rowA, rowB, rowC]))).toBe(
      t86Fingerprint(resp([rowC, rowA, rowB])),
    )
  })

  it('相鄰欄位的數字挪動位置也算改寫 —— 串接不得無分隔（0.6.42，AUDIT-04）', () => {
    /*
      With cells joined by an empty string, ['12','3'] and ['1','23'] both encode as '123', so a real revision
      could read as "unchanged" —— and that fingerprint is what freezes T86 as final for the day.
    */
    const a = [['2330', '台積電', '12', '3', '4,000', '5,000']]
    const b = [['2330', '台積電', '1', '23', '4,000', '5,000']]
    expect(t86Fingerprint(resp(a))).not.toBe(t86Fingerprint(resp(b)))
  })

  it('任何一列的數字改了 → 不同指紋（真正的改寫仍測得出來）', () => {
    const changed = [rowA, rowB, ['1516', '川飛', '4,000', '0', '4,001', '5,000']]
    expect(t86Fingerprint(resp([rowA, rowB, rowC]))).not.toBe(t86Fingerprint(resp(changed)))
  })

  it('少一列 → 不同指紋', () => {
    expect(t86Fingerprint(resp([rowA, rowB, rowC]))).not.toBe(t86Fingerprint(resp([rowA, rowB])))
  })

  it('樣板欄位（title / fields）變動不影響指紋 —— jsonb 會重排鍵，算進去等於自找不穩定', () => {
    const a = { ...resp([rowA, rowB]), title: '甲', fields: ['x'], notes: ['n'] }
    const b = { ...resp([rowA, rowB]), title: '乙', fields: ['y'], hints: 'h' }
    expect(t86Fingerprint(a)).toBe(t86Fingerprint(b))
  })

  it('資料日不同 → 不同指紋（別把昨天的當成今天的）', () => {
    const a = resp([rowA]); const b = { ...resp([rowA]), date: '20260724' }
    expect(t86Fingerprint(a)).not.toBe(t86Fingerprint(b))
  })

  it('非 T86 形狀 / null / undefined 不會炸，退回一般指紋', () => {
    expect(() => t86Fingerprint(null)).not.toThrow()
    expect(() => t86Fingerprint(undefined)).not.toThrow()
    expect(t86Fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }))
  })
})

describe('rowsFingerprint（裸陣列，探針用）', () => {
  const a = { Code: '2330', PEratio: '31.59', Date: '1150724' }
  const b = { Code: '2609', PEratio: '16.72', Date: '1150724' }

  it('列順序不同但內容相同 → 相同指紋', () => {
    expect(rowsFingerprint([a, b])).toBe(rowsFingerprint([b, a]))
  })

  it('任何一格改了 → 不同指紋（探針要測得出「當天被改寫」）', () => {
    expect(rowsFingerprint([a, b])).not.toBe(
      rowsFingerprint([a, { ...b, PEratio: '16.73' }]),
    )
  })

  it('資料日換了 → 不同指紋', () => {
    expect(rowsFingerprint([a])).not.toBe(rowsFingerprint([{ ...a, Date: '1150727' }]))
  })

  it('非陣列不會炸', () => {
    expect(() => rowsFingerprint(null)).not.toThrow()
    expect(() => rowsFingerprint(undefined)).not.toThrow()
  })
})

describe('nextT86State', () => {
  it('第一次抓到：不算改寫，也還沒定稿', () => {
    const s = nextT86State(null, 'fp1')
    expect(s).toEqual({ fingerprint: 'fp1', revisions: 0, unchanged: 0, frozen: false })
  })

  it('內容改變：改寫次數 +1、連續相同歸零、不定稿', () => {
    const prev: T86State = { fingerprint: 'fp1', revisions: 0, unchanged: 1, frozen: false }
    const s = nextT86State(prev, 'fp2')
    expect(s.revisions).toBe(1)
    expect(s.unchanged).toBe(0)
    expect(s.frozen).toBe(false)
  })

  it('連續 T86_STABLE_POLLS 次相同才定稿', () => {
    let s = nextT86State(null, 'fp1')
    expect(s.frozen).toBe(false)
    for (let i = 0; i < T86_STABLE_POLLS - 1; i++) {
      s = nextT86State(s, 'fp1')
      expect(s.frozen).toBe(false)
    }
    s = nextT86State(s, 'fp1')
    expect(s.frozen).toBe(true)
    expect(s.revisions).toBe(0)
  })

  it('定稿後又變了：重新開始觀察，不會卡在 frozen', () => {
    let s = nextT86State(null, 'fp1')
    s = nextT86State(s, 'fp1')
    s = nextT86State(s, 'fp1')
    expect(s.frozen).toBe(true)
    s = nextT86State(s, 'fp2')
    expect(s.frozen).toBe(false)
    expect(s.revisions).toBe(1)
  })
})

describe('decideSkip', () => {
  const base = {
    t86Today: false,
    t86Frozen: false,
    marginToday: false,
    borrowLanded: false,
    runsToday: 0,
  }

  it('今天全齊且已定稿 → 短路，這一輪不做任何對外請求', () => {
    expect(
      decideSkip({
        ...base,
        t86Today: true,
        t86Frozen: true,
        marginToday: true,
        borrowLanded: true,
      }),
    ).toEqual({ skip: true, reason: 'complete' })
  })

  // BUG-026：借券要等收盤結算後才翻日（2026-08-11 兩個環境實測皆為 22:15），比 T86 定稿（~16:30）
  // 與融資到位（~20:50）都晚。閘門若不含借券，21:00 之後就答 complete，等 22:15 真的翻日時，
  // 整支 generate-chips 會在 `loadBorrow` 之前就被短路——當天各命中 7 次、7 次都「產出 0 檔」，
  // 視窗關閉前借券始終沒到位，而最後一班固定班表跑在 21:45，比翻日還早，救不到。
  it('T86 與融資都到位、但借券還沒翻日 → 不可短路', () => {
    const d = decideSkip({
      ...base,
      t86Today: true,
      t86Frozen: true,
      marginToday: true,
      borrowLanded: false,
    })
    expect(d.skip).toBe(false)
  })

  it('抓到當天 T86 但尚未定稿 → 不可短路（還要回來看有沒有被改寫）', () => {
    const d = decideSkip({ ...base, t86Today: true, t86Frozen: false, marginToday: true })
    expect(d.skip).toBe(false)
  })

  it('T86 已定稿但融資融券還沒到 → 不可短路', () => {
    // Margin trading is only available at about 21:00. If you just look at T86 and call it a day, if it stops at 17:00, the margin trading on that day will be gone forever.
    const d = decideSkip({ ...base, t86Today: true, t86Frozen: true, marginToday: false })
    expect(d.skip).toBe(false)
  })

  it('什麼都還沒到 → 不短路', () => {
    expect(decideSkip(base).skip).toBe(false)
  })

  it('達到當日執行上限 → 無論如何都短路', () => {
    // The fool-proof upper limit takes precedence over everything else: the last brake when logic errors occur or keys are leaked.
    const d = decideSkip({ ...base, runsToday: MAX_RUNS_PER_DAY })
    expect(d).toEqual({ skip: true, reason: 'run-cap' })
  })

  it('上限之下差一次仍然照跑', () => {
    expect(decideSkip({ ...base, runsToday: MAX_RUNS_PER_DAY - 1 }).skip).toBe(false)
  })
})

describe('runSignature', () => {
  const parts = { dataYmd: '20260727', t86: 'a', margin: 'b', borrow: 'c', tickers: ['2609', '0050'] }

  it('輸入相同 → 指紋相同（不必重產報告）', () => {
    expect(runSignature(parts)).toBe(runSignature({ ...parts, tickers: ['0050', '2609'] }))
  })

  it('T86 內容變了 → 指紋不同（要重產）', () => {
    expect(runSignature(parts)).not.toBe(runSignature({ ...parts, t86: 'a2' }))
  })

  it('新增一檔持股 → 指紋不同（舊報告裡沒有它）', () => {
    expect(runSignature(parts)).not.toBe(
      runSignature({ ...parts, tickers: ['2609', '0050', '2330'] }),
    )
  })

  it('融資融券由無到有 → 指紋不同', () => {
    expect(runSignature({ ...parts, margin: '' })).not.toBe(runSignature(parts))
  })
})

describe('marginSigPart', () => {
  const parts = { dataYmd: '20260730', t86: 'a', margin: '', borrow: 'c', tickers: ['2609', '0050'] }

  it('順序不影響結果（哪幾天有資料才是重點）', () => {
    expect(marginSigPart(['20260724', '20260723'])).toBe(marginSigPart(['20260723', '20260724']))
  })

  it('當天的融資融券由無到有 → 指紋必須改變', () => {
    // The actual regression shape of 0.6.1: In the 16:15 round, only the historical day had margin trading, and the 21:00 round only made up for that day.
    // The old writing method passes the `dataYmd` constant, and the two rounds of fingerprints are the same → not repeated → the margin reported on the day is always null.
    const history = ['20260728', '20260729']
    const before = runSignature({ ...parts, dataYmd: '20260730', margin: marginSigPart(history) })
    const after = runSignature({
      ...parts,
      dataYmd: '20260730',
      margin: marginSigPart([...history, '20260730']),
    })
    expect(before).not.toBe(after)
  })

  it('歷史日回補（走勢圖補洞）也要重產', () => {
    const before = marginSigPart(['20260729', '20260730'])
    const after = marginSigPart(['20260728', '20260729', '20260730'])
    expect(before).not.toBe(after)
  })

  it('一天都沒有 → 空字串（與「整批失敗」是同一件事）', () => {
    expect(marginSigPart([])).toBe('')
  })
})
