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

describe('DiscordSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows an unconfigured webhook', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(EMPTY)
    render(<DiscordSection />)
    expect(await screen.findByText('尚未設定')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Discord 每日總結' })).toBeTruthy()
    expect(screen.getByText('平日 17:05 快報、21:30 完整版；當天沒有台股大盤資料時不送。')).toBeTruthy()
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
    for (const h of ['日期', '類型', '狀態', 'HTTP', '原因']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeTruthy()
    }
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('2026-09-16')
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

  it('explains how to create a Discord webhook, and that no API key is needed', async () => {
    svc.getDiscordWebhookStatus.mockResolvedValue(EMPTY)
    render(<DiscordSection />)
    await screen.findByText('尚未設定')
    const guide = screen.getByText('如何取得 Discord Webhook 網址').closest('details')
    expect(guide).not.toBeNull()
    expect(guide!.querySelectorAll('ol > li')).toHaveLength(7)
    const text = guide!.textContent ?? ''
    expect(text).toContain('不需要建立 Bot，也不需要 API 金鑰或 Bot Token')
    expect(text).toContain('編輯頻道')
    expect(text).toContain('整合')
    expect(text).toContain('複製 Webhook 網址')
    expect(text).toContain('Webhook 網址等同密碼')
    expect(text).toContain('刪除該 Webhook，重新建立一個')
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
