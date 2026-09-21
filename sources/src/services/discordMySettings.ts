/**
 * Self-service client for the signed-in account's own Discord webhooks (Task 165 step 2e,
 * spec discord-user-self-service.md §5.3/§6.1). Same safety rules as `discordAccounts.ts`:
 * the server never returns a webhook URL; never surface `error.message` from supabase-js.
 *
 * Every op is scoped to the caller by the Edge Function's `assertUser` — this client never
 * sends a `userId`, and never sends a webhook URL except on `set-market` / `set-holdings`
 * (spec §7).
 */
import { supabase } from './supabase'
import type { MySettingsStatus } from '../../supabase/functions/stock-report/discordMySettings'

/**
 * The wire shape, taken from the Edge Function itself rather than hand-copied (spec §5b.2).
 * A hand-copy is how this client once read a flat `{ marketLast4, ... }` the server never sent:
 * every field came back `undefined`, and the buttons D6 keeps disabled went live. `import type`
 * is erased at build time, so this costs the bundle nothing and makes the seam a compile error.
 */
export type DiscordMySettingsStatus = MySettingsStatus

export interface DiscordMySettingsSendResult {
  ok: boolean
  httpStatus: number | null
  reason?: string
}

export interface DiscordMySettingsResult {
  status: DiscordMySettingsStatus
  send?: DiscordMySettingsSendResult
  previewYmd?: string
  missingQuotes?: number
}

interface DiscordMySettingsOpResponse extends DiscordMySettingsResult {
  ok: boolean
  error?: string
}

/** Known error codes from the Edge function body that earn extra Chinese text. Spec §5.3/§7. */
const ERROR_TEXT: Record<string, string> = {
  quota: '今天的手動發送次數已用完',
  'invalid-url': '網址格式不正確',
  'not-configured': '尚未設定 Webhook',
  'no-holdings': '這個帳號目前沒有持股',
  'no-market-data': '找不到任何台股大盤資料',
  // The Edge Function answers this when it predates the `discord-my-settings` action (not deployed yet).
  'Unknown action': '後端尚未部署這個功能',
}

/**
 * Never surfaces `error.message` from supabase-js: for a network-layer failure it can embed
 * the request URL. Only the HTTP status, when available via `error.context` (a Response), is
 * safe to report. Only a recognised `error` code from the JSON body adds text after the
 * status; anything else in the body is ignored.
 */
async function discordMySettingsOpFailed(error: unknown): Promise<never> {
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

function stripOk(res: DiscordMySettingsOpResponse): DiscordMySettingsResult {
  const { status, send, previewYmd, missingQuotes } = res
  const out: DiscordMySettingsResult = { status }
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
async function invokeDiscordMySettingsOp(body: Record<string, unknown>): Promise<DiscordMySettingsResult> {
  if (!supabase) throw new Error('本機模式無法設定 Discord')
  const { data, error } = await supabase.functions.invoke('stock-report', {
    body: { action: 'discord-my-settings', ...body },
    timeout: 45_000,
  })
  if (error) await discordMySettingsOpFailed(error)
  return stripOk(data as DiscordMySettingsOpResponse)
}

export function getDiscordMySettings(): Promise<DiscordMySettingsResult> {
  return invokeDiscordMySettingsOp({ op: 'get' })
}

export function saveMyMarketWebhook(url: string): Promise<DiscordMySettingsResult> {
  return invokeDiscordMySettingsOp({ op: 'set-market', url })
}

export function clearMyMarketWebhook(): Promise<DiscordMySettingsResult> {
  return invokeDiscordMySettingsOp({ op: 'clear-market' })
}

export function toggleMyMarketEnabled(enabled: boolean): Promise<DiscordMySettingsResult> {
  return invokeDiscordMySettingsOp({ op: 'toggle-market', enabled })
}

export function testMyMarketWebhook(): Promise<DiscordMySettingsResult> {
  return invokeDiscordMySettingsOp({ op: 'test-market' })
}

export function saveMyHoldingsWebhook(url: string): Promise<DiscordMySettingsResult> {
  return invokeDiscordMySettingsOp({ op: 'set-holdings', url })
}

export function clearMyHoldingsWebhook(): Promise<DiscordMySettingsResult> {
  return invokeDiscordMySettingsOp({ op: 'clear-holdings' })
}

export function toggleMyHoldingsEnabled(enabled: boolean): Promise<DiscordMySettingsResult> {
  return invokeDiscordMySettingsOp({ op: 'toggle-holdings', enabled })
}

export function testMyHoldingsWebhook(): Promise<DiscordMySettingsResult> {
  return invokeDiscordMySettingsOp({ op: 'test-holdings' })
}

/**
 * Task 165 step 2f: the three per-account send times, one op, all three at once — `null` =
 * inherit the admin's schedule (spec §5.4). The server re-validates every non-null value against
 * the same `SCHEDULE_OPTIONS` window the admin path uses; the browser's choice is never trusted.
 */
export function saveMyTimes(times: {
  marketBriefTime: string | null
  marketFullTime: string | null
  holdingsTime: string | null
}): Promise<DiscordMySettingsResult> {
  return invokeDiscordMySettingsOp({ op: 'set-times', ...times })
}

/**
 * Sends the real holdings card (labelled as a preview in the UI). Longer timeout than every
 * other op: it renders the actual report, not just a fixed test payload. Mirrors
 * `discordAccounts.ts`'s `previewHoldingsReport`.
 */
export async function previewMyHoldingsReport(): Promise<DiscordMySettingsResult> {
  if (!supabase) throw new Error('本機模式無法設定 Discord')
  const { data, error } = await supabase.functions.invoke('stock-report', {
    body: { action: 'discord-my-settings', op: 'preview-holdings' },
    timeout: 90_000,
  })
  if (error) await discordMySettingsOpFailed(error)
  return stripOk(data as DiscordMySettingsOpResponse)
}

/**
 * Sends the real 經濟快報 edition (labelled as a preview in the UI) to this account's own
 * channel (Task 165 step 2h, spec discord-market-preview.md §7). Longer timeout than every
 * other op, mirroring `previewMyHoldingsReport`: it renders the actual report, not just a
 * fixed test payload.
 */
export async function previewMyMarketSummary(edition: 'brief' | 'full'): Promise<DiscordMySettingsResult> {
  if (!supabase) throw new Error('本機模式無法設定 Discord')
  const { data, error } = await supabase.functions.invoke('stock-report', {
    body: { action: 'discord-my-settings', op: 'preview-market', edition },
    timeout: 90_000,
  })
  if (error) await discordMySettingsOpFailed(error)
  return stripOk(data as DiscordMySettingsOpResponse)
}
