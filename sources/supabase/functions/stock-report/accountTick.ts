/**
 * Task 165 step 2f — the per-account send tick (spec docs/agent/specs/discord-account-schedule.md).
 * One 30-minute cron job (`discord-account-tick`, schema.sql §14) replaces the old one-time-a-day
 * `discord-holdings-daily` and asks, every half hour: which account is due for which stream, at
 * the time *it* chose (or the admin's schedule, if it never chose one)?
 *
 * Every side effect is an injected dependency, mirroring `discordRun.ts` / `holdingsRun.ts` —
 * `index.ts` supplies the real Supabase / fetch implementations.
 */
import type { DiscordFailReason, DiscordPayload, DiscordSendResult } from './discordWebhook.ts'
import { findMarketDay } from './discordSummary.ts'
import type { SummaryEdition } from './discordSummary.ts'
import { buildMarketEdition, type GatherDeps } from './discordRun.ts'
import { groupMarketTargets } from './discordTargets.ts'
import type { MarketOverride } from './discordTargets.ts'
import { createQuoteCache } from './holdingQuotes.ts'
import type { ChartFetch } from './holdingQuotes.ts'
import { runOneUser, type RunOneUserDeps } from './holdingsRun.ts'
import { dashDate, taipeiYmd } from './report.ts'
import type { MarketDay } from './twMarket.ts'

/** One account's settings row, exactly as far as the tick needs to know it. */
export interface AccountRow {
  userId: string
  marketWebhookUrl: string | null
  marketEnabled: boolean
  marketBriefTime: string | null
  marketFullTime: string | null
  holdingsWebhookUrl: string | null
  holdingsEnabled: boolean
  holdingsTime: string | null
}

/** The admin's two send times, read from `cron.job` (`discordSchedule.ts`'s `scheduleFromJobs`).
 * `null` = that job is missing — see `dueAt`'s doc comment for why that must not mean "due now". */
export interface GlobalSchedule { brief: string | null; full: string | null }

export interface DueStreams { marketBrief: boolean; marketFull: boolean; holdings: boolean }

/**
 * Pure. `hhmm` is Taipei wall-clock, already rounded to the half hour by the caller.
 *
 * This is the whole inherit rule in one testable function: each stream needs its switch on, its
 * own webhook, and either a custom time equal to `hhmm` or (custom time absent) the relevant
 * global time equal to `hhmm`. A `null` on both sides must never count as due — if the global
 * time is unknown (the cron job is missing) an inheriting account is *not* due, rather than due
 * at every tick.
 */
export function dueAt(hhmm: string, global: GlobalSchedule, row: AccountRow): DueStreams {
  const marketBrief = row.marketEnabled && row.marketWebhookUrl !== null && (row.marketBriefTime ?? global.brief) === hhmm
  const marketFull = row.marketEnabled && row.marketWebhookUrl !== null && (row.marketFullTime ?? global.full) === hhmm
  // 個人持股 inherits the BRIEF time, never the full one (spec §5.1) — there is only one control.
  const holdings = row.holdingsEnabled && row.holdingsWebhookUrl !== null && (row.holdingsTime ?? global.brief) === hhmm
  return { marketBrief, marketFull, holdings }
}

export type MarketCopyKind = 'market-brief' | 'market-full'

export type CopyOutcome =
  | { kind: 'sent'; httpStatus: number }
  | { kind: 'failed'; httpStatus: number | null; reason: DiscordFailReason }
  /** The account's own 經濟快報 webhook happens to be the global one — `groupMarketTargets`
   * drops it from the post (the global job already covers that channel), but the claim this
   * tick already made must still resolve, or the unique index would block every later day. */
  | { kind: 'skipped'; reason: 'same-as-global' }

export interface TickResult {
  ymd: string
  hhmm: string
  skipped?: 'no-market-day'
  marketBriefSent: number
  marketFullSent: number
  holdingsSent: number
  failed: number
  alreadySent: number
  leftOver: number
}

export interface TickDeps extends GatherDeps, RunOneUserDeps {
  /** ms since the tick started */
  elapsedMs: () => number
  loadMarketFile: () => Promise<{ days?: MarketDay[]; asOf?: string | null } | null>
  loadGlobalSchedule: () => Promise<GlobalSchedule>
  loadGlobalWebhookUrl: () => Promise<string | null>
  listAccounts: () => Promise<AccountRow[]>
  post: (url: string, payload: DiscordPayload) => Promise<DiscordSendResult>
  /** false = this user + day + kind is already claimed or sent (`23505`), same shape as
   * `claimHoldingsDaily`. */
  claimMarketCopy: (userId: string, ymd: string, kind: MarketCopyKind) => Promise<boolean>
  /** Updates the row `claimMarketCopy` inserted — never a second insert (spec §4, D-note). */
  finishMarketCopy: (userId: string, ymd: string, kind: MarketCopyKind, outcome: CopyOutcome) => Promise<void>
  claimHoldings: (userId: string, ymd: string) => Promise<boolean>
  fetchChart: ChartFetch
}

export const ACCOUNT_TICK_BUDGET_MS = 80_000

/** Taipei wall-clock 'HH:MM', rounded down to the half hour. The cron fires on `:00`/`:30`
 * already; this also makes a manual trigger land on a real slot instead of matching nothing. */
export function taipeiHalfHour(d: Date): string {
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const hour = t.getUTCHours()
  const minute = t.getUTCMinutes() < 30 ? 0 : 30
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * One market edition (marketBrief or marketFull), for every account due for it this tick.
 * Claims first (so a crash after this never re-sends), then builds the payload at most once —
 * only if something actually survived the claim — then groups by URL (`groupMarketTargets`,
 * which also drops any account whose own webhook happens to be the global one) and posts once
 * per URL group, finishing every claimed account either way.
 */
async function sendMarketStream(
  deps: TickDeps,
  ymd: string,
  kind: MarketCopyKind,
  edition: SummaryEdition,
  market: MarketDay,
  marketAsOf: string | null,
  globalUrl: string | null,
  dueAccounts: AccountRow[],
): Promise<{ sent: number; failed: number; alreadySent: number }> {
  let sent = 0
  let failed = 0
  let alreadySent = 0
  if (dueAccounts.length === 0) return { sent, failed, alreadySent }

  const claimed: MarketOverride[] = []
  for (const row of dueAccounts) {
    const ok = await deps.claimMarketCopy(row.userId, ymd, kind)
    if (ok) claimed.push({ userId: row.userId, url: row.marketWebhookUrl as string, enabled: true })
    else alreadySent++
  }
  if (claimed.length === 0) return { sent, failed, alreadySent }

  const groups = groupMarketTargets(globalUrl ?? '', claimed)
  const postedIds = new Set(groups.flatMap((t) => t.userIds))

  if (groups.length > 0) {
    const payload = await buildMarketEdition(deps, edition, ymd, market, marketAsOf)
    for (const target of groups) {
      let outcome: CopyOutcome
      try {
        const result = await deps.post(target.url, payload)
        outcome = result.ok
          ? { kind: 'sent', httpStatus: result.httpStatus }
          : { kind: 'failed', httpStatus: result.httpStatus, reason: result.reason }
      } catch {
        outcome = { kind: 'failed', httpStatus: null, reason: 'network' }
      }

      if (outcome.kind === 'sent') sent += target.userIds.length
      else failed += target.userIds.length

      if (outcome.kind === 'failed') {
        await deps.log({
          level: 'warn',
          message: 'discord account tick market send failed',
          detail: { kind, status: outcome.httpStatus, code: outcome.reason, users: target.userIds.length },
        })
      }

      for (const userId of target.userIds) {
        try {
          await deps.finishMarketCopy(userId, ymd, kind, outcome)
        } catch {
          await deps.log({ level: 'warn', message: 'discord account tick market record failed', detail: { userId, kind } })
        }
      }
    }
  }

  for (const c of claimed) {
    if (postedIds.has(c.userId)) continue
    try {
      await deps.finishMarketCopy(c.userId, ymd, kind, { kind: 'skipped', reason: 'same-as-global' })
    } catch {
      await deps.log({ level: 'warn', message: 'discord account tick market record failed', detail: { userId: c.userId, kind } })
    }
  }

  return { sent, failed, alreadySent }
}

export async function runAccountTick(deps: TickDeps): Promise<TickResult> {
  const now = deps.now()
  const ymd = dashDate(taipeiYmd(now))
  const hhmm = taipeiHalfHour(now)

  const file = await deps.loadMarketFile().catch(() => null)
  const market = findMarketDay(file, ymd)
  if (!market) {
    return {
      ymd,
      hhmm,
      skipped: 'no-market-day',
      marketBriefSent: 0,
      marketFullSent: 0,
      holdingsSent: 0,
      failed: 0,
      alreadySent: 0,
      leftOver: 0,
    }
  }

  const [global, globalUrl, accounts] = await Promise.all([
    deps.loadGlobalSchedule(),
    deps.loadGlobalWebhookUrl(),
    deps.listAccounts(),
  ])

  let holdingsSent = 0
  let failed = 0
  let alreadySent = 0
  let leftOver = 0

  const dueMarketBrief: AccountRow[] = []
  const dueMarketFull: AccountRow[] = []

  const quoteCache = createQuoteCache(deps.fetchChart, Math.floor(now.getTime() / 1000))

  for (let i = 0; i < accounts.length; i++) {
    if (deps.elapsedMs() > ACCOUNT_TICK_BUDGET_MS) {
      leftOver += accounts.length - i
      break
    }
    const row = accounts[i]
    const due = dueAt(hhmm, global, row)

    if (due.marketBrief) dueMarketBrief.push(row)
    if (due.marketFull) dueMarketFull.push(row)

    if (due.holdings) {
      const claimed = await deps.claimHoldings(row.userId, ymd)
      if (!claimed) {
        alreadySent++
      } else {
        const outcome = await runOneUser(deps, quoteCache, row.userId, row.holdingsWebhookUrl as string, ymd)
        if (outcome === 'sent') holdingsSent++
        else if (outcome === 'failed') failed++
      }
    }
  }

  // Market editions: built at most once per tick, shared by every account due at this minute.
  const brief = await sendMarketStream(deps, ymd, 'market-brief', 'brief', market, file?.asOf ?? null, globalUrl, dueMarketBrief)
  const full = await sendMarketStream(deps, ymd, 'market-full', 'full', market, file?.asOf ?? null, globalUrl, dueMarketFull)

  return {
    ymd,
    hhmm,
    marketBriefSent: brief.sent,
    marketFullSent: full.sent,
    holdingsSent,
    failed: failed + brief.failed + full.failed,
    alreadySent: alreadySent + brief.alreadySent + full.alreadySent,
    leftOver,
  }
}
