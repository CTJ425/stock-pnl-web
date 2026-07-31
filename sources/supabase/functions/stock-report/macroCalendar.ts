/**
 * 美國總經的官方發布行事曆，與「這一輪要不要真的去問 FRED」的決策（純函式，不觸網）。
 *
 * 為什麼獨立成模組：`index.ts` 模組載入即 `Deno.serve`，vitest 匯入不了，
 * 判斷寫在那裡等於沒測試（`pollPlan.ts:2-9` 的教訓）。
 *
 * ## 為什麼需要行事曆
 *
 * 0.6.14 之前是每天兩班盲掃，每天固定 10 個 FRED 請求，而且即時性最差要等隔天。
 * 官方其實**提前公告了確定的發布日期**（不是區間），所以可以反過來做：
 * 平常每天只掃一次（跟上 FRED 回頭修正歷史值），**發布日才從發布時刻起密集掃，
 * 一抓到就完全不再打 FRED**。請求數反而變少，即時性從「最慢隔天」變成「半小時內」。
 *
 * ## 真正的不確定區間
 *
 * 發布日是確定的，**不確定的是「官方發布 → FRED 匯入可用」的延遲**。
 * 實證：2026-07-30 的 PCE 官方在台北 20:30 發布，我們 21:00 那班就是抓不到
 * （當時線上檔的 yoy 對應的是同日已修正的 2026-05 值 —— 序列有更新，
 * 只是 2026-06 那筆還沒進去）。`SCAN_WINDOW_HOURS` 就是為這段延遲而留。
 *
 * ## ⚠️ 維護須知
 *
 * `RELEASE_CALENDAR` 需**每年 12 月手動更新次年日期**。
 * BLS 的 schedule 頁一律回 403（換瀏覽器 UA 也一樣），**無法自動同步**。
 * 行事曆用完時會自動 fallback 到 `FALLBACK_RULE` 的月中/月底規則並標記 `stale`，
 * 所以忘記更新不會讓整組失效，只是精準度下降。
 *
 * 資料來源（2026-07-31 查證）：
 * - BLS <https://www.bls.gov/schedule/news_release/> — CPI / PPI / 非農，皆美東 8:30
 * - BEA <https://www.bea.gov/news/schedule> — PCE，美東 8:30
 * - 密大 <https://www.sca.isr.umich.edu/> — 消費者信心，美東 **10:00**（與其他四項不同）
 *
 * 以 ALFRED vintage 反查的實際發布日與官方表完全吻合（見 scripts/find-release-dates.py）。
 */

/** 一次發布：哪一天、發的是哪一期 */
export interface ReleaseEntry {
  /** 發布日，美東當地日 'YYYY-MM-DD' */
  date: string
  /** 這次發布的資料期別 'YYYY-MM' */
  period: string
}

/**
 * 官方已公告的發布日期。**有效到 2026 年底**，之後走 `FALLBACK_RULE`。
 *
 * 只列已查證的部分：非農與 PCE 的上半年、PPI 的 1–3 月未查，
 * 但那些都已是過去式，對「下一期什麼時候到」的判斷沒有影響。
 */
export const RELEASE_CALENDAR: Record<string, readonly ReleaseEntry[]> = {
  CPILFESL: [
    { date: '2026-07-14', period: '2026-06' },
    { date: '2026-08-12', period: '2026-07' },
    { date: '2026-09-11', period: '2026-08' },
    { date: '2026-10-14', period: '2026-09' },
    { date: '2026-11-10', period: '2026-10' },
    { date: '2026-12-10', period: '2026-11' },
  ],
  PPIFES: [
    { date: '2026-07-15', period: '2026-06' },
    { date: '2026-08-13', period: '2026-07' },
    { date: '2026-09-10', period: '2026-08' },
    { date: '2026-10-15', period: '2026-09' },
  ],
  PAYEMS: [
    { date: '2026-08-07', period: '2026-07' },
    { date: '2026-09-04', period: '2026-08' },
    { date: '2026-10-02', period: '2026-09' },
  ],
  PCEPILFE: [
    { date: '2026-07-30', period: '2026-06' },
    { date: '2026-08-26', period: '2026-07' },
    { date: '2026-09-30', period: '2026-08' },
    { date: '2026-10-29', period: '2026-09' },
    { date: '2026-11-25', period: '2026-10' },
    { date: '2026-12-23', period: '2026-11' },
  ],
  // UMCSENT 刻意留空 —— 見 SKIP_INTENSIVE
}

/** 各指標的發布時刻（美東當地時，24 小時制的小時數） */
export const RELEASE_HOUR_ET: Record<string, number> = {
  CPILFESL: 8.5,
  PPIFES: 8.5,
  PAYEMS: 8.5,
  PCEPILFE: 8.5,
  UMCSENT: 10, // 密大是 10:00，與其他四項不同
}

/**
 * **不納入行事曆驅動密集掃**的指標。
 *
 * `UMCSENT`：實測在 FRED 上已停更 —— 依「次月 1 日進 FRED」的規律，2026-06 期
 * 該在 07-01 出現，但 07-01 / 07-15 / 07-31 三個 vintage 全停在 2026-05。
 * 納入密集掃只會每個發布日白掃到上限。它仍由**每日例行那一班**跟進，
 * 一旦來源恢復就會自動拿到。
 * （前例：`usMacro.ts` 開頭記載的 OECD 版 `CSCICP03USM665S` 已停更於 2024-01。）
 */
export const SKIP_INTENSIVE: readonly string[] = ['UMCSENT']

/** 行事曆用完時的退路：每月的第幾天算「應該已發布」。取自實測區間的**下緣** */
const FALLBACK_RULE: Record<string, number> = {
  PAYEMS: 8,
  UMCSENT: 3,
  CPILFESL: 14,
  PPIFES: 15,
  PCEPILFE: 30,
}

/** 發布後持續掃描的時數。涵蓋 FRED 從官方匯入的延遲 */
export const SCAN_WINDOW_HOURS = 6

/** 單一台北日的掃描次數上限（防呆，比照 pollPlan 的 MAX_RUNS_PER_DAY） */
export const MAX_SCANS_PER_DAY = 16

/**
 * 某個 UTC 時點在美東是否為日光節約時間（EDT, UTC-4）。
 *
 * 美國規則：3 月第二個週日 02:00 起、11 月第一個週日 02:00 止。
 * 邊界那兩小時的誤差不影響判斷（發布都在 8:30/10:00，離切換點很遠）。
 */
export function isEasternDst(d: Date): boolean {
  const y = d.getUTCFullYear()
  const secondSunOfMarch = nthSunday(y, 2, 2)
  const firstSunOfNov = nthSunday(y, 10, 1)
  const t = d.getTime()
  return t >= Date.UTC(y, 2, secondSunOfMarch, 7) && t < Date.UTC(y, 10, firstSunOfNov, 6)
}

/** 某年某月的第 n 個週日是幾號（month 為 0-based） */
function nthSunday(year: number, month: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return 1 + ((7 - firstDow) % 7) + (n - 1) * 7
}

/** 台北時區的 'YYYY-MM-DD' */
export function taipeiYmdOf(d: Date): string {
  const t = new Date(d.getTime() + 8 * 3600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
}

/**
 * 某指標的某次發布，其**實際可開始掃描的時刻**（UTC 毫秒）。
 * 美東當地日 + 當地時刻 → UTC，依當日是否夏令換算。
 */
export function releaseInstant(entry: ReleaseEntry, id: string): number {
  const [y, m, d] = entry.date.split('-').map(Number)
  const hourEt = RELEASE_HOUR_ET[id] ?? 8.5
  // 先以 EST(UTC-5) 粗估當天中午，判斷夏令與否，再定案偏移
  const probe = new Date(Date.UTC(y, m - 1, d, 12))
  const offset = isEasternDst(probe) ? 4 : 5
  return Date.UTC(y, m - 1, d, 0, 0, 0) + (hourEt + offset) * 3600_000
}

export interface ExpectedPeriod {
  /** 此刻依行事曆應該已經發布的最新期別；沒有任何一期到期時為 null */
  period: string | null
  /** 是否已用完行事曆、改用規則推算 */
  stale: boolean
}

/**
 * 依行事曆算出「此刻應該已經取得的最新期別」。
 *
 * 判斷基準是**發布時刻**而非發布日 —— 發布日當天早上還沒到 8:30 ET 時，
 * 那一期不算「應該已有」，否則會在發布前就把指標判成落後。
 */
export function expectedLatestPeriod(id: string, now: Date): ExpectedPeriod {
  const entries = RELEASE_CALENDAR[id] ?? []
  const t = now.getTime()
  let best: string | null = null
  let covered = false
  for (const e of entries) {
    const at = releaseInstant(e, id)
    if (at <= t && (best === null || e.period > best)) best = e.period
    if (at > t) covered = true // 行事曆還有未來的項目 → 尚未用完
  }
  // ⚠️ 判斷「用完了沒」要看**有沒有未來項目**，不能看 best 有沒有值 ——
  // 行事曆過期時 best 仍會是最後一筆（例如停在 2026-11），
  // 若據此回 stale:false，跨年後就會永遠卡在去年最後一期而不自知。
  if (covered) return { period: best, stale: false }

  // 行事曆用完（或該指標沒有行事曆）→ 退回規則推算
  const day = FALLBACK_RULE[id]
  if (day === undefined) return { period: null, stale: true }
  const tp = new Date(t + 8 * 3600_000) // 以台北日曆判斷「這個月過了幾天」
  const y = tp.getUTCFullYear()
  const mon = tp.getUTCMonth() + 1
  // 當月已過推估日 → 上個月的資料應該已發布；否則再往前一個月
  const back = tp.getUTCDate() >= day ? 1 : 2
  const total = y * 12 + (mon - 1) - back
  const p = (n: number) => String(n).padStart(2, '0')
  return { period: `${Math.floor(total / 12)}-${p((total % 12) + 1)}`, stale: true }
}

export interface NextRelease {
  /** 發布日（美東當地日）'YYYY-MM-DD' */
  date: string
  /** 這次會發布的資料期別 'YYYY-MM' */
  period: string
  /** true 代表行事曆已用完、日期是規則推算出來的 */
  estimated: boolean
}

/**
 * 某指標「下一期」的發布日。
 *
 * **由後端算完再回傳給前端**，而不是讓前端也放一份行事曆 ——
 * 兩份常數遲早會漂移，而漂移的症狀（畫面說 8/12、後端卻按 8/14 判定）
 * 幾乎不可能從畫面上看出來。單一真相來源就在這個檔案。
 *
 * 行事曆用完時回 `estimated: true` 並以 `FALLBACK_RULE` 的日子推算，
 * 畫面據此標示「推估」。
 */
export function nextReleaseFor(
  id: string,
  latestPeriod: string | null,
  now: Date,
): NextRelease | null {
  const entries = RELEASE_CALENDAR[id] ?? []
  const t = now.getTime()
  // 還沒發生、且期別比手上這期新的第一筆
  const upcoming = entries
    .filter((e) => releaseInstant(e, id) > t && (!latestPeriod || e.period > latestPeriod))
    .sort((a, b) => a.date.localeCompare(b.date))[0]
  if (upcoming) return { date: upcoming.date, period: upcoming.period, estimated: false }

  // 行事曆用完 → 依規則推算下一期
  const day = FALLBACK_RULE[id]
  if (day === undefined || !latestPeriod) return null
  const m = /^(\d{4})-(\d{2})$/.exec(latestPeriod)
  if (!m) return null
  // 手上是 2026-06 → 下一期 2026-07，於 2026-08 發布
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + 2
  const y = Math.floor(total / 12)
  const mon = (total % 12) + 1
  const p = (n: number) => String(n).padStart(2, '0')
  const nextPeriodTotal = Number(m[1]) * 12 + (Number(m[2]) - 1) + 1
  return {
    date: `${y}-${p(mon)}-${p(day)}`,
    period: `${Math.floor(nextPeriodTotal / 12)}-${p((nextPeriodTotal % 12) + 1)}`,
    estimated: true,
  }
}

export interface ScanInput {
  now: Date
  /** 既有檔裡各指標的最新期別 */
  indicators: ReadonlyArray<{ id: string; latestPeriod: string | null }>
  /** 今天（台北日）已掃過幾次 */
  scansToday: number
  /** 上次掃描的台北日；與今天不同代表今天還沒掃過 */
  lastScanYmd: string | null
}

export type ScanReason =
  /** 今天還沒掃過，例行掃一次（用來跟上 FRED 回頭修正歷史值） */
  | 'routine'
  /** 有指標到了發布時間卻還沒拿到，且落在掃描窗內 */
  | 'due'
  /** 該拿的都拿到了 */
  | 'satisfied'
  /** 有指標還沒拿到，但已超出掃描窗（等明天的例行班） */
  | 'outside-window'
  /** 今日掃描次數已達上限 */
  | 'capped'

export interface ScanDecision {
  scan: boolean
  reason: ScanReason
  /** 觸發掃描的指標（reason='due' 時才有內容） */
  dueIds: string[]
}

/**
 * 這一輪要不要真的去問 FRED。
 *
 * 沿用 `pollPlan.decideSkip` 的形狀：讓「要不要發請求」變成一個測得到的純函式，
 * 而不是散在 IO 流程裡的 if。
 *
 * 順序有意義：
 * 1. **次數上限**優先 —— 來源真的掛掉時（如 UMCSENT 停更）不能無限掃。
 * 2. **今天還沒掃 → 掃**。這一條保證每天至少問一次，
 *    因為 FRED 會回頭修正已發布的歷史值（BUG-008 那次 vintage 就同時改了兩期），
 *    只靠發布日掃會漏掉修正。
 * 3. **發布窗內且還沒拿到 → 掃**，這就是「拉長 scan」。
 * 4. 其餘不掃 —— **「一旦抓到就不抓」正是走到這裡**（satisfied）。
 */
export function decideMacroScan(input: ScanInput): ScanDecision {
  const { now, indicators, scansToday, lastScanYmd } = input

  if (scansToday >= MAX_SCANS_PER_DAY) return { scan: false, reason: 'capped', dueIds: [] }

  if (lastScanYmd !== taipeiYmdOf(now)) return { scan: true, reason: 'routine', dueIds: [] }

  const t = now.getTime()
  const dueIds: string[] = []
  let anyPendingOutsideWindow = false

  for (const ind of indicators) {
    if (SKIP_INTENSIVE.includes(ind.id)) continue
    const expected = expectedLatestPeriod(ind.id, now)
    if (!expected.period) continue
    // 已經拿到（或更新）→ 這一項不需要掃。這就是「抓到就不抓」
    if (ind.latestPeriod && ind.latestPeriod >= expected.period) continue

    // 還沒拿到：只有落在該期發布後的掃描窗內才值得繼續掃
    const entry = (RELEASE_CALENDAR[ind.id] ?? []).find((e) => e.period === expected.period)
    if (!entry) {
      anyPendingOutsideWindow = true
      continue
    }
    const at = releaseInstant(entry, ind.id)
    if (t >= at && t <= at + SCAN_WINDOW_HOURS * 3600_000) dueIds.push(ind.id)
    else anyPendingOutsideWindow = true
  }

  if (dueIds.length > 0) return { scan: true, reason: 'due', dueIds }
  return {
    scan: false,
    reason: anyPendingOutsideWindow ? 'outside-window' : 'satisfied',
    dueIds: [],
  }
}
