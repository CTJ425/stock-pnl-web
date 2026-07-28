/**
 * 個股新聞標題（AI 分析的消息面）：讀取盤後排程預產、存於公開 `reports` bucket 的
 * `news/{ticker}.json`。只服務 AI 分析分頁，v1 不做新聞列表 UI。
 *
 * 沒有 fallback，理由同 dailyProxy；查無檔案時 AI prompt 會帶「消息面缺料」文案，
 * 解讀功能照常運作、不阻斷。
 *
 * 此檔的型別是**網路介面契約**，須與 sources/supabase/functions/stock-report/twNews.ts
 * 的 NewsFile 對齊。
 */
import { downloadReportsJson } from './reportsBucket'

export interface NewsItem {
  title: string
  source: string | null
  /** ISO 時間；可能為 null（RSS 未附時間） */
  publishedAt: string | null
}

export interface NewsData {
  ticker: string
  /** 批次抓取時間 ISO */
  asOf: string
  /** 由新到舊 */
  items: NewsItem[]
}

/**
 * 前端認得的**最低**新聞結構版本。
 * 必須是「>=」而不是「===」，理由同 dailyProxy（0.4.0 事故）。
 */
export const MIN_NEWS_SCHEMA = 1

interface StoredNews {
  schema?: number
  ticker?: string
  asOf?: string
  items?: unknown
}

function normalizeItem(v: unknown): NewsItem | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.title !== 'string' || !o.title.trim()) return null
  return {
    title: o.title,
    source: typeof o.source === 'string' && o.source ? o.source : null,
    publishedAt: typeof o.publishedAt === 'string' && o.publishedAt ? o.publishedAt : null,
  }
}

function isSupported(d: unknown): d is StoredNews {
  if (!d || typeof d !== 'object') return false
  const f = d as StoredNews
  return typeof f.schema === 'number' && f.schema >= MIN_NEWS_SCHEMA && Array.isArray(f.items)
}

/** 讀某檔的近期新聞標題；查無 / 格式不符 / 無有效項目回 null */
export async function fetchNews(ticker: string): Promise<NewsData | null> {
  const stored = await downloadReportsJson<StoredNews>(`news/${ticker}.json`)
  if (!isSupported(stored)) return null

  const items = (stored.items as unknown[])
    .map(normalizeItem)
    .filter((i): i is NewsItem => i !== null)
  if (items.length === 0) return null

  return {
    ticker: typeof stored.ticker === 'string' ? stored.ticker : ticker,
    asOf: typeof stored.asOf === 'string' ? stored.asOf : '',
    items,
  }
}
