// @vitest-environment jsdom
/**
 * Task 165 step 2e Revision 1 (spec discord-user-self-service.md §Revision 1 R3): this block is
 * read-only. Every account edits its own webhooks through `Settings/DiscordMySettings.tsx`, so
 * the admin console must offer no input, toggle or send button here — the "no editing controls"
 * case below is the point of the revision, not an afterthought.
 *
 * The schedule moved to `DiscordSection.tsx` (R4); its tests moved with it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { DiscordAccountsSnapshot } from '../../services/discordAccounts'

const svc = vi.hoisted(() => ({
  getDiscordAccounts: vi.fn(),
  saveDiscordSchedule: vi.fn(),
  saveMarketWebhook: vi.fn(),
  clearMarketWebhook: vi.fn(),
  testMarketWebhook: vi.fn(),
  toggleMarketEnabled: vi.fn(),
  saveHoldingsWebhook: vi.fn(),
  clearHoldingsWebhook: vi.fn(),
  setHoldingsEnabled: vi.fn(),
  testHoldingsWebhook: vi.fn(),
  previewHoldingsReport: vi.fn(),
}))
vi.mock('../../services/discordAccounts', () => svc)

import { DiscordAccountsSection } from './DiscordAccountsSection'

// Assembled from pieces with a fake token: this repo is public and runs secret scanning.
const TOKEN = 'Fake_Token-' + 'x'.repeat(57) + 'Nnnn'
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '33333333-3333-4333-8333-333333333333'

const BASE: DiscordAccountsSnapshot = {
  schedule: { brief: '17:30', full: '21:30', holdingsAligned: true },
  accounts: [
    {
      userId: U1,
      email: 'alice@example.com',
      market: { custom: false, last4: null, enabled: false },
      holdings: { configured: true, last4: 'Hhhh', enabled: true },
      lastSend: { kind: 'daily', ymd: '2026-09-17', status: 'sent', reason: null, at: '2026-09-17T09:30:03Z' },
    },
    {
      userId: U2,
      email: 'bob@example.com',
      market: { custom: true, last4: 'Mmmm', enabled: true },
      holdings: { configured: false, last4: null, enabled: false },
      lastSend: { kind: 'market', ymd: '2026-09-17', status: 'failed', reason: 'webhook-gone', at: '2026-09-17T13:30:02Z' },
    },
    {
      userId: U3,
      email: null,
      market: { custom: false, last4: null, enabled: false },
      holdings: { configured: false, last4: null, enabled: false },
      lastSend: null,
    },
  ],
}

async function renderLoaded(snapshot: DiscordAccountsSnapshot = BASE) {
  svc.getDiscordAccounts.mockResolvedValue(snapshot)
  render(<DiscordAccountsSection />)
  await screen.findByText('alice@example.com')
}

function rowOf(email: string): HTMLElement {
  return screen.getByText(email).closest('tr') as HTMLElement
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DiscordAccountsSection — loading', () => {
  it('shows a hint while loading', () => {
    svc.getDiscordAccounts.mockReturnValue(new Promise(() => {}))
    render(<DiscordAccountsSection />)
    expect(screen.getByText('載入中…')).toBeTruthy()
  })

  it('shows the error text when the list cannot be loaded', async () => {
    svc.getDiscordAccounts.mockRejectedValue(new Error('Discord 設定失敗（HTTP 500）'))
    render(<DiscordAccountsSection />)
    expect(await screen.findByText('Discord 設定失敗（HTTP 500）')).toBeTruthy()
  })
})

describe('DiscordAccountsSection — the read-only table', () => {
  it('names every account, falling back for a missing email', async () => {
    await renderLoaded()
    expect(screen.getByText('alice@example.com')).toBeTruthy()
    expect(screen.getByText('bob@example.com')).toBeTruthy()
    expect(screen.getByText('（無 Email）')).toBeTruthy()
  })

  it('distinguishes 繼承 from a custom channel, and pushing from paused', async () => {
    await renderLoaded({
      ...BASE,
      accounts: BASE.accounts.map((a) =>
        a.userId === U3 ? { ...a, market: { custom: true, last4: 'Pppp', enabled: false } } : a,
      ),
    })
    expect(within(rowOf('alice@example.com')).getByText('繼承')).toBeTruthy()
    expect(within(rowOf('bob@example.com')).getByText('自訂・推送中')).toBeTruthy()
    expect(within(rowOf('（無 Email）')).getByText('自訂・已暫停')).toBeTruthy()
  })

  it('reports 個人持股 state per account', async () => {
    await renderLoaded()
    expect(within(rowOf('alice@example.com')).getByText('已設定・推送中')).toBeTruthy()
    expect(within(rowOf('bob@example.com')).getByText('未設定')).toBeTruthy()
  })

  it('renders the last send, and a dash when there is none', async () => {
    await renderLoaded()
    expect(within(rowOf('alice@example.com')).getByText('2026-09-17 持股日報 已送出')).toBeTruthy()
    expect(within(rowOf('bob@example.com')).getByText('2026-09-17 經濟快報 失敗')).toBeTruthy()
    expect(within(rowOf('（無 Email）')).getByText('—')).toBeTruthy()
  })

  it('offers no editing control at all — that is what Revision 1 removed', async () => {
    await renderLoaded()
    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(document.querySelectorAll('input').length).toBe(0)
    expect(document.querySelectorAll('select').length).toBe(0)
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('never puts a webhook URL in the DOM', async () => {
    await renderLoaded()
    expect(document.body.innerHTML).not.toContain(TOKEN)
  })

  it('calls no mutating service function', async () => {
    await renderLoaded()
    await waitFor(() => expect(svc.getDiscordAccounts).toHaveBeenCalled())
    for (const [name, fn] of Object.entries(svc)) {
      if (name === 'getDiscordAccounts') continue
      expect(fn).not.toHaveBeenCalled()
    }
  })
})
