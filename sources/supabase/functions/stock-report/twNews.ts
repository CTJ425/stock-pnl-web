/**
 * Google News RSS 抓取與解析（AI 解讀的消息面來源）。
 *
 * 實測確認（2026-07-27，q=台積電）：整份 XML 為單行；每個 <item> 內有
 * `<title>標題 - 來源名</title>`（純文字＋XML entity，未見 CDATA，但 Google 端格式
 * 可能變動，兩種形態都解）、`<pubDate>RFC 822</pubDate>`、
 * `<source url="...">來源名</source>`；一次回約 100 則。
 *
 * 解析用正規表達式而非 XML parser：Edge runtime 沒有 DOMParser，
 * 引 deno_dom 違反本專案「不加依賴」的慣性，而 RSS 2.0 的 <item> 結構
 * 平坦到 regex 足以應付；格式不符時回 [] 而不是 throw（缺新聞不得拖垮批次）。
 *
 * 版權註記：Google News RSS 條款限個人非商業用途；本專案為個人持股工具，
 * 只取標題/來源/時間三欄餵 AI，不轉載內文。
 *
 * 解析函式皆為純函式、不觸網；HTTP 抓取在 index.ts 組合。
 */

/**
 * 新聞檔的結構版本。
 * 前端守門必須用 `>=` 比對（見 src/services/newsProxy.ts），理由同 dailyProxy（0.4.1 事故）。
 */
export const NEWS_SCHEMA = 1

export interface NewsItem {
  title: string
  source: string | null
  /** ISO 時間；pubDate 解析失敗為 null */
  publishedAt: string | null
}

/** Storage 內 news/{ticker}.json 的結構 */
export interface NewsFile {
  schema: number
  ticker: string
  name: string
  /** 我們實際抓到它的時間 ISO；批次據此判斷同日已抓過就跳過 */
  asOf: string
  /** 實際送出的搜尋字串（除錯用） */
  query: string
  /** 由新到舊 */
  items: NewsItem[]
}

/** 進 prompt 的新聞上限：10 則已足夠呈現消息面，也控住 token */
export const NEWS_MAX_ITEMS = 10
/** 只保留近 14 天：太舊的標題對盤後解讀沒有資訊量 */
export const NEWS_SINCE_DAYS = 14

/**
 * 查詢字串一律是「名稱 代號」兩個詞。
 *
 * **只用名稱會抓到別的東西**（實測 2026-07-27）：`陽明` 回的全是陽明交通大學的校園新聞，
 * 與陽明海運（2609）無關；加上代號後 100 則全部命中該檔股票。
 * 台股名稱與機構 / 地名撞名的情況太常見，代號是唯一可靠的消歧依據。
 */
export function googleNewsRssUrl(name: string, ticker: string): string {
  const q = `${name} ${ticker}`.trim()
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`
}

/** 還原常見 XML entity（含十進位/十六進位數字型）。RSS 標題實測會出現 &amp; 與 &#39; */
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** 抽 <tag>…</tag> 的內文；CDATA 與純文字兩種形態都收，查無回 null */
function tagText(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  if (!m) return null
  let inner = m[1].trim()
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  if (cdata) inner = cdata[1].trim()
  return decodeXmlEntities(inner)
}

export function parseGoogleNewsRss(
  xml: string,
  opts?: { maxItems?: number; sinceDays?: number; now?: Date },
): NewsItem[] {
  const maxItems = opts?.maxItems ?? NEWS_MAX_ITEMS
  const sinceDays = opts?.sinceDays ?? NEWS_SINCE_DAYS
  const now = opts?.now ?? new Date()
  const cutoffMs = now.getTime() - sinceDays * 24 * 60 * 60 * 1000

  const items: NewsItem[] = []
  for (const m of String(xml ?? '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1]
    const title = tagText(block, 'title')
    if (!title) continue

    let publishedAt: string | null = null
    const pub = tagText(block, 'pubDate')
    if (pub) {
      const t = new Date(pub)
      publishedAt = Number.isNaN(t.getTime()) ? null : t.toISOString()
    }
    // 有時間且早於 cutoff 的丟棄；沒時間的保留（無從判斷，寧可給 AI 看）
    if (publishedAt && new Date(publishedAt).getTime() < cutoffMs) continue

    items.push({ title, source: tagText(block, 'source'), publishedAt })
  }

  // 由新到舊；沒時間的排最後
  items.sort((a, b) => {
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : -Infinity
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : -Infinity
    return tb - ta
  })
  return items.slice(0, maxItems)
}
