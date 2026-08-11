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
  | 'margin'
  | 'borrow'
  | 'mops_revenue'
  | 'mops_profit'

export const PROBE_SOURCE_LABELS: Record<ProbeSourceId, string> = {
  bfi82u: '全市場法人 BFI82U',
  t86: '個股法人 T86',
  bwibbu: '估值 BWIBBU',
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
  'margin',
  'borrow',
  'mops_revenue',
  'mops_profit',
]

/** [fromMin, toMin] inclusive, minutes from midnight Taipei */
type Window = { from: number; to: number }

const DAILY_WINDOWS: Record<
  Exclude<ProbeSourceId, 'mops_revenue' | 'mops_profit'>,
  Window
> = {
  bfi82u: { from: 15 * 60, to: 16 * 60 + 30 }, // 15:00–16:30
  t86: { from: 15 * 60 + 30, to: 17 * 60 + 30 }, // 15:30–17:30
  bwibbu: { from: 17 * 60 + 30, to: 22 * 60 }, // 17:30–22:00
  margin: { from: 20 * 60 + 30, to: 22 * 60 + 30 }, // 20:30–22:30
  // 15:00 起，不是 20:30：借券的命中條件是「title 日期翻到下一個交易日」（見 borrowHit），
  // 而沒人知道它幾點翻。窗若從 20:30 才開，翻日發生在那之前就只會看到一整排「中」——
  // 那正是 0.7.3 首版的毛病。寧可多探幾輪，也不要量到一個永遠為真的答案。
  borrow: { from: 15 * 60, to: 22 * 60 + 45 }, // 15:00–22:45
}

/** MOPS: only these HH:mm slots (aligned to every-5-minute cron) */
const MOPS_SLOTS = new Set(['12:00', '12:05', '21:00', '21:05'])

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

/**
 * Sources to probe at this Taipei HH:mm on a weekday.
 * Weekends: empty (caller may still skip entirely).
 */
export function sourcesForTaipeiTime(hhmm: string, weekday: boolean): ProbeSourceId[] {
  if (!weekday) return []
  const mins = minutesFromHhmm(hhmm)
  if (mins == null) return []

  const out: ProbeSourceId[] = []
  for (const id of ['bfi82u', 't86', 'bwibbu', 'margin', 'borrow'] as const) {
    if (inWindow(mins, DAILY_WINDOWS[id])) out.push(id)
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
  /** 估值檔（BWIBBU）自報的民國日期，7 碼。 */
  bwibbuRocYmd?: string | null
  /** 這一輪 MOPS backfill 實際寫進去幾筆。 */
  mopsFilled?: { revenue?: number; profit?: number }
}

/**
 * 這個來源今天算不算「收工」——命中**且資料確實到位**。
 *
 * 判準逐源不同，因為「到位」的證據逐源不同：
 * - `bfi82u`：`market/daily.json` 的當日場次已齊（量值 + 三大法人）。
 * - `t86` / `margin`：籌碼報告裡該來源自報的日期＝今天。報告可能是用昨天的資料產的，
 *   所以要看的是 stamp，不是「報告產出來了沒」。
 * - `borrow`：沿用 `borrowHit` 的同一條判準——日期**走過**今天才算，因為借券盤中自帶當日額度。
 * - `bwibbu`：估值檔自報的民國日期＝今天。
 * - `mops_*`：這一輪確實補進了資料。**這是唯一一個看「有沒有做事」而不是「資料在不在」的來源**——
 *   月營收／季報散在各檔個股的歷史檔裡，沒有一個便宜的單點可以問「今天的到了沒」。
 *   代價有界：MOPS 一天只探 12:00／12:05／21:00／21:05 四槽，最多多跑一輪。
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
      return !!ev.bwibbuRocYmd && ev.bwibbuRocYmd === ymdToRocYmd(todayYmd)
    case 'mops_revenue':
      return (ev.mopsFilled?.revenue ?? 0) > 0
    case 'mops_profit':
      return (ev.mopsFilled?.profit ?? 0) > 0
  }
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
