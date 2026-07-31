import { describe, it, expect } from 'vitest'
import {
  TL_SPAN_HOURS,
  TW_CHAIN,
  describeCron,
  hoursFromBase,
  humanAgo,
  judgeCron,
  judgePeriod,
  judgeSource,
  latestPeriod,
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
    // 台北 07-31 09:10 = 資料日 15:00 起算的第 18.167 小時
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
    // 公布窗 15:00–15:30 早就過了，但 dueBy 是批次班次（16:30）
    expect(judgeSource(inst, 1.25, 2)).toBe('ok')
  })

  it('借券拖到隔天早上算延遲', () => {
    expect(judgeSource(borrow, 18.167, 19)).toBe('late')
  })

  it('還沒到寬限截止就沒拿到 → 等待中，不是延遲', () => {
    // 每天傍晚都有一段時間資料本來就還沒公布，那時亮紅燈只會讓人學會忽略它
    expect(judgeSource(borrow, null, 3)).toBe('idle')
  })

  it('過了寬限截止仍沒拿到 → 延遲', () => {
    expect(judgeSource(borrow, null, 12)).toBe('late')
  })

  it('拿到了但不完整一律是 warn，不論早晚', () => {
    expect(judgeSource(inst, 1.25, 2, true)).toBe('warn')
    expect(judgeSource(borrow, 18.167, 19, true)).toBe('warn')
  })
})

describe('judgePeriod / latestPeriod', () => {
  it('與同組最新期別相同 → 最新', () => {
    expect(judgePeriod('2026-06', '2026-06')).toBe('ok')
  })

  it('落後同組其他來源 → warn（消費者信心停在 2026-05 的情形）', () => {
    expect(judgePeriod('2026-05', '2026-06')).toBe('warn')
  })

  it('沒有期別 → idle，不是錯誤', () => {
    expect(judgePeriod(null, '2026-06')).toBe('idle')
  })

  it('同組全都沒有資料時不判為落後', () => {
    expect(judgePeriod('2026-05', null)).toBe('ok')
  })

  it('latestPeriod 忽略 null 與空字串', () => {
    expect(latestPeriod(['2026-05', null, '2026-06', undefined, ''])).toBe('2026-06')
    expect(latestPeriod([null, undefined])).toBeNull()
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
    // */15 8-15 * * 1-5 → 台北 16:00–23:45
    expect(describeCron('*/15 8-15 * * 1-5')).toBe('週一至週五 16:00–23:45 每 15 分')
  })

  it('每日兩班：13/15 UTC → 台北 21:00 / 23:00', () => {
    expect(describeCron('0 13,15 * * *')).toBe('每日 21:00 / 23:00')
  })

  it('匯率的 3/9 UTC → 台北 11:00 / 17:00', () => {
    expect(describeCron('0 3,9 * * *')).toBe('每日 11:00 / 17:00')
  })

  it('認不得的表達式原樣回傳——顯示 cron 字串好過顯示翻錯的句子', () => {
    expect(describeCron('5 4 * * 0')).toBe('5 4 * * 0')
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
      if (!s.window) continue
      expect(s.window[0]).toBeLessThanOrEqual(s.window[1])
      expect(s.dueBy).toBeGreaterThanOrEqual(s.window[1])
    }
  })

  it('個股新聞沒有公布窗——它隨時可能有，批次每輪都會試著抓', () => {
    // 硬給一個窗只會畫出一條永遠抓不到東西的色塊，看起來像壞掉
    expect(TW_CHAIN.find((s) => s.id === 'news')!.window).toBeNull()
  })

  it('所有時點都落在軸的範圍內', () => {
    for (const s of TW_CHAIN) {
      expect(s.dueBy).toBeLessThanOrEqual(TL_SPAN_HOURS)
    }
  })
})
