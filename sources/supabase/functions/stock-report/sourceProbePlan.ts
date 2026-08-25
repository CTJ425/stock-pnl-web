/**
 * Probe experiment (0.7.3): which sources to probe at a given Taipei clock time.
 *
 * Daily sources: every 5 minutes **inside** their window.
 * MOPS revenue / profit: only a few slots per day (not every 5 min).
 *
 * Pure functions — vitest imports this file; no Deno / network.
 */

export type ProbeSourceId =
  | 'bfi82u'
  | 't86'
  | 'bwibbu'
  | 'twt38u'
  | 'margin'
  | 'borrow'
  | 'mops_revenue'
  | 'mops_profit'

export const PROBE_SOURCE_LABELS: Record<ProbeSourceId, string> = {
  bfi82u: '全市場法人 BFI82U',
  t86: '個股法人 T86',
  bwibbu: '估值 BWIBBU',
  twt38u: '外資買賣超 TWT38U',
  margin: '融資融券',
  borrow: '借券賣出',
  mops_revenue: '月營收彙整',
  mops_profit: '季報／獲利彙整',
}

/** Display order on the admin page */
export const PROBE_SOURCE_ORDER: ProbeSourceId[] = [
  'bfi82u',
  't86',
  'bwibbu',
  'twt38u',
  'margin',
  'borrow',
  'mops_revenue',
  'mops_profit',
]

/**
 * 每個來源要收工，所需的「尾端連續相同指紋次數」（0.9.6）。
 *
 * 六個每日來源要 3：次數只證明「量到了幾次」，證明不了「上游還會不會再改」——尾端連續正是
 * 用來抓這件事的證據，任何一次內容變動都會把計數歸零重新累積。
 *
 * MOPS 兩個來源是 `Infinity`：永不收工（Task 133）。MOPS 彙整表整天會隨申報家數重出，
 * 第一次出表不是當天最後一版，但 `sourceLanded` 的判準是 `atLeast`（檔案期別 >= 上游期別）
 * ——只要當天第一槽就已經有那一期，就會判定到位，若照舊給 1 次就收工，剩下五槽永遠不會跑，
 * 看不到同一天稍後更大份的重出。實測（DEV `source_probe_tick`，2026-08-17～08-24）：
 * `mops_profit` 每天只有 12:00 一筆，六個 `MOPS_SLOTS` 只用到第一個。`retiredSources()` 比較
 * `counts[id] >= required[id]`，`Infinity` 永遠比不過，六個槽點因此每天全跑。
 *
 * 數字不因這次改版而變：DEV `batch_run_log` 實測 2026-08-12～08-19，T86 一天最多改版一次，
 * 且落在 t86 探針視窗（16:00–17:00）之外，提高次數攔不到它，只會多打沒有意義的請求。
 */
export const REQUIRED_LANDED_COUNTS: Record<ProbeSourceId, number> = {
  bfi82u: 3,
  t86: 3,
  margin: 3,
  borrow: 3,
  bwibbu: 3,
  twt38u: 3,
  mops_revenue: Number.POSITIVE_INFINITY,
  mops_profit: Number.POSITIVE_INFINITY,
}

/**
 * 尾端連續相同指紋的長度（0.9.6）。
 *
 * 空陣列為 0；最後一筆永遠算 1；往前延伸的條件是相鄰兩筆**都非空且相等**——null／undefined／
 * 空字串都無法證明「跟前一筆一樣」，遇到就停在那裡。任何一次內容變動都會把計數截斷，
 * 逼著收工判準重新累積證據，而不是只看最後兩筆、把更早的改版證據丟掉。
 */
export function trailingRun(fingerprints: Array<string | null | undefined>): number {
  if (fingerprints.length === 0) return 0
  let run = 1
  for (let i = fingerprints.length - 1; i > 0; i--) {
    const cur = fingerprints[i]
    const prev = fingerprints[i - 1]
    if (!cur || !prev || cur !== prev) break
    run++
  }
  return run
}

/**
 * 依據今日各來源的尾端連續到位次數，計算哪些來源已經收工。
 *
 * 收工條件就是次數本身：`counts[id] ?? 0` 達到 `required[id]` 即收工，不再另外查一個
 * settled 旗標——尾端連續次數已經把「內容還在不在動」算進去了。
 */
export function retiredSources(
  counts: Record<string, number>,
  required: Record<ProbeSourceId, number> = REQUIRED_LANDED_COUNTS,
): Set<ProbeSourceId> {
  const out = new Set<ProbeSourceId>()
  for (const [id, req] of Object.entries(required) as Array<[ProbeSourceId, number]>) {
    if ((counts[id] ?? 0) >= req) out.add(id)
  }
  return out
}

/** [fromMin, toMin] inclusive, minutes from midnight Taipei */
export type Window = { from: number; to: number }

export const DAILY_WINDOWS: Record<
  Exclude<ProbeSourceId, 'mops_revenue' | 'mops_profit'>,
  Window | Window[]
> = {
  // bfi82u 雙時段：15:00–16:30（盤後初步，不含鉅額與綜合帳戶）與 19:30–20:15（盤後完整，含鉅額與綜合帳戶）
  bfi82u: [
    { from: 15 * 60, to: 16 * 60 + 30 },
    { from: 19 * 60 + 30, to: 20 * 60 + 15 },
  ],
  t86: { from: 16 * 60, to: 17 * 60 }, // 16:00–17:00
  // 17:00–18:30（0.7.17）：實測連續多日官方均於 17:15–17:20 出表，前緣留 15 分鐘餘裕從 17:00 開探，
  // 後緣 18:30 收工，避開 15:00–17:00 約 24 次無效 probe。
  bwibbu: { from: 17 * 60, to: 18 * 60 + 30 },
  twt38u: { from: 17 * 60, to: 18 * 60 }, // 17:00–18:00
  margin: { from: 20 * 60 + 30, to: 22 * 60 + 30 }, // 20:30–22:30
  // 21:00 起（0.7.13），不再是 15:00：舊窗的理由是「沒人知道借券幾點翻日」，那是誠實的——
  // 但 2026-08-11 量到了，DEV 與 PROD 都在 **22:15** 翻，中間 95 次請求全部打在空氣上。
  // 前緣留 75 分鐘的餘裕（21:00）而不是貼著 22:15，因為只有一天的樣本。
  borrow: { from: 21 * 60, to: 23 * 60 + 30 }, // 21:00–23:30
}

/** MOPS: only these HH:mm slots (aligned to every-5-minute cron) */
const MOPS_SLOTS = new Set(['12:00', '12:05', '17:15', '17:20', '21:00', '21:05'])

export function minutesFromHhmm(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

function inWindow(mins: number, w: Window): boolean {
  return mins >= w.from && mins <= w.to
}

/** 取得特定來源在當前分鐘所屬的活躍視窗（若不在任何視窗內則回傳 null）。 */
export function getActiveWindow(
  id: Exclude<ProbeSourceId, 'mops_revenue' | 'mops_profit'>,
  mins: number,
): Window | null {
  const w = DAILY_WINDOWS[id]
  if (Array.isArray(w)) {
    return w.find((win) => inWindow(mins, win)) ?? null
  }
  return inWindow(mins, w) ? w : null
}

export interface LandedTick {
  source: string
  taipei_time: string | null
  fingerprint: string | null
}

/**
 * 把今天的到位紀錄整理成「每個來源尾端連續到位幾次」。
 *
 * `slotMinutes` 是現在這一輪的分鐘數；當來源有每日視窗時，只有落在**當前活躍視窗**內的
 * tick 算數——`bfi82u` 一天兩個時段，跨時段累計會讓它提早退休。
 */
export function summariseLandedTicks(
  ticks: LandedTick[],
  slotMinutes: number | null,
): { counts: Record<string, number> } {
  // DB row order is not guaranteed; sort by tick time so per-source fingerprints are in
  // time order, which `trailingRun` needs (it walks backwards from the end).
  const sorted = [...ticks].sort(
    (a, b) =>
      (a.taipei_time ? minutesFromHhmm(a.taipei_time) ?? 0 : 0) -
      (b.taipei_time ? minutesFromHhmm(b.taipei_time) ?? 0 : 0),
  )

  const fingerprintsBySource: Record<string, Array<string | null>> = {}
  for (const r of sorted) {
    const src = r.source
    if (slotMinutes != null && src in DAILY_WINDOWS) {
      const activeWin = getActiveWindow(src as keyof typeof DAILY_WINDOWS, slotMinutes)
      if (activeWin) {
        const tickMins = r.taipei_time ? minutesFromHhmm(r.taipei_time) : null
        if (tickMins != null && (tickMins < activeWin.from || tickMins > activeWin.to)) {
          continue
        }
      }
    }
    ;(fingerprintsBySource[src] ??= []).push(r.fingerprint ?? null)
  }

  const counts: Record<string, number> = {}
  for (const src of Object.keys(fingerprintsBySource)) {
    counts[src] = trailingRun(fingerprintsBySource[src])
  }
  return { counts }
}

/**
 * Sources to probe at this Taipei HH:mm on a weekday.
 * Weekends: empty (caller may still skip entirely).
 */
export function sourcesForTaipeiTime(hhmm: string, weekday: boolean): ProbeSourceId[] {
  if (!weekday) return []
  const mins = minutesFromHhmm(hhmm)
  if (mins == null) return []

  const out: ProbeSourceId[] = []
  // Derive daily sources from DAILY_WINDOWS' keys (not a second hardcoded list) so a source
  // added there can't silently miss this loop again — see 'twt38u' bug.
  for (const id of Object.keys(DAILY_WINDOWS) as Array<keyof typeof DAILY_WINDOWS>) {
    const w = DAILY_WINDOWS[id]
    const matched = Array.isArray(w)
      ? w.some((win) => inWindow(mins, win))
      : inWindow(mins, w)
    if (matched) out.push(id)
  }
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const slot = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  if (MOPS_SLOTS.has(slot)) {
    out.push('mops_revenue', 'mops_profit')
  }
  return out
}

/**
 * 命中**且已經抓回來**之後才不再探這個源（0.7.7 起，0.7.8 補上後半句）。
 *
 * 探針只回答一個問題：**這個源今天幾點上架**。答案一旦拿到就不會再變，之後每 5 分鐘再問一次
 * 只是重複同一個已知答案——對 TWSE 多打幾十次沒有意義的請求，後台進度條也會被一排綠格灌爆，
 * 反而看不出「它暗了多久」這件唯一在量的事。
 *
 * 但「不再探」不能只看命中：0.7.8 起命中會直接觸發抓取，若那次抓取沒把資料拿回來而這裡照樣跳過，
 * 這個源當天就再也沒有第二次機會——變成「量到了、卻沒拿回來」，正是這整套機制要避免的事。
 * 所以判斷條件是**命中 + 資料確實到位**（`alreadyDone`，由 `sourceLanded` 判定），沒到位的下一輪重探、重試。
 *
 * 這裡的「到位」刻意不等於「抓取函式沒出錯」。抓取可以完全不拋錯卻什麼都沒帶回來
 * （`syncMarket` 的 `reason:'empty'`、T86 還沒上架時照樣產得出來的昨日籌碼報告），
 * 把那種情況記成收工，等於用一個假答案關掉當天所有重試機會。
 *
 * 代價要講清楚：**上游事後修訂會看不到**。這是刻意的取捨——修訂屬於抓取端
 * （`generate-chips` 的 `t86_revisions` 已經在管）的職責，不是探針的。
 */
export function pendingSources(
  planned: ProbeSourceId[],
  alreadyDone: Iterable<ProbeSourceId>,
): ProbeSourceId[] {
  const done = new Set(alreadyDone)
  return planned.filter((id) => !done.has(id))
}

/**
 * 命中之後要跑哪一支抓取（0.7.8）。
 *
 * 探針原本是純觀測：它只寫 `source_probe_tick`，抓資料完全靠固定班表。那代表**量到上游已經上架，
 * 卻要再等到下一個班次才會去拿**——今天 BFI82U 15:10 就綠了，固定班表 15:15 才動，而在班表被停用
 * 的那段期間更是永遠不會動。既然探針已經知道「現在有了」，就該由它直接把對應的抓取叫起來。
 *
 * 對應關係是「誰消費這個來源」，不是猜的：
 * - `bfi82u`  → `sync-market`：全市場法人買賣超寫進 `market/daily.json`
 * - `t86` / `margin` / `borrow` → `generate-chips`：三者都是個股籌碼報告的欄位
 * - `bwibbu`  → `generate-market-data`：估值走 `syncFundamental`
 * - `mops_*`  → `generate-history`：月營收／季報走 backfill
 */
export type ProbeFollowUp =
  | 'sync-market'
  | 'generate-chips'
  | 'generate-market-data'
  | 'generate-history'

export const PROBE_FOLLOW_UP: Record<ProbeSourceId, ProbeFollowUp> = {
  bfi82u: 'sync-market',
  t86: 'generate-chips',
  margin: 'generate-chips',
  borrow: 'generate-chips',
  bwibbu: 'generate-market-data',
  twt38u: 'generate-chips',
  mops_revenue: 'generate-history',
  mops_profit: 'generate-history',
}

/**
 * 固定執行順序：便宜的先跑。
 *
 * 一輪可能同時有兩個源轉綠（例如 21:00 的 margin 與 bwibbu），而 Edge 的 wall budget 有限——
 * 先跑短的，長的即使被預算擋下也只是等下一班補，不會反過來讓短的陪葬。
 */
const FOLLOW_UP_ORDER: ProbeFollowUp[] = [
  'sync-market',
  'generate-market-data',
  'generate-history',
  'generate-chips',
]

/** 這一輪剛轉綠的來源要觸發哪些抓取（去重、固定順序）。 */
export function followUpsFor(hitSources: Iterable<ProbeSourceId>): ProbeFollowUp[] {
  const wanted = new Set<ProbeFollowUp>()
  for (const id of hitSources) {
    const action = PROBE_FOLLOW_UP[id]
    if (action) wanted.add(action)
  }
  return FOLLOW_UP_ORDER.filter((a) => wanted.has(a))
}

/**
 * 「這個來源的資料真的進來了嗎」的證據（0.7.8）。
 *
 * 每一項都是**讀回成品後**才拿得到的東西，不是抓取函式自己的回報。抓取「有沒有出錯」與資料
 * 「有沒有到位」是兩件事：`syncMarket` 可以回 `reason:'empty'` 而完全沒拋錯，`generate-chips`
 * 也可以在 T86 還沒上架時照樣產出一份用昨天資料做的報告。只認前者，等於把「跑完了」當成「拿到了」。
 */
export interface LandingEvidence {
  /** `market/daily.json` 今天的成交量值與三大法人都已在檔（`isMarketSessionReady`）。 */
  marketSessionReady?: boolean
  /** 產出的籌碼報告裡各來源自報的資料日期（`ReportSources`，YYYY-MM-DD）。 */
  chipStamps?: {
    institutional?: string | null
    margin?: string | null
    borrow?: string | null
  }
  /** 前端讀的 `fundamental/*.json` 裡 `valuation.dataDate`（YYYY-MM-DD）。 */
  fundamentalValuationDate?: string | null
  /** `market/foreign_top50.json` 的 `rawDate`（YYYYMMDD / YYYY-MM-DD）。 */
  foreignTopDate?: string | null
  /** 同一份檔案裡，月營收／季報**目前最新的一期**（'YYYY-MM' / 'YYYY-Qn'）。 */
  fundamentalRevenueMonth?: string | null
  fundamentalProfitQuarter?: string | null
  /**
   * 上游這一輪**剛發布**的那一期——也就是「今天該出現在畫面上的」那一期。
   * 判準是絕對值而不是「有沒有往前走」：後者在資料早就補齊時會永遠答不出「到位」，
   * 而且它回答的是「有沒有變動」，不是「該有的那一期在不在」。
   */
  mopsPublished?: { revenue?: string | null; profit?: string | null }
}

/**
 * 這個來源今天算不算「收工」——命中**且資料確實到位**。
 *
 * 判準逐源不同，因為「到位」的證據逐源不同：
 * - `bfi82u`：`market/daily.json` 的當日場次已齊（量值 + 三大法人）。
 * - `t86` / `margin`：籌碼報告裡該來源自報的日期＝今天。報告可能是用昨天的資料產的，
 *   所以要看的是 stamp，不是「報告產出來了沒」。
 * - `borrow`：沿用 `borrowHit` 的同一條判準——日期**走過**今天才算，因為借券盤中自帶當日額度。
 * - `bwibbu`：**前端讀的那份** `fundamental/*.json` 的 `valuation.dataDate` ＝今天。
 *   不是問抓取函式回報了什麼日期——那只證明「我們抓到了」，不證明「畫面上換了」。
 * - `mops_*`：**上游剛發布的那一期**（月營收的 `資料年月`／季報的 `年度`+`季別`）已經在那份檔案裡。
 *   探針本來就要抓 MOPS 才能讀出表日期，順手把「這次發布的是哪一期」一起帶出來，
 *   判準因此和其他來源同型：都是「上游剛出的那一份，出現在前端讀的東西裡」。
 *
 * 八個來源共用同一條標準，只是各自的「那份東西」不同——沒有任何一個是用
 * 「抓取函式有沒有出錯」或「這輪有沒有做事」來判定的。
 */
export function sourceLanded(
  source: ProbeSourceId,
  todayYmd: string,
  ev: LandingEvidence,
): boolean {
  switch (source) {
    case 'bfi82u':
      return ev.marketSessionReady === true
    case 't86':
      return normaliseYmd(ev.chipStamps?.institutional) === todayYmd
    case 'margin':
      return normaliseYmd(ev.chipStamps?.margin) === todayYmd
    case 'borrow':
      return borrowHit(ev.chipStamps?.borrow ?? null, todayYmd)
    case 'bwibbu':
      return normaliseYmd(ev.fundamentalValuationDate) === todayYmd
    case 'twt38u':
      return normaliseYmd(ev.foreignTopDate) === todayYmd
    case 'mops_revenue':
      return atLeast(ev.fundamentalRevenueMonth, ev.mopsPublished?.revenue)
    case 'mops_profit':
      return atLeast(ev.fundamentalProfitQuarter, ev.mopsPublished?.profit)
  }
}

/**
 * 檔案裡的那一期有沒有追上（含）上游剛發布的那一期。
 *
 * 用 `>=` 而不是 `===`：backfill 可能早就補到更新的一期（月營收就是這樣——OpenAPI 快照停在六月，
 * 而畫面上已經有七月），那顯然算到位。缺任何一邊都算沒到位，沒有證據就不收工。
 */
function atLeast(have: string | null | undefined, want: string | null | undefined): boolean {
  if (!have || !want) return false
  return have >= want
}

/** 'YYYY-MM-DD' | 'YYYYMMDD' → 'YYYYMMDD'；其餘一律 null，不猜。 */
function normaliseYmd(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null
  const compact = v.replace(/-/g, '')
  return /^\d{8}$/.test(compact) ? compact : null
}

/**
 * 借券 TWT96U 是否已經換日。
 *
 * `title` 自帶的日期在盤中就是**當天**（「115年08月11日 當日可借券賣出股數」），
 * 收盤後才翻成下一個交易日的額度。只看「端點有沒有資料」永遠是有，
 * 所以命中必須定義成「日期已經走過今天」。
 */
export function borrowHit(dateIso: string | null, todayYmd: string): boolean {
  if (!dateIso || !/^\d{8}$/.test(todayYmd)) return false
  return dateIso.replace(/-/g, '') > todayYmd
}

/**
 * 快取的借券資料能不能用，跟「借券有沒有落地」是同一條規則——刻意不重寫第二個比較式。
 *
 * BUG-037：舊版快取用 `ymd >= tradeYmd`，比 `borrowHit` 的 `>` 少一步，翻日前的當日額度
 * 就會被誤判成可用；翻日後 `loadBorrow` 拿到那筆舊快取就不再重打端點，
 * `sourceLanded('borrow')` 因此永遠是 false。
 */
export function borrowCacheUsable(cachedYmd: string | null, tradeYmd: string): boolean {
  return borrowHit(cachedYmd, tradeYmd)
}

/**
 * MOPS 彙整表（t187ap05_L 月營收 / t187ap17_L 季報）自報的出表日期，民國 7 碼。
 *
 * 這兩份是「整份重出」的快照——實測整份 1082 / 336 筆共用同一個出表日期，
 * 因此取第一列即可。端點恆有資料，出表日期是唯一能分辨新舊的欄位。
 */
export function mopsIssueRocYmd(rows: unknown): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const v = (rows[0] as Record<string, unknown> | null)?.['出表日期']
  return typeof v === 'string' && /^\d{7}$/.test(v.trim()) ? v.trim() : null
}

/**
 * MOPS 這一次**發布的是哪一期**（0.7.12）。
 *
 * 探針為了讀出表日期本來就要抓這份表，順手把資料期別一起讀出來，收工判準才能問
 * 「這一期在不在畫面上」而不是「這一輪有沒有變動」——後者在資料早就補齊時永遠答不出到位。
 * 整份表共用同一期（實測 1082／336 筆皆然），取第一列即可，與 `mopsIssueRocYmd` 同一個理由。
 */
export function mopsRevenuePeriod(rows: unknown): string | null {
  const v = firstRowField(rows, '資料年月')
  if (!/^\d{5}$/.test(v ?? '')) return null
  const s = v as string
  return `${Number(s.slice(0, 3)) + 1911}-${s.slice(3)}`
}

/** 季報：`年度` + `季別` → 'YYYY-Qn'。 */
export function mopsProfitPeriod(rows: unknown): string | null {
  const y = firstRowField(rows, '年度')
  const q = firstRowField(rows, '季別')
  if (!/^\d{2,3}$/.test(y ?? '') || !/^[1-4]$/.test(q ?? '')) return null
  return `${Number(y) + 1911}-Q${q}`
}

function firstRowField(rows: unknown, field: string): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const v = (rows[0] as Record<string, unknown> | null)?.[field]
  return v == null ? null : String(v).trim()
}

/** UI helper: "15:00 沒中" / "15:05 中" */
export function formatProbeTickLabel(hhmm: string, hit: boolean): string {
  const compact = hhmm.replace(':', '')
  return `${compact} ${hit ? '中' : '沒中'}`
}

/** YYYYMMDD → ROC 7-digit date string used by BWIBBU (e.g. 20260811 → 1150811) */
export function ymdToRocYmd(ymd: string): string | null {
  if (!/^\d{8}$/.test(ymd)) return null
  const y = Number(ymd.slice(0, 4)) - 1911
  if (y < 1) return null
  return `${y}${ymd.slice(4)}`
}
