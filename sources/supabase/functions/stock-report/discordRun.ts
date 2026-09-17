/**
 * Orchestration for the Discord daily summary and its admin settings (Task 165).
 * Every side effect is an injected dependency so this file stays testable under Vitest;
 * `index.ts` supplies the real Supabase / fetch implementations. Spec §2.2–2.3.
 */
import { isDiscordWebhookUrl, webhookLast4 } from './discordUrl.ts'
import type { DiscordFailReason, DiscordPayload, DiscordSendResult } from './discordWebhook.ts'
import { buildSummaryPayload, buildTestPayload, findMarketDay } from './discordSummary.ts'
import type { FxLine, IndexLine, MacroLine, SummaryEdition } from './discordSummary.ts'
import { lastCompletedClose, SUMMARY_INDICES } from './globalIndexClose.ts'
import type { IndexChartResponse } from './globalIndexClose.ts'
import { extractMarketMarginTotals } from './marketMargin.ts'
import type { MarginSummaryResponse } from './marketMargin.ts'
import { dashDate, taipeiYmd } from './report.ts'
import type { MarketDay } from './twMarket.ts'

export type SendEdition = SummaryEdition | 'test'

export type RunOutcome =
  | { kind: 'sent'; httpStatus: number }
  | { kind: 'skipped'; reason: 'no-market-day' | 'no-webhook' | 'already-sent' }
  | { kind: 'failed'; httpStatus: number | null; reason: DiscordFailReason }

export interface SummaryDeps {
  now: () => Date
  loadMarketFile: () => Promise<{ days?: MarketDay[] } | null>
  loadWebhookUrl: () => Promise<string | null>
  /** false = this day + edition is already claimed or sent */
  claimSend: (ymd: string, edition: SummaryEdition) => Promise<boolean>
  finishSend: (ymd: string, edition: SendEdition, outcome: RunOutcome) => Promise<void>
  loadIndex: (symbol: string) => Promise<IndexChartResponse>
  loadUsdTwd: () => Promise<FxLine | null>
  loadMacro: () => Promise<MacroLine[] | null>
  /** `ymd` is 'YYYYMMDD' */
  loadMargin: (ymd: string) => Promise<MarginSummaryResponse>
  post: (url: string, payload: DiscordPayload) => Promise<DiscordSendResult>
  log: (e: { level: 'warn' | 'info'; message: string; detail: Record<string, unknown> }) => Promise<void>
}

export async function runDiscordSummary(deps: SummaryDeps, edition: SummaryEdition): Promise<RunOutcome> {
  const ymd = dashDate(taipeiYmd(deps.now()))

  const file = await deps.loadMarketFile().catch(() => null)
  const market = findMarketDay(file, ymd)
  if (!market) {
    const outcome: RunOutcome = { kind: 'skipped', reason: 'no-market-day' }
    await deps.finishSend(ymd, edition, outcome)
    return outcome
  }

  const url = await deps.loadWebhookUrl()
  if (!url) {
    const outcome: RunOutcome = { kind: 'skipped', reason: 'no-webhook' }
    await deps.finishSend(ymd, edition, outcome)
    return outcome
  }

  const claimed = await deps.claimSend(ymd, edition)
  if (!claimed) return { kind: 'skipped', reason: 'already-sent' }

  const nowSec = Math.floor(deps.now().getTime() / 1000)

  const indexPromise: Promise<IndexLine[]> = Promise.all(
    SUMMARY_INDICES.map(async ({ symbol, label }) => {
      try {
        const resp = await deps.loadIndex(symbol)
        return { symbol, label, quote: lastCompletedClose(resp, nowSec) }
      } catch {
        return { symbol, label, quote: null }
      }
    }),
  )
  const usdTwdPromise: Promise<FxLine | null> = deps.loadUsdTwd().catch(() => null)
  const macroPromise: Promise<MacroLine[] | null> = edition === 'full' ? deps.loadMacro().catch(() => null) : Promise.resolve(null)
  const marginYmd = ymd.replace(/-/g, '')
  const marginPromise = edition === 'full'
    ? deps
        .loadMargin(marginYmd)
        .then((raw) => {
          const totals = extractMarketMarginTotals(raw)
          return totals && totals.date === ymd ? totals : null
        })
        .catch(() => null)
    : Promise.resolve(null)

  const [indices, usdTwd, macro, margin] = await Promise.all([indexPromise, usdTwdPromise, macroPromise, marginPromise])

  const generatedAt = deps.now().toISOString()
  const payload = buildSummaryPayload({ edition, ymd, generatedAt, market, indices, usdTwd, margin, macro })
  const result = await deps.post(url, payload)

  const outcome: RunOutcome = result.ok
    ? { kind: 'sent', httpStatus: result.httpStatus }
    : { kind: 'failed', httpStatus: result.httpStatus, reason: result.reason }

  await deps.finishSend(ymd, edition, outcome)
  if (outcome.kind === 'failed') {
    await deps.log({
      level: 'warn',
      message: 'discord summary send failed',
      detail: { status: outcome.httpStatus, code: outcome.reason, name: edition },
    })
  }
  return outcome
}

export type SendLogStatus = 'claimed' | 'sent' | 'skipped' | 'failed'

export interface SendLogRow {
  taipeiYmd: string
  edition: SendEdition
  status: SendLogStatus
  httpStatus: number | null
  reason: string | null
  /** ISO timestamp */
  at: string
}

export interface WebhookStatus {
  configured: boolean
  last4: string | null
  updatedAt: string | null
  recent: SendLogRow[]
}

export interface WebhookAdminDeps {
  now: () => Date
  readWebhook: () => Promise<{ url: string; updatedAt: string } | null>
  writeWebhook: (url: string) => Promise<void>
  deleteWebhook: () => Promise<void>
  recentSends: (limit: number) => Promise<SendLogRow[]>
  finishSend: SummaryDeps['finishSend']
  post: SummaryDeps['post']
}

export type WebhookOpResult =
  | { ok: true; status: WebhookStatus; test?: DiscordSendResult }
  | { ok: false; error: 'bad-request' | 'invalid-url' | 'not-configured' }

function toStatus(stored: { url: string; updatedAt: string } | null, recent: SendLogRow[]): WebhookStatus {
  return {
    configured: !!stored,
    last4: stored ? webhookLast4(stored.url) : null,
    updatedAt: stored ? stored.updatedAt : null,
    recent,
  }
}

/** `input` is the untrusted request body (minus `action`). */
export async function runWebhookOp(deps: WebhookAdminDeps, input: unknown): Promise<WebhookOpResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'bad-request' }
  const op = (input as { op?: unknown }).op
  if (op !== 'get' && op !== 'set' && op !== 'clear' && op !== 'test') return { ok: false, error: 'bad-request' }

  if (op === 'set') {
    const url = (input as { url?: unknown }).url
    if (typeof url !== 'string' || !isDiscordWebhookUrl(url)) return { ok: false, error: 'invalid-url' }
    await deps.writeWebhook(url.trim())
  } else if (op === 'clear') {
    await deps.deleteWebhook()
  }

  if (op === 'test') {
    const stored = await deps.readWebhook()
    if (!stored) return { ok: false, error: 'not-configured' }
    const ymd = dashDate(taipeiYmd(deps.now()))
    const result = await deps.post(stored.url, buildTestPayload(deps.now().toISOString()))
    const outcome: RunOutcome = result.ok
      ? { kind: 'sent', httpStatus: result.httpStatus }
      : { kind: 'failed', httpStatus: result.httpStatus, reason: result.reason }
    await deps.finishSend(ymd, 'test', outcome)
    const recent = await deps.recentSends(10)
    return { ok: true, status: toStatus(stored, recent), test: result }
  }

  const stored = await deps.readWebhook()
  const recent = await deps.recentSends(10)
  return { ok: true, status: toStatus(stored, recent) }
}
