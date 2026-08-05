/**
 * 台股報價的抓取時段規則（0.6.36）。純函式、無狀態，供前端與 Edge Function 共用
 * （前端單元測試見 src/services/quoteWindow.test.ts）。
 *
 * 為什麼要分時段：13:30 收盤後價格就定案了，再每 60 秒問一次 MIS 只是白打 —— 對外部
 * 端點、Edge Function、DB 快取都是。收盤到隔天試撮前把 TTL 一路拉長，等於整段夜間零請求。
 *
 * 為什麼不查交易日曆、也不存「已鎖定」旗標：判斷只看台北的時鐘就夠了。
 * 週末與國定假日在 13:30 後自然落入長 TTL；隔天 08:25 解除後若當天休市，
 * 一到 13:30 又重新落入長 TTL。少一份要維護的假日表，也少一份會失準的狀態。
 */

/** 台北時區固定 +8（台灣無日光節約），與 stock-report/macroCalendar.ts 的處理一致 */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

/** 恢復抓價：08:25，比試撮（08:30）早 5 分鐘，讓開盤前第一筆試撮價就是新的 */
const RESUME_MS = (8 * 60 + 25) * MINUTE_MS
/** 收盤：13:30 最後一次撮合 */
const CLOSE_MS = (13 * 60 + 30) * MINUTE_MS
/** 收盤定案的寬限截止：14:00。這之後不論來源回什麼時間都鎖定 */
const CONFIRM_MS = 14 * 60 * MINUTE_MS
/** 盤中輪詢間隔（維持 0.6.35 以前的行為） */
const POLL_MS = MINUTE_MS

const CLOSE_TIME_TEXT = '13:30:00'

/** 台北時間的「當日已過毫秒數」（00:00:00 起算） */
function taipeiMsOfDay(now: Date): number {
  return (now.getTime() + TAIPEI_OFFSET_MS) % DAY_MS
}

/**
 * 台股報價的快取有效期。
 *
 * - 08:25–13:30（試撮與盤中）：60 秒，與收盤前的即時性需求一致
 * - 其餘時段：到下一個 08:25 為止，期間不再對外抓價
 *
 * @param tradeTime 來源回報的最後撮合時間（MIS 的 `t`，HH:mm:ss）。
 *   13:30–14:00 之間若它還沒到 13:30，表示收盤撮合尚未落地，
 *   這種過渡值不該被鎖上一整夜 —— 繼續用短 TTL 再問一輪。
 *   取不到（美股、TWSE OpenAPI 備援、舊快取）時不阻擋鎖定：
 *   「現在是台北 13:30 之後」本身已足以說明當日不會再有新價。
 */
export function twQuoteTtlMs(now: Date, tradeTime?: string | null): number {
  const t = taipeiMsOfDay(now)
  if (t >= RESUME_MS && t < CLOSE_MS) return POLL_MS
  if (t >= CLOSE_MS && t < CONFIRM_MS && tradeTime != null && tradeTime < CLOSE_TIME_TEXT) {
    return POLL_MS
  }
  // 收盤後往後推到明天的 08:25；凌晨（t < RESUME_MS）則是今天的 08:25
  return t < RESUME_MS ? RESUME_MS - t : DAY_MS - t + RESUME_MS
}
