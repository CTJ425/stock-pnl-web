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
    // 這是 T86 被改寫的真實形態：筆數不變、某幾檔的買賣超數字被更正。
    // 只比長度或筆數會漏掉，所以指紋必須含內容雜湊。
    const a = fingerprint([['2609', '4705359', '6411000']])
    const b = fingerprint([['2609', '4705359', '6411001']])
    expect(a).not.toBe(b)
  })

  it('undefined 不會炸', () => {
    expect(() => fingerprint(undefined)).not.toThrow()
  })
})

describe('t86Fingerprint', () => {
  // 2026-07-27 正式區實測：同一份資料連抓兩次，1334 列內容與集合相同，
  // 但末欄相同的幾列之間順序會換。以下用實際觀察到的三列還原那個形狀。
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
  const base = { t86Today: false, t86Frozen: false, marginToday: false, runsToday: 0 }

  it('今天全齊且已定稿 → 短路，這一輪不做任何對外請求', () => {
    expect(
      decideSkip({ ...base, t86Today: true, t86Frozen: true, marginToday: true }),
    ).toEqual({ skip: true, reason: 'complete' })
  })

  it('抓到當天 T86 但尚未定稿 → 不可短路（還要回來看有沒有被改寫）', () => {
    const d = decideSkip({ ...base, t86Today: true, t86Frozen: false, marginToday: true })
    expect(d.skip).toBe(false)
  })

  it('T86 已定稿但融資融券還沒到 → 不可短路', () => {
    // 融資融券約 21:00 才有。只看 T86 就收工的話，17:00 停掉，當天融資融券就永遠沒了。
    const d = decideSkip({ ...base, t86Today: true, t86Frozen: true, marginToday: false })
    expect(d.skip).toBe(false)
  })

  it('什麼都還沒到 → 不短路', () => {
    expect(decideSkip(base).skip).toBe(false)
  })

  it('達到當日執行上限 → 無論如何都短路', () => {
    // 防呆上限優先於一切：邏輯出錯或密鑰外流時的最後一道剎車
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
    // 0.6.1 的實際迴歸形狀：16:15 那輪只有歷史日有融資融券，21:00 那輪才補上當天。
    // 舊寫法傳的是 `dataYmd` 常數，兩輪指紋相同 → 不重產 → 當天報告的 margin 永遠是 null。
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
