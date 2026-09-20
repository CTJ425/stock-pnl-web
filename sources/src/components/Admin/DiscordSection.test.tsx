// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DiscordWebhookStatus } from '../../services/discordWebhook'

const svc = vi.hoisted(() => ({
  getDiscordWebhookStatus: vi.fn(),
  saveDiscordWebhook: vi.fn(),
  clearDiscordWebhook: vi.fn(),
  testDiscordWebhook: vi.fn(),
  previewDiscordSummary: vi.fn(),
}))
vi.mock('../../services/discordWebhook', () => svc)

// Task 165 step 2e Revision 1 (spec R4): the send schedule moved into this section, so its
// service is now a dependency of DiscordSection too. These tests moved here with the UI.
const acc = vi.hoisted(() => ({
  getDiscordAccounts: vi.fn(),
  saveDiscordSchedule: vi.fn(),
}))
vi.mock('../../services/discordAccounts', () => acc)

import { DiscordSection } from './DiscordSection'

// Assembled from pieces with a fake token: this repo is public and runs secret scanning.
const TOKEN = 'Fake_Token-' + 'x'.repeat(57) + 'Wxyz'
const HOOK = 'https://discord.com' + '/api/' + 'webhooks/' + '1'.repeat(18) + '/' + TOKEN

const EMPTY: DiscordWebhookStatus = { configured: false, last4: null, updatedAt: null, recent: [] }
const SET: DiscordWebhookStatus = {
  configured: true,
  last4: 'Wxyz',
  updatedAt: '2026-09-16T09:00:00Z',
  recent: [
    { taipeiYmd: '2026-09-16', edition: 'brief', status: 'sent', httpStatus: 204, reason: null, at: '2026-09-16T09:05:02Z' },
    { taipeiYmd: '2026-09-15', edition: 'full', status: 'failed', httpStatus: 404, reason: 'webhook-gone', at: '2026-09-15T13:30:01Z' },
    { taipeiYmd: '2026-09-15', edition: 'test', status: 'skipped', httpStatus: null, reason: 'no-webhook', at: '2026-09-15T01:00:00Z' },
  ],
}

function urlInput(): HTMLInputElement {
  return screen.getByLabelText('Discord Webhook 網址') as HTMLInputElement
}

function assertNoUrlInDom() {
  expect(document.body.innerHTML).not.toContain(TOKEN)
  for (const el of Array.from(document.querySelectorAll('input'))) expect(el.value).not.toContain(TOKEN)
}

const BRIEF = '快報與個人持股報告發送時間'
const FULL = '經濟快報發送時間'

const SCHEDULE_BASE = {
  schedule: { brief: '17:30', full: '21:30', holdingsAligned: true },
  accounts: [],
}

function select(label: string): HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLSelectElement
}

function optionValues(label: string): string[] {
  return Array.from(select(label).options).map((o) => o.value)
}

describe('DiscordSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    acc.getDiscordAccounts.mockResolvedValue(SCHEDULE_BASE)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows an unconfigured webhook', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(EMPTY)
    render(<DiscordSection />)
    expect(await screen.findByText('尚未設定')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '全域 Webhook' })).toBeTruthy()
    // no recent sends → no toggle for them
    expect(screen.queryByRole('button', { name: /最近發送紀錄/ })).toBeNull()
    const input = urlInput()
    expect(input.type).toBe('password')
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.value).toBe('')
    expect((screen.getByRole('button', { name: '儲存' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull()
    expect(screen.queryByRole('button', { name: '測試發送' })).toBeNull()
  })

  it('shows a configured webhook by its last four characters and the recent sends', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(SET)
    render(<DiscordSection />)
    expect(await screen.findByText(/已設定（…Wxyz）/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '清除' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '測試發送' })).toBeTruthy()
    // collapsed by default
    const toggle = screen.getByRole('button', { name: '最近發送紀錄（3 筆）' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryAllByRole('row')).toHaveLength(0)
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    for (const h of ['時間', '類型', '狀態', 'HTTP', '原因']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeTruthy()
    }
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    // Taipei wall-clock time of `at`, independent of the test host's timezone.
    expect(rows[0].textContent).toContain('2026-09-16 17:05:02')
    expect(rows[1].textContent).toContain('2026-09-15 21:30:01')
    expect(rows[2].textContent).toContain('2026-09-15 09:00:00')
    expect(rows[0].textContent).toContain('快報')
    expect(rows[0].textContent).toContain('已送出')
    expect(rows[0].textContent).toContain('204')
    expect(rows[1].textContent).toContain('完整版')
    expect(rows[1].textContent).toContain('失敗')
    expect(rows[1].textContent).toContain('404')
    expect(rows[2].textContent).toContain('測試')
    expect(rows[2].textContent).toContain('略過')
    assertNoUrlInDom()
  })

  it('falls back to the Taipei date when a log time is unreadable', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue({
      ...SET,
      recent: [{ ...SET.recent[0], at: 'not-a-time' }],
    })
    render(<DiscordSection />)
    await screen.findByText(/已設定（…Wxyz）/)
    fireEvent.click(screen.getByRole('button', { name: '最近發送紀錄（1 筆）' }))
    const row = screen.getAllByRole('row')[1]
    expect(row.textContent).toContain('2026-09-16')
    expect(row.textContent).not.toContain('Invalid')
    expect(row.textContent).not.toContain('NaN')
  })

  it('rejects an invalid URL without saving', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(EMPTY)
    render(<DiscordSection />)
    await screen.findByText('尚未設定')
    fireEvent.change(urlInput(), { target: { value: 'https://example.com/hook' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(await screen.findByText('網址格式不正確，需為 https://discord.com/api/webhooks/…')).toBeTruthy()
    expect(svc.saveDiscordWebhook).not.toHaveBeenCalled()
  })

  it('saves a valid URL, clears the input, and never shows the URL', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(EMPTY)
    svc.saveDiscordWebhook.mockResolvedValue(SET)
    render(<DiscordSection />)
    await screen.findByText('尚未設定')
    fireEvent.change(urlInput(), { target: { value: HOOK } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(svc.saveDiscordWebhook).toHaveBeenCalledWith(HOOK))
    expect(await screen.findByText(/已設定（…Wxyz）/)).toBeTruthy()
    expect(urlInput().value).toBe('')
    assertNoUrlInDom()
  })

  it('reports a successful test send', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(SET)
    svc.testDiscordWebhook.mockResolvedValue({ status: SET, test: { ok: true, httpStatus: 204 } })
    render(<DiscordSection />)
    fireEvent.click(await screen.findByRole('button', { name: '測試發送' }))
    expect(await screen.findByText('測試訊息已送出')).toBeTruthy()
  })

  it.each([
    ['webhook-gone', '網址已失效'],
    ['rate-limited', 'Discord 限流'],
    ['http-error', 'Discord 回應錯誤'],
    ['network', '連線失敗'],
    ['invalid-url', '網址格式不正確'],
    ['something-else', '未知錯誤'],
  ])('explains a failed test send (%s)', async (reason, text) => {
    svc.getDiscordWebhookStatus.mockResolvedValue(SET)
    svc.testDiscordWebhook.mockResolvedValue({ status: SET, test: { ok: false, httpStatus: null, reason } })
    render(<DiscordSection />)
    fireEvent.click(await screen.findByRole('button', { name: '測試發送' }))
    expect(await screen.findByText(`發送失敗（${text}）`)).toBeTruthy()
  })

  it('shows a load failure instead of pretending the webhook is unset', async () => {
    svc.getDiscordWebhookStatus.mockRejectedValue(new Error('Discord 設定失敗（HTTP 500）'))
    render(<DiscordSection />)
    expect(await screen.findByText('Discord 設定失敗（HTTP 500）')).toBeTruthy()
    expect(screen.queryByText('尚未設定')).toBeNull()
  })

  it('shows a save failure and keeps the URL out of the page text', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(EMPTY)
    svc.saveDiscordWebhook.mockRejectedValue(new Error('Discord 設定失敗（HTTP 400）'))
    render(<DiscordSection />)
    await screen.findByText('尚未設定')
    fireEvent.change(urlInput(), { target: { value: HOOK } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(await screen.findByText('Discord 設定失敗（HTTP 400）')).toBeTruthy()
    expect(document.body.textContent).not.toContain(TOKEN)
    expect(urlInput().type).toBe('password')
  })

  it('shows a clear failure', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(SET)
    svc.clearDiscordWebhook.mockRejectedValue(new Error('Discord 設定失敗（HTTP 500）'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DiscordSection />)
    fireEvent.click(await screen.findByRole('button', { name: '清除' }))
    expect(await screen.findByText('Discord 設定失敗（HTTP 500）')).toBeTruthy()
    expect(screen.getByText(/已設定（…Wxyz）/)).toBeTruthy()
  })

  it('shows a rejected test send (e.g. HTTP 409 not-configured)', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(SET)
    svc.testDiscordWebhook.mockRejectedValue(new Error('Discord 設定失敗（HTTP 409）'))
    render(<DiscordSection />)
    fireEvent.click(await screen.findByRole('button', { name: '測試發送' }))
    expect(await screen.findByText('Discord 設定失敗（HTTP 409）')).toBeTruthy()
  })

  it('disables the actions while a request is in flight', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(SET)
    let release!: (v: unknown) => void
    svc.testDiscordWebhook.mockReturnValue(new Promise((r) => (release = r)))
    render(<DiscordSection />)
    const test = (await screen.findByRole('button', { name: '測試發送' })) as HTMLButtonElement
    fireEvent.click(test)
    fireEvent.click(test)
    expect(svc.testDiscordWebhook).toHaveBeenCalledTimes(1)
    expect(test.disabled).toBe(true)
    expect((screen.getByRole('button', { name: '清除' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(urlInput(), { target: { value: HOOK } })
    expect((screen.getByRole('button', { name: '儲存' }) as HTMLButtonElement).disabled).toBe(true)
    release({ status: SET, test: { ok: true, httpStatus: 204 } })
    expect(await screen.findByText('測試訊息已送出')).toBeTruthy()
    expect(test.disabled).toBe(false)
  })

  it('offers previews only when configured', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(EMPTY)
    render(<DiscordSection />)
    await screen.findByText('尚未設定')
    expect(screen.queryByRole('button', { name: '預覽快報' })).toBeNull()
    expect(screen.queryByRole('button', { name: '預覽完整版' })).toBeNull()
  })

  it('sends a brief preview only after confirmation and reports the data date', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(SET)
    svc.previewDiscordSummary.mockResolvedValue({
      status: SET,
      test: { ok: true, httpStatus: 204 },
      preview: { edition: 'brief', marketDate: '2026-09-16' },
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<DiscordSection />)
    const button = await screen.findByRole('button', { name: '預覽快報' })
    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledWith('要把快報的正式內容傳送到 Discord 頻道嗎？頻道成員都會看到。')
    expect(svc.previewDiscordSummary).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() => expect(svc.previewDiscordSummary).toHaveBeenCalledWith('brief'))
    expect(await screen.findByText('預覽已送出（快報，資料日期 2026-09-16）')).toBeTruthy()
  })

  it('sends a full preview and explains a failed send', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(SET)
    svc.previewDiscordSummary.mockResolvedValue({
      status: SET,
      test: { ok: false, httpStatus: 404, reason: 'webhook-gone' },
      preview: { edition: 'full', marketDate: '2026-09-16' },
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DiscordSection />)
    fireEvent.click(await screen.findByRole('button', { name: '預覽完整版' }))
    expect(confirm).toHaveBeenCalledWith('要把完整版的正式內容傳送到 Discord 頻道嗎？頻道成員都會看到。')
    await waitFor(() => expect(svc.previewDiscordSummary).toHaveBeenCalledWith('full'))
    expect(await screen.findByText('發送失敗（網址已失效）')).toBeTruthy()
  })

  it('shows a rejected preview and disables every action while it runs', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(SET)
    let fail!: (e: Error) => void
    svc.previewDiscordSummary.mockReturnValue(new Promise((_r, j) => (fail = j)))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DiscordSection />)
    const brief = (await screen.findByRole('button', { name: '預覽快報' })) as HTMLButtonElement
    fireEvent.click(brief)
    for (const name of ['預覽快報', '預覽完整版', '測試發送', '清除']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    fail(new Error('Discord 設定失敗（HTTP 409：找不到任何台股大盤資料）'))
    expect(await screen.findByText('Discord 設定失敗（HTTP 409：找不到任何台股大盤資料）')).toBeTruthy()
    expect(brief.disabled).toBe(false)
  })

  it('clears only after confirmation', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(SET)
    svc.clearDiscordWebhook.mockResolvedValue(EMPTY)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<DiscordSection />)
    const button = await screen.findByRole('button', { name: '清除' })
    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledWith('確定要清除 Discord Webhook？')
    expect(svc.clearDiscordWebhook).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() => expect(svc.clearDiscordWebhook).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('尚未設定')).toBeTruthy()
  })
})

async function renderSchedule(snapshot: unknown = SCHEDULE_BASE) {
  svc.getDiscordWebhookStatus.mockResolvedValue(SET)
  acc.getDiscordAccounts.mockResolvedValue(snapshot)
  render(<DiscordSection />)
  await waitFor(() => expect(screen.getByLabelText(BRIEF)).toBeTruthy())
}

describe('DiscordSection — 發送排程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    acc.getDiscordAccounts.mockResolvedValue(SCHEDULE_BASE)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('offers one drop-down per slot, every half hour', async () => {
    await renderSchedule()
    expect(select(BRIEF).value).toBe('17:30')
    expect(select(FULL).value).toBe('21:30')
    expect(optionValues(BRIEF)).toEqual(['17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30'])
    expect(optionValues(FULL)).toEqual(['21:00', '21:30', '22:00', '22:30', '23:00', '23:30'])
  })

  it('saves only after a change', async () => {
    acc.saveDiscordSchedule.mockResolvedValue({
      ...SCHEDULE_BASE,
      schedule: { brief: '18:30', full: '22:00', holdingsAligned: true },
    })
    await renderSchedule()
    const save = screen.getByRole('button', { name: '儲存排程' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(select(BRIEF), { target: { value: '18:30' } })
    fireEvent.change(select(FULL), { target: { value: '22:00' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await screen.findByText('排程已儲存')
    expect(acc.saveDiscordSchedule).toHaveBeenCalledWith('18:30', '22:00')
    expect(select(BRIEF).value).toBe('18:30')
    expect(save.disabled).toBe(true)
  })

  it('shows an off-grid current time and asks for a new choice before saving', async () => {
    acc.saveDiscordSchedule.mockResolvedValue(SCHEDULE_BASE)
    await renderSchedule({ ...SCHEDULE_BASE, schedule: { brief: '17:05', full: '21:30', holdingsAligned: true } })
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
    await waitFor(() => expect(acc.saveDiscordSchedule).toHaveBeenCalledWith('17:30', '22:00'))
  })

  it('warns when the holdings job drifted from the brief, and allows saving as is', async () => {
    acc.saveDiscordSchedule.mockResolvedValue(SCHEDULE_BASE)
    await renderSchedule({ ...SCHEDULE_BASE, schedule: { ...SCHEDULE_BASE.schedule, holdingsAligned: false } })
    expect(screen.getByText('個人持股報告的時間和快報不一致；再儲存一次排程即可對齊。')).toBeTruthy()
    const save = screen.getByRole('button', { name: '儲存排程' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(acc.saveDiscordSchedule).toHaveBeenCalledWith('17:30', '21:30'))
  })

  it('locks the drop-downs when the cron jobs are missing', async () => {
    await renderSchedule({ ...SCHEDULE_BASE, schedule: { brief: null, full: null, holdingsAligned: false } })
    expect(screen.getByText('找不到 Discord 排程工作，無法調整。')).toBeTruthy()
    expect(select(BRIEF).disabled).toBe(true)
    expect(select(FULL).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '儲存排程' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a save error', async () => {
    acc.saveDiscordSchedule.mockRejectedValue(new Error('Discord 設定失敗（HTTP 400：時間不在可選範圍）'))
    await renderSchedule()
    fireEvent.change(select(FULL), { target: { value: '23:00' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存排程' }))
    expect(await screen.findByText('Discord 設定失敗（HTTP 400：時間不在可選範圍）', {}, { timeout: 3000 })).toBeTruthy()
  })
})
