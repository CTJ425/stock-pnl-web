/**
 * 探針一輪的編排（0.7.9）。
 *
 * **為什麼要獨立成一個檔**：`index.ts` 是 145KB 的 Deno 模組，模組層就建好了 `db` client、
 * 底部直接 `Deno.serve`，vitest 匯入不了——所以整支 `index.ts` 目前一行測試都沒有。
 * 而 0.7.8／0.7.9 真正容易錯的地方恰好不在那些純函式（那些都測了），是**它們之間的接線**：
 * 命中之後有沒有真的去叫抓取、抓完有沒有拿正確的來源去驗證、`data_landed` 有沒有寫回**那一列**。
 * 這些只要把 I/O 變成注入的相依，就能在 `npm test` 裡跑，不必等 TWSE 上架。
 *
 * 這裡刻意**不做**任何時間或日期判斷（那是 `sourcesForTaipeiTime` 的事），也不碰 HTTP 回應格式。
 */
import {
  PROBE_FOLLOW_UP,
  followUpsFor,
  pendingSources,
  sourceLanded,
  type LandingEvidence,
  type ProbeFollowUp,
  type ProbeSourceId,
} from './sourceProbePlan.ts'

/** 單一來源探測的結果（`probeSource` 的回傳，去掉 source 欄位）。 */
export interface ProbeTick {
  source: ProbeSourceId
  hit: boolean
  ok: boolean
  data_ymd: string | null
  fingerprint: string | null
  rows: number | null
  note: string | null
  duration_ms: number
  /** MOPS 專用：這一次上游發布的資料期別（'YYYY-MM' / 'YYYY-Qn'）。其他來源為 undefined。 */
  period?: string | null
}

export interface FollowUpOutcome {
  action: ProbeFollowUp
  ok: boolean
  note: string
}

export interface ProbeRoundDeps {
  /** 這個來源今天問過一次就好嗎——命中且資料已到位的集合。 */
  readDoneSources(): Promise<Set<ProbeSourceId>>
  /** 實際去問上游。 */
  probe(source: ProbeSourceId): Promise<ProbeTick>
  /** 把 tick 寫進 `source_probe_tick`。**在觸發抓取之前**呼叫，讀數才不會被抓取的失敗帶走。 */
  persistTick(tick: ProbeTick): Promise<void>
  /** 跑一支抓取，回傳它的 body（丟例外代表這支失敗）。 */
  runFollowUp(action: ProbeFollowUp): Promise<Record<string, unknown>>
  /**
   * 抓完之後回頭讀成品，取得「資料到底進來了沒」的證據。
   *
   * 收的是**命中的 tick**而不只是來源名稱，因為 MOPS 的判準需要 tick 上帶的 `period`
   * （上游這次發布的是哪一期）。判準一律是絕對值，所以不需要抓取前的基準相片。
   */
  readEvidence(hitTicks: ProbeTick[]): Promise<LandingEvidence>
  /** 把結論寫回該筆 tick。失敗不得讓整輪爆掉——代價只是下一輪重跑。 */
  markTick(source: ProbeSourceId, landed: boolean, note: string): Promise<void>
  /** 一句話摘要一支抓取的成果，寫進 note。 */
  summarise(action: ProbeFollowUp, body: Record<string, unknown>): string
  /** 現在幾點（毫秒）。注入是為了讓預算耗盡的分支可測。 */
  now(): number
  /** 抓取的 wall budget 截止時間（毫秒，絕對值）。 */
  deadline: number
}

export interface ProbeRoundResult {
  sources: ProbeSourceId[]
  skipped: ProbeSourceId[]
  ticks: ProbeTick[]
  followUps: FollowUpOutcome[]
  landed: ProbeSourceId[]
}

/**
 * 跑完一輪：挑來源 → 探 → 存 → 命中就抓 → 驗證資料到位 → 寫回。
 *
 * 順序是刻意的，而且每一步的失敗方向都朝「寧可重做一次」倒：
 * - tick **先存**，抓取後做——這樣抓取炸掉也不會賠掉這一輪量到的讀數。
 * - 代價是會留下「已命中但還沒抓」的列，所以 `data_landed` 才必須存在：
 *   只有命中**且**驗證到資料，這個來源才算今天結束。
 * - 預算不夠就不啟動下一支，把它留給固定班表；已經啟動的那支不會被打斷。
 */
export async function runProbeRound(
  planned: ProbeSourceId[],
  todayYmd: string,
  deps: ProbeRoundDeps,
): Promise<ProbeRoundResult> {
  const done = planned.length > 0 ? await deps.readDoneSources() : new Set<ProbeSourceId>()
  const sources = pendingSources(planned, done)
  const skipped = planned.filter((id) => !sources.includes(id))

  // Sequential: keep wall time predictable on free tier
  const ticks: ProbeTick[] = []
  for (const id of sources) {
    ticks.push(await deps.probe(id))
  }
  for (const t of ticks) {
    await deps.persistTick(t)
  }

  const hitTicks = ticks.filter((t) => t.hit)
  const hitSources = hitTicks.map((t) => t.source)
  const followUps: FollowUpOutcome[] = []
  const bodies = new Map<ProbeFollowUp, Record<string, unknown>>()
  for (const action of followUpsFor(hitSources)) {
    if (deps.now() > deps.deadline) {
      followUps.push({ action, ok: false, note: '預算不足，留給固定班表' })
      continue
    }
    try {
      const body = await deps.runFollowUp(action)
      bodies.set(action, body)
      followUps.push({ action, ok: true, note: deps.summarise(action, body) })
    } catch (e) {
      followUps.push({ action, ok: false, note: e instanceof Error ? e.message : String(e) })
    }
  }

  // Ask the artifacts, not the fetches —— see gatherLandingEvidence / sourceLanded.
  const evidence: LandingEvidence =
    hitTicks.length > 0 ? await deps.readEvidence(hitTicks) : {}

  const landed: ProbeSourceId[] = []
  for (const t of ticks) {
    if (!t.hit) continue
    const r = followUps.find((f) => f.action === PROBE_FOLLOW_UP[t.source])
    if (!r) continue
    const ok = r.ok && sourceLanded(t.source, todayYmd, evidence)
    if (ok) landed.push(t.source)
    const trigger = r.ok ? `已觸發 ${r.action}：${r.note}` : `觸發失敗 ${r.action}：${r.note}`
    await deps.markTick(
      t.source,
      ok,
      `${t.note} · ${trigger} · ${ok ? '資料已到位' : '資料未到位，下輪重試'}`,
    )
  }

  return { sources, skipped, ticks, followUps, landed }
}
