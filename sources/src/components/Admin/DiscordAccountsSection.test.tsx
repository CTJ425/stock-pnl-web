// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { DiscordAccountsSnapshot } from '../../services/discordAccounts'

const svc = vi.hoisted(() => ({
  getDiscordAccounts: vi.fn(),
  saveDiscordSchedule: vi.fn(),
  saveMarketWebhook: vi.fn(),
  clearMarketWebhook: vi.fn(),
  testMarketWebhook: vi.fn(),
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
const HOOK = 'https://discord.com' + '/api/' + 'webhooks/' + '1'.repeat(18) + '/' + TOKEN
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '33333333-3333-4333-8333-333333333333'

const BASE: DiscordAccountsSnapshot = {
  schedule: { brief: '17:30', full: '21:30', holdingsAligned: true },
  accounts: [
    {
      userId: U1,
      email: 'alice@example.com',
      market: { custom: false, last4: null },
      holdings: { configured: true, last4: 'Hhhh', enabled: true },
      lastSend: { kind: 'daily', ymd: '2026-09-17', status: 'sent', reason: null, at: '2026-09-17T09:30:03Z' },
    },
    {
      userId: U2,
      email: 'bob@example.com',
      market: { custom: true, last4: 'Mmmm' },
      holdings: { configured: false, last4: null, enabled: false },
      lastSend: { kind: 'market', ymd: '2026-09-17', status: 'failed', reason: 'webhook-gone', at: '2026-09-17T13:30:02Z' },
    },
    {
      userId: U3,
      email: null,
      market: { custom: false, last4: null },
      holdings: { configured: false, last4: null, enabled: false },
      lastSend: null,
    },
  ],
}

const BRIEF = '快報與個人持股報告發送時間'
const FULL = '經濟快報發送時間'

function withAccount(userId: string, patch: Partial<DiscordAccountsSnapshot['accounts'][number]>): DiscordAccountsSnapshot {
  return { ...BASE, accounts: BASE.accounts.map((a) => (a.userId === userId ? { ...a, ...patch } : a)) }
}

async function renderLoaded() {
  render(<DiscordAccountsSection />)
  await screen.findByRole('navigation', { name: '帳號清單' })
}

function accountList(): HTMLElement {
  return screen.getByRole('navigation', { name: '帳號清單' })
}

function accountButton(label: string): HTMLElement {
  return within(accountList()).getByRole('button', { name: new RegExp(label.replace(/[()（）.]/g, '\\$&')) })
}

function detail(label: string): HTMLElement {
  return screen.getByRole('region', { name: `${label} 的 Discord 設定` })
}

function pick(label: string): HTMLElement {
  fireEvent.click(accountButton(label))
  return detail(label)
}

function select(label: string): HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLSelectElement
}

function optionValues(label: string): string[] {
  return Array.from(select(label).options).map((o) => o.value)
}

function assertNoUrlInDom() {
  expect(document.body.innerHTML).not.toContain(TOKEN)
  for (const el of Array.from(document.querySelectorAll('input'))) expect(el.value).not.toContain(TOKEN)
}

describe('DiscordAccountsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    svc.getDiscordAccounts.mockResolvedValue(BASE)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('puts the account settings above the schedule', async () => {
    await renderLoaded()
    const accounts = screen.getByRole('heading', { name: '各帳號設定' })
    const schedule = screen.getByRole('heading', { name: '發送排程（平日・台北時間）' })
    expect(accounts.compareDocumentPosition(schedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  describe('loading', () => {
    it('keeps a heading while loading', () => {
      svc.getDiscordAccounts.mockReturnValue(new Promise(() => {}))
      render(<DiscordAccountsSection />)
      expect(screen.getByRole('heading', { name: '各帳號設定與發送排程' })).toBeTruthy()
      expect(screen.getByText('載入中…')).toBeTruthy()
    })

    it('shows a load error under that heading', async () => {
      svc.getDiscordAccounts.mockRejectedValue(new Error('Discord 設定失敗（HTTP 403）'))
      render(<DiscordAccountsSection />)
      await screen.findByText('Discord 設定失敗（HTTP 403）')
      expect(screen.getByRole('heading', { name: '各帳號設定與發送排程' })).toBeTruthy()
    })
  })

  describe('account list', () => {
    it('lists every account with a short status, and selects the first one', async () => {
      await renderLoaded()
      const buttons = within(accountList()).getAllByRole('button')
      expect(buttons).toHaveLength(3)
      expect(buttons[0].textContent).toContain('alice@example.com')
      expect(buttons[0].textContent).toContain('繼承・推送中')
      expect(buttons[1].textContent).toContain('bob@example.com')
      expect(buttons[1].textContent).toContain('自訂・未設定')
      expect(buttons[2].textContent).toContain('（無 Email）')
      expect(buttons[2].textContent).toContain('繼承・未設定')
      expect(buttons[0].getAttribute('aria-current')).toBe('true')
      expect(buttons[1].getAttribute('aria-current')).toBeNull()
      const d = detail('alice@example.com')
      expect(within(d).getByRole('heading', { name: 'alice@example.com' })).toBeTruthy()
      expect(d.textContent).toContain('上次發送：2026-09-17 持股日報 已送出')
    })

    it('switches the detail with one click and marks the current account', async () => {
      await renderLoaded()
      const d = pick('bob@example.com')
      expect(within(d).getByRole('heading', { name: 'bob@example.com' })).toBeTruthy()
      expect(d.textContent).toContain('上次發送：2026-09-17 經濟快報 失敗')
      expect(accountButton('bob@example.com').getAttribute('aria-current')).toBe('true')
      expect(accountButton('alice@example.com').getAttribute('aria-current')).toBeNull()
      expect(screen.queryByRole('region', { name: 'alice@example.com 的 Discord 設定' })).toBeNull()
      const none = pick('（無 Email）')
      expect(none.textContent).toContain('上次發送：—')
    })

    it('clears a typed URL when switching accounts', async () => {
      await renderLoaded()
      const a = detail('alice@example.com')
      fireEvent.change(within(a).getByLabelText('個人持股報告 Webhook 網址'), { target: { value: 'half-typed' } })
      const b = pick('bob@example.com')
      expect((within(b).getByLabelText('個人持股報告 Webhook 網址') as HTMLInputElement).value).toBe('')
    })

    it('shows a load error', async () => {
      svc.getDiscordAccounts.mockRejectedValue(new Error('Discord 設定失敗（HTTP 403）'))
      render(<DiscordAccountsSection />)
      await screen.findByText('Discord 設定失敗（HTTP 403）')
    })
  })

  describe('經濟快報 per account', () => {
    it('shows inherit for an account without its own URL, and no test button', async () => {
      await renderLoaded()
      const d = detail('alice@example.com')
      expect((within(d).getByLabelText('繼承全域') as HTMLInputElement).checked).toBe(true)
      expect(d.textContent).toContain('目前：繼承全域（不另外發送）')
      expect(within(d).queryByLabelText('經濟快報 Webhook 網址')).toBeNull()
      expect(within(d).queryByRole('button', { name: '測試經濟快報連線' })).toBeNull()
    })

    it('switches to a custom URL after validating it in the browser', async () => {
      svc.saveMarketWebhook.mockResolvedValue(withAccount(U1, { market: { custom: true, last4: 'Nnnn' } }))
      await renderLoaded()
      const d = detail('alice@example.com')
      fireEvent.click(within(d).getByLabelText('自訂 Webhook'))
      const input = within(d).getByLabelText('經濟快報 Webhook 網址') as HTMLInputElement
      expect(input.type).toBe('password')

      fireEvent.change(input, { target: { value: 'https://example.com/hook' } })
      fireEvent.click(within(d).getByRole('button', { name: '儲存經濟快報網址' }))
      expect(within(d).getByText('網址格式不正確')).toBeTruthy()
      expect(svc.saveMarketWebhook).not.toHaveBeenCalled()

      fireEvent.change(input, { target: { value: HOOK } })
      fireEvent.click(within(d).getByRole('button', { name: '儲存經濟快報網址' }))
      await waitFor(() => expect(svc.saveMarketWebhook).toHaveBeenCalledWith(U1, HOOK))
      await waitFor(() => expect(detail('alice@example.com').textContent).toContain('目前：自訂 …Nnnn'))
      expect(accountButton('alice@example.com').textContent).toContain('自訂・推送中')
      assertNoUrlInDom()
    })

    it('goes back to inherit only after a confirm', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      svc.clearMarketWebhook.mockResolvedValue(withAccount(U2, { market: { custom: false, last4: null } }))
      await renderLoaded()
      const d = pick('bob@example.com')
      expect((within(d).getByLabelText('自訂 Webhook') as HTMLInputElement).checked).toBe(true)
      expect(d.textContent).toContain('目前：自訂 …Mmmm')

      fireEvent.click(within(d).getByLabelText('繼承全域'))
      expect(confirm).toHaveBeenCalledWith('改回繼承全域？這個帳號的自訂網址會被刪除。')
      expect(svc.clearMarketWebhook).not.toHaveBeenCalled()

      confirm.mockReturnValue(true)
      fireEvent.click(within(d).getByLabelText('繼承全域'))
      await waitFor(() => expect(svc.clearMarketWebhook).toHaveBeenCalledWith(U2))
      await waitFor(() => expect(detail('bob@example.com').textContent).toContain('目前：繼承全域（不另外發送）'))
    })

    it('sends a connection test to the custom URL', async () => {
      svc.testMarketWebhook.mockResolvedValue({ ...BASE, send: { ok: true, httpStatus: 204 } })
      await renderLoaded()
      const d = pick('bob@example.com')
      fireEvent.click(within(d).getByRole('button', { name: '測試經濟快報連線' }))
      await within(d).findByText('測試訊息已送出')
      expect(svc.testMarketWebhook).toHaveBeenCalledWith(U2)
    })
  })

  describe('個人持股報告 per account', () => {
    it('saves a holdings URL for an account that has none, with no toggle or tests before it', async () => {
      svc.saveHoldingsWebhook.mockResolvedValue(withAccount(U2, { holdings: { configured: true, last4: 'Nnnn', enabled: false } }))
      await renderLoaded()
      const d = pick('bob@example.com')
      expect(within(d).queryByRole('button', { name: '每個交易日推送個人持股報告' })).toBeNull()
      expect(within(d).queryByRole('button', { name: '測試持股報告連線' })).toBeNull()
      expect(within(d).queryByRole('button', { name: '完整推送測試' })).toBeNull()

      const input = within(d).getByLabelText('個人持股報告 Webhook 網址') as HTMLInputElement
      expect(input.type).toBe('password')
      fireEvent.change(input, { target: { value: HOOK } })
      fireEvent.click(within(d).getByRole('button', { name: '儲存持股報告網址' }))
      await waitFor(() => expect(svc.saveHoldingsWebhook).toHaveBeenCalledWith(U2, HOOK))
      await waitFor(() => expect(input.value).toBe(''))
      expect(within(d).getByRole('button', { name: '每個交易日推送個人持股報告' })).toBeTruthy()
      expect(within(d).getByRole('button', { name: '完整推送測試' })).toBeTruthy()
      expect(d.textContent).toContain('目前：…Nnnn')
      assertNoUrlInDom()
    })

    it('refuses an invalid holdings URL in the browser', async () => {
      await renderLoaded()
      const d = pick('bob@example.com')
      fireEvent.change(within(d).getByLabelText('個人持股報告 Webhook 網址'), { target: { value: 'nope' } })
      fireEvent.click(within(d).getByRole('button', { name: '儲存持股報告網址' }))
      expect(within(d).getByText('網址格式不正確')).toBeTruthy()
      expect(svc.saveHoldingsWebhook).not.toHaveBeenCalled()
    })

    it('toggles the daily card with an empty switch and a visible label', async () => {
      svc.setHoldingsEnabled.mockResolvedValue(withAccount(U1, { holdings: { configured: true, last4: 'Hhhh', enabled: false } }))
      await renderLoaded()
      const d = detail('alice@example.com')
      const toggle = within(d).getByRole('button', { name: '每個交易日推送個人持股報告' })
      expect(toggle.getAttribute('aria-pressed')).toBe('true')
      expect(toggle.className).toContain('adm-toggle')
      expect(toggle.textContent).toBe('')
      expect(within(d).getByText('每日推送')).toBeTruthy()
      fireEvent.click(toggle)
      await waitFor(() => expect(svc.setHoldingsEnabled).toHaveBeenCalledWith(U1, false))
      await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'))
      expect(accountButton('alice@example.com').textContent).toContain('繼承・已暫停')
    })

    it('reports a failed connection test', async () => {
      svc.testHoldingsWebhook.mockResolvedValue({ ...BASE, send: { ok: false, httpStatus: 404, reason: 'webhook-gone' } })
      await renderLoaded()
      const d = detail('alice@example.com')
      fireEvent.click(within(d).getByRole('button', { name: '測試持股報告連線' }))
      await within(d).findByText('發送失敗（網址已失效）')
      expect(svc.testHoldingsWebhook).toHaveBeenCalledWith(U1)
    })

    it('sends the full holdings report and names its data date', async () => {
      svc.previewHoldingsReport.mockResolvedValue({ ...BASE, send: { ok: true, httpStatus: 204 }, previewYmd: '2026-09-17' })
      await renderLoaded()
      const d = detail('alice@example.com')
      fireEvent.click(within(d).getByRole('button', { name: '完整推送測試' }))
      await within(d).findByText('已送出完整持股報告（資料日 2026-09-17）')
      expect(svc.previewHoldingsReport).toHaveBeenCalledWith(U1)
    })

    it('shows why a full report could not be sent', async () => {
      svc.previewHoldingsReport.mockRejectedValue(new Error('Discord 設定失敗（HTTP 409：這個帳號目前沒有持股）'))
      await renderLoaded()
      const d = detail('alice@example.com')
      fireEvent.click(within(d).getByRole('button', { name: '完整推送測試' }))
      await within(d).findByText('Discord 設定失敗（HTTP 409：這個帳號目前沒有持股）')
    })

    it('clears the holdings URL only after a confirm', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      svc.clearHoldingsWebhook.mockResolvedValue(withAccount(U1, { holdings: { configured: false, last4: null, enabled: false } }))
      await renderLoaded()
      const d = detail('alice@example.com')
      fireEvent.click(within(d).getByRole('button', { name: '清除持股報告網址' }))
      expect(confirm).toHaveBeenCalledWith('清除這個帳號的個人持股報告網址？')
      expect(svc.clearHoldingsWebhook).not.toHaveBeenCalled()
      confirm.mockReturnValue(true)
      fireEvent.click(within(d).getByRole('button', { name: '清除持股報告網址' }))
      await waitFor(() => expect(svc.clearHoldingsWebhook).toHaveBeenCalledWith(U1))
      await waitFor(() => expect(accountButton('alice@example.com').textContent).toContain('繼承・未設定'))
    })
  })

  describe('schedule', () => {
    it('offers one drop-down per slot, every half hour', async () => {
      await renderLoaded()
      expect(select(BRIEF).tagName).toBe('SELECT')
      expect(select(BRIEF).value).toBe('17:30')
      expect(select(FULL).value).toBe('21:30')
      expect(optionValues(BRIEF)).toEqual(['17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30'])
      expect(optionValues(FULL)).toEqual(['21:00', '21:30', '22:00', '22:30', '23:00', '23:30'])
      expect(screen.getByText('快報＋個人持股報告')).toBeTruthy()
      expect(screen.getByText('經濟快報（完整版）')).toBeTruthy()
    })

    it('saves only after a change', async () => {
      svc.saveDiscordSchedule.mockResolvedValue({ ...BASE, schedule: { brief: '18:30', full: '22:00', holdingsAligned: true } })
      await renderLoaded()
      const save = screen.getByRole('button', { name: '儲存排程' }) as HTMLButtonElement
      expect(save.disabled).toBe(true)
      fireEvent.change(select(BRIEF), { target: { value: '18:30' } })
      fireEvent.change(select(FULL), { target: { value: '22:00' } })
      expect(save.disabled).toBe(false)
      fireEvent.click(save)
      await screen.findByText('排程已儲存')
      expect(svc.saveDiscordSchedule).toHaveBeenCalledWith('18:30', '22:00')
      expect(select(BRIEF).value).toBe('18:30')
      expect(save.disabled).toBe(true)
    })

    it('shows an off-grid current time and asks for a new choice before saving', async () => {
      svc.getDiscordAccounts.mockResolvedValue({ ...BASE, schedule: { brief: '17:05', full: '21:30', holdingsAligned: true } })
      svc.saveDiscordSchedule.mockResolvedValue(BASE)
      await renderLoaded()
      expect(select(BRIEF).value).toBe('17:05')
      expect(optionValues(BRIEF)[0]).toBe('17:05')
      expect(screen.getByRole('option', { name: '17:05（目前設定，請改選）' })).toBeTruthy()
      const save = screen.getByRole('button', { name: '儲存排程' }) as HTMLButtonElement
      expect(save.disabled).toBe(true)
      fireEvent.change(select(FULL), { target: { value: '22:00' } })
      expect(save.disabled).toBe(true)
      fireEvent.change(select(BRIEF), { target: { value: '17:30' } })
      expect(save.disabled).toBe(false)
      fireEvent.click(save)
      await waitFor(() => expect(svc.saveDiscordSchedule).toHaveBeenCalledWith('17:30', '22:00'))
    })

    it('warns when the holdings job drifted from the brief, and allows saving as is', async () => {
      svc.getDiscordAccounts.mockResolvedValue({ ...BASE, schedule: { ...BASE.schedule, holdingsAligned: false } })
      svc.saveDiscordSchedule.mockResolvedValue(BASE)
      await renderLoaded()
      expect(screen.getByText('個人持股報告的時間和快報不一致；再儲存一次排程即可對齊。')).toBeTruthy()
      const save = screen.getByRole('button', { name: '儲存排程' }) as HTMLButtonElement
      expect(save.disabled).toBe(false)
      fireEvent.click(save)
      await waitFor(() => expect(svc.saveDiscordSchedule).toHaveBeenCalledWith('17:30', '21:30'))
    })

    it('locks the drop-downs when the cron jobs are missing', async () => {
      svc.getDiscordAccounts.mockResolvedValue({ ...BASE, schedule: { brief: null, full: null, holdingsAligned: false } })
      await renderLoaded()
      expect(screen.getByText('找不到 Discord 排程工作，無法調整。')).toBeTruthy()
      expect(select(BRIEF).disabled).toBe(true)
      expect(select(FULL).disabled).toBe(true)
      expect((screen.getByRole('button', { name: '儲存排程' }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('shows a save error', async () => {
      svc.saveDiscordSchedule.mockRejectedValue(new Error('Discord 設定失敗（HTTP 400：時間不在可選範圍）'))
      await renderLoaded()
      fireEvent.change(select(FULL), { target: { value: '23:00' } })
      fireEvent.click(screen.getByRole('button', { name: '儲存排程' }))
      expect(await screen.findByText('Discord 設定失敗（HTTP 400：時間不在可選範圍）', {}, { timeout: 3000 })).toBeTruthy()
    })
  })
})
