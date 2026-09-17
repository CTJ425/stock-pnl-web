/**
 * Per-user Discord holdings card settings client (Task 165 Phase 2).
 * Same safety rules as `src/services/discordWebhook.ts`: the server never returns the
 * webhook URL; never surface `error.message` from supabase-js. Spec §2.7.
 */
import { supabase } from './supabase'

export type HoldingsSendKind = 'daily' | 'preview' | 'test'

export interface HoldingsLastSend {
  kind: HoldingsSendKind
  ymd: string
  status: 'claimed' | 'sent' | 'skipped' | 'failed'
  reason: string | null
  at: string
}

export interface HoldingsPushStatus {
  configured: boolean
  last4: string | null
  enabled: boolean
  lastSend: HoldingsLastSend | null
}

export interface HoldingsSendResult {
  ok: boolean
  httpStatus: number | null
  reason?: string
}

interface HoldingsOpResponse {
  ok: boolean
  status: HoldingsPushStatus
  send?: HoldingsSendResult
  previewYmd?: string
  error?: string
}

/** Known error codes from the Edge function body that earn extra Chinese text. Spec §2.7. */
const ERROR_TEXT: Record<string, string> = {
  'not-configured': '尚未設定 Webhook',
  'invalid-url': '網址格式不正確',
  quota: '今日測試／預覽次數已達上限',
  'no-market-data': '找不到任何台股大盤資料',
  'no-holdings': '目前沒有持股',
  'bad-request': '請求格式錯誤',
}

/**
 * Never surfaces `error.message` from supabase-js: for a network-layer failure it can embed
 * the request URL. Only the HTTP status, when available via `error.context` (a Response), is
 * safe to report. Only a recognised `error` code from the JSON body adds text after the
 * status; anything else in the body is ignored, so no server text is ever echoed.
 */
async function holdingsOpFailed(error: unknown): Promise<never> {
  const ctx = (error as { context?: unknown })?.context
  if (!(ctx instanceof Response)) throw new Error('Discord 推播設定失敗')
  const status = ctx.status
  let code: string | undefined
  try {
    const body = (await ctx.clone().json()) as { error?: string }
    code = body?.error
  } catch {
    code = undefined
  }
  // Own-property check: a body code such as `constructor` must not resolve through the prototype.
  const text = typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_TEXT, code) ? ERROR_TEXT[code] : undefined
  throw new Error(text ? `Discord 推播設定失敗（HTTP ${status}：${text}）` : `Discord 推播設定失敗（HTTP ${status}）`)
}

async function finishHoldingsOp(pending: Promise<{ data: unknown; error: unknown }>): Promise<HoldingsOpResponse> {
  const { data, error } = await pending
  if (error) await holdingsOpFailed(error)
  return data as HoldingsOpResponse
}

/**
 * Each call site below spells out its own `timeout` literal rather than taking it as a
 * parameter — `src/services/invokeTimeout.test.ts` scans for a literal number after
 * `timeout:` in every `functions.invoke` call, so a passed-through variable would (rightly)
 * fail that structural check.
 */
async function invokeHoldingsOp(body: Record<string, unknown>): Promise<HoldingsOpResponse> {
  if (!supabase) throw new Error('本機模式無法設定 Discord 推播')
  return finishHoldingsOp(
    supabase.functions.invoke('stock-report', {
      body: { action: 'discord-holdings-settings', ...body },
      timeout: 45_000,
    }),
  )
}

export async function getHoldingsPush(): Promise<HoldingsPushStatus> {
  const res = await invokeHoldingsOp({ op: 'get' })
  return res.status
}

export async function saveHoldingsWebhook(url: string): Promise<HoldingsPushStatus> {
  const res = await invokeHoldingsOp({ op: 'set', url })
  return res.status
}

export async function clearHoldingsWebhook(): Promise<HoldingsPushStatus> {
  const res = await invokeHoldingsOp({ op: 'clear' })
  return res.status
}

export async function setHoldingsPushEnabled(enabled: boolean): Promise<HoldingsPushStatus> {
  const res = await invokeHoldingsOp({ op: 'enable', enabled })
  return res.status
}

export async function testHoldingsWebhook(): Promise<{ status: HoldingsPushStatus; send: HoldingsSendResult }> {
  const res = await invokeHoldingsOp({ op: 'test' })
  return { status: res.status, send: res.send as HoldingsSendResult }
}

/** Longer timeout than the other ops: quotes for every held ticker plus a post. */
export async function previewHoldings(): Promise<{ status: HoldingsPushStatus; send: HoldingsSendResult; previewYmd: string }> {
  if (!supabase) throw new Error('本機模式無法設定 Discord 推播')
  const res = await finishHoldingsOp(
    supabase.functions.invoke('stock-report', {
      body: { action: 'discord-holdings-settings', op: 'preview' },
      timeout: 90_000,
    }),
  )
  return { status: res.status, send: res.send as HoldingsSendResult, previewYmd: res.previewYmd as string }
}
