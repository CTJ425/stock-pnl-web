// @vitest-environment jsdom
/**
 * Task 165 step 2e — spec discord-user-self-service.md §11, the UI rows of the test charter.
 *
 * These exist because the first build of this panel read a flat `{ marketLast4, ... }` shape the
 * Edge Function never sent: every field came back `undefined`, `undefined !== null` held, and the
 * buttons D6 requires to stay disabled were live. The assertions below are written against the
 * rendered state, not against the service's field names, so the same seam break cannot pass again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { DiscordMySettingsResult } from '../../services/discordMySettings'

const svc = vi.hoisted(() => ({
  getDiscordMySettings: vi.fn(),
  saveMyMarketWebhook: vi.fn(),
  clearMyMarketWebhook: vi.fn(),
  toggleMyMarketEnabled: vi.fn(),
  testMyMarketWebhook: vi.fn(),
  saveMyHoldingsWebhook: vi.fn(),
  clearMyHoldingsWebhook: vi.fn(),
  toggleMyHoldingsEnabled: vi.fn(),
  testMyHoldingsWebhook: vi.fn(),
  previewMyHoldingsReport: vi.fn(),
}))
vi.mock('../../services/discordMySettings', () => svc)

import { DiscordMySettings } from './DiscordMySettings'

// Assembled from pieces with a fake token: this repo is public and runs secret scanning.
const TOKEN = 'Fake_Token-' + 'x'.repeat(57) + 'Mmmm'
const HOOK = 'https://discord.com' + '/api/' + 'webhooks/' + '1'.repeat(18) + '/' + TOKEN

const NOTHING: DiscordMySettingsResult = {
  status: {
    global: { configured: true, last4: 'Gggg' },
    globalSchedule: { brief: '17:30', full: '21:30' },
    market: { enabled: false, configured: false, last4: null, briefTime: null, fullTime: null },
    holdings: { enabled: false, configured: false, last4: null, lastSend: null, time: null },
  },
}

const BOTH_STORED: DiscordMySettingsResult = {
  status: {
    global: { configured: true, last4: 'Gggg' },
    globalSchedule: { brief: '17:30', full: '21:30' },
    market: { enabled: true, configured: true, last4: 'Mmmm', briefTime: null, fullTime: null },
    holdings: { enabled: false, configured: true, last4: 'Hhhh', lastSend: null, time: null },
  },
}

async function renderWith(result: DiscordMySettingsResult) {
  svc.getDiscordMySettings.mockResolvedValue(result)
  render(<DiscordMySettings />)
  await waitFor(() => expect(screen.getByLabelText('經濟快報 Webhook 網址')).toBeTruthy())
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DiscordMySettings — before a URL is stored', () => {
  it('hides the 經濟快報 test and switch entirely while inheriting', async () => {
    await renderWith(NOTHING)
    // Absent, not disabled: inheriting the global channel is nothing this app can switch or test,
    // so a greyed-out control would read as broken right under 「全域頻道：已設定」.
    expect(screen.queryByText('測試經濟快報連線')).toBeNull()
    expect(screen.queryByLabelText('啟用經濟快報')).toBeNull()
    expect(screen.getByText('要在自己的頻道也收到一份，請在上方設定 Webhook 網址。')).toBeTruthy()
  })

  it('still disables the 個人持股 controls, which do have an own channel to wait for', async () => {
    await renderWith(NOTHING)
    expect(screen.getByText('測試持股報告連線').closest('button')!.disabled).toBe(true)
    expect(screen.getByText('完整推送測試').closest('button')!.disabled).toBe(true)
    expect((screen.getByLabelText('啟用個人持股報告') as HTMLButtonElement).disabled).toBe(true)
  })

  it('names both channels, so inheriting is not mistaken for silence', async () => {
    await renderWith(NOTHING)
    expect(screen.getByText('全域頻道：已設定 …Gggg — 你會在共用頻道收到')).toBeTruthy()
    expect(screen.getByText('我的頻道：未設定（不另外發送）')).toBeTruthy()
    expect(screen.getByText('目前：未設定')).toBeTruthy()
  })

  it('says outright when nobody receives 經濟快報 at all', async () => {
    await renderWith({
      status: {
        global: { configured: false, last4: null },
        globalSchedule: { brief: '17:30', full: '21:30' },
        market: { enabled: false, configured: false, last4: null, briefTime: null, fullTime: null },
        holdings: { enabled: false, configured: false, last4: null, lastSend: null, time: null },
      },
    })
    expect(screen.getByText('全域頻道：管理員尚未設定，目前沒有人收得到')).toBeTruthy()
  })
})

describe('DiscordMySettings — once a URL is stored', () => {
  it('enables the test buttons and the toggles', async () => {
    await renderWith(BOTH_STORED)
    expect(screen.getByText('測試經濟快報連線').closest('button')!.disabled).toBe(false)
    expect(screen.getByText('測試持股報告連線').closest('button')!.disabled).toBe(false)
    expect((screen.getByLabelText('啟用經濟快報') as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText('要在自己的頻道也收到一份，請在上方設定 Webhook 網址。')).toBeNull()
    expect((screen.getByLabelText('啟用個人持股報告') as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows last4 only, never the webhook URL', async () => {
    await renderWith(BOTH_STORED)
    expect(screen.getByText('我的頻道：…Mmmm（推送中）')).toBeTruthy()
    expect(screen.getByText('目前：…Hhhh')).toBeTruthy()
    expect(document.body.textContent).not.toContain(HOOK)
    expect(document.body.textContent).not.toContain(TOKEN)
  })

  it('distinguishes a paused own channel from an unset one', async () => {
    await renderWith({
      status: {
        global: { configured: true, last4: 'Gggg' },
        globalSchedule: { brief: '17:30', full: '21:30' },
        market: { enabled: false, configured: true, last4: 'Mmmm', briefTime: null, fullTime: null },
        holdings: { enabled: false, configured: false, last4: null, lastSend: null, time: null },
      },
    })
    expect(screen.getByText('我的頻道：…Mmmm（已暫停）')).toBeTruthy()
  })

  it('reflects each switch independently', async () => {
    await renderWith(BOTH_STORED)
    expect(screen.getByLabelText('啟用經濟快報').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('啟用個人持股報告').getAttribute('aria-pressed')).toBe('false')
  })

  it('starts both URL inputs empty — the URL never round-trips back', async () => {
    await renderWith(BOTH_STORED)
    expect((screen.getByLabelText('經濟快報 Webhook 網址') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('個人持股報告 Webhook 網址') as HTMLInputElement).value).toBe('')
  })
})

/**
 * Task 165 step 2g: the admin console no longer shows a schedule, so 「全域」 names a screen the
 * user cannot reach. The inherit option keeps carrying the resolved time — that part was never
 * the problem — but calls itself 預設.
 */
describe('DiscordMySettings — the inherit option', () => {
  function optionLabels(label: string): string[] {
    const el = screen.getByLabelText(label) as HTMLSelectElement
    return Array.from(el.options).map((o) => o.textContent ?? '')
  }

  it('labels inherit as 預設 with the resolved time, never as 全域', async () => {
    await renderWith(BOTH_STORED)
    expect(optionLabels('快報發送時間')[0]).toBe('預設（17:30）')
    expect(optionLabels('完整版發送時間')[0]).toBe('預設（21:30）')
    expect(optionLabels('發送時間')[0]).toBe('預設（17:30）')
    for (const l of [...optionLabels('快報發送時間'), ...optionLabels('完整版發送時間'), ...optionLabels('發送時間')]) {
      expect(l).not.toContain('全域')
    }
  })

  it('still says so when no default time exists', async () => {
    await renderWith({
      status: {
        ...BOTH_STORED.status,
        globalSchedule: { brief: null, full: null },
      },
    })
    expect(optionLabels('快報發送時間')[0]).toBe('預設（尚未設定）')
    expect(optionLabels('完整版發送時間')[0]).toBe('預設（尚未設定）')
  })
})
