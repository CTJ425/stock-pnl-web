import { describe, expect, it } from 'vitest'
import { isDiscordWebhookUrl, webhookLast4 } from './discordUrl.ts'
import { FAKE_ID, FAKE_TOKEN, FAKE_WEBHOOK } from './discordTestFixtures.ts'

const PATH = '/api/' + 'webhooks/'

describe('isDiscordWebhookUrl', () => {
  it('accepts discord.com and discordapp.com webhooks', () => {
    expect(isDiscordWebhookUrl(FAKE_WEBHOOK)).toBe(true)
    expect(isDiscordWebhookUrl('https://discordapp.com' + PATH + FAKE_ID + '/' + FAKE_TOKEN)).toBe(true)
  })

  it('trims surrounding whitespace', () => {
    expect(isDiscordWebhookUrl(`  ${FAKE_WEBHOOK}\n`)).toBe(true)
  })

  it.each([
    ['http scheme', FAKE_WEBHOOK.replace('https:', 'http:')],
    ['other host', 'https://example.com' + PATH + FAKE_ID + '/' + FAKE_TOKEN],
    ['look-alike host', 'https://discord.com.evil.io' + PATH + FAKE_ID + '/' + FAKE_TOKEN],
    ['subdomain', 'https://ptb.discord.com' + PATH + FAKE_ID + '/' + FAKE_TOKEN],
    ['port', 'https://discord.com:8443' + PATH + FAKE_ID + '/' + FAKE_TOKEN],
    ['userinfo', 'https://a@discord.com' + PATH + FAKE_ID + '/' + FAKE_TOKEN],
    ['query', FAKE_WEBHOOK + '?wait=true'],
    ['fragment', FAKE_WEBHOOK + '#x'],
    ['trailing slash', FAKE_WEBHOOK + '/'],
    ['thread path', FAKE_WEBHOOK + '/slack'],
    ['short id', 'https://discord.com' + PATH + '1234' + '/' + FAKE_TOKEN],
    ['non-numeric id', 'https://discord.com' + PATH + 'a'.repeat(18) + '/' + FAKE_TOKEN],
    ['short token', 'https://discord.com' + PATH + FAKE_ID + '/abc'],
    ['bad token char', 'https://discord.com' + PATH + FAKE_ID + '/' + FAKE_TOKEN.slice(0, -1) + '!'],
    ['missing token', 'https://discord.com' + PATH + FAKE_ID],
    ['empty', ''],
  ])('rejects %s', (_name, url) => {
    expect(isDiscordWebhookUrl(url)).toBe(false)
  })
})

describe('webhookLast4', () => {
  it('returns the tail of the token', () => {
    expect(webhookLast4(FAKE_WEBHOOK)).toBe('Wxyz')
    expect(webhookLast4(` ${FAKE_WEBHOOK} `)).toBe('Wxyz')
  })

  it('returns an empty string for an invalid URL', () => {
    expect(webhookLast4('https://example.com/abcd')).toBe('')
    expect(webhookLast4('')).toBe('')
  })
})
