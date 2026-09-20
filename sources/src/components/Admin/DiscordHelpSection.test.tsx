// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DiscordHelpSection } from './DiscordHelpSection'

describe('DiscordHelpSection', () => {
  afterEach(() => cleanup())

  it('states the sending rules', () => {
    render(<DiscordHelpSection />)
    expect(screen.getByRole('heading', { name: '說明' })).toBeTruthy()
    const text = document.body.textContent ?? ''
    expect(text).toContain('繼承全域不另外發送；自訂網址會同時多送快報與完整版一份')
    expect(text).toContain('個人持股報告只送到該帳號自己的網址')
    expect(text).toContain('全域未設定時經濟快報不送')
    expect(text).toContain('當天沒有台股大盤資料時不送')
  })

  it('explains how to create a Discord webhook, and that no API key is needed', () => {
    render(<DiscordHelpSection />)
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
})
