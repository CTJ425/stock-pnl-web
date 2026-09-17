// @vitest-environment jsdom
// Task 165 Phase 2 step 2c — spec docs/agent/specs/discord-holdings.md §2.7 (component).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { HoldingsPushStatus } from '../../services/discordHoldings'

const svc = vi.hoisted(() => ({
  getHoldingsPush: vi.fn(),
  saveHoldingsWebhook: vi.fn(),
  clearHoldingsWebhook: vi.fn(),
  setHoldingsPushEnabled: vi.fn(),
  testHoldingsWebhook: vi.fn(),
  previewHoldings: vi.fn(),
}))
vi.mock('../../services/discordHoldings', () => svc)

import { DiscordPushSection } from './DiscordPushSection'

// Assembled from pieces with a fake token: this repo is public and runs secret scanning.
const TOKEN = 'Fake_Token-' + 'x'.repeat(57) + 'Wxyz'
const HOOK = 'https://discord.com' + '/api/' + 'webhooks/' + '1'.repeat(18) + '/' + TOKEN

const WARNING = '卡片會顯示完整的股數、成本與損益金額。請使用只有你看得到的私人頻道 Webhook；貼到共用頻道，頻道裡所有人都會看到。'

const EMPTY: HoldingsPushStatus = { configured: false, last4: null, enabled: false, lastSend: null }
const SET_OFF: HoldingsPushStatus = {
  configured: true,
  last4: 'Wxyz',
  enabled: false,
  lastSend: { kind: 'daily', ymd: '2026-09-16', status: 'sent', reason: null, at: '2026-09-16T09:15:03Z' },
}
const SET_ON: HoldingsPushStatus = { ...SET_OFF, enabled: true }

const urlInput = () => screen.getByLabelText('Discord Webhook 網址') as HTMLInputElement
const toggle = () => screen.getByRole('switch', { name: '每個交易日 17:15 推送持股日報' }) as HTMLButtonElement
const isOn = () => toggle().getAttribute('aria-checked') === 'true'
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

function assertNoUrlInDom() {
  expect(document.body.innerHTML).not.toContain(TOKEN)
  for (const el of Array.from(document.querySelectorAll('input'))) expect(el.value).not.toContain(TOKEN)
}

async function renderLoaded(status: HoldingsPushStatus) {
  svc.getHoldingsPush.mockResolvedValue(status)
  render(<DiscordPushSection />)
  await screen.findByText(/^狀態：/)
}

describe('DiscordPushSection', () => {
  beforeEach(() => {
    for (const fn of Object.values(svc)) fn.mockReset()
  })
  afterEach(() => cleanup())

  it('shows a loading state first', async () => {
    let resolve!: (s: HoldingsPushStatus) => void
    svc.getHoldingsPush.mockReturnValue(new Promise((r) => (resolve = r)))
    render(<DiscordPushSection />)
    expect(screen.getByText('載入中…')).toBeTruthy()
    resolve(EMPTY)
    await screen.findByText('狀態：未設定')
  })

  it('renders an unconfigured user with everything that needs a webhook disabled', async () => {
    await renderLoaded(EMPTY)
    expect(screen.getByText('狀態：未設定')).toBeTruthy()
    expect(screen.getByText(WARNING)).toBeTruthy()
    expect(within(screen.getByRole('list', { name: '設定步驟' })).getAllByRole('listitem')).toHaveLength(3)
    expect(urlInput().type).toBe('password')
    expect(urlInput().getAttribute('autocomplete')).toBe('off')
    expect(toggle().disabled).toBe(true)
    expect(isOn()).toBe(false)
    expect(button('清除').disabled).toBe(true)
    expect(button('測試發送').disabled).toBe(true)
    expect(button('預覽今日持股').disabled).toBe(true)
    expect(button('儲存').disabled).toBe(true)
    expect(screen.getByText('上次發送：尚無紀錄')).toBeTruthy()
    // uses the site's shared styles (spec §2.7)
    expect(toggle().tagName).toBe('BUTTON')
    expect(toggle().className).toBe('adm-toggle')
    expect(screen.getByText(WARNING).className).toContain('notice notice-warn')
    expect(urlInput().className).toContain('ai-input')
    expect(button('儲存').className).toContain('btn-primary')
    expect(button('清除').className).toContain('btn-danger')
    expect(button('測試發送').className).toContain('btn')
  })

  it('renders a configured, enabled user with the last send in Taipei time', async () => {
    await renderLoaded(SET_ON)
    expect(screen.getByText('狀態：已設定（…Wxyz）')).toBeTruthy()
    expect(toggle().disabled).toBe(false)
    expect(isOn()).toBe(true)
    expect(button('清除').disabled).toBe(false)
    expect(button('測試發送').disabled).toBe(false)
    expect(button('預覽今日持股').disabled).toBe(false)
    expect(screen.getByText('上次發送：2026-09-16 17:15:03・每日・已送出')).toBeTruthy()
    assertNoUrlInDom()
  })

  it.each([
    [{ kind: 'preview', status: 'skipped', reason: 'no-holdings' }, '上次發送：2026-09-17 10:00:00・預覽・略過（無持股）'],
    [{ kind: 'daily', status: 'failed', reason: 'webhook-gone' }, '上次發送：2026-09-17 10:00:00・每日・失敗（網址已失效）'],
    [{ kind: 'daily', status: 'failed', reason: 'exception' }, '上次發送：2026-09-17 10:00:00・每日・失敗（系統錯誤）'],
    [{ kind: 'test', status: 'failed', reason: 'weird-code' }, '上次發送：2026-09-17 10:00:00・測試・失敗（weird-code）'],
    [{ kind: 'daily', status: 'claimed', reason: null }, '上次發送：2026-09-17 10:00:00・每日・處理中'],
  ] as const)('labels last send %j', async (partial, text) => {
    await renderLoaded({ ...SET_OFF, lastSend: { ymd: '2026-09-17', at: '2026-09-17T02:00:00Z', ...partial } })
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('shows a load failure', async () => {
    svc.getHoldingsPush.mockRejectedValue(new Error('Discord 推播設定失敗（HTTP 401）'))
    render(<DiscordPushSection />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Discord 推播設定失敗（HTTP 401）')
    expect(alert.className).toContain('notice notice-error')
  })

  it('saves a trimmed URL, clears the input, and never shows the URL', async () => {
    await renderLoaded(EMPTY)
    fireEvent.change(urlInput(), { target: { value: '   ' } })
    expect(button('儲存').disabled).toBe(true)
    svc.saveHoldingsWebhook.mockResolvedValue(SET_OFF)
    fireEvent.change(urlInput(), { target: { value: `  ${HOOK} ` } })
    expect(button('儲存').disabled).toBe(false)
    fireEvent.click(button('儲存'))
    await screen.findByText('已儲存 Webhook')
    expect(svc.saveHoldingsWebhook).toHaveBeenCalledWith(HOOK)
    expect(urlInput().value).toBe('')
    expect(screen.getByText('狀態：已設定（…Wxyz）')).toBeTruthy()
    expect(toggle().disabled).toBe(false)
    assertNoUrlInDom()
  })

  it('shows a save failure', async () => {
    await renderLoaded(EMPTY)
    svc.saveHoldingsWebhook.mockRejectedValue(new Error('Discord 推播設定失敗（HTTP 400：網址格式不正確）'))
    fireEvent.change(urlInput(), { target: { value: 'https://example.com' } })
    fireEvent.click(button('儲存'))
    expect((await screen.findByRole('alert')).textContent).toContain('Discord 推播設定失敗（HTTP 400：網址格式不正確）')
    expect(screen.getByText('狀態：未設定')).toBeTruthy()
  })

  it('clears the webhook', async () => {
    await renderLoaded(SET_ON)
    svc.clearHoldingsWebhook.mockResolvedValue(EMPTY)
    fireEvent.click(button('清除'))
    await screen.findByText('已清除 Webhook，推播已關閉')
    expect(svc.clearHoldingsWebhook).toHaveBeenCalledTimes(1)
    expect(screen.getByText('狀態：未設定')).toBeTruthy()
    expect(isOn()).toBe(false)
  })

  it('turns the daily push on and off', async () => {
    await renderLoaded(SET_OFF)
    svc.setHoldingsPushEnabled.mockResolvedValueOnce(SET_ON).mockResolvedValueOnce(SET_OFF)
    fireEvent.click(toggle())
    await screen.findByText('已開啟每日推播')
    expect(svc.setHoldingsPushEnabled).toHaveBeenLastCalledWith(true)
    expect(isOn()).toBe(true)
    fireEvent.click(toggle())
    await screen.findByText('已關閉每日推播')
    expect(svc.setHoldingsPushEnabled).toHaveBeenLastCalledWith(false)
    expect(isOn()).toBe(false)
  })

  it.each([
    [{ ok: true, httpStatus: 204 }, '測試發送成功（HTTP 204）'],
    [{ ok: false, httpStatus: 404, reason: 'webhook-gone' }, '測試發送失敗（HTTP 404：網址已失效）'],
    [{ ok: false, httpStatus: null, reason: 'network' }, '測試發送失敗（HTTP --：連線失敗）'],
    [{ ok: false, httpStatus: 500, reason: 'mystery' }, '測試發送失敗（HTTP 500：未知錯誤）'],
  ])('reports a test send %j', async (send, text) => {
    await renderLoaded(SET_OFF)
    svc.testHoldingsWebhook.mockResolvedValue({ status: SET_OFF, send })
    fireEvent.click(button('測試發送'))
    const el = await screen.findByRole('status')
    expect(el.textContent).toBe(text)
    expect(el.className).toContain(send.ok ? 'notice-ok' : 'notice-warn')
  })

  it.each([
    [{ ok: true, httpStatus: 204 }, '已送出 09/17 的持股預覽（HTTP 204）'],
    [{ ok: false, httpStatus: 429, reason: 'rate-limited' }, '預覽發送失敗（HTTP 429：Discord 限流）'],
  ])('reports a preview %j', async (send, text) => {
    await renderLoaded(SET_OFF)
    svc.previewHoldings.mockResolvedValue({ status: SET_OFF, send, previewYmd: '2026-09-17' })
    fireEvent.click(button('預覽今日持股'))
    expect((await screen.findByRole('status')).textContent).toBe(text)
  })

  it('shows a preview refusal', async () => {
    await renderLoaded(SET_OFF)
    svc.previewHoldings.mockRejectedValue(new Error('Discord 推播設定失敗（HTTP 409：目前沒有持股）'))
    fireEvent.click(button('預覽今日持股'))
    expect((await screen.findByRole('alert')).textContent).toContain('Discord 推播設定失敗（HTTP 409：目前沒有持股）')
  })

  it('disables every action while a request is running', async () => {
    await renderLoaded(SET_OFF)
    let finish!: (v: unknown) => void
    svc.previewHoldings.mockReturnValue(new Promise((r) => (finish = r)))
    fireEvent.click(button('預覽今日持股'))
    await waitFor(() => expect(button('預覽今日持股').disabled).toBe(true))
    expect(button('測試發送').disabled).toBe(true)
    expect(button('清除').disabled).toBe(true)
    expect(toggle().disabled).toBe(true)
    fireEvent.change(urlInput(), { target: { value: HOOK } })
    expect(button('儲存').disabled).toBe(true)
    finish({ status: SET_OFF, send: { ok: true, httpStatus: 204 }, previewYmd: '2026-09-17' })
    await screen.findByText('已送出 09/17 的持股預覽（HTTP 204）')
    expect(button('測試發送').disabled).toBe(false)
  })
})
