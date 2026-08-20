import { describe, expect, it } from 'vitest'
import {
  PROBE_FOLLOW_UP,
  PROBE_SOURCE_ORDER,
  REQUIRED_LANDED_COUNTS,

  trailingRun,
  summariseLandedTicks,
  borrowHit,
  followUpsFor,
  formatProbeTickLabel,
  getActiveWindow,
  minutesFromHhmm,
  mopsIssueRocYmd,
  mopsProfitPeriod,
  mopsRevenuePeriod,
  pendingSources,
  retiredSources,
  sourceLanded,
  sourcesForTaipeiTime,
  ymdToRocYmd,
  type ProbeSourceId,
} from './sourceProbePlan'

describe('sourceProbePlan', () => {
  it('minutesFromHhmm', () => {
    expect(minutesFromHhmm('15:30')).toBe(15 * 60 + 30)
    expect(minutesFromHhmm('09:05')).toBe(9 * 60 + 5)
    expect(minutesFromHhmm('bad')).toBeNull()
  })

  it('下午開 BFI／T86 窗；估值窗 17:00–18:30，借券此時不探', () => {
    expect(sourcesForTaipeiTime('15:05', true)).toEqual(['bfi82u'])
    expect(sourcesForTaipeiTime('15:30', true)).toEqual(['bfi82u'])
    expect(sourcesForTaipeiTime('16:00', true)).toEqual(['bfi82u', 't86'])
    expect(sourcesForTaipeiTime('16:45', true)).toEqual(['t86'])
    expect(sourcesForTaipeiTime('12:00', true).sort()).toEqual(
      ['mops_profit', 'mops_revenue'].sort(),
    )
    expect(sourcesForTaipeiTime('17:00', true).sort()).toEqual(
      ['bwibbu', 't86', 'twt38u'].sort(),
    )
    expect(sourcesForTaipeiTime('17:15', true).sort()).toEqual(
      ['bwibbu', 'mops_profit', 'mops_revenue', 'twt38u'].sort(),
    )
    expect(sourcesForTaipeiTime('17:20', true).sort()).toEqual(
      ['bwibbu', 'mops_profit', 'mops_revenue', 'twt38u'].sort(),
    )
    expect(sourcesForTaipeiTime('18:00', true).sort()).toEqual(
      ['bwibbu', 'twt38u'].sort(),
    )
    expect(sourcesForTaipeiTime('18:30', true)).toEqual(['bwibbu'])
    expect(sourcesForTaipeiTime('18:35', true)).toEqual([])
  })

  // 0.7.19 起 twt38u 已有 label／window／follow-up／landed 判定，卻沒有被排程器吐出來，
  // 所以 PROD 從未跑過一次外資買賣超探針（index.ts 的 probeSource 當時也缺對應分支，
  // 那半邊是 Deno-only、vitest 測不到，只能靠型別檢查與 review 守）。
  // 這條測試只鎖住純函式這一半：「排程器真的會派 twt38u」。
  it('twt38u 在 17:00–18:00 窗內會被排程，窗外不會', () => {
    expect(sourcesForTaipeiTime('16:59', true)).not.toContain('twt38u')
    expect(sourcesForTaipeiTime('17:00', true)).toContain('twt38u')
    expect(sourcesForTaipeiTime('17:30', true)).toContain('twt38u')
    expect(sourcesForTaipeiTime('18:00', true)).toContain('twt38u')
    expect(sourcesForTaipeiTime('18:05', true)).not.toContain('twt38u')
    expect(sourcesForTaipeiTime('17:30', false)).toEqual([])
  })

  it('晚間 BFI 完整版第二時窗（19:30–20:15）', () => {
    expect(sourcesForTaipeiTime('19:25', true)).toEqual([])
    expect(sourcesForTaipeiTime('19:30', true)).toEqual(['bfi82u'])
    expect(sourcesForTaipeiTime('20:00', true)).toEqual(['bfi82u'])
    expect(sourcesForTaipeiTime('20:15', true)).toEqual(['bfi82u'])
    expect(sourcesForTaipeiTime('20:20', true)).toEqual([])
  })

  it('晚間融資借券窗（20:30 起融資、21:00 起借券與 MOPS）', () => {
    expect(sourcesForTaipeiTime('20:30', true)).toEqual(['margin'])
    expect(sourcesForTaipeiTime('21:00', true).sort()).toEqual(
      ['borrow', 'margin', 'mops_profit', 'mops_revenue'].sort(),
    )
    expect(sourcesForTaipeiTime('21:30', true).sort()).toEqual(
      ['borrow', 'margin'].sort(),
    )
  })

  // 0.7.13：借券窗從 15:00–22:45 收成 21:00–23:30。原本的 15:00 起是因為「沒人知道它幾點翻」，
  // 現在知道了——2026-08-11 兩個環境實測都是 22:45 前的 22:15。前緣砍掉六小時（一天少約 72 次
  // 打不到東西的 TWSE 請求），後緣反而延長 45 分鐘：舊窗 22:45 關、最後一班固定班表 21:45，
  // 翻日只要晚於 22:45 就整天沒有任何人會去撿。
  it('借券窗收斂到 21:00–23:30：前緣不再從下午開，後緣蓋過實測翻日時間', () => {
    expect(sourcesForTaipeiTime('20:55', true)).not.toContain('borrow')
    expect(sourcesForTaipeiTime('21:00', true)).toContain('borrow')
    // 實測翻日時刻，必須在窗內
    expect(sourcesForTaipeiTime('22:15', true)).toContain('borrow')
    // 22:30 之後融資窗關，借券要能獨自撐到 23:30
    expect(sourcesForTaipeiTime('23:00', true)).toEqual(['borrow'])
    expect(sourcesForTaipeiTime('23:30', true)).toEqual(['borrow'])
    expect(sourcesForTaipeiTime('23:35', true)).toEqual([])
  })

  it('窗外與週末不探日頻', () => {
    expect(sourcesForTaipeiTime('10:00', true)).toEqual([])
    expect(sourcesForTaipeiTime('15:30', false)).toEqual([])
  })

  // 0.7.7: 探針只在量「幾點上架」，答案拿到就不必再問。
  // 0.7.8: 「拿到答案」= 命中且抓取成功；呼叫端傳進來的是 done，不是 hit。
  it('命中過的源當天不再探，其餘照舊', () => {
    expect(pendingSources(['bfi82u', 't86', 'borrow'], ['bfi82u'])).toEqual(['t86', 'borrow'])
    // 全中 → 這一輪完全不打外部
    expect(pendingSources(['bfi82u', 'borrow'], ['bfi82u', 'borrow'])).toEqual([])
    // 一個都沒中 → 與改版前一模一樣
    expect(pendingSources(['bfi82u', 't86'], [])).toEqual(['bfi82u', 't86'])
    // 順序必須照原計畫，不能被 Set 的走訪順序帶著跑
    expect(pendingSources(['bfi82u', 't86', 'borrow'], ['t86'])).toEqual(['bfi82u', 'borrow'])
    // 窗外本來就沒東西可探
    expect(pendingSources([], ['bfi82u'])).toEqual([])
  })

  // 0.7.8: 命中不再只是記一筆，要真的把對應的抓取叫起來。
  it('命中之後觸發對應的抓取，一輪多個源會去重', () => {
    expect(followUpsFor(['bfi82u'])).toEqual(['sync-market'])
    // 三個都是個股籌碼報告的欄位 → 只跑一次 generate-chips
    expect(followUpsFor(['t86', 'margin', 'borrow'])).toEqual(['generate-chips'])
    expect(followUpsFor(['bwibbu'])).toEqual(['generate-market-data'])
    expect(followUpsFor(['mops_revenue', 'mops_profit'])).toEqual(['generate-history'])
    // 沒有命中就什麼都不跑
    expect(followUpsFor([])).toEqual([])
  })

  it('多個抓取同時要跑時，便宜的先跑（預算不足時長的才留給固定班表）', () => {
    expect(followUpsFor(['t86', 'bfi82u'])).toEqual(['sync-market', 'generate-chips'])
    expect(followUpsFor(['margin', 'bwibbu', 'mops_revenue'])).toEqual([
      'generate-market-data',
      'generate-history',
      'generate-chips',
    ])
  })

  // 命中但資料沒到位的源不算完成，下一輪要再探一次——否則當天就再也沒有第二次機會。
  it('資料沒到位的源不會被跳過', () => {
    const planned: ProbeSourceId[] = ['bfi82u', 't86']
    // bfi82u 命中且資料已到位 → done；t86 命中但資料沒進來 → 不在 done 裡
    expect(pendingSources(planned, ['bfi82u'])).toEqual(['t86'])
  })

  // 0.7.8: 「收工」的判準是資料真的到位，不是抓取函式有沒有回 200。
  describe('sourceLanded', () => {
    const today = '20260811'

    it('bfi82u 看的是當日場次已齊，不是 sync-market 有沒有跑', () => {
      expect(sourceLanded('bfi82u', today, { marketSessionReady: true })).toBe(true)
      expect(sourceLanded('bfi82u', today, { marketSessionReady: false })).toBe(false)
      // 沒有證據就是沒到位——不能因為「抓取沒出錯」就當成到了
      expect(sourceLanded('bfi82u', today, {})).toBe(false)
    })

    it('t86／margin 看報告裡該來源自報的日期，昨天的報告不算', () => {
      expect(sourceLanded('t86', today, { chipStamps: { institutional: '2026-08-11' } })).toBe(true)
      // generate-chips 在 T86 還沒上架時照樣產得出報告，但那是用昨天的資料做的
      expect(sourceLanded('t86', today, { chipStamps: { institutional: '2026-08-10' } })).toBe(
        false,
      )
      expect(sourceLanded('margin', today, { chipStamps: { margin: '20260811' } })).toBe(true)
      expect(sourceLanded('margin', today, { chipStamps: { margin: null } })).toBe(false)
    })

    it('borrow 沿用 borrowHit：日期要走過今天，等於今天不算', () => {
      expect(sourceLanded('borrow', today, { chipStamps: { borrow: '2026-08-12' } })).toBe(true)
      // 盤中借券自帶當日額度，日期＝今天代表還沒翻日
      expect(sourceLanded('borrow', today, { chipStamps: { borrow: '2026-08-11' } })).toBe(false)
    })

    // 0.7.11: 看的是**前端讀的那份檔案**，不是抓取函式回報了什麼。
    it('bwibbu 比對 fundamental 檔裡的 valuation.dataDate', () => {
      expect(sourceLanded('bwibbu', today, { fundamentalValuationDate: '2026-08-11' })).toBe(true)
      // 抓到了但檔案還是昨天的 → 畫面沒換，不算到位
      expect(sourceLanded('bwibbu', today, { fundamentalValuationDate: '2026-08-10' })).toBe(false)
      expect(sourceLanded('bwibbu', today, { fundamentalValuationDate: null })).toBe(false)
    })

    it('mops_* 問「上游剛發布的那一期在不在畫面上」，不是「有沒有變動」', () => {
      const published = { revenue: '2026-07', profit: '2026-Q2' }
      expect(
        sourceLanded('mops_revenue', today, {
          mopsPublished: published,
          fundamentalRevenueMonth: '2026-07',
        }),
      ).toBe(true)
      // 檔案還停在上一期 → 沒到位
      expect(
        sourceLanded('mops_revenue', today, {
          mopsPublished: published,
          fundamentalRevenueMonth: '2026-06',
        }),
      ).toBe(false)
      // backfill 早就補到更新的一期也算到位（實測：快照停在六月，畫面已有七月）
      expect(
        sourceLanded('mops_revenue', today, {
          mopsPublished: { revenue: '2026-06' },
          fundamentalRevenueMonth: '2026-07',
        }),
      ).toBe(true)
      expect(
        sourceLanded('mops_profit', today, {
          mopsPublished: published,
          fundamentalProfitQuarter: '2026-Q2',
        }),
      ).toBe(true)
      expect(
        sourceLanded('mops_profit', today, {
          mopsPublished: published,
          fundamentalProfitQuarter: '2026-Q1',
        }),
      ).toBe(false)
      // 缺任一邊都不收工——沒有證據就不算到位
      expect(sourceLanded('mops_profit', today, { mopsPublished: published })).toBe(false)
      expect(sourceLanded('mops_profit', today, { fundamentalProfitQuarter: '2026-Q2' })).toBe(false)
    })

    it('mops 期別解析：整份表共用同一期，取第一列', () => {
      expect(mopsRevenuePeriod([{ 資料年月: '11506' }, { 資料年月: '11506' }])).toBe('2026-06')
      expect(mopsRevenuePeriod([{ 資料年月: 'bad' }])).toBeNull()
      expect(mopsRevenuePeriod([])).toBeNull()
      expect(mopsProfitPeriod([{ 年度: 115, 季別: 2 }])).toBe('2026-Q2')
      expect(mopsProfitPeriod([{ 年度: '115', 季別: '5' }])).toBeNull()
    })

    it('TWT38U 以 foreign_top50 快照的日期為到位證據', () => {
      expect(sourceLanded('twt38u', today, { foreignTopDate: today })).toBe(true)
      // 帶破折號的寫法也要認得，和 chipStamps 同型
      expect(sourceLanded('twt38u', today, { foreignTopDate: '2026-08-11' })).toBe(true)
    })

    it('TWT38U 快照停在昨天就不算到位——這正是探針還要再探的情況', () => {
      expect(sourceLanded('twt38u', today, { foreignTopDate: '20260810' })).toBe(false)
      expect(sourceLanded('twt38u', today, { foreignTopDate: null })).toBe(false)
      expect(sourceLanded('twt38u', today, {})).toBe(false)
    })

    it('每個來源在沒有任何證據時一律不算到位', () => {
      for (const id of PROBE_SOURCE_ORDER) {
        expect(sourceLanded(id, today, {})).toBe(false)
      }
    })
  })

  it('每個探針來源都有對應的抓取——漏一個就會變成「量到了但沒人去拿」', () => {
    for (const id of PROBE_SOURCE_ORDER) {
      expect(PROBE_FOLLOW_UP[id]).toBeTruthy()
    }
  })

  it('formatProbeTickLabel', () => {
    expect(formatProbeTickLabel('15:00', false)).toBe('1500 沒中')
    expect(formatProbeTickLabel('15:05', true)).toBe('1505 中')
  })

  it('ymdToRocYmd', () => {
    expect(ymdToRocYmd('20260811')).toBe('1150811')
  })

  // 0.7.3 首版把這兩者的命中寫成「端點有沒有資料」，而兩個端點盤中就恆有資料——
  // 整個實驗窗會全綠，量不到任何落地時間。以下三個案例就是那個錯誤的回歸測試。
  it('借券：title 還停在今天不算命中，翻到下一個交易日才算', () => {
    expect(borrowHit('2026-08-11', '20260811')).toBe(false) // 盤中的當日額度
    expect(borrowHit('2026-08-12', '20260811')).toBe(true)
    expect(borrowHit('2026-08-14', '20260811')).toBe(true) // 週五收盤 → 下週一
    expect(borrowHit('2026-08-10', '20260811')).toBe(false) // 反而落後，不是命中
    expect(borrowHit(null, '20260811')).toBe(false)
  })

  it('mopsIssueRocYmd 取整份共用的出表日期', () => {
    expect(mopsIssueRocYmd([{ 出表日期: '1150811', 公司代號: '1213' }])).toBe('1150811')
    expect(mopsIssueRocYmd([{ 出表日期: ' 1150717 ' }])).toBe('1150717')
    expect(mopsIssueRocYmd([{ 公司代號: '1101' }])).toBeNull()
    expect(mopsIssueRocYmd([])).toBeNull()
    expect(mopsIssueRocYmd(null)).toBeNull()
  })
})

/*
  0.7.12 standards audit —— the point of aligning them is that the alignment itself is checkable.

  Every source must obey the same two rules, so that no future source can quietly reintroduce the
  0.7.8 mistake (「抓取沒出錯 = 收工」) or the BUG-024 mistake (「問一個落後的鏡像」).
*/
describe('判準對齊（八個來源共用同一條標準）', () => {
  it('每個來源都有抓取、都有收工判準，且沒有證據時一律不收工', () => {
    for (const id of PROBE_SOURCE_ORDER) {
      expect(PROBE_FOLLOW_UP[id]).toBeTruthy()
      // 空證據 = 沒有任何理由相信資料在畫面上 → 不得收工
      expect(sourceLanded(id, '20260811', {})).toBe(false)
    }
  })

  /*
    退休判準（0.9.6）：**尾端連續相同指紋的長度** ≥ 該來源所需次數。

    舊判準是「總到位次數 ≥ N 且最近兩次指紋相同」，它有兩個洞：
    1. `A → B → B` 就退休——B 只穩了一輪，而 `A → B` 剛剛才證明上游還在改。
    2. 只讀最後兩筆，前面每一次改版的證據都被丟掉。
    改成尾端連續之後，任何一次內容變動都會把計數歸零，重新累積。

    N 維持 3（每日來源）／1（MOPS）。提高 N 沒有意義：DEV `batch_run_log` 實測
    2026-08-12～08-19，T86 一天最多改版一次，且發生在 17:00–20:45 之間，
    落在 t86 探針視窗（16:00–17:00）之外——多探 5 分鐘攔不到它。
  */
  it('retiredSources 依各來源所需的「尾端連續次數」判定收工', () => {
    expect(retiredSources({ bfi82u: 2, t86: 3, mops_revenue: 1 })).toEqual(
      new Set(['t86', 'mops_revenue']),
    )
    expect(retiredSources({ bfi82u: 3, margin: 3, borrow: 2 })).toEqual(
      new Set(['bfi82u', 'margin']),
    )
    expect(retiredSources({})).toEqual(new Set())
  })

  it('MOPS 只需尾端連續 1 次——判準是期別，指紋不參與', () => {
    expect(retiredSources({ mops_revenue: 1, mops_profit: 1 })).toEqual(
      new Set(['mops_revenue', 'mops_profit']),
    )
  })

  it('REQUIRED_LANDED_COUNTS 每個來源都要表態，不得漏列', () => {
    for (const id of PROBE_SOURCE_ORDER) {
      expect(typeof REQUIRED_LANDED_COUNTS[id]).toBe('number')
      expect(REQUIRED_LANDED_COUNTS[id]).toBeGreaterThan(0)
    }
    for (const id of ['bfi82u', 't86', 'bwibbu', 'twt38u', 'margin', 'borrow'] as const) {
      expect(REQUIRED_LANDED_COUNTS[id]).toBe(3)
    }
  })

  /*
    退休判定的接線本身也要測（reviewer RISK）。純函式測得再好，若「哪些 tick 算數、指紋怎麼排序」
    這段留在 index.ts 的 DB 讀取裡，恆為 false（整窗打滿）與恆為 true（提早關門）兩種失效
    都不會被任何測試接住。把它抽成純函式就有守門員。
  */
  describe('summariseLandedTicks——把到位紀錄整理成尾端連續次數', () => {
    const tick = (source: string, taipei_time: string, fingerprint: string | null) => ({
      source,
      taipei_time,
      fingerprint,
    })

    it('依來源分組，計的是尾端連續相同指紋的長度', () => {
      const r = summariseLandedTicks(
        [tick('t86', '16:10', 'A'), tick('t86', '16:15', 'A'), tick('margin', '20:50', 'M')],
        16 * 60 + 15,
      )
      expect(r.counts).toEqual({ t86: 2, margin: 1 })
    })

    it('內容一變就歸零：A → B → B 只算 2，不得收工', () => {
      const ticks = [tick('t86', '16:10', 'A'), tick('t86', '16:15', 'B'), tick('t86', '16:20', 'B')]
      const r = summariseLandedTicks(ticks, 16 * 60 + 20)
      expect(r.counts.t86).toBe(2)
      expect(retiredSources(r.counts)).toEqual(new Set())
    })

    it('歸零後重新累積：B → B → B 才收工', () => {
      const ticks = [
        tick('t86', '16:05', 'A'),
        tick('t86', '16:10', 'B'),
        tick('t86', '16:15', 'B'),
        tick('t86', '16:20', 'B'),
      ]
      const r = summariseLandedTicks(ticks, 16 * 60 + 20)
      expect(r.counts.t86).toBe(3)
      expect(retiredSources(r.counts)).toEqual(new Set(['t86']))
    })

    it('未命中不參與：中間沒有到位紀錄不會打斷連續', () => {
      // 未命中的輪次根本不會出現在輸入裡（呼叫端只讀 hit + data_landed 的列）
      const ticks = [tick('t86', '16:05', 'A'), tick('t86', '16:20', 'A'), tick('t86', '16:40', 'A')]
      expect(summariseLandedTicks(ticks, 16 * 60 + 40).counts.t86).toBe(3)
    })

    it('指紋以時間升冪決定尾端，不依賴輸入順序', () => {
      const shuffled = [tick('t86', '16:20', 'B'), tick('t86', '16:10', 'A'), tick('t86', '16:15', 'A')]
      expect(summariseLandedTicks(shuffled, 16 * 60 + 20).counts.t86).toBe(1)
      const settledInput = [tick('t86', '16:20', 'A'), tick('t86', '16:10', 'B'), tick('t86', '16:15', 'A')]
      expect(summariseLandedTicks(settledInput, 16 * 60 + 20).counts.t86).toBe(2)
    })

    it('null 指紋無法證明穩定：尾端只算它自己一筆', () => {
      const ticks = [tick('t86', '16:10', null), tick('t86', '16:15', null)]
      expect(summariseLandedTicks(ticks, 16 * 60 + 15).counts.t86).toBe(1)
      // MOPS 只需 1 次，所以 null 指紋不會擋住它——維持舊行為
      const mops = summariseLandedTicks([tick('mops_revenue', '12:00', null)], 12 * 60)
      expect(retiredSources(mops.counts)).toEqual(new Set(['mops_revenue']))
    })

    it('視窗外的 tick 既不計次也不供指紋——bfi82u 雙時段是實例', () => {
      const ticks = [
        tick('bfi82u', '15:05', 'X'),
        tick('bfi82u', '15:10', 'X'),
        tick('bfi82u', '15:15', 'X'),
        tick('bfi82u', '19:30', 'Y'),
        tick('bfi82u', '19:35', 'Y'),
      ]
      // 站在 19:35（第二時段）：只有 19:30/19:35 算數，X 不得延續 Y 的連續數
      expect(summariseLandedTicks(ticks, 19 * 60 + 35).counts.bfi82u).toBe(2)
      // 站在 15:15（第一時段）：只有三筆 15:xx 算數
      expect(summariseLandedTicks(ticks, 15 * 60 + 15).counts.bfi82u).toBe(3)
    })

    it('沒有時槽時不做視窗過濾，全部算數', () => {
      const ticks = [tick('bfi82u', '15:05', 'X'), tick('bfi82u', '19:30', 'Y')]
      expect(summariseLandedTicks(ticks, null).counts.bfi82u).toBe(1)
    })

    it('不在 DAILY_WINDOWS 的來源（MOPS）不受視窗過濾', () => {
      const r = summariseLandedTicks([tick('mops_revenue', '12:00', 'R')], 21 * 60)
      expect(r.counts.mops_revenue).toBe(1)
    })

    it('空輸入回空結果，不丟例外', () => {
      expect(summariseLandedTicks([], 16 * 60)).toEqual({ counts: {} })
    })

    it('接得住壞資料：時間為 null 的 tick 不得讓整批壞掉', () => {
      const r = summariseLandedTicks(
        [{ source: 't86', taipei_time: null, fingerprint: 'A' }, tick('t86', '16:15', 'A')],
        16 * 60 + 15,
      )
      expect(typeof r.counts.t86).toBe('number')
    })
  })

  describe('trailingRun——尾端連續相同指紋的長度', () => {
    it('連續相同就累加', () => {
      expect(trailingRun(['a', 'a', 'a'])).toBe(3)
      expect(trailingRun(['x', 'a', 'a'])).toBe(2)
    })

    it('一變就歸零，只算尾端那一段', () => {
      expect(trailingRun(['a', 'a', 'b'])).toBe(1)
      expect(trailingRun(['a', 'b'])).toBe(1)
    })

    it('空輸入為 0；單筆為 1', () => {
      expect(trailingRun([])).toBe(0)
      expect(trailingRun(['a'])).toBe(1)
    })

    it('null / 空字串無法證明相同——尾端停在它自己', () => {
      expect(trailingRun([null, null])).toBe(1)
      expect(trailingRun(['a', null])).toBe(1)
      expect(trailingRun(['', ''])).toBe(1)
      expect(trailingRun(['a', undefined])).toBe(1)
      expect(trailingRun([null, 'a', 'a'])).toBe(2)
    })
  })


  it('getActiveWindow 依當前分鐘回傳對應的活躍視窗', () => {
    // bfi82u 雙時段
    expect(getActiveWindow('bfi82u', 15 * 60 + 10)).toEqual({ from: 15 * 60, to: 16 * 60 + 30 })
    expect(getActiveWindow('bfi82u', 17 * 60)).toBeNull()
    expect(getActiveWindow('bfi82u', 19 * 60 + 40)).toEqual({ from: 19 * 60 + 30, to: 20 * 60 + 15 })

    // bwibbu 單時段
    expect(getActiveWindow('bwibbu', 17 * 60 + 15)).toEqual({ from: 17 * 60, to: 18 * 60 + 30 })
    expect(getActiveWindow('bwibbu', 15 * 60 + 30)).toBeNull()

    // twt38u 單時段 17:00–18:00，與 bwibbu 同時起跑但提早一個半小時收工
    expect(getActiveWindow('twt38u', 17 * 60)).toEqual({ from: 17 * 60, to: 18 * 60 })
    expect(getActiveWindow('twt38u', 17 * 60 + 30)).toEqual({ from: 17 * 60, to: 18 * 60 })
    expect(getActiveWindow('twt38u', 18 * 60)).toEqual({ from: 17 * 60, to: 18 * 60 })
    expect(getActiveWindow('twt38u', 16 * 60 + 59)).toBeNull()
    expect(getActiveWindow('twt38u', 18 * 60 + 1)).toBeNull()
  })

  it('TWT38U 不另開抓取動作，沿用 generate-chips——實際抓 TWT38U 的就是那個階段', () => {
    expect(PROBE_FOLLOW_UP.twt38u).toBe('generate-chips')
    expect(followUpsFor(['twt38u'])).toEqual(['generate-chips'])
    // t86 與 twt38u 同輪轉綠時只跑一次 chips，不重複
    expect(followUpsFor(['t86', 'twt38u'])).toEqual(['generate-chips'])
  })

  it('TWT38U 與其他每日來源一樣，需 3 次穩定到位才退休', () => {
    expect(REQUIRED_LANDED_COUNTS.twt38u).toBe(3)
    expect(PROBE_SOURCE_ORDER).toContain('twt38u')
  })

  it('BFI82U 在 marketSessionReady 為 true 時即標記為 landed（取消 15:40 限制）', () => {
    expect(sourceLanded('bfi82u', '20260811', { marketSessionReady: true })).toBe(true)
    expect(sourceLanded('bfi82u', '20260811', { marketSessionReady: false })).toBe(false)
  })

  it('收工判準只吃「成品的證據」，不吃抓取自己的回報', () => {
    // 這組證據刻意混入抓取端會回報的欄位名，它們不該有任何影響
    const noise = { ok: true, synced: 99, generated: 99, reason: 'updated' } as never
    for (const id of PROBE_SOURCE_ORDER) {
      expect(sourceLanded(id, '20260811', noise)).toBe(false)
    }
  })
})
