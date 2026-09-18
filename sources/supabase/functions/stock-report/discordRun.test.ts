import { describe, expect, it, vi } from 'vitest'
import {
  runDiscordSummary,
  runWebhookOp,
  type RunOutcome,
  type SendLogRow,
  type SummaryDeps,
  type WebhookAdminDeps,
} from './discordRun.ts'
import type { DiscordPayload, DiscordSendResult } from './discordWebhook.ts'
import {
  FAKE_TOKEN,
  FAKE_WEBHOOK,
  GSPC_PREOPEN,
  MACRO_LINES,
  MARGIN_MS_0916,
  MARKET_DAY_0916,
  N225_MIDSESSION,
  USD_TWD,
  MARKET_ASOF_0916,
} from './discordTestFixtures.ts'

/** 17:05 and 21:30 Taipei on 2026-09-16. */
const BRIEF_AT = new Date('2026-09-16T09:05:00Z')
const FULL_AT = new Date('2026-09-16T13:30:00Z')

function summaryDeps(over: Partial<SummaryDeps> = {}) {
  const deps = {
    now: vi.fn(() => BRIEF_AT),
    loadMarketFile: vi.fn(async () => ({ asOf: MARKET_ASOF_0916, days: [MARKET_DAY_0916] })),
    loadWebhookUrl: vi.fn(async () => FAKE_WEBHOOK),
    claimSend: vi.fn(async () => true),
    finishSend: vi.fn(async () => {}),
    loadIndex: vi.fn(async (symbol: string) => {
      if (symbol === '^KS11') throw new Error('yahoo down')
      return symbol === '^GSPC' ? GSPC_PREOPEN : N225_MIDSESSION
    }),
    loadUsdTwd: vi.fn(async () => USD_TWD),
    loadMacro: vi.fn(async () => MACRO_LINES),
    loadMargin: vi.fn(async () => MARGIN_MS_0916),
    post: vi.fn(async (): Promise<DiscordSendResult> => ({ ok: true, httpStatus: 204 })),
    log: vi.fn(async () => {}),
    ...over,
  }
  return deps
}

function posted(deps: ReturnType<typeof summaryDeps>): DiscordPayload {
  expect(deps.post).toHaveBeenCalledTimes(1)
  return vi.mocked(deps.post).mock.calls[0][1]
}

/** Description of the card whose title contains `name`. */
function fieldOf(p: DiscordPayload, name: string): string | undefined {
  return p.embeds.find((e) => e.title.includes(name))?.description
}

function footerOf(p: DiscordPayload, name: string): string | undefined {
  return p.embeds.find((e) => e.title.includes(name))?.footer?.text
}

function heading(p: DiscordPayload): string | undefined {
  return p.content?.split('\n')[0]
}

describe('runDiscordSummary', () => {
  it('skips a day with no TAIEX row without touching the webhook', async () => {
    const deps = summaryDeps({ loadMarketFile: vi.fn(async () => ({ days: [{ ...MARKET_DAY_0916, date: '2026-09-15' }] })) })
    const out = await runDiscordSummary(deps, 'brief')
    expect(out).toEqual({ kind: 'skipped', reason: 'no-market-day' })
    expect(deps.finishSend).toHaveBeenCalledWith('2026-09-16', 'brief', out)
    expect(deps.loadWebhookUrl).not.toHaveBeenCalled()
    expect(deps.claimSend).not.toHaveBeenCalled()
    expect(deps.loadIndex).not.toHaveBeenCalled()
    expect(deps.post).not.toHaveBeenCalled()
  })

  it('treats an unreadable market file as no market day', async () => {
    const deps = summaryDeps({ loadMarketFile: vi.fn(async () => { throw new Error('storage down') }) })
    expect(await runDiscordSummary(deps, 'brief')).toEqual({ kind: 'skipped', reason: 'no-market-day' })
    expect(deps.post).not.toHaveBeenCalled()
  })

  it('skips when no webhook is configured', async () => {
    const deps = summaryDeps({ loadWebhookUrl: vi.fn(async () => null) })
    const out = await runDiscordSummary(deps, 'full')
    expect(out).toEqual({ kind: 'skipped', reason: 'no-webhook' })
    expect(deps.finishSend).toHaveBeenCalledWith('2026-09-16', 'full', out)
    expect(deps.claimSend).not.toHaveBeenCalled()
    expect(deps.post).not.toHaveBeenCalled()
  })

  it('does nothing when the day and edition are already claimed', async () => {
    const deps = summaryDeps({ claimSend: vi.fn(async () => false) })
    expect(await runDiscordSummary(deps, 'brief')).toEqual({ kind: 'skipped', reason: 'already-sent' })
    expect(deps.claimSend).toHaveBeenCalledWith('2026-09-16', 'brief')
    expect(deps.post).not.toHaveBeenCalled()
    expect(deps.finishSend).not.toHaveBeenCalled()
  })

  it('sends the brief edition without loading macro or margin', async () => {
    const deps = summaryDeps()
    const out = await runDiscordSummary(deps, 'brief')
    expect(out).toEqual({ kind: 'sent', httpStatus: 204 })
    expect(deps.loadMacro).not.toHaveBeenCalled()
    expect(deps.loadMargin).not.toHaveBeenCalled()
    expect(deps.loadIndex).toHaveBeenCalledTimes(8)
    expect(vi.mocked(deps.post).mock.calls[0][0]).toBe(FAKE_WEBHOOK)
    const p = posted(deps)
    expect(heading(p)).toBe('## 📊 台股盤後快報 09/16(三)')
    expect(footerOf(p, '台股大盤')).toBe('09/16 15:05 更新')
    expect(p.embeds.find((e) => e.title.includes('三大法人'))?.title).toBe('🏦 三大法人・盤後初步（億元）')
    expect(fieldOf(p, '匯率')).toBe('```\nUSD/TWD  31.773 +0.056\n```')
    expect(deps.finishSend).toHaveBeenCalledWith('2026-09-16', 'brief', out)
    expect(deps.log).not.toHaveBeenCalled()
  })

  it('uses completed closes and marks a failed index as missing', async () => {
    const deps = summaryDeps()
    await runDiscordSummary(deps, 'brief')
    const lines = fieldOf(posted(deps), '國際指數')!.split('\n')
    expect(lines[1]).toBe('日經225   63,923 ▲0.69%')
    expect(lines[2]).toBe('KOSPI    暫無資料')
    expect(lines[5]).toBe('S&P 500    7,552 ▼0.45%')
  })

  it('treats a failed fx load as missing', async () => {
    const deps = summaryDeps({ loadUsdTwd: vi.fn(async () => { throw new Error('x') }) })
    await runDiscordSummary(deps, 'brief')
    expect(fieldOf(posted(deps), '匯率')).toBe('暫無資料')
  })

  it('sends the full edition with margin and macro', async () => {
    const deps = summaryDeps({ now: vi.fn(() => FULL_AT) })
    const out = await runDiscordSummary(deps, 'full')
    expect(out).toEqual({ kind: 'sent', httpStatus: 204 })
    expect(deps.loadMargin).toHaveBeenCalledWith('20260916')
    const p = posted(deps)
    expect(heading(p)).toBe('## 📋 台股盤後完整版 09/16(三)')
    expect(footerOf(p, '融資融券')).toBe('09/16 資料')
    expect(fieldOf(p, '融資融券')).toBe(
      '```\n融資張 9,248,877 +58,366\n融資億   5,861.7   +39.3\n融券張   197,048  -1,004\n```',
    )
    expect(fieldOf(p, '美國總經')?.split('\n')[1]).toBe('核心CPI 08月')
  })

  it('refuses margin totals dated another day', async () => {
    const deps = summaryDeps({
      now: vi.fn(() => FULL_AT),
      loadMargin: vi.fn(async () => ({ ...MARGIN_MS_0916, date: '20260915' })),
    })
    await runDiscordSummary(deps, 'full')
    expect(fieldOf(posted(deps), '融資融券')).toBe('尚未公布')
  })

  it('treats unpublished or failed margin and macro as missing', async () => {
    const deps = summaryDeps({
      now: vi.fn(() => FULL_AT),
      loadMargin: vi.fn(async () => { throw new Error('twse down') }),
      loadMacro: vi.fn(async () => { throw new Error('storage down') }),
    })
    expect((await runDiscordSummary(deps, 'full')).kind).toBe('sent')
    const p = posted(deps)
    expect(fieldOf(p, '融資融券')).toBe('尚未公布')
    expect(fieldOf(p, '美國總經')).toBe('暫無資料')
  })

  it('records a failed post and logs it without the URL', async () => {
    const deps = summaryDeps({
      post: vi.fn(async (): Promise<DiscordSendResult> => ({ ok: false, httpStatus: 404, reason: 'webhook-gone' })),
    })
    const out = await runDiscordSummary(deps, 'brief')
    expect(out).toEqual({ kind: 'failed', httpStatus: 404, reason: 'webhook-gone' })
    expect(deps.finishSend).toHaveBeenCalledWith('2026-09-16', 'brief', out)
    expect(deps.log).toHaveBeenCalledWith({
      level: 'warn',
      message: 'discord summary send failed',
      detail: { status: 404, code: 'webhook-gone', name: 'brief' },
    })
    expect(JSON.stringify(vi.mocked(deps.log).mock.calls)).not.toContain(FAKE_TOKEN)
    expect(JSON.stringify(vi.mocked(deps.finishSend).mock.calls)).not.toContain(FAKE_TOKEN)
  })

  it('propagates a claim failure', async () => {
    const deps = summaryDeps({ claimSend: vi.fn(async () => { throw new Error('db down') }) })
    await expect(runDiscordSummary(deps, 'brief')).rejects.toThrow('db down')
    expect(deps.post).not.toHaveBeenCalled()
  })

  it('uses the Taipei date, not the UTC date', async () => {
    const deps = summaryDeps({
      now: vi.fn(() => new Date('2026-09-16T16:30:00Z')), // 2026-09-17 00:30 Taipei
    })
    expect(await runDiscordSummary(deps, 'brief')).toEqual({ kind: 'skipped', reason: 'no-market-day' })
    expect(deps.finishSend).toHaveBeenCalledWith('2026-09-17', 'brief', expect.anything())
  })
})

const RECENT: SendLogRow[] = [
  { taipeiYmd: '2026-09-16', edition: 'brief', status: 'sent', httpStatus: 204, reason: null, at: '2026-09-16T09:05:02Z' },
]

function adminDeps(
  initial: string | null = null,
  market: { days?: typeof MARKET_DAY_0916[]; asOf?: string | null } | null = { asOf: MARKET_ASOF_0916, days: [MARKET_DAY_0916] },
) {
  let stored: { url: string; updatedAt: string } | null = initial
    ? { url: initial, updatedAt: '2026-09-15T01:00:00.000Z' }
    : null
  const deps = {
    now: vi.fn(() => BRIEF_AT),
    readWebhook: vi.fn(async () => stored),
    writeWebhook: vi.fn(async (url: string) => {
      stored = { url, updatedAt: BRIEF_AT.toISOString() }
    }),
    deleteWebhook: vi.fn(async () => {
      stored = null
    }),
    recentSends: vi.fn(async () => RECENT),
    finishSend: vi.fn(async (_ymd: string, _edition: string, _outcome: RunOutcome) => {}),
    post: vi.fn(async (_url: string, _payload: DiscordPayload): Promise<DiscordSendResult> => ({ ok: true, httpStatus: 204 })),
    loadMarketFile: vi.fn(async () => market),
    loadIndex: vi.fn(async (symbol: string) => (symbol === '^GSPC' ? GSPC_PREOPEN : N225_MIDSESSION)),
    loadUsdTwd: vi.fn(async () => USD_TWD),
    loadMacro: vi.fn(async () => MACRO_LINES),
    loadMargin: vi.fn(async () => MARGIN_MS_0916),
  } satisfies WebhookAdminDeps
  return deps
}

describe('runWebhookOp', () => {
  it.each([
    ['null', null],
    ['string', 'get'],
    ['array', ['get']],
    ['no op', {}],
    ['unknown op', { op: 'delete' }],
  ])('rejects %s input', async (_name, body) => {
    const deps = adminDeps(FAKE_WEBHOOK)
    expect(await runWebhookOp(deps, body)).toEqual({ ok: false, error: 'bad-request' })
    expect(deps.writeWebhook).not.toHaveBeenCalled()
    expect(deps.deleteWebhook).not.toHaveBeenCalled()
    expect(deps.post).not.toHaveBeenCalled()
  })

  it('reports an unconfigured webhook', async () => {
    const deps = adminDeps()
    expect(await runWebhookOp(deps, { op: 'get' })).toEqual({
      ok: true,
      status: { configured: false, last4: null, updatedAt: null, recent: RECENT },
    })
    expect(deps.recentSends).toHaveBeenCalledWith(10)
  })

  it('reports a configured webhook by its last four characters only', async () => {
    const out = await runWebhookOp(adminDeps(FAKE_WEBHOOK), { op: 'get' })
    expect(out).toEqual({
      ok: true,
      status: { configured: true, last4: 'Wxyz', updatedAt: '2026-09-15T01:00:00.000Z', recent: RECENT },
    })
    expect(JSON.stringify(out)).not.toContain(FAKE_TOKEN)
  })

  it.each([
    ['missing url', { op: 'set' }],
    ['non-string url', { op: 'set', url: 42 }],
    ['foreign url', { op: 'set', url: 'https://example.com/hook' }],
  ])('refuses to store a %s', async (_name, body) => {
    const deps = adminDeps()
    expect(await runWebhookOp(deps, body)).toEqual({ ok: false, error: 'invalid-url' })
    expect(deps.writeWebhook).not.toHaveBeenCalled()
  })

  it('stores a trimmed valid URL and returns only its status', async () => {
    const deps = adminDeps()
    const out = await runWebhookOp(deps, { op: 'set', url: `  ${FAKE_WEBHOOK}\n` })
    expect(deps.writeWebhook).toHaveBeenCalledWith(FAKE_WEBHOOK)
    expect(out).toEqual({
      ok: true,
      status: { configured: true, last4: 'Wxyz', updatedAt: BRIEF_AT.toISOString(), recent: RECENT },
    })
    expect(JSON.stringify(out)).not.toContain(FAKE_TOKEN)
  })

  it('clears the webhook', async () => {
    const deps = adminDeps(FAKE_WEBHOOK)
    const out = await runWebhookOp(deps, { op: 'clear' })
    expect(deps.deleteWebhook).toHaveBeenCalledTimes(1)
    expect(out).toMatchObject({ ok: true, status: { configured: false, last4: null } })
  })

  it('refuses a test send without a webhook', async () => {
    const deps = adminDeps()
    expect(await runWebhookOp(deps, { op: 'test' })).toEqual({ ok: false, error: 'not-configured' })
    expect(deps.post).not.toHaveBeenCalled()
    expect(deps.finishSend).not.toHaveBeenCalled()
  })

  it('sends a test message and records it', async () => {
    const deps = adminDeps(FAKE_WEBHOOK)
    const out = await runWebhookOp(deps, { op: 'test' })
    expect(deps.post).toHaveBeenCalledTimes(1)
    const [url, payload] = deps.post.mock.calls[0] as unknown as [string, DiscordPayload]
    expect(url).toBe(FAKE_WEBHOOK)
    expect(payload.embeds[0].title).toBe('🔔 Discord 連線測試')
    expect(payload.embeds[0].timestamp).toBe(BRIEF_AT.toISOString())
    expect(deps.finishSend).toHaveBeenCalledWith('2026-09-16', 'test', { kind: 'sent', httpStatus: 204 })
    expect(out).toMatchObject({ ok: true, test: { ok: true, httpStatus: 204 }, status: { configured: true } })
    expect(JSON.stringify(out)).not.toContain(FAKE_TOKEN)
  })

  it('records a failed test send', async () => {
    const deps = adminDeps(FAKE_WEBHOOK)
    deps.post.mockResolvedValueOnce({ ok: false, httpStatus: 404, reason: 'webhook-gone' })
    const out = await runWebhookOp(deps, { op: 'test' })
    expect(deps.finishSend).toHaveBeenCalledWith('2026-09-16', 'test', {
      kind: 'failed',
      httpStatus: 404,
      reason: 'webhook-gone',
    })
    expect(out).toMatchObject({ ok: true, test: { ok: false, httpStatus: 404, reason: 'webhook-gone' } })
  })
})

describe('runWebhookOp — preview (real content, sent now)', () => {
  function previewPayload(deps: ReturnType<typeof adminDeps>): DiscordPayload {
    expect(deps.post).toHaveBeenCalledTimes(1)
    return vi.mocked(deps.post).mock.calls[0][1]
  }

  it.each([
    ['missing edition', { op: 'preview' }],
    ['test edition', { op: 'preview', edition: 'test' }],
    ['unknown edition', { op: 'preview', edition: 'weekly' }],
  ])('rejects a %s', async (_name, body) => {
    const deps = adminDeps(FAKE_WEBHOOK)
    expect(await runWebhookOp(deps, body)).toEqual({ ok: false, error: 'bad-request' })
    expect(deps.post).not.toHaveBeenCalled()
    expect(deps.loadMarketFile).not.toHaveBeenCalled()
  })

  it('refuses without a webhook and loads nothing', async () => {
    const deps = adminDeps()
    expect(await runWebhookOp(deps, { op: 'preview', edition: 'brief' })).toEqual({ ok: false, error: 'not-configured' })
    expect(deps.loadMarketFile).not.toHaveBeenCalled()
    expect(deps.loadIndex).not.toHaveBeenCalled()
    expect(deps.post).not.toHaveBeenCalled()
  })

  it("sends today's brief content labelled as a preview, without macro or margin", async () => {
    const deps = adminDeps(FAKE_WEBHOOK)
    const out = await runWebhookOp(deps, { op: 'preview', edition: 'brief' })
    const p = previewPayload(deps)
    expect(vi.mocked(deps.post).mock.calls[0][0]).toBe(FAKE_WEBHOOK)
    expect(heading(p)).toBe('## 【預覽】📊 台股盤後快報 09/16(三)')
    expect(p.allowed_mentions).toEqual({ parse: [] })
    expect(fieldOf(p, '台股大盤')).toBe('```\n加權指數  45,848.90\n漲跌點數    +337.41 🔴\n漲跌幅度     +0.74% 🔴\n成交金額  6,759.7億\n```')
    expect(footerOf(p, '台股大盤')).toBe('09/16 15:05 更新')
    expect(fieldOf(p, '匯率')).toBe('```\nUSD/TWD  31.773 +0.056\n```')
    expect(deps.loadIndex).toHaveBeenCalledTimes(8)
    expect(deps.loadMacro).not.toHaveBeenCalled()
    expect(deps.loadMargin).not.toHaveBeenCalled()
    expect(deps.finishSend).toHaveBeenCalledWith('2026-09-16', 'test', { kind: 'sent', httpStatus: 204 })
    expect(out).toMatchObject({
      ok: true,
      test: { ok: true, httpStatus: 204 },
      preview: { edition: 'brief', marketDate: '2026-09-16' },
      status: { configured: true, last4: 'Wxyz' },
    })
    expect(JSON.stringify(out)).not.toContain(FAKE_TOKEN)
  })

  it('falls back to the latest market day when today has none, whatever the array order', async () => {
    const deps = adminDeps(FAKE_WEBHOOK, {
      days: [MARKET_DAY_0916, { ...MARKET_DAY_0916, date: '2026-09-15', taiex: 45511.49, changePoints: -12.5 }],
    })
    deps.now.mockReturnValue(new Date('2026-09-19T02:00:00Z')) // Saturday 10:00 Taipei
    const out = await runWebhookOp(deps, { op: 'preview', edition: 'full' })
    const p = previewPayload(deps)
    expect(heading(p)).toBe('## 【預覽】📋 台股盤後完整版 09/16(三)')
    expect(footerOf(p, '台股大盤')).toBe('⚠️ 09/16 資料・非今日')
    expect(footerOf(p, '融資融券')).toBe('⚠️ 09/16 資料・非今日')
    expect(deps.loadMargin).toHaveBeenCalledWith('20260916')
    expect(fieldOf(p, '融資融券')).toBe(
      '```\n融資張 9,248,877 +58,366\n融資億   5,861.7   +39.3\n融券張   197,048  -1,004\n```',
    )
    expect(fieldOf(p, '美國總經')?.split('\n')[1]).toBe('核心CPI 08月')
    expect(deps.finishSend).toHaveBeenCalledWith('2026-09-19', 'test', { kind: 'sent', httpStatus: 204 })
    expect(out).toMatchObject({ ok: true, preview: { edition: 'full', marketDate: '2026-09-16' } })
  })

  it('never picks a day with a missing or malformed date as the latest', async () => {
    const bad = [
      { ...MARKET_DAY_0916, date: undefined },
      { ...MARKET_DAY_0916, date: 20260918 },
      { ...MARKET_DAY_0916, date: '2026-9-18' },
    ] as unknown as typeof MARKET_DAY_0916[]
    const deps = adminDeps(FAKE_WEBHOOK, { days: [...bad, { ...MARKET_DAY_0916, date: '2026-09-15' }] })
    deps.now.mockReturnValue(new Date('2026-09-19T02:00:00Z'))
    for (const edition of ['brief', 'full'] as const) {
      const out = await runWebhookOp(deps, { op: 'preview', edition })
      expect(out).toMatchObject({ ok: true, preview: { edition, marketDate: '2026-09-15' } })
    }
  })

  it('reports no market data when every day is malformed', async () => {
    const bad = [{ ...MARKET_DAY_0916, date: undefined }, { ...MARKET_DAY_0916, date: null }] as unknown as typeof MARKET_DAY_0916[]
    const deps = adminDeps(FAKE_WEBHOOK, { days: bad })
    deps.now.mockReturnValue(new Date('2026-09-19T02:00:00Z'))
    for (const edition of ['brief', 'full'] as const) {
      expect(await runWebhookOp(deps, { op: 'preview', edition })).toEqual({ ok: false, error: 'no-market-data' })
    }
    expect(deps.post).not.toHaveBeenCalled()
  })

  it("marks margin totals from another day as unpublished", async () => {
    const deps = adminDeps(FAKE_WEBHOOK)
    deps.loadMargin.mockResolvedValueOnce({ ...MARGIN_MS_0916, date: '20260915' })
    await runWebhookOp(deps, { op: 'preview', edition: 'full' })
    expect(fieldOf(previewPayload(deps), '融資融券')).toBe('尚未公布')
  })

  it.each([
    ['an empty file', { days: [] }],
    ['a null file', null],
  ])('reports no market data for %s and sends nothing', async (_name, market) => {
    const deps = adminDeps(FAKE_WEBHOOK, market)
    expect(await runWebhookOp(deps, { op: 'preview', edition: 'brief' })).toEqual({ ok: false, error: 'no-market-data' })
    expect(deps.post).not.toHaveBeenCalled()
    expect(deps.finishSend).not.toHaveBeenCalled()
  })

  it('treats an unreadable market file as no market data', async () => {
    const deps = adminDeps(FAKE_WEBHOOK)
    deps.loadMarketFile.mockRejectedValueOnce(new Error('storage down'))
    expect(await runWebhookOp(deps, { op: 'preview', edition: 'brief' })).toEqual({ ok: false, error: 'no-market-data' })
    expect(deps.post).not.toHaveBeenCalled()
  })

  it('records a failed preview send', async () => {
    const deps = adminDeps(FAKE_WEBHOOK)
    deps.post.mockResolvedValueOnce({ ok: false, httpStatus: 404, reason: 'webhook-gone' })
    const out = await runWebhookOp(deps, { op: 'preview', edition: 'brief' })
    expect(deps.finishSend).toHaveBeenCalledWith('2026-09-16', 'test', {
      kind: 'failed',
      httpStatus: 404,
      reason: 'webhook-gone',
    })
    expect(out).toMatchObject({ ok: true, test: { ok: false, httpStatus: 404, reason: 'webhook-gone' } })
  })
})
