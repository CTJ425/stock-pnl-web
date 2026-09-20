/**
 * Task 165 step 2e — the signed-in account editing its own two Discord webhooks.
 * Spec: docs/agent/specs/discord-user-self-service.md §5.3, §5b.2 and §7.
 *
 * The security invariants (§7) live entirely in `index.ts`'s `assertUser` call: this module
 * takes `userId` as a plain argument and never reads it from `input`, so it cannot be misused
 * to touch another account's row. Holdings ops delegate to `runHoldingsSettingsOp` (§5b.3);
 * this file only adds the 經濟快報 half.
 */
import { isDiscordWebhookUrl, webhookLast4 } from './discordUrl.ts'
import { buildTestPayload } from './discordSummary.ts'
import {
  MANUAL_SENDS_PER_DAY,
  runHoldingsSettingsOp,
  type HoldingsOutcome,
  type HoldingsSettingsDeps,
  type HoldingsSettingsResult,
  type HoldingsSettingsStatus,
} from './holdingsRun.ts'
import { dashDate, taipeiYmd } from './report.ts'

export interface MySettingsDeps extends HoldingsSettingsDeps {
  readMarket: (userId: string) => Promise<{ enabled: boolean; webhookUrl: string | null }>
  saveMarketWebhook: (userId: string, url: string | null) => Promise<void>
  setMarketEnabled: (userId: string, enabled: boolean) => Promise<void>
  finishMarket: (userId: string, ymd: string, outcome: HoldingsOutcome) => Promise<void>
  // Same reader the admin webhook path uses (`WebhookAdminDeps.readWebhook`) — spec Revision 1 R5.
  readWebhook: () => Promise<{ url: string; updatedAt: string } | null>
}

export interface MySettingsStatus {
  global: { configured: boolean; last4: string | null }
  market: { enabled: boolean; configured: boolean; last4: string | null }
  holdings: HoldingsSettingsStatus
}

export type MySettingsResult =
  | { ok: true; status: MySettingsStatus; send?: import('./discordWebhook.ts').DiscordSendResult; previewYmd?: string; missingQuotes?: number }
  | { ok: false; error: 'bad-request' | 'invalid-url' | 'not-configured' | 'quota' | 'no-market-data' | 'no-holdings' }

const HOLDINGS_OP: Record<string, 'set' | 'clear' | 'enable' | 'test' | 'preview'> = {
  'set-holdings': 'set',
  'clear-holdings': 'clear',
  'toggle-holdings': 'enable',
  'test-holdings': 'test',
  'preview-holdings': 'preview',
}

async function marketStatus(deps: MySettingsDeps, userId: string): Promise<MySettingsStatus['market']> {
  const row = await deps.readMarket(userId)
  return {
    enabled: row.enabled,
    configured: row.webhookUrl != null,
    last4: row.webhookUrl != null ? webhookLast4(row.webhookUrl) : null,
  }
}

async function globalStatus(deps: MySettingsDeps): Promise<MySettingsStatus['global']> {
  const row = await deps.readWebhook()
  return { configured: row != null, last4: row != null ? webhookLast4(row.url) : null }
}

async function holdingsStatus(deps: MySettingsDeps, userId: string): Promise<HoldingsSettingsStatus> {
  // 'get' always returns ok: true (see runHoldingsSettingsOp).
  const result = (await runHoldingsSettingsOp(deps, userId, { op: 'get' })) as { ok: true; status: HoldingsSettingsStatus }
  return result.status
}

async function fullStatus(deps: MySettingsDeps, userId: string): Promise<MySettingsStatus> {
  const [global, market, holdings] = await Promise.all([
    globalStatus(deps),
    marketStatus(deps, userId),
    holdingsStatus(deps, userId),
  ])
  return { global, market, holdings }
}

/** `input` is the untrusted request body (minus `action`); `userId` comes only from the verified JWT. */
export async function runMySettingsOp(deps: MySettingsDeps, userId: string, input: unknown): Promise<MySettingsResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'bad-request' }
  const op = (input as { op?: unknown }).op

  if (op === 'get') {
    return { ok: true, status: await fullStatus(deps, userId) }
  }

  if (op === 'set-market') {
    const url = (input as { url?: unknown }).url
    if (typeof url !== 'string' || !isDiscordWebhookUrl(url)) return { ok: false, error: 'invalid-url' }
    await deps.saveMarketWebhook(userId, url.trim())
    // Storing a URL is the affirmative act: it switches 經濟快報 on, so saving is never a dead end.
    await deps.setMarketEnabled(userId, true)
    return { ok: true, status: await fullStatus(deps, userId) }
  }

  if (op === 'clear-market') {
    // Safe order (spec §5b.7): disable first, so a crash mid-write leaves (enabled false, URL
    // set) — paused, harmless — never (enabled true, URL null).
    await deps.setMarketEnabled(userId, false)
    await deps.saveMarketWebhook(userId, null)
    return { ok: true, status: await fullStatus(deps, userId) }
  }

  if (op === 'toggle-market') {
    const enabled = (input as { enabled?: unknown }).enabled
    if (typeof enabled !== 'boolean') return { ok: false, error: 'bad-request' }
    if (enabled) {
      const row = await deps.readMarket(userId)
      if (!row.webhookUrl) return { ok: false, error: 'not-configured' }
    }
    await deps.setMarketEnabled(userId, enabled)
    return { ok: true, status: await fullStatus(deps, userId) }
  }

  if (op === 'test-market') {
    const row = await deps.readMarket(userId)
    if (!row.webhookUrl) return { ok: false, error: 'not-configured' }
    const ymd = dashDate(taipeiYmd(deps.now()))
    const count = await deps.countManualToday(userId, ymd)
    if (count >= MANUAL_SENDS_PER_DAY) return { ok: false, error: 'quota' }

    const result = await deps.post(row.webhookUrl, buildTestPayload(deps.now().toISOString()))
    const outcome: HoldingsOutcome = result.ok
      ? { kind: 'sent', httpStatus: result.httpStatus }
      : { kind: 'failed', httpStatus: result.httpStatus, reason: result.reason }
    await deps.finishMarket(userId, ymd, outcome)
    return { ok: true, status: await fullStatus(deps, userId), send: result }
  }

  if (typeof op === 'string' && op in HOLDINGS_OP) {
    const innerOp = HOLDINGS_OP[op]
    const innerInput: Record<string, unknown> = { op: innerOp }
    if (op === 'set-holdings') innerInput.url = (input as { url?: unknown }).url
    if (op === 'toggle-holdings') innerInput.enabled = (input as { enabled?: unknown }).enabled

    const result: HoldingsSettingsResult = await runHoldingsSettingsOp(deps, userId, innerInput)
    if (!result.ok) return { ok: false, error: result.error }
    const [global, market] = await Promise.all([globalStatus(deps), marketStatus(deps, userId)])
    return {
      ok: true,
      status: { global, market, holdings: result.status },
      send: result.send,
      previewYmd: result.previewYmd,
      missingQuotes: result.missingQuotes,
    }
  }

  return { ok: false, error: 'bad-request' }
}
