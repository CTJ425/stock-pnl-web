// @vitest-environment jsdom
/**
 * Task 159 D12 (and the title half of D1), Task 158 #2 / Task 159 D9: every page names itself once
 * for screen readers and in the browser tab, and 「新增交易」 exists exactly once — in the header on
 * wide screens, as the floating button on narrow ones — never both.
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

  it('offers exactly one add-transaction button', async () => {
    render(<App />)
    await screen.findByText('本機模式')

    expect(screen.getAllByRole('button', { name: '新增交易' })).toHaveLength(1)
  })
})
