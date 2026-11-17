// @vitest-environment jsdom
/**
 * Task 159 D12 (and the title half of D1), Task 158 #2 / Task 159 D9: every page names itself once
 * for screen readers and in the browser tab, and 「新增交易」 exists exactly once — in the header, on
 * every width (0.9.68: the floating button covered the bottom-right corner).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

describe('AppShell page identity', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('gives each page one h1 and a matching document title', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    expect(screen.getByRole('heading', { level: 1, name: '庫存總覽' })).toBeTruthy()
    expect(document.title).toBe('庫存總覽 · 股票小幫手')

    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    expect(await screen.findByRole('heading', { level: 1, name: '交易紀錄' })).toBeTruthy()
    expect(document.title).toBe('交易紀錄 · 股票小幫手')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  // 0.9.68: the user moved it into the header bar (reverts 0.9.47); no floating button.
  it('offers exactly one add-transaction button, in the header', async () => {
    const { container } = render(<App />)
    await screen.findByText('本機模式')

    // The button appears once the workspace's transactions have loaded (Task 185 / A2), a tick after the shell.
    const buttons = await screen.findAllByRole('button', { name: '新增交易' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0].closest('.app-header')).toBeTruthy()
    expect(container.querySelector('.fab')).toBeNull()
  })

  it('provides a skip link that moves focus to the page h1 without changing window.location.hash', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '#/transactions')
    render(<App />)
    await screen.findByText('本機模式')

    const skipLink = screen.getByRole('link', { name: '跳至主要內容' })
    await user.click(skipLink)
    const h1 = screen.getByRole('heading', { level: 1, name: '交易紀錄' })
    expect(document.activeElement).toBe(h1)
    expect(window.location.hash).toBe('#/transactions')
  })

  it('supports ArrowDown/ArrowUp/Home/End keyboard navigation in HeaderMenu', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    const wsTrigger = await screen.findByRole('button', { name: /^工作區：/ })
    wsTrigger.focus()
    await user.keyboard('{ArrowDown}')

    const menu = await screen.findByRole('menu', { name: '工作區選單' })
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'))
    expect(document.activeElement).toBe(items[0])

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[1])

    await user.keyboard('{End}')
    expect(document.activeElement).toBe(items[items.length - 1])

    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(items[0])
  })
})
