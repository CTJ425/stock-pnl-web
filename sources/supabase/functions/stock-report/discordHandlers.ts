/**
 * Discord actions (Task 165) and the service-role reads/writes behind them. The pure planning and
 * rendering live in the discord*.ts / holdings*.ts / accountTick.ts modules; this file is their wiring.
 */
import { db, json } from './runtime.ts'
import type { GenerateReportRequestBody } from './requestBody.ts'
import { type Transaction } from '../_shared/engine/models.ts'
import { logEvent } from '../_shared/log.ts'
import {
  type AccountRow,
  type CopyOutcome,
  type GlobalSchedule,
  type MarketCopyKind,
  runAccountTick,
  type TickDeps,
} from './accountTick.ts'
import { downloadJson } from './dataAccess.ts'
import { type AccountSettingsRow, type DiscordAccountsDeps, runDiscordAccountsOp } from './discordAccounts.ts'
import { type MySettingsDeps, runMySettingsOp } from './discordMySettings.ts'
import {
  runDiscordSummary,
  type RunOutcome,
  runWebhookOp,
  type SendEdition,
  type SendLogRow,
  type SendLogStatus,
  type SummaryDeps,
  type WebhookAdminDeps,
} from './discordRun.ts'
import { scheduleFromJobs } from './discordSchedule.ts'
import { type FxLine, type MacroLine, type SummaryEdition } from './discordSummary.ts'
import { postDiscordWebhook } from './discordWebhook.ts'
import { type FxFile } from './fxRates.ts'
import { assertUser } from './gates.ts'
import { type IndexChartResponse, indexChartUrl } from './globalIndexClose.ts'
import { makeChartFetch } from './holdingQuotes.ts'
import { type WorkspaceInput } from './holdingsCard.ts'
import {
  type HoldingsDataDeps,
  type HoldingsKind,
  type HoldingsOutcome,
  type HoldingsRunDeps,
  type LastSend,
  runHoldingsDaily,
} from './holdingsRun.ts'
import { type MarginSummaryResponse, marginSummaryUrl } from './marketMargin.ts'
import { fetchJson } from './twChips.ts'
import { type MarketFile } from './twMarket.ts'
import { type MacroFile } from './usMacro.ts'

/**
 * Real dependencies for the Discord daily summary (Task 165). Shared by `discord-summary` (cron,
 * `x-cron-secret`) and `discord-webhook` (admin console): both read/write `app_secrets` and
 * `discord_send_log`. The webhook URL itself never leaves this module as a return value — see
 * spec §2.2/§2.3.
 */
export async function readDiscordWebhookRow(): Promise<{ url: string; updatedAt: string } | null> {
  const { data, error } = await db
    .from('app_secrets')
    .select('value, updated_at')
    .eq('name', 'discord_webhook_url')
    .maybeSingle()
  // A read failure must not look like "not configured": the admin console would show 尚未設定 and
  // the cron run would record a misleading `no-webhook` skip. Throw so the caller answers 500.
  if (error) throw new Error(error.message)
  if (!data) return null
  return { url: data.value, updatedAt: data.updated_at }
}

export async function loadDiscordWebhookUrl(): Promise<string | null> {
  const row = await readDiscordWebhookRow()
  return row?.url ?? null
}

export async function writeDiscordWebhookUrl(url: string): Promise<void> {
  const { error } = await db
    .from('app_secrets')
    .upsert({ name: 'discord_webhook_url', value: url, updated_at: new Date().toISOString() }, { onConflict: 'name' })
  if (error) throw new Error(error.message)
}

export async function deleteDiscordWebhookUrl(): Promise<void> {
  const { error } = await db.from('app_secrets').delete().eq('name', 'discord_webhook_url')
  if (error) throw new Error(error.message)
}

export async function recentDiscordSends(limit: number): Promise<SendLogRow[]> {
  const { data, error } = await db
    .from('discord_send_log')
    .select('taipei_ymd, edition, status, http_status, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data.map(
    (row: {
      taipei_ymd: string
      edition: SendEdition
      status: SendLogStatus
      http_status: number | null
      reason: string | null
      created_at: string
    }) => ({
      taipeiYmd: row.taipei_ymd,
      edition: row.edition,
      status: row.status,
      httpStatus: row.http_status,
      reason: row.reason,
      at: row.created_at,
    }),
  )
}

/**
 * The unique index `discord_send_log_once` (schema.sql) is the actual guard against a double
 * post; `23505` means another call already claimed this day+edition first.
 */
export async function claimDiscordSend(ymd: string, edition: SummaryEdition): Promise<boolean> {
  const { error } = await db.from('discord_send_log').insert({ taipei_ymd: ymd, edition, status: 'claimed' })
  if (!error) return true
  if (error.code === '23505') return false
  throw new Error(error.message)
}

/**
 * `brief`/`full` terminal outcomes (`sent`/`failed`) update the row `claimSend` inserted earlier;
 * everything else — the two pre-claim skip reasons, and every `test` send — has no claimed row to
 * update, so it inserts its own.
 */
export async function finishDiscordSend(ymd: string, edition: SendEdition, outcome: RunOutcome): Promise<void> {
  const httpStatus = outcome.kind === 'sent' || outcome.kind === 'failed' ? outcome.httpStatus : null
  const reason = outcome.kind === 'skipped' || outcome.kind === 'failed' ? outcome.reason : null
  if ((edition === 'brief' || edition === 'full') && (outcome.kind === 'sent' || outcome.kind === 'failed')) {
    const { error } = await db
      .from('discord_send_log')
      .update({ status: outcome.kind, http_status: httpStatus, reason, updated_at: new Date().toISOString() })
      .eq('taipei_ymd', ymd)
      .eq('edition', edition)
      .eq('status', 'claimed')
    if (error) throw new Error(error.message)
    return
  }
  const { error } = await db
    .from('discord_send_log')
    .insert({ taipei_ymd: ymd, edition, status: outcome.kind, http_status: httpStatus, reason })
  if (error) throw new Error(error.message)
}

export async function loadDiscordUsdTwd(): Promise<FxLine | null> {
  const file = await downloadJson<FxFile>('fx/twd.json')
  const usd = file?.currencies.find((c) => c.code === 'USD')
  if (!usd) return null
  const lastPoint = usd.points[usd.points.length - 1]
  return {
    code: usd.code,
    latest: usd.latest,
    prevClose: usd.prevClose,
    decimals: usd.decimals,
    date: lastPoint ? lastPoint[0] : null,
    asOf: file?.asOf ?? null,
  }
}

export async function loadDiscordMacro(): Promise<MacroLine[] | null> {
  const file = await downloadJson<MacroFile>('macro/us.json')
  return file?.indicators ?? null
}

/** Task 165 step 2f: every account's row, exactly as `accountTick.ts`'s `dueAt` needs it. Unlike
 * the retired `loadDiscordMarketOverrides`, this is not filtered to accounts with a 經濟快報 URL —
 * an account with only a 個人持股 webhook (or neither) still needs its row for `dueAt` to say no. */
export async function listDiscordTickAccounts(): Promise<AccountRow[]> {
  const out: AccountRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('user_discord_settings')
      .select('user_id, market_webhook_url, market_enabled, market_brief_time, market_full_time, webhook_url, enabled, holdings_time')
      .order('user_id', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    const page = data ?? []
    out.push(
      ...page.map(
        (row: {
          user_id: string
          market_webhook_url: string | null
          market_enabled: boolean
          market_brief_time: string | null
          market_full_time: string | null
          webhook_url: string | null
          enabled: boolean
          holdings_time: string | null
        }) => ({
          userId: row.user_id,
          marketWebhookUrl: row.market_webhook_url,
          marketEnabled: row.market_enabled,
          marketBriefTime: row.market_brief_time,
          marketFullTime: row.market_full_time,
          holdingsWebhookUrl: row.webhook_url,
          holdingsEnabled: row.enabled,
          holdingsTime: row.holdings_time,
        }),
      ),
    )
    if (page.length < 1000) break
  }
  return out
}

/** schema.sql §15's two-job schedule, in the shape `accountTick.ts`'s `dueAt` inherits from. */
export async function loadDiscordGlobalSchedule(): Promise<GlobalSchedule> {
  return scheduleFromJobs(await readDiscordScheduleJobs())
}

/** `23505` means another tick already claimed this user+day+kind first — same shape as
 * `claimHoldingsDaily`. Task 165 step 2f (spec §4): this is new; the retired
 * `finishDiscordMarketOverride` inserted a finished row with no prior claim, safe only because
 * the job ran once a day. */
export async function claimMarketCopy(userId: string, ymd: string, kind: MarketCopyKind): Promise<boolean> {
  const { error } = await db.from('user_discord_send_log').insert({ user_id: userId, taipei_ymd: ymd, kind, status: 'claimed' })
  if (!error) return true
  if (error.code === '23505') return false
  throw new Error(error.message)
}

/** Updates the row `claimMarketCopy` inserted — never a second insert. */
export async function finishMarketCopy(userId: string, ymd: string, kind: MarketCopyKind, outcome: CopyOutcome): Promise<void> {
  const httpStatus = outcome.kind === 'sent' || outcome.kind === 'failed' ? outcome.httpStatus : null
  const reason = outcome.kind === 'skipped' || outcome.kind === 'failed' ? outcome.reason : null
  const { error } = await db
    .from('user_discord_send_log')
    .update({ status: outcome.kind, http_status: httpStatus, reason, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('taipei_ymd', ymd)
    .eq('kind', kind)
    .eq('status', 'claimed')
  if (error) throw new Error(error.message)
}

/** Cron entry point: every half hour, Taipei 17:00–23:30 weekdays (`discord-account-tick` in
 * schema.sql). Reuses the same data loaders / holdings step as the retired `discord-holdings`. */
export async function handleDiscordAccountTick(): Promise<Response> {
  const startedAt = Date.now()
  const deps: TickDeps = {
    now: () => new Date(),
    elapsedMs: () => Date.now() - startedAt,
    loadMarketFile: () => downloadJson<MarketFile>('market/daily.json'),
    loadGlobalSchedule: loadDiscordGlobalSchedule,
    loadGlobalWebhookUrl: loadDiscordWebhookUrl,
    listAccounts: listDiscordTickAccounts,
    loadIndex: (symbol) => fetchJson<IndexChartResponse>(indexChartUrl(symbol)),
    loadUsdTwd: loadDiscordUsdTwd,
    loadMacro: loadDiscordMacro,
    loadMargin: (ymd) => fetchJson<MarginSummaryResponse>(marginSummaryUrl(ymd)),
    post: postDiscordWebhook,
    claimMarketCopy,
    finishMarketCopy,
    loadWorkspaces: loadHoldingsWorkspaces,
    fetchChart: makeChartFetch({ fetchImpl: fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }),
    claimHoldings: claimHoldingsDaily,
    finish: finishHoldingsSend,
    log: (e) => logEvent(db, { level: e.level, action: 'discord-account-tick', message: e.message, detail: e.detail }),
  }
  const result = await runAccountTick(deps)
  return json(result)
}

/**
 * The five real data loaders behind both the scheduled summary and the admin preview
 * (`op: 'preview'`, spec §2.7) — one factory so the two entry points cannot drift.
 */
export function discordSummaryLoaders(): Pick<
  SummaryDeps,
  'loadMarketFile' | 'loadIndex' | 'loadUsdTwd' | 'loadMacro' | 'loadMargin'
> {
  return {
    loadMarketFile: () => downloadJson<MarketFile>('market/daily.json'),
    loadIndex: (symbol) => fetchJson<IndexChartResponse>(indexChartUrl(symbol)),
    loadUsdTwd: loadDiscordUsdTwd,
    loadMacro: loadDiscordMacro,
    loadMargin: (ymd) => fetchJson<MarginSummaryResponse>(marginSummaryUrl(ymd)),
  }
}

/** Cron entry point: weekday 17:30 (`brief`) / 21:30 (`full`) — the two `discord-summary-*` jobs
 * in schema.sql. Posts to the global webhook only (Task 165 step 2f, spec D4) — the per-account
 * copies of either edition are `discord-account-tick`'s job now. */
export async function handleDiscordSummary(body: GenerateReportRequestBody): Promise<Response> {
  if (body.edition !== 'brief' && body.edition !== 'full') {
    return json({ error: 'edition 必須是 brief 或 full' }, 400)
  }
  const edition = body.edition
  const deps: SummaryDeps = {
    now: () => new Date(),
    ...discordSummaryLoaders(),
    loadWebhookUrl: loadDiscordWebhookUrl,
    claimSend: claimDiscordSend,
    finishSend: finishDiscordSend,
    post: postDiscordWebhook,
    log: (e) => logEvent(db, { level: e.level, action: 'discord-summary', message: e.message, detail: e.detail }),
  }
  const outcome = await runDiscordSummary(deps, edition)
  return json(outcome)
}

/** Admin console entry point (Discord settings panel): get / set / clear / test / preview. Never returns the URL — see `runWebhookOp`. */
export async function handleDiscordWebhook(body: GenerateReportRequestBody): Promise<Response> {
  const { action: _action, ...input } = body
  const deps: WebhookAdminDeps = {
    now: () => new Date(),
    readWebhook: readDiscordWebhookRow,
    writeWebhook: writeDiscordWebhookUrl,
    deleteWebhook: deleteDiscordWebhookUrl,
    recentSends: recentDiscordSends,
    finishSend: finishDiscordSend,
    post: postDiscordWebhook,
    ...discordSummaryLoaders(),
  }
  const result = await runWebhookOp(deps, input)
  if (!result.ok) {
    return json(result, result.error === 'not-configured' || result.error === 'no-market-data' ? 409 : 400)
  }
  return json(result)
}

/**
 * Real dependencies for the per-user Discord holdings card (Task 165 Phase 2). Shared by
 * `discord-holdings` (cron, `x-cron-secret`) and `discord-accounts` (admin console, Task 165
 * Phase 2 step 2d, replacing the retired per-user `discord-holdings-settings`): both read/write
 * `user_discord_settings` and `user_discord_send_log`. The webhook URL itself never leaves this
 * module as a return value — see spec §2.6.
 */
export const HOLDINGS_TX_COLUMNS = 'id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, tx_nature, fee_rate, created_at'

/** Every workspace of the user, each with all of its transactions. BUG-066: page transactions
 * 1,000 rows at a time until a short page — PostgREST caps a single response at `max_rows`. */
export async function loadHoldingsWorkspaces(userId: string): Promise<WorkspaceInput[]> {
  const { data: workspaces, error } = await db
    .from('workspaces')
    .select('id, fee_rate')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw new Error(error.message)

  const out: WorkspaceInput[] = []
  for (const ws of workspaces ?? []) {
    const transactions: Transaction[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error: txError } = await db
        .from('transactions')
        .select(HOLDINGS_TX_COLUMNS)
        .eq('workspace_id', ws.id)
        .order('tx_date', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (txError) throw new Error(txError.message)
      const page = (data ?? []) as unknown as Transaction[]
      transactions.push(...page)
      if (page.length < 1000) break
    }
    out.push({ id: ws.id, fee_rate: ws.fee_rate, transactions })
  }
  return out
}

export async function listEnabledHoldingsUsers(): Promise<Array<{ userId: string; webhookUrl: string }>> {
  const { data, error } = await db
    .from('user_discord_settings')
    .select('user_id, webhook_url')
    .eq('enabled', true)
    .not('webhook_url', 'is', null)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: { user_id: string; webhook_url: string | null }) => ({
    userId: row.user_id,
    webhookUrl: row.webhook_url as string,
  }))
}

/** `23505` means another call already claimed this user+day first — the unique index is the actual guard. */
export async function claimHoldingsDaily(userId: string, ymd: string): Promise<boolean> {
  const { error } = await db.from('user_discord_send_log').insert({ user_id: userId, taipei_ymd: ymd, kind: 'daily', status: 'claimed' })
  if (!error) return true
  if (error.code === '23505') return false
  throw new Error(error.message)
}

/** `daily` terminal outcomes (`sent`/`failed`/`skipped`) update the row `claimDaily` inserted
 * earlier; `preview`/`test` have no claimed row, so they insert their own. */
export async function finishHoldingsSend(userId: string, ymd: string, kind: HoldingsKind, outcome: HoldingsOutcome): Promise<void> {
  const httpStatus = outcome.kind === 'sent' || outcome.kind === 'failed' ? outcome.httpStatus : null
  const reason = outcome.kind === 'skipped' || outcome.kind === 'failed' ? outcome.reason : null
  if (kind === 'daily') {
    const { error } = await db
      .from('user_discord_send_log')
      .update({ status: outcome.kind, http_status: httpStatus, reason, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('taipei_ymd', ymd)
      .eq('status', 'claimed')
    if (error) throw new Error(error.message)
    return
  }
  const { error } = await db
    .from('user_discord_send_log')
    .insert({ user_id: userId, taipei_ymd: ymd, kind, status: outcome.kind, http_status: httpStatus, reason })
  if (error) throw new Error(error.message)
}

export async function readHoldingsSettings(
  userId: string,
): Promise<{ enabled: boolean; webhookUrl: string | null; holdingsTime: string | null } | null> {
  const { data, error } = await db
    .from('user_discord_settings')
    .select('enabled, webhook_url, holdings_time')
    .eq('user_id', userId)
    .maybeSingle()
  // A read failure must not look like "not configured" — throw so the caller answers 500.
  if (error) throw new Error(error.message)
  if (!data) return null
  return { enabled: data.enabled, webhookUrl: data.webhook_url, holdingsTime: data.holdings_time }
}

export async function saveHoldingsWebhookUrl(userId: string, url: string): Promise<void> {
  const { error } = await db
    .from('user_discord_settings')
    .upsert({ user_id: userId, webhook_url: url, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

export async function clearHoldingsWebhookUrl(userId: string): Promise<void> {
  const { error } = await db
    .from('user_discord_settings')
    .update({ webhook_url: null, enabled: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export async function setHoldingsEnabled(userId: string, enabled: boolean): Promise<void> {
  const { error } = await db
    .from('user_discord_settings')
    .upsert({ user_id: userId, enabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

export async function readHoldingsLastSend(userId: string): Promise<LastSend | null> {
  const { data, error } = await db
    .from('user_discord_send_log')
    .select('kind, taipei_ymd, status, reason, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return { kind: data.kind, ymd: data.taipei_ymd, status: data.status, reason: data.reason, at: data.updated_at }
}

export async function countHoldingsManualToday(userId: string, ymd: string): Promise<number> {
  const { count, error } = await db
    .from('user_discord_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('taipei_ymd', ymd)
    .in('kind', ['test', 'preview'])
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** The data loaders shared by the scheduled run and the per-user settings ops (get/set/.../preview). */
export function holdingsDataDeps(): HoldingsDataDeps {
  return {
    now: () => new Date(),
    loadMarketFile: () => downloadJson<MarketFile>('market/daily.json'),
    loadWorkspaces: loadHoldingsWorkspaces,
    fetchChart: makeChartFetch({ fetchImpl: fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }),
    post: postDiscordWebhook,
    finish: finishHoldingsSend,
  }
}

/** Cron entry point: weekday, together with the brief (17:30 default; admin-adjustable, see
 * schema.sql §15) — `discord-holdings-daily` in schema.sql. */
export async function handleDiscordHoldings(): Promise<Response> {
  const startedAt = Date.now()
  const deps: HoldingsRunDeps = {
    ...holdingsDataDeps(),
    elapsedMs: () => Date.now() - startedAt,
    listEnabledUsers: listEnabledHoldingsUsers,
    claimDaily: claimHoldingsDaily,
    log: (e) => logEvent(db, { level: e.level, action: 'discord-holdings', message: e.message, detail: e.detail }),
  }
  const result = await runHoldingsDaily(deps)
  return json(result)
}

/**
 * Real dependencies for the admin console's per-account Discord ops (Task 165 Phase 2 step 2d,
 * spec discord-admin-accounts.md §3.5). Every account, every webhook — global (§13, unchanged),
 * per-account 經濟快報 override, per-account 個人持股報告 — plus the send schedule, all gated by
 * `assertAdmin`; the per-user `discord-holdings-settings` action is retired with it (U1).
 */
export async function listDiscordAccounts(): Promise<Array<{ userId: string; email: string | null }>> {
  // Same BUG-066 paging shape as `handleAdminBackups` / `handleAdminUsers`: `listUsers` has its
  // own page/perPage, independent of PostgREST's max_rows.
  const perPage = 1000
  const users: Array<{ userId: string; email: string | null }> = []
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(error.message)
    const batch = data?.users ?? []
    users.push(
      ...batch.map((u: { id: string; email: string | null | undefined }) => ({
        userId: u.id,
        email: u.email ?? null,
      })),
    )
    if (batch.length < perPage) break
  }
  return users
}

export async function listDiscordAccountSettings(): Promise<AccountSettingsRow[]> {
  const out: AccountSettingsRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('user_discord_settings')
      .select('user_id, enabled, webhook_url, market_webhook_url, market_enabled')
      .order('user_id', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    const page = data ?? []
    out.push(
      ...page.map(
        (row: {
          user_id: string
          enabled: boolean
          webhook_url: string | null
          market_webhook_url: string | null
          market_enabled: boolean
        }) => ({
          userId: row.user_id,
          enabled: row.enabled,
          webhookUrl: row.webhook_url,
          marketWebhookUrl: row.market_webhook_url,
          marketEnabled: row.market_enabled,
        }),
      ),
    )
    if (page.length < 1000) break
  }
  return out
}

export async function saveDiscordMarketWebhook(userId: string, url: string | null): Promise<void> {
  const { error } = await db
    .from('user_discord_settings')
    .upsert({ user_id: userId, market_webhook_url: url, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

/** Task 165 step 2e: the per-account 經濟快報 switch, shared by the admin console and the
 * self-service `discord-my-settings` action. */
export async function setDiscordMarketEnabled(userId: string, enabled: boolean): Promise<void> {
  const { error } = await db
    .from('user_discord_settings')
    .upsert({ user_id: userId, market_enabled: enabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

/** Self-service read of the caller's own 經濟快報 override, plus (Task 165 step 2f) its two send
 * times — `discord-my-settings` only. */
export async function readDiscordMarketSettings(
  userId: string,
): Promise<{ enabled: boolean; webhookUrl: string | null; marketBriefTime: string | null; marketFullTime: string | null }> {
  const { data, error } = await db
    .from('user_discord_settings')
    .select('market_enabled, market_webhook_url, market_brief_time, market_full_time')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { enabled: false, webhookUrl: null, marketBriefTime: null, marketFullTime: null }
  return {
    enabled: data.market_enabled,
    webhookUrl: data.market_webhook_url,
    marketBriefTime: data.market_brief_time,
    marketFullTime: data.market_full_time,
  }
}

/** Typed for `discordMySettings.ts`'s `HoldingsOutcome` (the self-service market sends never
 * produce `no-holdings`, but the shared `MySettingsDeps.finishMarket` signature carries the full
 * type). `kind` distinguishes 「測試經濟快報連線」 (`'test'`) from the real-edition preview
 * (`'preview'`, Task 165 step 2h) — both are manual sends; the tick's own sends go through
 * `finishMarketCopy`. Nothing writes `kind: 'market'` any more (spec discord-market-preview.md §2). */
export async function finishDiscordMyMarket(userId: string, ymd: string, kind: 'test' | 'preview', outcome: HoldingsOutcome): Promise<void> {
  const httpStatus = outcome.kind === 'sent' || outcome.kind === 'failed' ? outcome.httpStatus : null
  const reason = outcome.kind === 'skipped' || outcome.kind === 'failed' ? outcome.reason : null
  const { error } = await db
    .from('user_discord_send_log')
    .insert({ user_id: userId, taipei_ymd: ymd, kind, status: outcome.kind, http_status: httpStatus, reason })
  if (error) throw new Error(error.message)
}

/** Task 165 step 2f: writes all three per-account send times at once; `null` = inherit. */
export async function saveDiscordTimes(
  userId: string,
  times: { marketBriefTime: string | null; marketFullTime: string | null; holdingsTime: string | null },
): Promise<void> {
  const { error } = await db
    .from('user_discord_settings')
    .upsert(
      {
        user_id: userId,
        market_brief_time: times.marketBriefTime,
        market_full_time: times.marketFullTime,
        holdings_time: times.holdingsTime,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
  if (error) throw new Error(error.message)
}

/** schema.sql §15's `discord_schedule_get()` — jobname/schedule only, never `command`. */
export async function readDiscordScheduleJobs(): Promise<Array<{ jobname: string; schedule: string }>> {
  const { data, error } = await db.rpc('discord_schedule_get')
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{ jobname: string; schedule: string }>
}

export async function writeDiscordSchedule(s: {
  briefHour: number
  briefMinute: number
  fullHour: number
  fullMinute: number
}): Promise<void> {
  const { error } = await db.rpc('discord_schedule_set', {
    brief_hour: s.briefHour,
    brief_minute: s.briefMinute,
    full_hour: s.fullHour,
    full_minute: s.fullMinute,
  })
  if (error) throw new Error(error.message)
}

/** Admin console entry point: list / set-schedule / set-market / clear-market / test-market /
 * holdings-set / holdings-clear / holdings-enable / holdings-test. Never returns a webhook URL —
 * see `runDiscordAccountsOp`. */
export async function handleDiscordAccounts(body: GenerateReportRequestBody): Promise<Response> {
  const { action: _action, ...input } = body
  const deps: DiscordAccountsDeps = {
    ...holdingsDataDeps(),
    readSettings: readHoldingsSettings,
    saveWebhook: saveHoldingsWebhookUrl,
    clearWebhook: clearHoldingsWebhookUrl,
    setEnabled: setHoldingsEnabled,
    lastSend: readHoldingsLastSend,
    countManualToday: countHoldingsManualToday,
    listAccounts: listDiscordAccounts,
    listSettings: listDiscordAccountSettings,
    saveMarketWebhook: saveDiscordMarketWebhook,
    setMarketEnabled: setDiscordMarketEnabled,
    readScheduleJobs: readDiscordScheduleJobs,
    writeSchedule: writeDiscordSchedule,
  }
  const result = await runDiscordAccountsOp(deps, input)
  if (!result.ok) {
    const status =
      result.error === 'bad-request' ||
      result.error === 'invalid-url' ||
      result.error === 'invalid-time' ||
      result.error === 'not-configured' ||
      result.error === 'unknown-user'
        ? 400
        : result.error === 'quota'
          ? 429
          : 409
    return json(result, status)
  }
  return json(result)
}

/** Self-service entry point (Task 165 step 2e, spec discord-user-self-service.md §5.3/§7): the
 * signed-in account managing its own 經濟快報 and 個人持股 webhooks. `assertUser` must run first —
 * `userId` never comes from the request body (§7). Never returns a webhook URL — see `runMySettingsOp`. */
export async function handleDiscordMySettings(req: Request, body: GenerateReportRequestBody): Promise<Response> {
  const auth = await assertUser(req)
  if (auth instanceof Response) return auth

  const { action: _action, ...input } = body
  const deps: MySettingsDeps = {
    ...holdingsDataDeps(),
    readSettings: readHoldingsSettings,
    saveWebhook: saveHoldingsWebhookUrl,
    clearWebhook: clearHoldingsWebhookUrl,
    setEnabled: setHoldingsEnabled,
    lastSend: readHoldingsLastSend,
    countManualToday: countHoldingsManualToday,
    readMarket: readDiscordMarketSettings,
    saveMarketWebhook: saveDiscordMarketWebhook,
    setMarketEnabled: setDiscordMarketEnabled,
    finishMarket: finishDiscordMyMarket,
    readWebhook: readDiscordWebhookRow,
    saveTimes: saveDiscordTimes,
    readScheduleJobs: readDiscordScheduleJobs,
    loadIndex: (symbol) => fetchJson<IndexChartResponse>(indexChartUrl(symbol)),
    loadUsdTwd: loadDiscordUsdTwd,
    loadMacro: loadDiscordMacro,
    loadMargin: (ymd) => fetchJson<MarginSummaryResponse>(marginSummaryUrl(ymd)),
  }
  const result = await runMySettingsOp(deps, auth.userId, input)
  if (!result.ok) {
    const status =
      result.error === 'bad-request' ||
      result.error === 'invalid-url' ||
      result.error === 'invalid-time' ||
      result.error === 'not-configured'
        ? 400
        : result.error === 'quota'
          ? 429
          : 409
    return json(result, status)
  }
  return json(result)
}
