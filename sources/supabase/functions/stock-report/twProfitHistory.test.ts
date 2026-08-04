import { describe, it, expect } from 'vitest'
import {
  mopsProfitBody,
  nextProfitThrough,
  parseMopsProfit,
  planProfitBackfill,
  publishedQuarters,
  type ProfitProgress,
} from './twProfitHistory'

/**
 * 依實際頁面縮寫的 fixture（欄名逐字取自 2026-08-04 實測的 ajax_t163sb04）。
 * 三張表對應三種產業別格式：一般業、金融（有營業利益）、銀行（沒有單一營收欄）。
 */
const HTML = `
<table><tr><td>版面用的表格，沒有表頭</td></tr></table>
<table>
  <tr>
    <th>公司代號</th><th>公司名稱</th><th>營業收入</th><th>營業成本</th>
    <th>營業毛利（毛損）</th><th>營業毛利（毛損）淨額</th><th>營業利益（損失）</th>
    <th>稅前淨利（淨損）</th><th>本期淨利（淨損）</th><th>基本每股盈餘（元）</th>
  </tr>
  <tr>
    <td>1802</td><td>台泥</td><td>10,244,189</td><td>8,274,742</td>
    <td>1,969,447</td><td>1,969,447</td><td>807,242</td><td>659,725</td><td>584,943</td><td>0.79</td>
  </tr>
  <tr>
    <td>9999</td><td>零營收公司</td><td>0</td><td>0</td>
    <td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td>
  </tr>
  <tr><td>小計</td><td>—</td><td>1</td><td>1</td><td>1</td><td>1</td><td>1</td><td>1</td><td>1</td><td>1</td></tr>
</table>
<table>
  <tr>
    <th>公司代號</th><th>公司名稱</th><th>收益</th><th>支出及費用</th>
    <th>營業利益</th><th>繼續營業單位稅前損益</th><th>本期淨利（淨損）</th>
  </tr>
  <tr>
    <td>2882</td><td>國泰金</td><td>1,000,000</td><td>600,000</td>
    <td>400,000</td><td>380,000</td><td>320,000</td>
  </tr>
</table>
<table>
  <tr>
    <th>公司代號</th><th>公司名稱</th><th>利息淨收益</th><th>利息以外淨損益</th>
    <th>繼續營業單位稅前淨利（淨損）</th><th>本期稅後淨利（淨損）</th>
  </tr>
  <tr><td>2801</td><td>彰銀</td><td>500,000</td><td>120,000</td><td>300,000</td><td>250,000</td></tr>
</table>
`

describe('mopsProfitBody', () => {
  it('西元年換民國、季別補零', () => {
    expect(mopsProfitBody('sii', '2026-Q1')).toContain('year=115')
    expect(mopsProfitBody('sii', '2026-Q1')).toContain('season=01')
    expect(mopsProfitBody('otc', '2025-Q4')).toContain('TYPEK=otc')
    expect(mopsProfitBody('otc', '2025-Q4')).toContain('season=04')
  })

  it('格式不符回 null——不要去打一個必然失敗的請求', () => {
    expect(mopsProfitBody('sii', '2026-Q5')).toBeNull()
    expect(mopsProfitBody('sii', '2026-01')).toBeNull()
    expect(mopsProfitBody('sii', '')).toBeNull()
  })
})

describe('parseMopsProfit', () => {
  const got = parseMopsProfit(HTML, '2026-Q1', new Set())

  it('一般業四項比率都算得出來，且與官方 t187ap17_L 逐位吻合', () => {
    // 這組數字取自民國115 Q1 的台泥，官方值為 毛19.23 / 營7.88 / 前6.44 / 後5.71
    const q = got.get('1802')!
    expect(q.grossMarginPercent).toBe(19.23)
    expect(q.operatingMarginPercent).toBe(7.88)
    expect(q.pretaxMarginPercent).toBe(6.44)
    expect(q.netMarginPercent).toBe(5.71)
  })

  it('營收換算成百萬元——這份表是千元，與 t187ap17_L 的單位不同', () => {
    expect(got.get('1802')!.revenueMillionTwd).toBe(10244.19)
  })

  it('金融業沒有毛利欄 → 毛利率為 null，其餘照算', () => {
    const q = got.get('2882')!
    expect(q.grossMarginPercent).toBeNull()
    expect(q.operatingMarginPercent).toBe(40)
    expect(q.pretaxMarginPercent).toBe(38)
    expect(q.netMarginPercent).toBe(32)
  })

  it('銀行業沒有單一營收欄 → 整張表跳過，不硬湊分母', () => {
    // 利息淨收益 + 利息以外淨損益 才等於它的營收，湊出來的比率無法與其他產業比較
    expect(got.has('2801')).toBe(false)
  })

  it('營收為 0 的列跳過——除下去會是 Infinity，那不能顯示', () => {
    expect(got.has('9999')).toBe(false)
  })

  it('非代號的列（小計、表頭）不會被當成資料', () => {
    expect(got.has('小計')).toBe(false)
    expect(got.has('公司代號')).toBe(false)
  })

  it('只保留 wanted 內的代號', () => {
    const only = parseMopsProfit(HTML, '2026-Q1', new Set(['1802']))
    expect([...only.keys()]).toEqual(['1802'])
  })

  it('季別由呼叫端指定——頁面本身不帶年季', () => {
    expect(got.get('1802')!.yearQuarter).toBe('2026-Q1')
  })

  it('基本每股盈餘照原值取，不除以營收（0.6.28）', () => {
    const got = parseMopsProfit(HTML, '2026-Q1', new Set())
    // 0.79 元就是 0.79 元 —— 它已經是每股金額，不是比率
    expect(got.get('1802')!.epsTwd).toBe(0.79)
    expect(got.get('1802')!.epsChecked).toBe(true)
  })

  it('沒有 EPS 欄的產業別：epsTwd 為 null 但仍標記已查過', () => {
    // 金融業那張表沒有這一欄。標記已查過，才不會每晚重抓同一季的 1.6MB 季報
    const got = parseMopsProfit(HTML, '2026-Q1', new Set())
    expect(got.get('2882')!.epsTwd).toBeNull()
    expect(got.get('2882')!.epsChecked).toBe(true)
  })

  it('壞掉的 HTML 回空 Map 而不是拋錯', () => {
    expect(parseMopsProfit('', '2026-Q1', new Set()).size).toBe(0)
    expect(parseMopsProfit('<html>沒有表格</html>', '2026-Q1', new Set()).size).toBe(0)
  })
})

describe('planProfitBackfill', () => {
  const want = ['2026-Q1', '2025-Q4', '2025-Q3', '2025-Q2']

  it('缺哪幾季就補哪幾季，由新到舊', () => {
    const have = new Map<string, ProfitProgress>([
      ['1802', { quarters: new Set(['2026-Q1']), through: null }],
    ])
    expect(planProfitBackfill(have, want, 2)).toEqual(['2025-Q4', '2025-Q3'])
  })

  it('through 以上都已經找過，不再重問', () => {
    // ETF 找不到資料，但 through 記著「這些季別問過了」——否則會永遠卡在同一批
    const have = new Map<string, ProfitProgress>([
      ['0050', { quarters: new Set(), through: '2025-Q3' }],
    ])
    expect(planProfitBackfill(have, want, 4)).toEqual(['2025-Q2'])
  })

  it('補滿之後回空陣列，呼叫端據此完全不發請求', () => {
    const have = new Map<string, ProfitProgress>([
      ['1802', { quarters: new Set(want), through: '2025-Q2' }],
    ])
    expect(planProfitBackfill(have, want, 4)).toEqual([])
  })

  it('已有的季別但還沒查過 EPS，也算缺口（0.6.28）', () => {
    /*
      這是 EPS 專屬的例外：through 記著「比它舊的都問過了」，而 EPS 缺口出現在
      最新那幾季（夜間批次剛寫進來），正好在 through 的另一側 ——
      沿用同一條判斷的話，新一季的 EPS 永遠補不到。
    */
    const have = new Map<string, ProfitProgress>([
      [
        '1802',
        {
          quarters: new Set(want),
          needEps: new Set(['2026-Q1']),
          through: '2025-Q2',
        },
      ],
    ])
    expect(planProfitBackfill(have, want, 4)).toEqual(['2026-Q1'])
  })

  it('沒有任何檔案或預算為 0 時不做事', () => {
    expect(planProfitBackfill(new Map(), want, 4)).toEqual([])
    const have = new Map<string, ProfitProgress>([
      ['1802', { quarters: new Set(), through: null }],
    ])
    expect(planProfitBackfill(have, want, 0)).toEqual([])
  })
})

describe('nextProfitThrough', () => {
  it('取舊值與本輪嘗試過的季別裡最舊的那個', () => {
    expect(nextProfitThrough('2025-Q4', ['2025-Q3', '2025-Q2'])).toBe('2025-Q2')
    expect(nextProfitThrough(null, ['2026-Q1'])).toBe('2026-Q1')
    expect(nextProfitThrough('2025-Q1', [])).toBe('2025-Q1')
    expect(nextProfitThrough(null, [])).toBeNull()
  })
})

describe('publishedQuarters', () => {
  /** 台北時間轉成 UTC 的 Date（函式內部會加 8 小時） */
  const taipei = (iso: string) => new Date(Date.parse(`${iso}+08:00`))

  it('依申報期限判斷最新一季，並留五天緩衝', () => {
    // Q1 期限 5/15，5/20 之後才算已公布
    expect(publishedQuarters(taipei('2026-05-14T10:00:00'), 1)).toEqual(['2025-Q4'])
    expect(publishedQuarters(taipei('2026-05-20T10:00:00'), 1)).toEqual(['2026-Q1'])
    // Q2 期限 8/14
    expect(publishedQuarters(taipei('2026-08-19T10:00:00'), 1)).toEqual(['2026-Q2'])
    // Q3 期限 11/14
    expect(publishedQuarters(taipei('2026-11-19T10:00:00'), 1)).toEqual(['2026-Q3'])
  })

  it('年報（Q4）期限是次年 3/31', () => {
    expect(publishedQuarters(taipei('2026-03-01T10:00:00'), 1)).toEqual(['2025-Q3'])
    expect(publishedQuarters(taipei('2026-04-05T10:00:00'), 1)).toEqual(['2025-Q4'])
  })

  it('由新到舊往回數，跨年進位正確', () => {
    expect(publishedQuarters(taipei('2026-08-19T10:00:00'), 6)).toEqual([
      '2026-Q2',
      '2026-Q1',
      '2025-Q4',
      '2025-Q3',
      '2025-Q2',
      '2025-Q1',
    ])
  })

  it('count 為 0 或負數回空陣列', () => {
    expect(publishedQuarters(taipei('2026-08-19T10:00:00'), 0)).toEqual([])
    expect(publishedQuarters(taipei('2026-08-19T10:00:00'), -3)).toEqual([])
  })
})
