/**
 * Admin console client for the Discord daily summary webhook (Task 165).
 * The server never returns the webhook URL; only `last4` reaches the browser.
 */
import { supabase } from './supabase'

export type DiscordSendEdition = 'brief' | 'full' | 'test'
export type DiscordSendStatus = 'claimed' | 'sent' | 'skipped' | 'failed'

export interface DiscordSendLogRow {
  taipeiYmd: string
  edition: DiscordSendEdition
  status: DiscordSendStatus
  httpStatus: number | null
  reason: string | null
  at: string
}

export interface DiscordWebhookStatus {
  configured: boolean
  last4: string | null
  updatedAt: string | null
  recent: DiscordSendLogRow[]
}

export interface DiscordTestResult {
  ok: boolean
  httpStatus: number | null
  reason?: string
}

interface WebhookOpResponse {
  ok: boolean
  status: DiscordWebhookStatus
  test?: DiscordTestResult
  preview?: DiscordPreviewInfo
  error?: string
}

/** Known error codes from the Edge function body that earn extra Chinese text. Spec §2.7. */
const ERROR_TEXT: Record<string, string> = {
  'not-configured': '尚未設定 Webhook',
  'invalid-url': '網址格式不正確',
  'no-market-data': '找不到任何台股大盤資料',
  'bad-request': '請求格式錯誤',
}

/**
 * Never surfaces `error.message` from supabase-js: for a network-layer failure it can
 * embed the request URL (and thus the webhook token). Only the HTTP status, when
 * available via `error.context` (a Response), is safe to report — see spec §2.6/2.7.
 * Only a recognised `error` code from the JSON body adds text after the status; anything
 * else in the body is ignored, so no server text is ever echoed.
 */
async function discordOpFailed(error: unknown): Promise<never> {
  const ctx = (error as { context?: unknown })?.context
  if (!(ctx instanceof Response)) throw new Error('Discord 設定失敗')
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
  throw new Error(text ? `Discord 設定失敗（HTTP ${status}：${text}）` : `Discord 設定失敗（HTTP ${status}）`)
}

/**
 * Note: each call site below spells out its own `timeout` literal rather than taking it
 * as a parameter — `src/services/invokeTimeout.test.ts` scans for a literal number after
 * `timeout:` in every `functions.invoke` call, so a passed-through variable would (rightly)
 * fail that structural check.
 */
async function finishWebhookOp(pending: Promise<{ data: unknown; error: unknown }>): Promise<WebhookOpResponse> {
  const { data, error } = await pending
  if (error) await discordOpFailed(error)
  return data as WebhookOpResponse
}

async function invokeWebhookOp(body: Record<string, unknown>): Promise<WebhookOpResponse> {
  if (!supabase) throw new Error('本機模式無法設定 Discord')
  return finishWebhookOp(
    supabase.functions.invoke('stock-report', {
      body: { action: 'discord-webhook', ...body },
      timeout: 45_000,
    }),
  )
}

export async function getDiscordWebhookStatus(): Promise<DiscordWebhookStatus> {
  const res = await invokeWebhookOp({ op: 'get' })
  return res.status
}

export async function saveDiscordWebhook(url: string): Promise<DiscordWebhookStatus> {
  const res = await invokeWebhookOp({ op: 'set', url })
  return res.status
}

export async function clearDiscordWebhook(): Promise<DiscordWebhookStatus> {
  const res = await invokeWebhookOp({ op: 'clear' })
  return res.status
}

export async function testDiscordWebhook(): Promise<{ status: DiscordWebhookStatus; test: DiscordTestResult }> {
  const res = await invokeWebhookOp({ op: 'test' })
  return { status: res.status, test: res.test as DiscordTestResult }
}

export interface DiscordPreviewInfo {
  edition: 'brief' | 'full'
  /** 'YYYY-MM-DD' of the market day the preview was built from */
  marketDate: string
}

/**
 * Sends the real brief/full summary content right now, labelled 【預覽】. Spec §2.7.
 * Longer timeout than the other ops: eight index fetches plus a post.
 */
export async function previewDiscordSummary(
  edition: 'brief' | 'full',
): Promise<{ status: DiscordWebhookStatus; test: DiscordTestResult; preview: DiscordPreviewInfo }> {
  if (!supabase) throw new Error('本機模式無法設定 Discord')
  const res = await finishWebhookOp(
    supabase.functions.invoke('stock-report', {
      body: { action: 'discord-webhook', op: 'preview', edition },
      timeout: 60_000,
    }),
  )
  return { status: res.status, test: res.test as DiscordTestResult, preview: res.preview as DiscordPreviewInfo }
}
