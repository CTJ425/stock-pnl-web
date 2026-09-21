/**
 * Task 165 step 2e — the signed-in account editing its own two Discord webhooks.
 * Spec: docs/agent/specs/discord-user-self-service.md §5.3, §5b.2 and §7.
 * Task 165 step 2f adds `set-times` (spec docs/agent/specs/discord-account-schedule.md §5.4):
 * the same three per-account send times `accountTick.ts`'s `dueAt` reads.
 *
 * The security invariants (§7) live entirely in `index.ts`'s `assertUser` call: this module
 * takes `userId` as a plain argument and never reads it from `input`, so it cannot be misused
 * to touch another account's row. Holdings ops delegate to `runHoldingsSettingsOp` (§5b.3);
 * this file only adds the 經濟快報 half.
 */
import { isDiscordWebhookUrl, webhookLast4 } from './discordUrl.ts'
import { buildTestPayload } from './discordSummary.ts'
import { isValidScheduleTime, scheduleFromJobs, type ScheduleView } from './discordSchedule.ts'
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
  readMarket: (userId: string) => Promise<{
    enabled: boolean
    webhookUrl: string | null
    /** Optional so fixtures built before step 2f still type-check; missing reads as "inherit". */
    marketBriefTime?: string | null
    marketFullTime?: string | null
  }>
  saveMarketWebhook: (userId: string, url: string | null) => Promise<void>
  setMarketEnabled: (userId: string, enabled: boolean) => Promise<void>
  finishMarket: (userId: string, ymd: string, outcome: HoldingsOutcome) => Promise<void>
  // Same reader the admin webhook path uses (`WebhookAdminDeps.readWebhook`) — spec Revision 1 R5.
  readWebhook: () => Promise<{ url: string; updatedAt: string } | null>
  /** Task 165 step 2f: writes all three per-account send times at once; `null` = inherit. */
  saveTimes: (
    userId: string,
    times: { marketBriefTime: string | null; marketFullTime: string | null; holdingsTime: string | null },
  ) => Promise<void>
  /** Same reader the admin schedule path uses (`DiscordAccountsDeps.readScheduleJobs`) — one
   * window definition, one schedule reader. */
  readScheduleJobs: () => Promise<Array<{ jobname: string; schedule: string }>>
}

export interface MySettingsStatus {
  global: { configured: boolean; last4: string | null }
  /** `null` on a time means "inherit `globalSchedule`". The fields are required, not optional:
   * an absent time would silently read as inherit and hide a serialisation mistake. */
  market: { enabled: boolean; configured: boolean; last4: string | null; briefTime: string | null; fullTime: string | null }
  holdings: HoldingsSettingsStatus & { time: string | null }
  /** The admin's schedule — the default an inheriting account's time resolves to (spec §5.4). */
  globalSchedule: ScheduleView
}

export type MySettingsResult =
  | { ok: true; status: MySettingsStatus; send?: import('./discordWebhook.ts').DiscordSendResult; previewYmd?: string; missingQuotes?: number }
  | { ok: false; error: 'bad-request' | 'invalid-url' | 'invalid-time' | 'not-configured' | 'quota' | 'no-market-data' | 'no-holdings' }

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
    briefTime: row.marketBriefTime ?? null,
    fullTime: row.marketFullTime ?? null,
  }
}

async function globalStatus(deps: MySettingsDeps): Promise<MySettingsStatus['global']> {
  const row = await deps.readWebhook()
  return { configured: row != null, last4: row != null ? webhookLast4(row.url) : null }
}

/** `readSettings`'s `holdingsTime` — read alongside (not through) `runHoldingsSettingsOp`,
 * which does not know about step 2f's time columns. */
async function holdingsTimeOf(deps: MySettingsDeps, userId: string): Promise<string | null> {
  const row = await deps.readSettings(userId)
  return row?.holdingsTime ?? null
}

async function holdingsStatus(deps: MySettingsDeps, userId: string): Promise<MySettingsStatus['holdings']> {
  // 'get' always returns ok: true (see runHoldingsSettingsOp).
  const [result, time] = await Promise.all([
    runHoldingsSettingsOp(deps, userId, { op: 'get' }) as Promise<{ ok: true; status: HoldingsSettingsStatus }>,
    holdingsTimeOf(deps, userId),
  ])
  return { ...result.status, time }
}

async function globalScheduleStatus(deps: MySettingsDeps): Promise<ScheduleView> {
  return scheduleFromJobs(await deps.readScheduleJobs())
}

async function fullStatus(deps: MySettingsDeps, userId: string): Promise<MySettingsStatus> {
  const [global, market, holdings, globalSchedule] = await Promise.all([
    globalStatus(deps),
    marketStatus(deps, userId),
    holdingsStatus(deps, userId),
    globalScheduleStatus(deps),
  ])
  return { global, market, holdings, globalSchedule }
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

  if (op === 'set-times') {
    const marketBriefTime = (input as { marketBriefTime?: unknown }).marketBriefTime
    const marketFullTime = (input as { marketFullTime?: unknown }).marketFullTime
    const holdingsTime = (input as { holdingsTime?: unknown }).holdingsTime
    // `null` = inherit, always allowed; a chosen time must be one `SCHEDULE_OPTIONS` offers for
    // its own slot — the browser's choice is never trusted (spec §5.4/D7). 個人持股 shares the
    // brief slot's window (it inherits the brief time — spec §5.1).
    if (
      (marketBriefTime !== null && !isValidScheduleTime('brief', marketBriefTime)) ||
      (marketFullTime !== null && !isValidScheduleTime('full', marketFullTime)) ||
      (holdingsTime !== null && !isValidScheduleTime('brief', holdingsTime))
    ) {
      return { ok: false, error: 'invalid-time' }
    }
    await deps.saveTimes(userId, {
      marketBriefTime: marketBriefTime as string | null,
      marketFullTime: marketFullTime as string | null,
      holdingsTime: holdingsTime as string | null,
    })
    return { ok: true, status: await fullStatus(deps, userId) }
  }

  if (typeof op === 'string' && op in HOLDINGS_OP) {
    const innerOp = HOLDINGS_OP[op]
    const innerInput: Record<string, unknown> = { op: innerOp }
    if (op === 'set-holdings') innerInput.url = (input as { url?: unknown }).url
    if (op === 'toggle-holdings') innerInput.enabled = (input as { enabled?: unknown }).enabled

    const result: HoldingsSettingsResult = await runHoldingsSettingsOp(deps, userId, innerInput)
    if (!result.ok) return { ok: false, error: result.error }
    const [global, market, time, globalSchedule] = await Promise.all([
      globalStatus(deps),
      marketStatus(deps, userId),
      holdingsTimeOf(deps, userId),
      globalScheduleStatus(deps),
    ])
    return {
      ok: true,
      status: { global, market, holdings: { ...result.status, time }, globalSchedule },
      send: result.send,
      previewYmd: result.previewYmd,
      missingQuotes: result.missingQuotes,
    }
  }

  return { ok: false, error: 'bad-request' }
}
