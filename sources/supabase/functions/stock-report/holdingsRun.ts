/**
 * Orchestration for the per-user Discord holdings card and its settings ops (Task 165 Phase 2).
 * Every side effect is an injected dependency, mirroring `discordRun.ts` — `index.ts` supplies
 * the real Supabase / fetch implementations. Spec §2.6.
 */
import { isDiscordWebhookUrl, webhookLast4 } from './discordUrl.ts'
import type { DiscordFailReason, DiscordPayload, DiscordSendResult } from './discordWebhook.ts'
import { findMarketDay } from './discordSummary.ts'
import { createQuoteCache, type ChartFetch } from './holdingQuotes.ts'
import {
  aggregateHoldings,
  buildHoldingsPayload,
  buildHoldingsTestPayload,
  buildLedgers,
  heldKeys,
  type WorkspaceInput,
} from './holdingsCard.ts'
import { positionKey, type Market } from '../_shared/engine/models.ts'
import { dashDate, taipeiYmd } from './report.ts'
import type { MarketDay } from './twMarket.ts'

export type HoldingsKind = 'daily' | 'preview' | 'test'

export type HoldingsOutcome =
  | { kind: 'sent'; httpStatus: number }
  | { kind: 'skipped'; reason: 'no-holdings' }
  | { kind: 'failed'; httpStatus: number | null; reason: DiscordFailReason | 'exception' }

export interface LastSend {
  kind: HoldingsKind
  ymd: string
  status: 'claimed' | 'sent' | 'skipped' | 'failed'
  reason: string | null
  at: string
}

export interface HoldingsDataDeps {
  now: () => Date
  loadMarketFile: () => Promise<{ days?: MarketDay[] } | null>
  /** Every workspace of the user, with all its transactions. */
  loadWorkspaces: (userId: string) => Promise<WorkspaceInput[]>
  fetchChart: ChartFetch
  post: (url: string, payload: DiscordPayload) => Promise<DiscordSendResult>
  finish: (userId: string, ymd: string, kind: HoldingsKind, outcome: HoldingsOutcome) => Promise<void>
}

export interface HoldingsRunDeps extends HoldingsDataDeps {
  /** ms since the run started */
  elapsedMs: () => number
  listEnabledUsers: () => Promise<Array<{ userId: string; webhookUrl: string }>>
  /** false = already claimed/sent today */
  claimDaily: (userId: string, ymd: string) => Promise<boolean>
  log: (e: { level: 'warn' | 'info'; message: string; detail: Record<string, unknown> }) => Promise<void>
}

export interface HoldingsRunResult {
  ymd: string
  skipped?: 'no-market-day'
  sent: number
  failed: number
  noHoldings: number
  alreadySent: number
  leftOver: number
}

export const HOLDINGS_RUN_BUDGET_MS = 80_000

/** The entry with the greatest `date` in `file.days` (array order is not trusted). Re-stated
 * from `discordRun.ts`'s `latestMarketDay`, which is module-private, per spec §2.6. */
function latestMarketDay(file: { days?: MarketDay[] } | null): MarketDay | null {
  const days = (Array.isArray(file?.days) ? file.days : []).filter(
    (d) => typeof d?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date),
  )
  if (days.length === 0) return null
  return days.reduce((max, d) => (d.date > max.date ? d : max))
}

function errorName(e: unknown): string {
  return e instanceof Error ? e.name : 'Error'
}

/** Runs `finish`, logging (and swallowing) a throw from `finish` itself so one bad write
 * never breaks the run loop. */
async function finishSafe(
  deps: HoldingsDataDeps & { log: HoldingsRunDeps['log'] },
  userId: string,
  ymd: string,
  kind: HoldingsKind,
  outcome: HoldingsOutcome,
): Promise<void> {
  try {
    await deps.finish(userId, ymd, kind, outcome)
  } catch (e) {
    await deps.log({ level: 'warn', message: 'holdings user failed', detail: { userId, error: errorName(e) } })
  }
}

/** Builds one user's quotes map from their held keys, via the run's shared quote cache. */
async function quotesFor(quoteCache: ReturnType<typeof createQuoteCache>, keys: Array<{ market: Market; ticker: string }>) {
  const pairs = await Promise.all(
    keys.map(async (k) => [positionKey(k.market, k.ticker), await quoteCache.get(k.market, k.ticker)] as const),
  )
  return new Map(pairs)
}

async function runOneUser(
  deps: HoldingsRunDeps,
  quoteCache: ReturnType<typeof createQuoteCache>,
  userId: string,
  webhookUrl: string,
  ymd: string,
): Promise<'sent' | 'failed' | 'noHoldings'> {
  try {
    const workspaces = await deps.loadWorkspaces(userId)
    const ledgers = buildLedgers(workspaces)
    const keys = heldKeys(ledgers)
    const quotes = await quotesFor(quoteCache, keys)
    const summary = aggregateHoldings(ledgers, quotes, ymd)
    const payload = buildHoldingsPayload(summary, { generatedAt: deps.now().toISOString(), preview: false })

    if (!payload) {
      await finishSafe(deps, userId, ymd, 'daily', { kind: 'skipped', reason: 'no-holdings' })
      return 'noHoldings'
    }

    const result = await deps.post(webhookUrl, payload)
    const outcome: HoldingsOutcome = result.ok
      ? { kind: 'sent', httpStatus: result.httpStatus }
      : { kind: 'failed', httpStatus: result.httpStatus, reason: result.reason }
    await finishSafe(deps, userId, ymd, 'daily', outcome)
    return outcome.kind === 'sent' ? 'sent' : 'failed'
  } catch (e) {
    await finishSafe(deps, userId, ymd, 'daily', { kind: 'failed', httpStatus: null, reason: 'exception' })
    await deps.log({ level: 'warn', message: 'holdings user failed', detail: { userId, error: errorName(e) } })
    return 'failed'
  }
}

export async function runHoldingsDaily(deps: HoldingsRunDeps): Promise<HoldingsRunResult> {
  const ymd = dashDate(taipeiYmd(deps.now()))
  const file = await deps.loadMarketFile().catch(() => null)
  const market = findMarketDay(file, ymd)
  if (!market) {
    return { ymd, skipped: 'no-market-day', sent: 0, failed: 0, noHoldings: 0, alreadySent: 0, leftOver: 0 }
  }

  const users = await deps.listEnabledUsers()
  const quoteCache = createQuoteCache(deps.fetchChart, Math.floor(deps.now().getTime() / 1000))

  let sent = 0
  let failed = 0
  let noHoldings = 0
  let alreadySent = 0
  let leftOver = 0

  for (let i = 0; i < users.length; i++) {
    if (deps.elapsedMs() > HOLDINGS_RUN_BUDGET_MS) {
      leftOver = users.length - i
      break
    }
    const { userId, webhookUrl } = users[i]
    const claimed = await deps.claimDaily(userId, ymd)
    if (!claimed) {
      alreadySent++
      continue
    }
    const outcome = await runOneUser(deps, quoteCache, userId, webhookUrl, ymd)
    if (outcome === 'sent') sent++
    else if (outcome === 'failed') failed++
    else noHoldings++
  }

  return { ymd, sent, failed, noHoldings, alreadySent, leftOver }
}

// ── settings ops ─────────────────────────────────────────────────────────────

export interface HoldingsSettingsDeps extends HoldingsDataDeps {
  readSettings: (userId: string) => Promise<{ enabled: boolean; webhookUrl: string | null } | null>
  /** upsert; `enabled` unchanged (false on insert) */
  saveWebhook: (userId: string, url: string) => Promise<void>
  /** webhook_url = null, enabled = false */
  clearWebhook: (userId: string) => Promise<void>
  setEnabled: (userId: string, enabled: boolean) => Promise<void>
  lastSend: (userId: string) => Promise<LastSend | null>
  /** rows of kind test/preview for that day */
  countManualToday: (userId: string, ymd: string) => Promise<number>
}

export interface HoldingsSettingsStatus {
  configured: boolean
  last4: string | null
  enabled: boolean
  lastSend: LastSend | null
}

export type HoldingsSettingsResult =
  | { ok: true; status: HoldingsSettingsStatus; send?: DiscordSendResult; previewYmd?: string }
  | { ok: false; error: 'bad-request' | 'invalid-url' | 'not-configured' | 'quota' | 'no-market-data' | 'no-holdings' }

export const MANUAL_SENDS_PER_DAY = 10

async function currentStatus(deps: HoldingsSettingsDeps, userId: string): Promise<HoldingsSettingsStatus> {
  const [row, lastSend] = await Promise.all([deps.readSettings(userId), deps.lastSend(userId)])
  return {
    configured: row?.webhookUrl != null,
    last4: row?.webhookUrl != null ? webhookLast4(row.webhookUrl) : null,
    enabled: row?.enabled ?? false,
    lastSend,
  }
}

/** `input` is the untrusted request body (minus `action`); `userId` comes only from the verified JWT. */
export async function runHoldingsSettingsOp(
  deps: HoldingsSettingsDeps,
  userId: string,
  input: unknown,
): Promise<HoldingsSettingsResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'bad-request' }
  const op = (input as { op?: unknown }).op
  if (op !== 'get' && op !== 'set' && op !== 'clear' && op !== 'enable' && op !== 'test' && op !== 'preview') {
    return { ok: false, error: 'bad-request' }
  }

  if (op === 'set') {
    const url = (input as { url?: unknown }).url
    if (typeof url !== 'string' || !isDiscordWebhookUrl(url)) return { ok: false, error: 'invalid-url' }
    await deps.saveWebhook(userId, url.trim())
  } else if (op === 'clear') {
    await deps.clearWebhook(userId)
  } else if (op === 'enable') {
    const enabled = (input as { enabled?: unknown }).enabled
    if (typeof enabled !== 'boolean') return { ok: false, error: 'bad-request' }
    if (enabled) {
      const row = await deps.readSettings(userId)
      if (!row || !row.webhookUrl) return { ok: false, error: 'not-configured' }
    }
    await deps.setEnabled(userId, enabled)
  }

  if (op === 'test' || op === 'preview') {
    const row = await deps.readSettings(userId)
    if (!row || !row.webhookUrl) return { ok: false, error: 'not-configured' }
    const webhookUrl = row.webhookUrl
    const ymd = dashDate(taipeiYmd(deps.now()))
    const count = await deps.countManualToday(userId, ymd)
    if (count >= MANUAL_SENDS_PER_DAY) return { ok: false, error: 'quota' }

    if (op === 'test') {
      const payload = buildHoldingsTestPayload(deps.now().toISOString())
      const result = await deps.post(webhookUrl, payload)
      const outcome: HoldingsOutcome = result.ok
        ? { kind: 'sent', httpStatus: result.httpStatus }
        : { kind: 'failed', httpStatus: result.httpStatus, reason: result.reason }
      await deps.finish(userId, ymd, 'test', outcome)
      const status = await currentStatus(deps, userId)
      return { ok: true, status, send: result }
    }

    // preview: today's market day, else the latest well-formed day in the file.
    const file = await deps.loadMarketFile().catch(() => null)
    const market = findMarketDay(file, ymd) ?? latestMarketDay(file)
    if (!market) return { ok: false, error: 'no-market-data' }

    const workspaces = await deps.loadWorkspaces(userId)
    const ledgers = buildLedgers(workspaces)
    const keys = heldKeys(ledgers)
    const quoteCache = createQuoteCache(deps.fetchChart, Math.floor(deps.now().getTime() / 1000))
    const quotes = await quotesFor(quoteCache, keys)
    const summary = aggregateHoldings(ledgers, quotes, market.date)
    const payload = buildHoldingsPayload(summary, { generatedAt: deps.now().toISOString(), preview: true })

    if (!payload) {
      await deps.finish(userId, ymd, 'preview', { kind: 'skipped', reason: 'no-holdings' })
      return { ok: false, error: 'no-holdings' }
    }

    const result = await deps.post(webhookUrl, payload)
    const outcome: HoldingsOutcome = result.ok
      ? { kind: 'sent', httpStatus: result.httpStatus }
      : { kind: 'failed', httpStatus: result.httpStatus, reason: result.reason }
    await deps.finish(userId, ymd, 'preview', outcome)
    const status = await currentStatus(deps, userId)
    return { ok: true, status, send: result, previewYmd: market.date }
  }

  const status = await currentStatus(deps, userId)
  return { ok: true, status }
}
