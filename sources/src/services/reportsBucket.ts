/**
 * Exposes the `reports` bucket for public reading.
 *
 * The after-hours schedule writes two things into the same bucket, and the front-end downloads them directly without going through the Edge Function:
 * - `manifest.json` / `{ymd}/{ticker}.json` —— Chip report (reportProxy.ts)
 * - `daily/{ticker}.json` —— Daily OHLCV (dailyProxy.ts)
 *
 * Writing a copy of the download logic on both sides will inevitably lead to failure. This is a single source.
 * Choosing Storage instead of Edge Function is deliberate: the lesson from 0.3.9 is that the invocation quota is burned out
 * It will also cause the stock-price to stop together. If possible, the Edge Function will not be implemented.
 */
import { isSupabaseConfigured, supabase } from './supabase'

export const REPORTS_BUCKET = 'reports'

/**
 * Read a JSON file from the reports bucket (public bucket, readable by anon); return null if none/failed.
 *
 * **Why is `fetch(..., { cache: 'no-store' })` instead of `supabase.storage.download()`**
 * (0.6.4-dev.5, actual online accident):
 *
 * These files are written in batches after the event, and Edge Function's `uploadJson` does not specify `cacheControl`.
 * The default value of supabase-js is **3600**, so Storage returns `cache-control: public, max-age=3600`.
 * The bottom layer of `download()` is `fetch()`, so the response is cached by the browser for a full hour.
 *
 * The worst part is that **users cannot save themselves**: `Ctrl+Shift+R` only skips the cache of "files and sub-resources".
 * **Does not cover `fetch()`** issued after JS. The actual test result is that after resetting the window dozens of times, it will always stop at the old data,
 * Incognito window (empty cache) is correct - and there is no way to tell on the screen that you are getting the old one.
 *
 * `no-store` makes every read actually go through the network. These files can be updated up to 32 times a day and each copy is KB.
 * The traffic saved is far from worth the cost of "the displayed data is wrong and the user cannot save themselves."
 *
 * The other half of the modification is in Edge Function's `uploadJson` (rewriting cacheControl).
 * However, the metadata of the existing file will not be replaced until the next write, so the front-end cannot be omitted.
 *
 * Diagnostic pitfall: Measuring this endpoint with `curl -I` (HEAD) results in `no-cache`, which does not match the actual header of GET.
 * It will make people misjudge that "it is not a cache problem". **Always use GET verification** (`curl -s -o /dev/null -D -`).
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
