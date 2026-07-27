/**
 * 輪詢決策的純邏輯（0.6.1）。
 *
 * **為什麼要獨立成一個檔**：`index.ts` 在模組載入時就呼叫 `Deno.serve`，vitest 匯入不了，
 * 所以寫在那裡的判斷等於沒有測試。批次從一天 3 班改成一天 32 次輪詢之後，
 * 「什麼時候可以完全不對外抓取」變成安全關鍵 —— 判斷寫錯的代價從 3 倍變成 32 倍。
 * 0.3.9 燒光額度的成因正是自己的邏輯錯誤（prune 的保留期單位錯配讓每晚做白工），
 * 不是惡意流量，所以這裡的每一條判斷都要有測試釘住。
 */

/**
 * 一天最多允許幾次實際執行（超過就短路）。
 *
 * cron 一天只排 32 次，所以正常情況永遠碰不到這個上限 —— 它是防呆，防的是兩件事：
 * 1. 我們自己的判斷邏輯出錯，導致該短路的時候沒短路（0.3.9 的形狀）。
 * 2. `generate-all` 只靠 `x-cron-secret` 把關，而函式以 `--no-verify-jwt` 部署、
 *    網址就在公開 bundle 裡。密鑰若外流，這個上限是最後一道剎車。
 */
export const MAX_RUNS_PER_DAY = 40

/**
 * 連續幾次抓到的 T86 內容相同才視為定稿。
 *
 * 刻意**看內容而不是看時鐘**：`schema.sql` §6c 那些「幾點公布」的註解在 2026-07-27
 * 一天之內就被實測推翻三處（T86 時間、借券時間、借券語意）。時鐘上的猜測會過期，
 * 「連續兩次抓到一樣的東西」不會。
 */
export const T86_STABLE_POLLS = 2

/**
 * 內容指紋。長度 + djb2 雜湊，長度先擋掉絕大多數碰撞。
 * 只用來判斷「跟上次是不是同一份」，不需要密碼學強度。
 */
export function fingerprint(value: unknown): string {
  const s = JSON.stringify(value) ?? ''
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return `${s.length}:${h.toString(36)}`
}

/** 今天這份 T86 的改寫狀態；跨輪次由 `batch_run_log` 的最後一列帶回 */
export interface T86State {
  fingerprint: string
  /** 今天被改寫過幾次（第一次抓到不算改寫） */
  revisions: number
  /** 連續幾次抓到的內容與上次相同 */
  unchanged: number
  /** 已定稿：後續輪次不再重抓 */
  frozen: boolean
}

/**
 * 依這次抓到的指紋推進狀態。
 *
 * 使用者指出 T86「16:00 開始每 15 分鐘更新一次」—— 也就是說當天第一次抓到的**不一定是定稿**。
 * 而原本的 `loadT86` 是「當天第一次抓到非空回應就快取，之後永遠不再更新」，
 * 兩者相衝：早抓會把初版鎖成當天的答案，比晚抓一次還糟。這個函式就是為了解掉這個衝突。
 */
export function nextT86State(
  prev: T86State | null,
  fp: string,
  stablePolls: number = T86_STABLE_POLLS,
): T86State {
  if (!prev) return { fingerprint: fp, revisions: 0, unchanged: 0, frozen: false }
  if (prev.fingerprint !== fp) {
    // 內容變了：改寫次數 +1，連續相同歸零，重新開始觀察
    return { fingerprint: fp, revisions: prev.revisions + 1, unchanged: 0, frozen: false }
  }
  const unchanged = prev.unchanged + 1
  return {
    fingerprint: fp,
    revisions: prev.revisions,
    unchanged,
    frozen: unchanged >= stablePolls,
  }
}

export type SkipReason = 'complete' | 'run-cap'

export interface SkipDecision {
  skip: boolean
  reason: SkipReason | null
}

/**
 * 這一輪要不要完全跳過（不做任何對外請求）。
 *
 * `t86Frozen` 是關鍵而不只是 `t86Today` —— 抓到當天的 T86 不代表它已經定稿，
 * 定稿前還得繼續回來看有沒有被改寫（見 `nextT86State`）。
 *
 * 融資融券要等到 21:00 之後才會有，所以「今天全齊」必須包含它；
 * 只看 T86 就收工的話，17:00 停掉，當天的融資融券就永遠不會被抓到。
 */
export function decideSkip(input: {
  t86Today: boolean
  t86Frozen: boolean
  marginToday: boolean
  runsToday: number
  maxRuns?: number
}): SkipDecision {
  const maxRuns = input.maxRuns ?? MAX_RUNS_PER_DAY
  if (input.runsToday >= maxRuns) return { skip: true, reason: 'run-cap' }
  if (input.t86Today && input.t86Frozen && input.marginToday) {
    return { skip: true, reason: 'complete' }
  }
  return { skip: false, reason: null }
}

/**
 * 報告內容的輸入指紋。相同就不必重產報告 ——
 * 省的不是錢（5 檔 × 5KB），是讓 `generatedAt` 只在真的有變動時才跳，
 * 否則 32 次輪詢會把「什麼時候變的」這個訊號洗掉。
 */
export function runSignature(parts: {
  dataYmd: string
  t86: string
  margin: string
  borrow: string
  tickers: string[]
}): string {
  return [
    parts.dataYmd,
    parts.t86,
    parts.margin,
    parts.borrow,
    // 持股清單變了也要重產：新增一檔股票時，舊報告裡沒有它
    parts.tickers.slice().sort().join(','),
  ].join('|')
}
