import { describe, expect, it } from 'vitest'
import {
  PROBE_FOLLOW_UP,
  PROBE_SOURCE_ORDER,
  borrowHit,
  followUpsFor,
  formatProbeTickLabel,
  minutesFromHhmm,
  mopsIssueRocYmd,
  pendingSources,
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

  it('下午開 BFI／T86 窗，借券窗從 15:00 起（要看得到 title 翻日的那一刻）', () => {
    expect(sourcesForTaipeiTime('15:05', true)).toEqual(['bfi82u', 'borrow'])
    expect(sourcesForTaipeiTime('15:30', true)).toEqual(['bfi82u', 't86', 'borrow'])
    expect(sourcesForTaipeiTime('16:45', true)).toEqual(['t86', 'borrow'])
    expect(sourcesForTaipeiTime('12:00', true).sort()).toEqual(
      ['mops_profit', 'mops_revenue'].sort(),
    )
  })

  it('晚間融資借券窗（21:00 仍在估值窗內）', () => {
    expect(sourcesForTaipeiTime('21:00', true).sort()).toEqual(
      ['borrow', 'bwibbu', 'margin', 'mops_profit', 'mops_revenue'].sort(),
    )
    expect(sourcesForTaipeiTime('21:30', true).sort()).toEqual(
      ['borrow', 'bwibbu', 'margin'].sort(),
    )
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

    it('bwibbu 比對估值檔自報的民國日期', () => {
      expect(sourceLanded('bwibbu', today, { bwibbuRocYmd: '1150811' })).toBe(true)
      expect(sourceLanded('bwibbu', today, { bwibbuRocYmd: '1150810' })).toBe(false)
      expect(sourceLanded('bwibbu', today, { bwibbuRocYmd: null })).toBe(false)
    })

    it('mops_* 看這輪有沒有真的補進資料', () => {
      expect(sourceLanded('mops_revenue', today, { mopsFilled: { revenue: 3 } })).toBe(true)
      expect(sourceLanded('mops_revenue', today, { mopsFilled: { revenue: 0 } })).toBe(false)
      expect(sourceLanded('mops_profit', today, { mopsFilled: { profit: 1 } })).toBe(true)
      expect(sourceLanded('mops_profit', today, { mopsFilled: { revenue: 5 } })).toBe(false)
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
