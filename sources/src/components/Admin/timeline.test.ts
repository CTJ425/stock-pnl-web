import { describe, it, expect } from 'vitest'
import {
  describeCron,
  describeScope,
  groupProbeTicks,
  humanAgo,
  judgeCron,
} from './timeline'

describe('judgeCron', () => {
  it('停用的排程要看得出來', () => {
    expect(judgeCron(false, 0, '2026-07-31T01:00:00Z')).toBe('late')
  })

  it('今日有失敗 → warn', () => {
    expect(judgeCron(true, 2, '2026-07-31T01:00:00Z')).toBe('warn')
  })

  it('從未跑過 → idle', () => {
    expect(judgeCron(true, 0, null)).toBe('idle')
  })

  it('啟用且無失敗 → 正常', () => {
    expect(judgeCron(true, 0, '2026-07-31T01:00:00Z')).toBe('ok')
  })
})

describe('describeCron', () => {
  it('盤後批次：UTC 換算成台北', () => {
    // */15 8-15 * * 1-5 → Taipei 16:00–23:45
    expect(describeCron('*/15 8-15 * * 1-5')).toBe('週一至週五 16:00–23:45 每 15 分')
  })

  it('每日兩班：13/15 UTC → 台北 21:00 / 23:00', () => {
    expect(describeCron('0 13,15 * * *')).toBe('每日 21:00 / 23:00')
  })

  it('匯率的 3/9 UTC → 台北 11:00 / 17:00', () => {
    expect(describeCron('0 3,9 * * *')).toBe('每日 11:00 / 17:00')
  })

  it('全市場的整點區間、僅平日：8-10 UTC → 台北 16/17/18 點', () => {
    expect(describeCron('0 8-10 * * 1-5')).toBe('週一至週五 16:00 / 17:00 / 18:00')
  })

  it('全市場改成每半小時後仍讀得懂：0,30 7-10 UTC → 台北 15:00–18:30', () => {
    expect(describeCron('0,30 7-10 * * 1-5')).toBe('週一至週五 15:00–18:30 每 30 分')
  })

  it('單一分鐘的整點區間仍逐班列出，不被上面那條吃掉', () => {
    expect(describeCron('0 8-10 * * 1-5')).toBe('週一至週五 16:00 / 17:00 / 18:00')
  })

  it('每日的步進區間會跨午夜：*/30 12-18 UTC → 台北 20:00–次日 02:30', () => {
    expect(describeCron('*/30 12-18 * * *')).toBe('每日 20:00–次日 02:30 每 30 分')
  })

  it('步進區間的結束分鐘由步長算出，不是寫死的 :45', () => {
    expect(describeCron('*/30 8-15 * * 1-5')).toBe('週一至週五 16:00–23:30 每 30 分')
  })

  it('稀疏固定班：分×時列表，逐班列出台北時間', () => {
    expect(describeCron('30,45 7 * * 1-5')).toBe('週一至週五 15:30 / 15:45')
    expect(describeCron('30,45 8,13 * * 1-5')).toBe(
      '週一至週五 16:30 / 16:45 / 21:30 / 21:45',
    )
  })

  it('認得不得的表達式標記後回傳，不再看起來像正常輸出', () => {
    expect(describeCron('5 4 * * 0')).toBe('未解析的排程 5 4 * * 0')
    expect(describeCron('5 4 * * 0')).toContain('5 4 * * 0')
  })
})

describe('humanAgo', () => {
  it('依大小換單位', () => {
    expect(humanAgo(38_000)).toBe('38s')
    expect(humanAgo(9 * 60_000)).toBe('9m')
    expect(humanAgo(3 * 3600_000 + 40 * 60_000)).toBe('3h 40m')
    expect(humanAgo(19 * 86400_000 + 20 * 3600_000)).toBe('19d 20h')
  })

  it('負數或非數字回破折號，不顯示奇怪的值', () => {
    expect(humanAgo(-1)).toBe('—')
    expect(humanAgo(NaN)).toBe('—')
  })
})

describe('describeScope', () => {
  it('每個排程都說得出自己抓什麼', () => {
    expect(describeScope('generate-chips')).toContain('T86')
    expect(describeScope('generate-chips')).toContain('淨持股')
    expect(describeScope('generate-all')).toContain('phase')
    expect(describeScope('sync-market')).toContain('FMTQIK')
    expect(describeScope('sync-market')).toContain('BFI82U')
    expect(describeScope('sync-market')).toContain('market/daily.json')
    expect(describeScope('sync-market')).toContain('15:00–16:30')
    expect(describeScope('sync-top-tickers')).toBe('')
    expect(describeScope('sync-macro')).toContain('FRED')
    expect(describeScope('sync-fx')).toContain('八個幣對')
    expect(describeScope('probe')).toContain('不寫報告')
  })

  it('不認得的 action 回空字串，畫面就不顯示那一行', () => {
    expect(describeScope('unknown')).toBe('')
    expect(describeScope(null)).toBe('')
  })
})

describe('groupProbeTicks', () => {
  const order = ['bfi82u', 't86', 'margin']
  const labels = { bfi82u: '全市場法人 BFI82U', t86: '個股法人 T86', margin: '融資融券' }

  const raw = [
    { taipei_ymd: '20260811', taipei_time: '15:00', source: 'bfi82u', hit: false, ok: true, note: '尚未齊' },
    { taipei_ymd: '20260811', taipei_time: '15:05', source: 'bfi82u', hit: true, ok: true, data_ymd: '20260811', rows: 1, note: '含買進' },
    { taipei_ymd: '20260811', taipei_time: '15:10', source: 'bfi82u', hit: true, ok: true, rows: 1 },
    { taipei_ymd: '20260811', taipei_time: '15:30', source: 't86', hit: false, ok: true },
    { taipei_ymd: '20260810', taipei_time: '15:00', source: 'bfi82u', hit: true, ok: true },
  ]

  it('依日分組、日新到舊，每一天都排滿 order 裡的每一個源', () => {
    const days = groupProbeTicks(raw, order, labels)
    expect(days.map((d) => d.ymd)).toEqual(['20260811', '20260810'])
    // 窗還沒開的源也要占位——少一列就會讓「沒探到」讀起來像「一切正常」
    expect(days[0].series.map((s) => s.source)).toEqual(order)
    expect(days[0].series[2].ticks).toHaveLength(0)
    expect(days[0].series[2].label).toBe('融資融券')
  })

  it('首次命中取時間最早的那一格，不是收到的第一筆', () => {
    const shuffled = [raw[2], raw[1], raw[0]]
    const [today] = groupProbeTicks(shuffled, ['bfi82u'], labels)
    expect(today.series[0].ticks.map((t) => t.time)).toEqual(['15:00', '15:05', '15:10'])
    expect(today.series[0].firstHit).toBe('15:05')
    expect(today.series[0].hits).toBe(2)
  })

  it('同一格重覆寫入時留最後一筆——重跑那次才是要看的觀測', () => {
    const [day] = groupProbeTicks(
      [
        { taipei_ymd: '20260811', taipei_time: '15:00', source: 'bfi82u', hit: false },
        { taipei_ymd: '20260811', taipei_time: '15:00', source: 'bfi82u', hit: true, note: '重跑後命中' },
      ],
      ['bfi82u'],
      labels,
    )
    expect(day.series[0].ticks).toHaveLength(1)
    expect(day.series[0].ticks[0].hit).toBe(true)
    expect(day.series[0].ticks[0].note).toBe('重跑後命中')
  })

  it('缺欄位的列直接略過，不會生出時間為空的格子', () => {
    const days = groupProbeTicks(
      [{ taipei_ymd: '20260811', source: 'bfi82u', hit: true }, { taipei_time: '15:00', hit: true }],
      ['bfi82u'],
      labels,
    )
    expect(days).toEqual([])
  })

  it('沒有 label 的源退回用 id 當名字，不會印 undefined', () => {
    const [day] = groupProbeTicks(
      [{ taipei_ymd: '20260811', taipei_time: '12:00', source: 'mops_revenue', hit: true }],
      ['mops_revenue'],
      {},
    )
    expect(day.series[0].label).toBe('mops_revenue')
  })
})
