import { describe, expect, it } from 'vitest'
import { DISCORD_FAIL_REASON_LABELS, discordSendResultText } from './discordSendText'

describe('discordSendResultText', () => {
  it('says the test message was sent on success', () => {
    expect(discordSendResultText({ ok: true })).toBe('測試訊息已送出')
  })

  it.each(Object.entries(DISCORD_FAIL_REASON_LABELS))('names the reason %s', (reason, label) => {
    expect(discordSendResultText({ ok: false, reason })).toBe(`發送失敗（${label}）`)
  })

  it('does not echo an unknown reason from the server', () => {
    expect(discordSendResultText({ ok: false, reason: 'secret-detail' })).toBe('發送失敗（未知錯誤）')
    expect(discordSendResultText({ ok: false })).toBe('發送失敗（未知錯誤）')
    expect(discordSendResultText({ ok: false, reason: null })).toBe('發送失敗（未知錯誤）')
  })
})
