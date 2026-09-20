/**
 * Admin console client for the per-account Discord settings (Task 165 Phase 2 step 2d,
 * spec discord-admin-accounts.md §3.7). Same safety rules as `discordWebhook.ts`: the
 * server never returns a webhook URL; never surface `error.message` from supabase-js.
 */
import { supabase } from './supabase'

export interface ScheduleView {
  brief: string | null
  full: string | null
  holdingsAligned: boolean
}

export interface DiscordAccountLastSend {
  kind: 'daily' | 'preview' | 'test' | 'market'
  ymd: string
  status: 'claimed' | 'sent' | 'skipped' | 'failed'
  reason: string | null
  at: string
}

export interface DiscordAccountRow {
  userId: string
  email: string | null
  market: { custom: boolean; last4: string | null; enabled: boolean }
  holdings: { configured: boolean; last4: string | null; enabled: boolean }
  lastSend: DiscordAccountLastSend | null
}

export interface DiscordAccountsSendResult {
  ok: boolean
  httpStatus: number | null
  reason?: string
}

export interface DiscordAccountsSnapshot {
  schedule: ScheduleView
  accounts: DiscordAccountRow[]
  send?: DiscordAccountsSendResult
  previewYmd?: string
  missingQuotes?: number
}

interface DiscordAccountsOpResponse extends DiscordAccountsSnapshot {
  ok: boolean
  error?: string
}

/** Known error codes from the Edge function body that earn extra Chinese text. Spec §3.7/§9.1. */
const ERROR_TEXT: Record<string, string> = {
  'invalid-time': '時間不在可選範圍',
  'unknown-user': '找不到這個帳號',
  quota: '今天的手動發送次數已用完',
  'invalid-url': '網址格式不正確',
  'not-configured': '尚未設定 Webhook',
  'no-holdings': '這個帳號目前沒有持股',
  'no-market-data': '找不到任何台股大盤資料',
  // The Edge Function answers this when it predates the `discord-accounts` action (not deployed yet).
  'Unknown action': '後端尚未部署這個功能',
}

/**
 * Never surfaces `error.message` from supabase-js: for a network-layer failure it can
 * embed the request URL (and thus the webhook token). Only the HTTP status, when
 * available via `error.context` (a Response), is safe to report. Only a recognised
 * `error` code from the JSON body adds text after the status; anything else in the body
 * is ignored, so no server text is ever echoed.
 */
async function discordAccountsOpFailed(error: unknown): Promise<never> {
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

function stripOk(res: DiscordAccountsOpResponse): DiscordAccountsSnapshot {
  const { schedule, accounts, send, previewYmd, missingQuotes } = res
  const out: DiscordAccountsSnapshot = { schedule, accounts }
  if (send !== undefined) out.send = send
  if (previewYmd !== undefined) out.previewYmd = previewYmd
  if (missingQuotes !== undefined) out.missingQuotes = missingQuotes
  return out
}

/**
 * Each call site below spells out its own `timeout` literal rather than taking it as a
 * parameter — `src/services/invokeTimeout.test.ts` scans for a literal number after
 * `timeout:` in every `functions.invoke` call, so a passed-through variable would (rightly)
 * fail that structural check.
 */
async function invokeDiscordAccountsOp(body: Record<string, unknown>): Promise<DiscordAccountsSnapshot> {
  if (!supabase) throw new Error('本機模式無法設定 Discord')
  const { data, error } = await supabase.functions.invoke('stock-report', {
    body: { action: 'discord-accounts', ...body },
    timeout: 45_000,
  })
  if (error) await discordAccountsOpFailed(error)
  return stripOk(data as DiscordAccountsOpResponse)
}

export function getDiscordAccounts(): Promise<DiscordAccountsSnapshot> {
  return invokeDiscordAccountsOp({ op: 'list' })
}

export function saveDiscordSchedule(brief: string, full: string): Promise<DiscordAccountsSnapshot> {
  return invokeDiscordAccountsOp({ op: 'set-schedule', brief, full })
}

export function saveMarketWebhook(userId: string, url: string): Promise<DiscordAccountsSnapshot> {
  return invokeDiscordAccountsOp({ op: 'set-market', userId, url })
}

export function clearMarketWebhook(userId: string): Promise<DiscordAccountsSnapshot> {
  return invokeDiscordAccountsOp({ op: 'clear-market', userId })
}

export function testMarketWebhook(userId: string): Promise<DiscordAccountsSnapshot> {
  return invokeDiscordAccountsOp({ op: 'test-market', userId })
}

export function toggleMarketEnabled(userId: string, enabled: boolean): Promise<DiscordAccountsSnapshot> {
  return invokeDiscordAccountsOp({ op: 'toggle-market', userId, enabled })
}

export function saveHoldingsWebhook(userId: string, url: string): Promise<DiscordAccountsSnapshot> {
  return invokeDiscordAccountsOp({ op: 'holdings-set', userId, url })
}

export function clearHoldingsWebhook(userId: string): Promise<DiscordAccountsSnapshot> {
  return invokeDiscordAccountsOp({ op: 'holdings-clear', userId })
}

export function setHoldingsEnabled(userId: string, enabled: boolean): Promise<DiscordAccountsSnapshot> {
  return invokeDiscordAccountsOp({ op: 'holdings-enable', userId, enabled })
}

export function testHoldingsWebhook(userId: string): Promise<DiscordAccountsSnapshot> {
  return invokeDiscordAccountsOp({ op: 'holdings-test', userId })
}

/**
 * Sends the real holdings card (labelled as a preview in the UI). Longer timeout than every
 * other op: it renders the actual report, not just a fixed test payload. Spec §9.1/§9.2.
 */
export async function previewHoldingsReport(userId: string): Promise<DiscordAccountsSnapshot> {
  if (!supabase) throw new Error('本機模式無法設定 Discord')
  const { data, error } = await supabase.functions.invoke('stock-report', {
    body: { action: 'discord-accounts', op: 'holdings-preview', userId },
    timeout: 90_000,
  })
  if (error) await discordAccountsOpFailed(error)
  return stripOk(data as DiscordAccountsOpResponse)
}
