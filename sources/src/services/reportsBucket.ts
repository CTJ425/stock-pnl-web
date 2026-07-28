/**
 * 公開 `reports` bucket 的共用讀取。
 *
 * 盤後排程把兩種東西寫進同一個 bucket，前端都是直接下載、不經 Edge Function：
 * - `manifest.json` / `{ymd}/{ticker}.json` —— 籌碼報告（reportProxy.ts）
 * - `daily/{ticker}.json`                  —— 日線 OHLCV（dailyProxy.ts）
 *
 * 兩邊各寫一份下載邏輯必然會走鐘，這裡是單一來源。
 * 走 Storage 而非 Edge Function 是刻意的：0.3.9 的教訓是 invocation 額度燒光
 * 會連帶讓 stock-price 一起停擺，能不打 Edge Function 就不打。
 */
import { isSupabaseConfigured, supabase } from './supabase'

export const REPORTS_BUCKET = 'reports'

/**
 * 從 reports bucket 讀一個 JSON 檔（公開 bucket，anon 可讀）；查無 / 失敗回 null。
 *
 * **為什麼是 `fetch(..., { cache: 'no-store' })` 而不是 `supabase.storage.download()`**
 * （0.6.4-dev.5，實際線上事故）：
 *
 * 這些檔案由盤後批次寫入，而 Edge Function 的 `uploadJson` 沒有指定 `cacheControl`，
 * supabase-js 的預設值是 **3600**，於是 Storage 回 `cache-control: public, max-age=3600`。
 * `download()` 底層就是 `fetch()`，這份回應因此被瀏覽器整整快取一小時。
 *
 * 最惡劣的地方是**使用者救不了自己**：`Ctrl+Shift+R` 只跳過「文件與其子資源」的快取，
 * **不涵蓋 JS 之後才發出的 `fetch()`**。實測結果是一般視窗重整幾十次都停在舊資料、
 * 無痕視窗（空快取）才正確 —— 而畫面上完全看不出來自己拿的是舊的。
 *
 * `no-store` 讓每次讀取都真的走網路。這些檔一天最多更新 32 次、每份數 KB，
 * 省那點流量遠不值得換來「顯示的資料是錯的、而且使用者無法自救」。
 *
 * 另一半的修法在 Edge Function 的 `uploadJson`（改寫 cacheControl），
 * 但**既有檔案要等下次寫入才會換掉 metadata**，所以前端這道不能省。
 *
 * 診斷陷阱：用 `curl -I`（HEAD）量這個端點會得到 `no-cache`，與 GET 的實際標頭不符，
 * 會讓人誤判「不是快取問題」。**一律用 GET 驗證**（`curl -s -o /dev/null -D -`）。
 */
export async function downloadReportsJson<T>(path: string): Promise<T | null> {
  if (!isSupabaseConfigured || !supabase) return null
  try {
    const { data } = supabase.storage.from(REPORTS_BUCKET).getPublicUrl(path)
    const res = await fetch(data.publicUrl, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}
