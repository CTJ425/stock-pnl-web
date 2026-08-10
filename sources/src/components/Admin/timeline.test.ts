import { describe, it, expect } from 'vitest'
import {
  TL_SPAN_HOURS,
  TW_CHAIN,
  cronHoursTaipei,
  dayPercent,
  describeCron,
  durationLabel,
  describeScope,
  hourLabel,
  nextRun,
  roundBaseYmd,
  hoursFromBase,
  humanAgo,
  judgeCron,
  judgeSource,
  ROUND_GRACE_HOURS,
  taipeiParts,
  tlLabel,
  tlPercent,
} from './timeline'

const BASE = '2026-07-30'

describe('hoursFromBase', () => {
  it('以資料日 15:00（台北）為原點', () => {
    expect(hoursFromBase('2026-07-30T07:00:00.000Z', BASE)).toBe(0) // 台北 15:00
    expect(hoursFromBase('2026-07-30T08:15:00.000Z', BASE)).toBe(1.25) // 台北 16:15
  })

  it('跨日的時間戳算成大於 9（＝隔天 00:00 之後）', () => {
    // Taipei 07-31 09:10 = the 18.167th hour starting from 15:00 on the data day
    const h = hoursFromBase('2026-07-31T01:10:00.000Z', BASE)!
    expect(h).toBeCloseTo(18.167, 2)
    expect(h).toBeGreaterThan(9)
  })

  it('壞掉的時間戳或空值回 null，不得回 NaN', () => {
    expect(hoursFromBase(null, BASE)).toBeNull()
    expect(hoursFromBase('', BASE)).toBeNull()
    expect(hoursFromBase('not-a-date', BASE)).toBeNull()
    expect(hoursFromBase('2026-07-30T08:00:00Z', '')).toBeNull()
  })
})

describe('tlPercent / tlLabel', () => {
  it('0 與軸長分別對應 0% 與 100%', () => {
    expect(tlPercent(0)).toBe(0)
    expect(tlPercent(TL_SPAN_HOURS)).toBe(100)
  })

  it('超出軸範圍的事件夾在邊界，不會跑出容器', () => {
    expect(tlPercent(-5)).toBe(0)
    expect(tlPercent(99)).toBe(100)
  })

  it('刻度換算與時間軸設計一致（21:00 在 6/19）', () => {
    expect(tlPercent(6)).toBeCloseTo(31.58, 1)
  })

  it('跨日的時刻標成「次日」', () => {
    expect(tlLabel(1.25)).toBe('16:15')
    expect(tlLabel(6)).toBe('21:00')
    expect(tlLabel(18.167)).toBe('次日 09:10')
  })
})

describe('judgeSource', () => {
  const borrow = TW_CHAIN.find((s) => s.id === 'borrow')!
  const inst = TW_CHAIN.find((s) => s.id === 'institutional')!

  it('法人 16:15 到手算正常——批次 16:00 才起跑，不能拿公布時刻判', () => {
    // The announcement window 15:00–15:30 has long passed, but dueBy is a batch shift (16:30)
    expect(judgeSource(inst, 1.25, 2)).toBe('ok')
  })

  it('借券拖到隔天早上算延遲', () => {
    expect(judgeSource(borrow, 18.167, 19)).toBe('late')
  })

  it('全市場法人以 18:15 為界——它的排程一天只有三班，最後一班 18:00（0.6.33）', () => {
    const market = TW_CHAIN.find((s) => s.id === 'market')!
    // 16:15 (Hour 1.25): The line for individual stocks, but the entire market may not have run the second shift at that time - not counting delays
    expect(judgeSource(market, 1.25, 4)).toBe('ok')
    expect(judgeSource(market, 3.25, 4)).toBe('ok') // 18:15 剛好在界上
    expect(judgeSource(market, 3.5, 4)).toBe('late') // 18:30 才產出才算延遲
    // I haven’t received it yet before 18:15. It’s because I’m waiting, not delayed (I pass this section every evening)
    expect(judgeSource(market, null, 2)).toBe('idle')
    expect(judgeSource(market, null, 4)).toBe('late')
  })

  it('還沒到寬限截止就沒拿到 → 等待中，不是延遲', () => {
    // There is a period of time every evening when the information has not been released to begin with. Turning on the red light at that time will only make people learn to ignore it.
    expect(judgeSource(borrow, null, 3)).toBe('idle')
  })

  it('過了寬限截止仍沒拿到 → 延遲', () => {
    expect(judgeSource(borrow, null, 12)).toBe('late')
  })

  it('剛好卡在 dueBy 之後幾秒仍算準時——判定以「輪次」為單位而非精確秒數', () => {
    // Actual measurement: dueBy=1.5 (16:30 round) of the three major legal persons, and this round was not written until 16:30:03 →
    // 1.5009 hours. If there is no round buffering, the difference will be three seconds and it will be judged as delay.
    // However, the daily K-line (dueBy=2) captured at the same moment displays normally, with one red and one green screen appearing broken.
    expect(judgeSource(inst, 1.5009, 3)).toBe('ok')
    expect(judgeSource(inst, inst.dueBy + ROUND_GRACE_HOURS - 0.01, 3)).toBe('ok')
  })

  it('超過該輪的緩衝才算延遲', () => {
    expect(judgeSource(inst, inst.dueBy + ROUND_GRACE_HOURS + 0.01, 3)).toBe('late')
  })

  it('拿到了但不完整一律是 warn，不論早晚', () => {
    expect(judgeSource(inst, 1.25, 2, true)).toBe('warn')
    expect(judgeSource(borrow, 18.167, 19, true)).toBe('warn')
  })
})

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
    // market-daily. Without this item, the entire schedule will only print the original cron string.
    expect(describeCron('0 8-10 * * 1-5')).toBe('週一至週五 16:00 / 17:00 / 18:00')
  })

  it('全市場改成每半小時後仍讀得懂：0,30 7-10 UTC → 台北 15:00–18:30（0.6.38）', () => {
    // 0.6.38 moved market-daily earlier; without the minute-list branch this printed the raw cron string,
    // so the admin schedule never mentioned 15:00 at all —— which is how the gap was noticed.
    expect(describeCron('0,30 7-10 * * 1-5')).toBe('週一至週五 15:00–18:30 每 30 分')
  })

  it('單一分鐘的整點區間仍逐班列出，不被上面那條吃掉', () => {
    // Three shifts read better one by one than as "每 60 分"
    expect(describeCron('0 8-10 * * 1-5')).toBe('週一至週五 16:00 / 17:00 / 18:00')
  })

  it('每日的步進區間會跨午夜：*/30 12-18 UTC → 台北 20:00–次日 02:30（0.6.41）', () => {
    // macro-daily. Before this branch existed it printed the raw cron string, same as BUG-012 —— found while
    // verifying that fix. Without the 次日 marker it would read "每日 20:00–02:30", i.e. as if it ran in the morning.
    expect(describeCron('*/30 12-18 * * *')).toBe('每日 20:00–次日 02:30 每 30 分')
  })

  it('步進區間的結束分鐘由步長算出，不是寫死的 :45', () => {
    // */15 ends at :45 and */30 at :30. The literal 45 was right only for the one job that had this shape.
    expect(describeCron('*/30 8-15 * * 1-5')).toBe('週一至週五 16:00–23:30 每 30 分')
  })

  it('認不得的表達式標記後回傳，不再看起來像正常輸出（0.6.43，AUDIT-05）', () => {
    /*
      Echoing the expression was already the honest choice —— a cron string beats a mistranslated sentence.
      What it could not do is tell a missing branch apart from a design decision, which is where BUG-012 and
      BUG-014 hid. The prefix makes the next unmatched shape announce itself; the expression is still shown.
    */
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

describe('TW_CHAIN', () => {
  it('公布窗的起訖與寬限截止必須遞增，否則延遲線會反向', () => {
    for (const s of TW_CHAIN) {
      expect(s.window[0]).toBeLessThanOrEqual(s.window[1])
      expect(s.dueBy).toBeGreaterThanOrEqual(s.window[1])
    }
  })

  it('不含個股新聞——0.6.13 起後台不再追蹤它', () => {
    expect(TW_CHAIN.map((s) => s.id)).toEqual([
      'institutional',
      'market',
      'daily',
      'margin',
      'borrow',
    ])
  })

  it('所有時點都落在軸的範圍內', () => {
    for (const s of TW_CHAIN) {
      expect(s.dueBy).toBeLessThanOrEqual(TL_SPAN_HOURS)
    }
  })
})

describe('roundBaseYmd（本輪的目標交易日）', () => {
  it('取各來源資料日的最大值', () => {
    expect(roundBaseYmd(['2026-08-04', '2026-08-05', '2026-08-03'])).toBe('2026-08-05')
  })

  /*
   * 2026-08-05 What actually happened: BFI82U used independent scheduling in the whole market and captured the data of the day at 16:00.
   * For individual stocks T86, you have to wait for the 16:30 round. When the base date is tied to individual stock reports, the column for the entire market is taken as "Yesterday 15:00"
   * When it is the origin, calculate 25 hours, clamp it to the right end of the axis and judge it as late - it is on time but the red light is on.
   */
  it('全市場已到手、個股還沒時，基準日跟著跑得快的那個走', () => {
    const base = roundBaseYmd(['2026-08-04', null, '2026-08-04', undefined, '2026-08-05'])
    expect(base).toBe('2026-08-05')
    // Available at 16:00 in all markets → 1 hour from 8/5 15:00, within dueBy 3
    const market = TW_CHAIN.find((s) => s.id === 'market')!
    const h = hoursFromBase('2026-08-05T08:00:04.000Z', base)
    expect(h).toBeCloseTo(1, 2)
    expect(judgeSource(market, h, 1.3)).toBe('ok')
    // If the old base date is tied, it will be 25 hours and judged as late - this is the bug that has been fixed.
    expect(hoursFromBase('2026-08-05T08:00:04.000Z', '2026-08-04')).toBeCloseTo(25, 2)
    expect(judgeSource(market, 25, 25.3)).toBe('late')
  })

  it('沒有任何有效日期時回空字串（畫面顯示「—」）', () => {
    expect(roundBaseYmd([])).toBe('')
    expect(roundBaseYmd([null, undefined, '', '20260805', '2026-8-5'])).toBe('')
  })

  it('週末沒有新資料，基準日自然停在最後交易日', () => {
    expect(roundBaseYmd(['2026-08-07', '2026-08-07', null])).toBe('2026-08-07')
  })
})

describe('cronHoursTaipei / nextRun（總經班次軸）', () => {
  it('UTC 13,15 換算成台北 21,23', () => {
    expect(cronHoursTaipei('0 13,15 * * *')).toEqual([21, 23])
  })

  it('跨日換算：UTC 3,9 → 台北 11,17', () => {
    expect(cronHoursTaipei('0 3,9 * * *')).toEqual([11, 17])
  })

  it('UTC 20 → 台北 4（跨日後要回到 0–23，不是 28）', () => {
    expect(cronHoursTaipei('0 20 * * *')).toEqual([4])
  })

  it('不是每日固定時刻的形狀回空陣列（例如盤後批次的 */15）', () => {
    expect(cronHoursTaipei('*/15 8-15 * * 1-5')).toEqual([])
  })

  it('macro-daily 密集掃描 */30 12-18 UTC → 台北 20:00–02:30 每半小時', () => {
    const hours = cronHoursTaipei('*/30 12-18 * * *')
    // Sorted 0–23: overnight tail (0…2.5) then evening (20…23.5)
    expect(hours).toContain(20)
    expect(hours).toContain(20.5)
    expect(hours).toContain(23.5)
    expect(hours).toContain(0)
    expect(hours).toContain(2.5)
    expect(hours).toHaveLength(14) // 7h × 2
  })

  it('下一班是今天的下一個時刻', () => {
    expect(nextRun([21, 23], 14.5)).toEqual({ hour: 21, tomorrow: false, inHours: 6.5 })
    expect(nextRun([21, 23], 21.5)).toEqual({ hour: 23, tomorrow: false, inHours: 1.5 })
  })

  it('今天班次都跑完了就指向明天第一班', () => {
    const r = nextRun([21, 23], 23.5)!
    expect(r.tomorrow).toBe(true)
    expect(r.hour).toBe(21)
    expect(r.inHours).toBeCloseTo(21.5, 5)
  })

  it('沒有班次時回 null，畫面顯示破折號', () => {
    expect(nextRun([], 10)).toBeNull()
  })
})

describe('taipeiParts', () => {
  it('UTC 換算成台北的日期與當日小時數', () => {
    // UTC 04:50 → Taipei 12:50
    expect(taipeiParts('2026-07-31T04:50:00.000Z')).toEqual({ ymd: '20260731', hour: 12 + 50 / 60 })
  })

  it('跨日：UTC 當天傍晚是台北的隔天凌晨', () => {
    // UTC 07-30 16:30 → Taipei 07-31 00:30
    expect(taipeiParts('2026-07-30T16:30:00.000Z')).toEqual({ ymd: '20260731', hour: 0.5 })
  })

  it('月份與日期補零成 YYYYMMDD，才比得上後端的 todayYmd', () => {
    expect(taipeiParts('2026-01-05T00:00:00.000Z')?.ymd).toBe('20260105')
  })

  it('壞掉的時間戳或空值回 null，不得回 NaN', () => {
    expect(taipeiParts(null)).toBeNull()
    expect(taipeiParts(undefined)).toBeNull()
    expect(taipeiParts('')).toBeNull()
    expect(taipeiParts('not-a-date')).toBeNull()
  })
})

describe('dayPercent / hourLabel / durationLabel', () => {
  it('24 小時軸的兩端與中點', () => {
    expect(dayPercent(0)).toBe(0)
    expect(dayPercent(12)).toBe(50)
    expect(dayPercent(24)).toBe(100)
  })

  it('超出一天的值夾在邊界', () => {
    expect(dayPercent(-3)).toBe(0)
    expect(dayPercent(30)).toBe(100)
  })

  it('小時數轉時刻，含半小時', () => {
    expect(hourLabel(20.5)).toBe('20:30')
    expect(hourLabel(21)).toBe('21:00')
    expect(hourLabel(0)).toBe('00:00')
  })

  it('時間長度用時分表示', () => {
    expect(durationLabel(6.667)).toBe('6h 40m')
    expect(durationLabel(0.5)).toBe('30m')
  })
})

describe('describeScope', () => {
  it('每個排程都說得出自己抓什麼', () => {
    expect(describeScope('generate-all')).toContain('三大法人')
    expect(describeScope('generate-all')).toContain('TOP20')
    expect(describeScope('sync-market')).toContain('FMTQIK')
    expect(describeScope('sync-market')).toContain('BFI82U')
    expect(describeScope('sync-market')).toContain('market/daily.json')
    expect(describeScope('sync-top-tickers')).toContain('MI_INDEX20')
    expect(describeScope('sync-macro')).toContain('FRED')
    expect(describeScope('sync-fx')).toContain('八個幣對')
    expect(describeScope('probe')).toContain('不寫報告')
  })

  it('不認得的 action 回空字串，畫面就不顯示那一行', () => {
    expect(describeScope('unknown')).toBe('')
    expect(describeScope(null)).toBe('')
  })
})
