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
 *     → { reportId, generatedAt, dataDate, data, html }（即點即產，前端 fallback 用）
 *   POST { action: 'generate-all' }  header: x-cron-secret（盤後 pg_cron 觸發）
 *     → 產生全體持有台股的共用報告存入 Storage(reports bucket)，並清理超過 7 天的舊資料
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

type ResolvedT86 = { ymd: string; resp: T86ResponseShape } | null
type MarginRows = Record<string, string>[] | null
type SblRows = Parameters<typeof extractBorrow>[0] | null

/** 由已抓好的當日資料組出單一代號的報告（data + html）。holding 為 null 時省略持股概況區。 */
function assembleOne(opts: {
  ticker: string
  name: string
  holding: HoldingContext | null
  dataYmd: string
  t86: ResolvedT86
  marginRows: MarginRows
  sblRows: SblRows
}): { data: ReturnType<typeof buildReport>; html: string } {
  const { ticker, name, holding, dataYmd, t86, marginRows, sblRows } = opts
  const notes: string[] = []

  const institutional = t86 ? extractInstitutional(t86.resp, ticker) : null
  if (!t86) notes.push('三大法人資料暫無（可能尚未收盤或逢假日）。')

  const margin = marginRows ? extractMargin(marginRows, ticker) : null
  if (!marginRows) notes.push('融資融券來源暫時無回應。')

  const borrow = sblRows ? extractBorrow(sblRows, ticker) : null

  if (institutional === null && margin === null) {
    notes.push('此代號查無上市籌碼資料（可能為上櫃 / 興櫃，v1 暫不支援上櫃）。')
  }

  const data = buildReport({ ticker, name, dataDateYmd: dataYmd, holding, institutional, margin, borrow, notes })
  return { data, html: reportBodyHtml(data) }
}

/** 抓當日三檔全市場資料（T86 / 融資融券 / 借券）；一次抓、多檔共用（批次時只打一次外部 API） */
async function loadDaySources(): Promise<{
  dataYmd: string
  t86: ResolvedT86
  marginRows: MarginRows
  sblRows: SblRows
}> {
  const candidates = tradingDateCandidates(new Date())
  const t86 = await resolveT86(candidates)
  const dataYmd = t86?.ymd ?? candidates[1] // 無資料時退回昨日當標示
  const marginRows = await readLatest<Record<string, string>[]>(dataYmd, 'MI_MARGN', MI_MARGN_URL)
  const sblRows = await readLatest<Parameters<typeof extractBorrow>[0]>(dataYmd, 'SBL', SBL_URL)
  return { dataYmd, t86, marginRows, sblRows }
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

  const { dataYmd, t86, marginRows, sblRows } = await loadDaySources()
  const { data, html } = assembleOne({ ticker, name, holding, dataYmd, t86, marginRows, sblRows })

  const reportId = makeReportId(dataYmd, ticker)
  return json({ reportId, generatedAt: data.generatedAt, dataDate: data.dataDate, data, html })
}

// ---- 盤後批次：產生全體持有台股的共用報告存入 Storage(reports bucket)，保留最近 7 天 ----

const REPORTS_BUCKET = 'reports'
const RETAIN_DAYS = 7

/** generate-all 會寫 Storage，端點為公開(--no-verify-jwt)，故要求 x-cron-secret 與環境變數相符 */
function assertCronSecret(req: Request): Response | null {
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  const got = req.headers.get('x-cron-secret') ?? ''
  if (!expected || got !== expected) return json({ error: 'Unauthorized' }, 401)
  return null
}

function ymdMinusDays(ymd: string, days: number): string {
  const dt = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)))
  dt.setUTCDate(dt.getUTCDate() - days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`
}

function dashYmd(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

/** 全體使用者「淨持有（買 − 賣 > 0）」的台股代號（service role 掃 transactions；跨使用者去重） */
async function heldTwTickers(): Promise<Array<{ ticker: string; name: string }>> {
  const { data, error } = await db
    .from('transactions')
    .select('ticker, name, tx_type, qty')
    .eq('market', 'TPE')
  if (error || !data) return []
  const acc = new Map<string, { net: number; name: string }>()
  for (const row of data) {
    const ticker = String(row.ticker ?? '').trim()
    if (!TICKER_RE.test(ticker)) continue
    const qty = Number(row.qty) || 0
    const delta = row.tx_type === 'BUY' ? qty : -qty
    const prev = acc.get(ticker) ?? { net: 0, name: '' }
    acc.set(ticker, { net: prev.net + delta, name: String(row.name ?? '').trim() || prev.name })
  }
  return [...acc.entries()]
    .filter(([, v]) => v.net > 0)
    .map(([ticker, v]) => ({ ticker, name: v.name }))
}

async function uploadJson(path: string, payload: unknown): Promise<boolean> {
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const { error } = await db.storage.from(REPORTS_BUCKET).upload(path, blob, {
      upsert: true,
      contentType: 'application/json; charset=utf-8',
    })
    return !error
  } catch {
    return false
  }
}

/** 刪除 reports bucket 中資料日早於 cutoff 的整個 {ymd}/ 目錄 */
async function pruneStorage(cutoffYmd: string): Promise<void> {
  try {
    const { data: entries } = await db.storage.from(REPORTS_BUCKET).list('', { limit: 1000 })
    for (const e of entries ?? []) {
      if (!/^\d{8}$/.test(e.name) || e.name >= cutoffYmd) continue
      const { data: files } = await db.storage.from(REPORTS_BUCKET).list(e.name, { limit: 1000 })
      const paths = (files ?? []).map((f) => `${e.name}/${f.name}`)
      if (paths.length > 0) await db.storage.from(REPORTS_BUCKET).remove(paths)
    }
  } catch {
    // 清理失敗不影響主流程
  }
}

async function pruneChipCache(cutoffYmd: string): Promise<void> {
  try {
    await db.from('chip_raw_cache').delete().lt('ymd', cutoffYmd)
  } catch {
    // 清理失敗不影響主流程
  }
}

async function handleGenerateAll(): Promise<Response> {
  const { dataYmd, t86, marginRows, sblRows } = await loadDaySources()
  const tickers = await heldTwTickers()

  let generated = 0
  for (const { ticker, name } of tickers) {
    const { data, html } = assembleOne({ ticker, name, holding: null, dataYmd, t86, marginRows, sblRows })
    const okUp = await uploadJson(`${dataYmd}/${ticker}.json`, {
      ticker,
      dataDate: data.dataDate,
      generatedAt: data.generatedAt,
      data,
      html,
    })
    if (okUp) generated++
  }

  // 讓前端知道「最近一份」是哪個交易日，免在前端重算交易日
  await uploadJson('manifest.json', {
    ymd: dataYmd,
    dataDate: dashYmd(dataYmd),
    generatedAt: new Date().toISOString(),
  })

  // 只保留最近 RETAIN_DAYS 天：清掉更舊的報告與原始檔快取
  const cutoff = ymdMinusDays(dataYmd, RETAIN_DAYS)
  await pruneStorage(cutoff)
  await pruneChipCache(cutoff)

  return json({ ok: true, ymd: dataYmd, generated, total: tickers.length })
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

  if (body.action === 'generate-all') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleGenerateAll()
  }

  return json({ error: 'Unknown action' }, 400)
})
