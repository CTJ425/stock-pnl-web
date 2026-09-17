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
  error?: string
}

/**
 * Never surfaces `error.message` from supabase-js: for a network-layer failure it can
 * embed the request URL (and thus the webhook token). Only the HTTP status, when
 * available via `error.context` (a Response), is safe to report — see spec §2.6.
 */
function discordOpFailed(error: unknown): never {
  const ctx = (error as { context?: unknown })?.context
  const status = ctx instanceof Response ? ctx.status : null
  throw new Error(status ? `Discord 設定失敗（HTTP ${status}）` : 'Discord 設定失敗')
}

async function invokeWebhookOp(body: Record<string, unknown>): Promise<WebhookOpResponse> {
  if (!supabase) throw new Error('本機模式無法設定 Discord')
  const { data, error } = await supabase.functions.invoke('stock-report', {
    body: { action: 'discord-webhook', ...body },
    timeout: 45_000,
  })
  if (error) discordOpFailed(error)
  return data as WebhookOpResponse
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
