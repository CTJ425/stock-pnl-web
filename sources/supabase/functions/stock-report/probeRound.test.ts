import { describe, expect, it, vi } from 'vitest'
import { runProbeRound, type ProbeRoundDeps, type ProbeTick } from './probeRound'
import type { LandingEvidence, ProbeFollowUp, ProbeSourceId } from './sourceProbePlan'

const TODAY = '20260811'

function tick(source: ProbeSourceId, hit: boolean, note = 'n'): ProbeTick {
  return { source, hit, ok: true, data_ymd: null, fingerprint: null, rows: null, note, duration_ms: 1 }
}

/**
 * A round with everything stubbed. Each test overrides only what it is about —— the point of this
 * harness is that a probe hit can be *made* to happen, which is the one thing waiting for TWSE
 * cannot give us on demand.
 */
function harness(over: Partial<ProbeRoundDeps> & { hits?: ProbeSourceId[]; evidence?: LandingEvidence } = {}) {
  const { hits = [], evidence = {}, ...rest } = over
  const persisted: ProbeTick[] = []
  const marked: Array<{ source: ProbeSourceId; landed: boolean; note: string }> = []
  const ran: ProbeFollowUp[] = []
  const order: string[] = []

  const deps: ProbeRoundDeps = {
    deadline: Number.MAX_SAFE_INTEGER,
    now: () => 0,
    summarise: (a) => `did ${a}`,
    readDoneSources: async () => new Set<ProbeSourceId>(),
    probe: async (id) => {
      order.push(`probe:${id}`)
      return tick(id, hits.includes(id))
    },
    persistTick: async (t) => {
      order.push(`persist:${t.source}`)
      persisted.push(t)
    },
    runFollowUp: async (a) => {
      order.push(`run:${a}`)
      ran.push(a)
      return {}
    },
    readEvidence: async () => {
      order.push('evidence')
      return evidence
    },
    markTick: async (source, landed, note) => {
      order.push(`mark:${source}`)
      marked.push({ source, landed, note })
    },
    ...rest,
  }
  return { deps, persisted, marked, ran, order }
}

describe('runProbeRound', () => {
  it('沒命中就不觸發任何抓取，也不寫回任何結論', async () => {
    const h = harness({ hits: [] })
    const r = await runProbeRound(['bwibbu', 'borrow'], TODAY, h.deps)

    expect(h.ran).toEqual([])
    expect(h.marked).toEqual([])
    expect(r.landed).toEqual([])
    expect(h.persisted.map((t) => t.source)).toEqual(['bwibbu', 'borrow'])
  })

  it('命中就叫起對應的抓取，資料到位才算收工', async () => {
    const h = harness({ hits: ['bfi82u'], evidence: { marketSessionReady: true } })
    const r = await runProbeRound(['bfi82u'], TODAY, h.deps)

    expect(h.ran).toEqual(['sync-market'])
    expect(r.landed).toEqual(['bfi82u'])
    expect(h.marked[0].landed).toBe(true)
    expect(h.marked[0].note).toContain('已觸發 sync-market')
    expect(h.marked[0].note).toContain('資料已到位')
  })

  /*
    The whole reason 0.7.9 exists: a follow-up that returns cleanly but brings nothing must NOT retire
    the source. Without this the day's last retry is closed on a false answer.
  */
  it('抓取成功但資料沒進來 → 不算收工，備註寫明下輪重試', async () => {
    const h = harness({ hits: ['bfi82u'], evidence: { marketSessionReady: false } })
    const r = await runProbeRound(['bfi82u'], TODAY, h.deps)

    expect(h.ran).toEqual(['sync-market']) // 有跑
    expect(r.landed).toEqual([]) // 但不算完成
    expect(h.marked[0].landed).toBe(false)
    expect(h.marked[0].note).toContain('資料未到位，下輪重試')
  })

  it('抓取拋錯 → 不算收工，錯誤訊息留在備註裡', async () => {
    const h = harness({
      hits: ['bfi82u'],
      evidence: { marketSessionReady: true },
      runFollowUp: async () => {
        throw new Error('upstream 503')
      },
    })
    const r = await runProbeRound(['bfi82u'], TODAY, h.deps)

    expect(r.landed).toEqual([])
    expect(h.marked[0].landed).toBe(false)
    expect(h.marked[0].note).toContain('觸發失敗')
    expect(h.marked[0].note).toContain('upstream 503')
  })

  it('同一輪三個籌碼來源命中，generate-chips 只跑一次，但三筆各自判定', async () => {
    const h = harness({
      hits: ['t86', 'margin', 'borrow'],
      // T86 到了、融資券還沒公布、借券還沒翻日
      evidence: { chipStamps: { institutional: '2026-08-11', margin: null, borrow: '2026-08-11' } },
    })
    const r = await runProbeRound(['t86', 'margin', 'borrow'], TODAY, h.deps)

    expect(h.ran).toEqual(['generate-chips'])
    expect(r.landed).toEqual(['t86'])
    expect(h.marked.find((m) => m.source === 'margin')?.landed).toBe(false)
    expect(h.marked.find((m) => m.source === 'borrow')?.landed).toBe(false)
  })

  it('預算用完就不啟動抓取，留給固定班表，且該來源不算收工', async () => {
    const h = harness({
      hits: ['bfi82u'],
      evidence: { marketSessionReady: true },
      deadline: 100,
      now: () => 999,
    })
    const r = await runProbeRound(['bfi82u'], TODAY, h.deps)

    expect(h.ran).toEqual([])
    expect(r.landed).toEqual([])
    expect(h.marked[0].note).toContain('預算不足')
  })

  /*
    Ordering is a correctness property, not a style choice: if the tick were written after the fetch,
    a crash mid-fetch would lose the measurement —— the one thing this experiment must never fake.
  */
  it('tick 一律先落地，才輪到抓取', async () => {
    const h = harness({ hits: ['bfi82u'], evidence: { marketSessionReady: true } })
    await runProbeRound(['bfi82u'], TODAY, h.deps)

    expect(h.order.indexOf('persist:bfi82u')).toBeLessThan(h.order.indexOf('run:sync-market'))
    expect(h.order.indexOf('run:sync-market')).toBeLessThan(h.order.indexOf('evidence'))
    expect(h.order.indexOf('evidence')).toBeLessThan(h.order.indexOf('mark:bfi82u'))
  })

  // 0.7.12: MOPS 的判準也是絕對值——上游剛發布的那一期，出現在畫面讀的檔案裡。
  it('mops 命中：剛發布的那一期已在畫面上 → 收工', async () => {
    const h = harness({
      hits: ['mops_revenue'],
      evidence: { mopsPublished: { revenue: '2026-07' }, fundamentalRevenueMonth: '2026-07' },
    })
    const r = await runProbeRound(['mops_revenue'], TODAY, h.deps)

    expect(h.ran).toEqual(['generate-history'])
    expect(r.landed).toEqual(['mops_revenue'])
  })

  it('mops 命中：抓完了但畫面還停在上一期 → 下輪重試', async () => {
    const h = harness({
      hits: ['mops_revenue'],
      evidence: { mopsPublished: { revenue: '2026-07' }, fundamentalRevenueMonth: '2026-06' },
    })
    const r = await runProbeRound(['mops_revenue'], TODAY, h.deps)

    expect(r.landed).toEqual([])
    expect(h.marked[0].note).toContain('資料未到位，下輪重試')
  })

  it('估值抓到了但畫面那份檔案沒換 → 不算收工', async () => {
    const h = harness({
      hits: ['bwibbu'],
      // generate-market-data 跑完了、也沒拋錯，但 fundamental 檔的估值日還是昨天
      evidence: { fundamentalValuationDate: '2026-08-10' },
    })
    const r = await runProbeRound(['bwibbu'], TODAY, h.deps)

    expect(h.ran).toEqual(['generate-market-data'])
    expect(r.landed).toEqual([])
    expect(h.marked[0].note).toContain('資料未到位，下輪重試')
  })

  it('估值落到畫面那份檔案上 → 收工', async () => {
    const h = harness({ hits: ['bwibbu'], evidence: { fundamentalValuationDate: '2026-08-11' } })
    const r = await runProbeRound(['bwibbu'], TODAY, h.deps)

    expect(r.landed).toEqual(['bwibbu'])
    expect(h.marked[0].note).toContain('資料已到位')
  })

  it('已收工的來源這一輪完全不探，也不會被列入 sources', async () => {
    const h = harness({ readDoneSources: async () => new Set<ProbeSourceId>(['bwibbu']) })
    const r = await runProbeRound(['bwibbu', 'borrow'], TODAY, h.deps)

    expect(r.sources).toEqual(['borrow'])
    expect(r.skipped).toEqual(['bwibbu'])
    expect(h.order).not.toContain('probe:bwibbu')
  })

  it('窗外（planned 為空）連 done 都不查——省一趟 DB', async () => {
    const readDoneSources = vi.fn(async () => new Set<ProbeSourceId>())
    const h = harness({ readDoneSources })
    const r = await runProbeRound([], TODAY, h.deps)

    expect(readDoneSources).not.toHaveBeenCalled()
    expect(r.sources).toEqual([])
    expect(h.order).toEqual([])
  })

  /*
    RISK-001: the probe loop had no budget check at all — only the follow-up loop did. Three daily
    windows now overlap at 17:00 and four sources are scheduled together at 17:15/17:20, each fetch
    carrying a 10s timeout, so a slow round could be killed by the Edge Function's 60s limit *inside*
    the loop. Being killed mid-loop loses the later sources silently; deferring them on purpose does
    not, and the fixed shift still covers them.
  */
  it('探測預算用完就不再開新的來源，剩下的列為 deferred', async () => {
    const h = harness({ probeDeadline: 100, now: () => 999 })
    const r = await runProbeRound(['bwibbu', 'borrow', 'twt38u'], TODAY, h.deps)

    expect(h.order).toEqual([])
    expect(r.deferred).toEqual(['bwibbu', 'borrow', 'twt38u'])
    expect(r.ticks).toEqual([])
    expect(h.persisted).toEqual([])
    expect(h.ran).toEqual([])
  })

  it('預算是在每個來源開始前檢查，已經開始的那一支不會被打斷', async () => {
    let clock = 0
    const h = harness({
      probeDeadline: 50,
      now: () => clock,
      // The first probe overruns the budget; the second must never start.
      probe: async (id) => {
        clock += 80
        return { source: id, hit: false, ok: true, data_ymd: null, fingerprint: null, rows: null, note: 'n', duration_ms: 1 }
      },
    })
    const r = await runProbeRound(['bwibbu', 'borrow'], TODAY, h.deps)

    expect(r.ticks.map((t) => t.source)).toEqual(['bwibbu'])
    expect(r.deferred).toEqual(['borrow'])
    expect(h.persisted.map((t) => t.source)).toEqual(['bwibbu'])
  })

  it('deferred 不是 skipped —— 今天已收工和預算不足是兩件事', async () => {
    const h = harness({
      probeDeadline: 50,
      now: () => 999,
      readDoneSources: async () => new Set<ProbeSourceId>(['bwibbu']),
    })
    const r = await runProbeRound(['bwibbu', 'borrow'], TODAY, h.deps)

    expect(r.skipped).toEqual(['bwibbu'])
    expect(r.deferred).toEqual(['borrow'])
  })

  it('沒給探測預算時行為完全不變（既有呼叫端不受影響）', async () => {
    const h = harness({ hits: ['bfi82u'], evidence: { marketSessionReady: true } })
    const r = await runProbeRound(['bfi82u'], TODAY, h.deps)

    expect(r.deferred).toEqual([])
    expect(r.ticks.map((t) => t.source)).toEqual(['bfi82u'])
    expect(h.ran).toEqual(['sync-market'])
  })

  it('先探到的命中照樣觸發抓取，不因為後面的來源被延後而取消', async () => {
    let clock = 0
    const h = harness({
      hits: ['bfi82u'],
      evidence: { marketSessionReady: true },
      probeDeadline: 50,
      now: () => clock,
      probe: async (id) => {
        clock += 80
        return { source: id, hit: id === 'bfi82u', ok: true, data_ymd: null, fingerprint: null, rows: null, note: 'n', duration_ms: 1 }
      },
    })
    const r = await runProbeRound(['bfi82u', 'borrow'], TODAY, h.deps)

    expect(r.deferred).toEqual(['borrow'])
    expect(h.ran).toEqual(['sync-market'])
    expect(r.landed).toEqual(['bfi82u'])
  })

})
