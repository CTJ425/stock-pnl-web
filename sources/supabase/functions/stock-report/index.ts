/**
 * Supabase Edge Function：stock-report（盤後籌碼報告產生器）
 *
 * 由伺服器端代抓 TWSE 盤後籌碼資料並產出報告 HTML 與結構化資料。
 * 共用 raw 檔快取（chip_raw_cache 資料表，見 sources/supabase/schema.sql）。
 * 部署方式（需安裝 Supabase CLI 並登入）：
 *   supabase functions deploy stock-report --no-verify-jwt
 *
 * 介面：
 *   POST { action: 'generate', market: 'TPE', ticker: string, name: string, holding?: HoldingContext }
 *     → { reportId, generatedAt, dataDate, data, html }
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  fetchJson,
  t86Url,
  MI_MARGN_URL,
  SBL_URL,
  extractInstitutional,
  extractMargin,
  extractBorrow,
  type T86ResponseShape,
} from './twChips.ts'
import {
  buildReport,
  tradingDateCandidates,
  type HoldingContext,
} from './report.ts'
import { reportBodyHtml } from './reportHtml.ts'

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由 Supabase 執行環境自動注入；
// service role 不受 RLS 限制，是 chip_raw_cache 唯一的讀寫途徑
const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

const TICKER_RE = /^[0-9A-Za-z]{2,8}$/

function t86Ok(r: T86ResponseShape): boolean {
  const data = r.data ?? r.tables?.[0]?.data
  return r.stat === 'OK' && Array.isArray(data) && data.length > 0
}

export function makeReportId(dateYmd: string, ticker: string): string {
  return `${dateYmd}_${ticker}_${crypto.randomUUID().slice(0, 8)}`
}

async function readCache<T>(ymd: string, dataset: string): Promise<T | null> {
  try {
    const { data, error } = await db
      .from('chip_raw_cache')
      .select('payload')
      .eq('ymd', ymd)
      .eq('dataset', dataset)
      .maybeSingle()
    if (error || !data?.payload) return null
    return data.payload as T
  } catch {
    return null
  }
}

async function writeCache(ymd: string, dataset: string, payload: unknown): Promise<void> {
  try {
    await db.from('chip_raw_cache').upsert({
      ymd,
      dataset,
      payload,
      updated_at: new Date().toISOString(),
    })
  } catch {
    // 快取寫入失敗不影響主流程
  }
}

/** 從候選交易日中找出第一個有 T86 資料的日期（優先讀 Postgres 日檔快取） */
async function resolveT86(
  candidates: string[],
): Promise<{ ymd: string; resp: T86ResponseShape } | null> {
  for (const ymd of candidates) {
    const cached = await readCache<T86ResponseShape>(ymd, 'T86')
    if (cached && t86Ok(cached)) {
      return { ymd, resp: cached }
    }
    let resp: T86ResponseShape
    try {
      resp = await fetchJson<T86ResponseShape>(t86Url(ymd))
    } catch {
      continue
    }
    if (t86Ok(resp)) {
      await writeCache(ymd, 'T86', resp)
      return { ymd, resp }
    }
    // 非交易日 / 尚未收盤：不快取空回應，試更早的候選
  }
  return null
}

/** 讀取「最新交易日」型的 whole-market 檔（無 date 參數），按解析日期快取於 Postgres */
async function readLatest<T>(
  ymd: string,
  dataset: string,
  url: string,
): Promise<T | null> {
  const cached = await readCache<T>(ymd, dataset)
  if (cached) return cached

  try {
    const data = await fetchJson<T>(url)
    await writeCache(ymd, dataset, data)
    return data
  } catch {
    return null
  }
}

interface GenerateReportRequestBody {
  action?: string
  market?: string
  ticker?: string
  name?: string
  holding?: HoldingContext | null
}

async function handleGenerate(body: GenerateReportRequestBody): Promise<Response> {
  if (body.market !== 'TPE') {
    return json({ error: '盤後籌碼報告僅支援台股（TPE）' }, 400)
  }
  const ticker = String(body.ticker ?? '').trim()
  if (!TICKER_RE.test(ticker)) {
    return json({ error: 'ticker 格式不正確' }, 400)
  }
  const name = String(body.name ?? '').trim().slice(0, 40)
  const holding = body.holding ?? null

  const notes: string[] = []
  const candidates = tradingDateCandidates(new Date())

  const t86 = await resolveT86(candidates)
  const dataYmd = t86?.ymd ?? candidates[1] // 無資料時退回昨日當標示
  const institutional = t86 ? extractInstitutional(t86.resp, ticker) : null
  if (!t86) notes.push('三大法人資料暫無（可能尚未收盤或逢假日）。')

  const marginRows = await readLatest<Record<string, string>[]>(
    dataYmd,
    'MI_MARGN',
    MI_MARGN_URL,
  )
  const margin = marginRows ? extractMargin(marginRows, ticker) : null
  if (!marginRows) notes.push('融資融券來源暫時無回應。')

  const sblRows = await readLatest<Parameters<typeof extractBorrow>[0]>(dataYmd, 'SBL', SBL_URL)
  const borrow = sblRows ? extractBorrow(sblRows, ticker) : null

  if (institutional === null && margin === null) {
    notes.push('此代號查無上市籌碼資料（可能為上櫃 / 興櫃，v1 暫不支援上櫃）。')
  }

  const data = buildReport({
    ticker,
    name,
    dataDateYmd: dataYmd,
    holding,
    institutional,
    margin,
    borrow,
    notes,
  })

  const reportId = makeReportId(dataYmd, ticker)
  const html = reportBodyHtml(data)

  return json({ reportId, generatedAt: data.generatedAt, dataDate: data.dataDate, data, html })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  let body: GenerateReportRequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (body.action === 'generate') {
    return handleGenerate(body)
  }

  return json({ error: 'Unknown action' }, 400)
})
