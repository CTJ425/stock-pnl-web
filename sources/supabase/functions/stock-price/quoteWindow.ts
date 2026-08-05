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
 * - 其餘時段：**只鎖已確認是收盤定案值的報價**，鎖到下一個 08:25
 *
 * @param tradeTime 來源回報的最後撮合時間（MIS 的 `t`，HH:mm:ss）。
 *   **沒到 13:30 或根本取不到就不鎖**（0.6.37 修正）：
 *   0.6.36 原本的推理是「現在是 13:30 之後，當日不會再有新價」——
 *   那對「價格」成立，對「這筆是不是收盤定案值」不成立。
 *   缺這個欄位的快取有兩種來源：升級前寫入的舊列，以及沒有這個欄位的備援路徑
 *   （Yahoo / TWSE OpenAPI）。兩者都只是盤中某一刻的快照，鎖了會把它凍到隔天早上，
 *   畫面上就一路顯示「盤中」而且開高低量全是「—」。正式區實際發生過。
 *   代價是來源持續回非定案值時整夜維持短輪詢 —— 那是異常狀態，本來就該持續重試。
 */
export function twQuoteTtlMs(now: Date, tradeTime?: string | null): number {
  const t = taipeiMsOfDay(now)
  if (t >= RESUME_MS && t < CLOSE_MS) return POLL_MS
  if (tradeTime == null || tradeTime < CLOSE_TIME_TEXT) return POLL_MS
  // 收盤後往後推到明天的 08:25；凌晨（t < RESUME_MS）則是今天的 08:25
  return t < RESUME_MS ? RESUME_MS - t : DAY_MS - t + RESUME_MS
}

/**
 * 此刻台股快取「可能的最長有效期」，供 DB 查詢的粗篩下界使用。
 *
 * 粗篩不知道每一列的 `trade_time`，不能直接呼叫 `twQuoteTtlMs(now)` ——
 * 那會回短 TTL（因為沒帶撮合時間），把昨天收盤抓到的定案價濾掉、整夜白抓。
 * 這裡以「已定案」為假設取上界，逐列的實際判定仍由 `twQuoteTtlMs` 負責。
 */
export function twMaxTtlMs(now: Date): number {
  return twQuoteTtlMs(now, CLOSE_TIME_TEXT)
}
