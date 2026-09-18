/**
 * Admin console per-account Discord ops (Task 165 Phase 2 step 2d, spec
 * discord-admin-accounts.md §3.4). Every Discord webhook — global, per-account 經濟快報 override,
 * and per-account 個人持股報告 — is now managed here, gated by `assertAdmin` in `index.ts`.
 */
import { isDiscordWebhookUrl, webhookLast4 } from './discordUrl.ts'
import { buildTestPayload } from './discordSummary.ts'
import type { DiscordSendResult } from './discordWebhook.ts'
import { isValidScheduleTime, scheduleFromJobs, scheduleTimeParts } from './discordSchedule.ts'
import type { ScheduleView } from './discordSchedule.ts'
import { dashDate, taipeiYmd } from './report.ts'
import {
  MANUAL_SENDS_PER_DAY,
  runHoldingsSettingsOp,
  type HoldingsOutcome,
  type HoldingsSettingsDeps,
  type HoldingsSettingsResult,
  type LastSend,
} from './holdingsRun.ts'

export interface AccountSettingsRow {
  userId: string
  enabled: boolean
  webhookUrl: string | null
  marketWebhookUrl: string | null
}

export interface DiscordAccountsDeps extends HoldingsSettingsDeps {
  listAccounts: () => Promise<Array<{ userId: string; email: string | null }>>
  listSettings: () => Promise<AccountSettingsRow[]>
  /** upsert; `null` = go back to inheriting the global webhook. */
  saveMarketWebhook: (userId: string, url: string | null) => Promise<void>
  readScheduleJobs: () => Promise<Array<{ jobname: string; schedule: string }>>
  writeSchedule: (s: { briefHour: number; briefMinute: number; fullHour: number; fullMinute: number }) => Promise<void>
}

export interface DiscordAccountRow {
  userId: string
  email: string | null
  market: { custom: boolean; last4: string | null }
  holdings: { configured: boolean; last4: string | null; enabled: boolean }
  lastSend: LastSend | null
}

export type DiscordAccountsResult =
  | { ok: true; schedule: ScheduleView; accounts: DiscordAccountRow[]; send?: DiscordSendResult }
  | { ok: false; error: Extract<HoldingsSettingsResult, { ok: false }>['error'] | 'invalid-time' | 'unknown-user' }

const OPS = new Set([
  'list',
  'set-schedule',
  'set-market',
  'clear-market',
  'test-market',
  'holdings-set',
  'holdings-clear',
  'holdings-enable',
  'holdings-test',
])

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every success returns the full admin snapshot: the schedule and every account, joined with
 * its settings row (none → inherit / not configured / disabled) and its last send. */
async function snapshot(deps: DiscordAccountsDeps): Promise<{ schedule: ScheduleView; accounts: DiscordAccountRow[] }> {
  const [jobs, accountsList, settingsList] = await Promise.all([
    deps.readScheduleJobs(),
    deps.listAccounts(),
    deps.listSettings(),
  ])
  const schedule = scheduleFromJobs(jobs)
  const settingsByUser = new Map(settingsList.map((r) => [r.userId, r]))

  const sorted = [...accountsList].sort((a, b) => {
    if (a.email === null && b.email === null) return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
    if (a.email === null) return 1
    if (b.email === null) return -1
    return a.email < b.email ? -1 : a.email > b.email ? 1 : 0
  })

  const accounts = await Promise.all(
    sorted.map(async (acc) => {
      const row = settingsByUser.get(acc.userId)
      const lastSend = await deps.lastSend(acc.userId)
      return {
        userId: acc.userId,
        email: acc.email,
        market: {
          custom: row?.marketWebhookUrl != null,
          last4: row?.marketWebhookUrl != null ? webhookLast4(row.marketWebhookUrl) : null,
        },
        holdings: {
          configured: row?.webhookUrl != null,
          last4: row?.webhookUrl != null ? webhookLast4(row.webhookUrl) : null,
          enabled: row?.enabled ?? false,
        },
        lastSend,
      }
    }),
  )

  return { schedule, accounts }
}

const HOLDINGS_OP: Record<string, 'set' | 'clear' | 'enable' | 'test'> = {
  'holdings-set': 'set',
  'holdings-clear': 'clear',
  'holdings-enable': 'enable',
  'holdings-test': 'test',
}

/** `input` is the untrusted request body (minus `action`). Never returns a webhook URL. */
export async function runDiscordAccountsOp(deps: DiscordAccountsDeps, input: unknown): Promise<DiscordAccountsResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'bad-request' }
  const op = (input as { op?: unknown }).op
  if (typeof op !== 'string' || !OPS.has(op)) return { ok: false, error: 'bad-request' }

  if (op === 'list') {
    return { ok: true, ...(await snapshot(deps)) }
  }

  if (op === 'set-schedule') {
    const brief = (input as { brief?: unknown }).brief
    const full = (input as { full?: unknown }).full
    if (!isValidScheduleTime('brief', brief) || !isValidScheduleTime('full', full)) {
      return { ok: false, error: 'invalid-time' }
    }
    const briefParts = scheduleTimeParts(brief)
    const fullParts = scheduleTimeParts(full)
    await deps.writeSchedule({
      briefHour: briefParts.hour,
      briefMinute: briefParts.minute,
      fullHour: fullParts.hour,
      fullMinute: fullParts.minute,
    })
    return { ok: true, ...(await snapshot(deps)) }
  }

  // Every other op takes a userId — validated as a UUID string, then checked against the account list.
  const userId = (input as { userId?: unknown }).userId
  if (typeof userId !== 'string' || !USER_ID_RE.test(userId)) return { ok: false, error: 'bad-request' }

  const accountsList = await deps.listAccounts()
  if (!accountsList.some((a) => a.userId === userId)) return { ok: false, error: 'unknown-user' }

  if (op === 'set-market') {
    const url = (input as { url?: unknown }).url
    if (typeof url !== 'string' || !isDiscordWebhookUrl(url)) return { ok: false, error: 'invalid-url' }
    await deps.saveMarketWebhook(userId, url.trim())
    return { ok: true, ...(await snapshot(deps)) }
  }

  if (op === 'clear-market') {
    await deps.saveMarketWebhook(userId, null)
    return { ok: true, ...(await snapshot(deps)) }
  }

  if (op === 'test-market') {
    const settingsList = await deps.listSettings()
    const row = settingsList.find((r) => r.userId === userId)
    if (!row || row.marketWebhookUrl == null) return { ok: false, error: 'not-configured' }

    const ymd = dashDate(taipeiYmd(deps.now()))
    const count = await deps.countManualToday(userId, ymd)
    if (count >= MANUAL_SENDS_PER_DAY) return { ok: false, error: 'quota' }

    const result = await deps.post(row.marketWebhookUrl, buildTestPayload(deps.now().toISOString()))
    const outcome: HoldingsOutcome = result.ok
      ? { kind: 'sent', httpStatus: result.httpStatus }
      : { kind: 'failed', httpStatus: result.httpStatus, reason: result.reason }
    await deps.finish(userId, ymd, 'test', outcome)
    return { ok: true, ...(await snapshot(deps)), send: result }
  }

  // holdings-set / holdings-clear / holdings-enable / holdings-test delegate to the existing op.
  const innerOp = HOLDINGS_OP[op]
  const innerInput: Record<string, unknown> = { op: innerOp }
  if (op === 'holdings-set') innerInput.url = (input as { url?: unknown }).url
  if (op === 'holdings-enable') innerInput.enabled = (input as { enabled?: unknown }).enabled

  const result = await runHoldingsSettingsOp(deps, userId, innerInput)
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, ...(await snapshot(deps)), send: result.send }
}
