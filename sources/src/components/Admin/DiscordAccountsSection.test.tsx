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
  schedule: { brief: '17:05', full: '21:30', holdingsAligned: true },
  accounts: [
    {
      userId: U1,
      email: 'alice@example.com',
      market: { custom: false, last4: null },
      holdings: { configured: true, last4: 'Hhhh', enabled: true },
      lastSend: { kind: 'daily', ymd: '2026-09-17', status: 'sent', reason: null, at: '2026-09-17T09:05:03Z' },
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

function withAccount(userId: string, patch: Partial<DiscordAccountsSnapshot['accounts'][number]>): DiscordAccountsSnapshot {
  return { ...BASE, accounts: BASE.accounts.map((a) => (a.userId === userId ? { ...a, ...patch } : a)) }
}

async function renderLoaded() {
  render(<DiscordAccountsSection />)
  await screen.findByText('alice@example.com')
}

function select(label: string): HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLSelectElement
}

function optionValues(label: string): string[] {
  return Array.from(select(label).options).map((o) => o.value)
}

function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest('tr') as HTMLElement
}

function openEditor(label: string): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: `編輯 ${label}` }))
  return screen.getByRole('region', { name: `${label} 的 Discord 設定` })
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

  describe('schedule', () => {
    it('shows the current times in the four drop-downs', async () => {
      await renderLoaded()
      expect(screen.getByRole('heading', { name: 'Discord 排程' })).toBeTruthy()
      expect(select('快報與個人持股報告（時）').value).toBe('17')
      expect(select('快報與個人持股報告（分）').value).toBe('05')
      expect(select('經濟快報（時）').value).toBe('21')
      expect(select('經濟快報（分）').value).toBe('30')
      expect(optionValues('快報與個人持股報告（時）')).toEqual(['17', '18', '19', '20'])
      expect(optionValues('經濟快報（時）')).toEqual(['21', '22', '23'])
      expect(optionValues('經濟快報（分）')).toEqual(['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'])
      expect(screen.getByText('平日（週一至週五）台北時間；快報與個人持股報告同時發送。')).toBeTruthy()
    })

    it('offers no 17:00 and moves 00 to 05 when the hour becomes 17', async () => {
      await renderLoaded()
      expect(optionValues('快報與個人持股報告（分）')[0]).toBe('05')
      fireEvent.change(select('快報與個人持股報告（時）'), { target: { value: '18' } })
      fireEvent.change(select('快報與個人持股報告（分）'), { target: { value: '00' } })
      expect(select('快報與個人持股報告（分）').value).toBe('00')
      fireEvent.change(select('快報與個人持股報告（時）'), { target: { value: '17' } })
      expect(select('快報與個人持股報告（分）').value).toBe('05')
    })

    it('saves only after a change', async () => {
      svc.saveDiscordSchedule.mockResolvedValue({ ...BASE, schedule: { brief: '18:30', full: '22:00', holdingsAligned: true } })
      await renderLoaded()
      const save = screen.getByRole('button', { name: '儲存排程' }) as HTMLButtonElement
      expect(save.disabled).toBe(true)
      fireEvent.change(select('快報與個人持股報告（時）'), { target: { value: '18' } })
      fireEvent.change(select('快報與個人持股報告（分）'), { target: { value: '30' } })
      fireEvent.change(select('經濟快報（時）'), { target: { value: '22' } })
      fireEvent.change(select('經濟快報（分）'), { target: { value: '00' } })
      expect(save.disabled).toBe(false)
      fireEvent.click(save)
      await screen.findByText('排程已儲存')
      expect(svc.saveDiscordSchedule).toHaveBeenCalledWith('18:30', '22:00')
      expect(select('快報與個人持股報告（時）').value).toBe('18')
      expect(save.disabled).toBe(true)
    })

    it('warns when the holdings job drifted from the brief, and allows saving as is', async () => {
      svc.getDiscordAccounts.mockResolvedValue({ ...BASE, schedule: { ...BASE.schedule, holdingsAligned: false } })
      svc.saveDiscordSchedule.mockResolvedValue(BASE)
      await renderLoaded()
      expect(screen.getByText('個人持股報告的時間和快報不一致；再儲存一次排程即可對齊。')).toBeTruthy()
      const save = screen.getByRole('button', { name: '儲存排程' }) as HTMLButtonElement
      expect(save.disabled).toBe(false)
      fireEvent.click(save)
      await waitFor(() => expect(svc.saveDiscordSchedule).toHaveBeenCalledWith('17:05', '21:30'))
    })

    it('locks the drop-downs when the cron jobs are missing', async () => {
      svc.getDiscordAccounts.mockResolvedValue({ ...BASE, schedule: { brief: null, full: null, holdingsAligned: false } })
      await renderLoaded()
      expect(screen.getByText('找不到 Discord 排程工作，無法調整。')).toBeTruthy()
      expect(select('快報與個人持股報告（時）').disabled).toBe(true)
      expect(select('經濟快報（分）').disabled).toBe(true)
      expect((screen.getByRole('button', { name: '儲存排程' }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('shows a save error', async () => {
      svc.saveDiscordSchedule.mockRejectedValue(new Error('Discord 設定失敗（HTTP 400：時間不在可選範圍）'))
      await renderLoaded()
      fireEvent.change(select('經濟快報（時）'), { target: { value: '23' } })
      fireEvent.click(screen.getByRole('button', { name: '儲存排程' }))
      await screen.findByText('Discord 設定失敗（HTTP 400：時間不在可選範圍）')
    })
  })

  describe('account table', () => {
    it('lists every account with both settings and the last send', async () => {
      await renderLoaded()
      expect(screen.getByRole('heading', { name: '各帳號 Discord 設定' })).toBeTruthy()
      const alice = rowOf('alice@example.com')
      expect(alice.textContent).toContain('繼承全域')
      expect(alice.textContent).toContain('…Hhhh')
      expect(alice.textContent).toContain('推送中')
      expect(alice.textContent).toContain('2026-09-17 持股日報 已送出')
      const bob = rowOf('bob@example.com')
      expect(bob.textContent).toContain('自訂 …Mmmm')
      expect(bob.textContent).toContain('未設定')
      expect(bob.textContent).toContain('2026-09-17 經濟快報 失敗')
      const nobody = rowOf('（無 Email）')
      expect(nobody.textContent).toContain('—')
    })

    it('shows a load error', async () => {
      svc.getDiscordAccounts.mockRejectedValue(new Error('Discord 設定失敗（HTTP 403）'))
      render(<DiscordAccountsSection />)
      await screen.findByText('Discord 設定失敗（HTTP 403）')
    })

    it('opens one editor at a time', async () => {
      await renderLoaded()
      openEditor('alice@example.com')
      openEditor('bob@example.com')
      expect(screen.queryByRole('region', { name: 'alice@example.com 的 Discord 設定' })).toBeNull()
      expect(screen.getByRole('region', { name: 'bob@example.com 的 Discord 設定' })).toBeTruthy()
    })
  })

  describe('經濟快報 per account', () => {
    it('shows inherit for an account without its own URL, and no test button', async () => {
      await renderLoaded()
      const ed = openEditor('alice@example.com')
      expect((within(ed).getByLabelText('繼承全域') as HTMLInputElement).checked).toBe(true)
      expect(within(ed).getByText('會送到全域頻道，不另外發送。')).toBeTruthy()
      expect(within(ed).queryByLabelText('經濟快報 Webhook 網址')).toBeNull()
      expect(within(ed).queryByRole('button', { name: '測試經濟快報' })).toBeNull()
    })

    it('switches to a custom URL after validating it in the browser', async () => {
      svc.saveMarketWebhook.mockResolvedValue(withAccount(U1, { market: { custom: true, last4: 'Nnnn' } }))
      await renderLoaded()
      const ed = openEditor('alice@example.com')
      fireEvent.click(within(ed).getByLabelText('自訂 Webhook'))
      const input = within(ed).getByLabelText('經濟快報 Webhook 網址') as HTMLInputElement
      expect(input.type).toBe('password')

      fireEvent.change(input, { target: { value: 'https://example.com/hook' } })
      fireEvent.click(within(ed).getByRole('button', { name: '儲存經濟快報網址' }))
      expect(within(ed).getByText('網址格式不正確')).toBeTruthy()
      expect(svc.saveMarketWebhook).not.toHaveBeenCalled()

      fireEvent.change(input, { target: { value: HOOK } })
      fireEvent.click(within(ed).getByRole('button', { name: '儲存經濟快報網址' }))
      await waitFor(() => expect(svc.saveMarketWebhook).toHaveBeenCalledWith(U1, HOOK))
      await waitFor(() => expect(rowOf('alice@example.com').textContent).toContain('自訂 …Nnnn'))
      assertNoUrlInDom()
    })

    it('goes back to inherit only after a confirm', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      svc.clearMarketWebhook.mockResolvedValue(withAccount(U2, { market: { custom: false, last4: null } }))
      await renderLoaded()
      const ed = openEditor('bob@example.com')
      expect((within(ed).getByLabelText('自訂 Webhook') as HTMLInputElement).checked).toBe(true)

      fireEvent.click(within(ed).getByLabelText('繼承全域'))
      expect(confirm).toHaveBeenCalledWith('改回繼承全域？這個帳號的自訂網址會被刪除。')
      expect(svc.clearMarketWebhook).not.toHaveBeenCalled()

      confirm.mockReturnValue(true)
      fireEvent.click(within(ed).getByLabelText('繼承全域'))
      await waitFor(() => expect(svc.clearMarketWebhook).toHaveBeenCalledWith(U2))
      await waitFor(() => expect(rowOf('bob@example.com').textContent).toContain('繼承全域'))
    })

    it('sends a test message to the custom URL', async () => {
      svc.testMarketWebhook.mockResolvedValue({ ...BASE, send: { ok: true, httpStatus: 204 } })
      await renderLoaded()
      const ed = openEditor('bob@example.com')
      fireEvent.click(within(ed).getByRole('button', { name: '測試經濟快報' }))
      await within(ed).findByText('測試訊息已送出')
      expect(svc.testMarketWebhook).toHaveBeenCalledWith(U2)
    })
  })

  describe('個人持股報告 per account', () => {
    it('saves a holdings URL for an account that has none, with no toggle or test before it', async () => {
      svc.saveHoldingsWebhook.mockResolvedValue(withAccount(U2, { holdings: { configured: true, last4: 'Nnnn', enabled: false } }))
      await renderLoaded()
      const ed = openEditor('bob@example.com')
      expect(within(ed).getByText('不提供繼承全域：持股屬個人資料，不會送到共用頻道。')).toBeTruthy()
      expect(within(ed).queryByRole('button', { name: '每個交易日推送個人持股報告' })).toBeNull()
      expect(within(ed).queryByRole('button', { name: '測試持股報告' })).toBeNull()

      const input = within(ed).getByLabelText('個人持股報告 Webhook 網址') as HTMLInputElement
      expect(input.type).toBe('password')
      fireEvent.change(input, { target: { value: HOOK } })
      fireEvent.click(within(ed).getByRole('button', { name: '儲存持股報告網址' }))
      await waitFor(() => expect(svc.saveHoldingsWebhook).toHaveBeenCalledWith(U2, HOOK))
      await waitFor(() => expect(input.value).toBe(''))
      expect(within(ed).getByRole('button', { name: '每個交易日推送個人持股報告' })).toBeTruthy()
      assertNoUrlInDom()
    })

    it('refuses an invalid holdings URL in the browser', async () => {
      await renderLoaded()
      const ed = openEditor('bob@example.com')
      fireEvent.change(within(ed).getByLabelText('個人持股報告 Webhook 網址'), { target: { value: 'nope' } })
      fireEvent.click(within(ed).getByRole('button', { name: '儲存持股報告網址' }))
      expect(within(ed).getByText('網址格式不正確')).toBeTruthy()
      expect(svc.saveHoldingsWebhook).not.toHaveBeenCalled()
    })

    it('toggles the daily card', async () => {
      svc.setHoldingsEnabled.mockResolvedValue(withAccount(U1, { holdings: { configured: true, last4: 'Hhhh', enabled: false } }))
      await renderLoaded()
      const ed = openEditor('alice@example.com')
      const toggle = within(ed).getByRole('button', { name: '每個交易日推送個人持股報告' })
      expect(toggle.getAttribute('aria-pressed')).toBe('true')
      expect(toggle.className).toContain('adm-toggle')
      fireEvent.click(toggle)
      await waitFor(() => expect(svc.setHoldingsEnabled).toHaveBeenCalledWith(U1, false))
      await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'))
      expect(rowOf('alice@example.com').textContent).toContain('已暫停')
    })

    it('reports a failed holdings test send', async () => {
      svc.testHoldingsWebhook.mockResolvedValue({ ...BASE, send: { ok: false, httpStatus: 404, reason: 'webhook-gone' } })
      await renderLoaded()
      const ed = openEditor('alice@example.com')
      fireEvent.click(within(ed).getByRole('button', { name: '測試持股報告' }))
      await within(ed).findByText('發送失敗（網址已失效）')
      expect(svc.testHoldingsWebhook).toHaveBeenCalledWith(U1)
    })

    it('clears the holdings URL only after a confirm', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      svc.clearHoldingsWebhook.mockResolvedValue(withAccount(U1, { holdings: { configured: false, last4: null, enabled: false } }))
      await renderLoaded()
      const ed = openEditor('alice@example.com')
      fireEvent.click(within(ed).getByRole('button', { name: '清除持股報告網址' }))
      expect(confirm).toHaveBeenCalledWith('清除這個帳號的個人持股報告網址？')
      expect(svc.clearHoldingsWebhook).not.toHaveBeenCalled()
      confirm.mockReturnValue(true)
      fireEvent.click(within(ed).getByRole('button', { name: '清除持股報告網址' }))
      await waitFor(() => expect(svc.clearHoldingsWebhook).toHaveBeenCalledWith(U1))
      await waitFor(() => expect(rowOf('alice@example.com').textContent).toContain('未設定'))
    })

    it('shows a server error in the editor', async () => {
      svc.testHoldingsWebhook.mockRejectedValue(new Error('Discord 設定失敗（HTTP 429：今天的手動發送次數已用完）'))
      await renderLoaded()
      const ed = openEditor('alice@example.com')
      fireEvent.click(within(ed).getByRole('button', { name: '測試持股報告' }))
      await within(ed).findByText('Discord 設定失敗（HTTP 429：今天的手動發送次數已用完）')
    })
  })
})
