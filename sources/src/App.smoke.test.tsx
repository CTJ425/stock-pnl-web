// @vitest-environment jsdom
/**
 * UI smoke test (native mode):
 * Go through the complete usage process of "Start → Add Transaction → Dashboard/Annual Income/Transaction Record Presentation",
 * Verify the actual wiring of Context, data layer (LocalProvider) and each page.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { APP_VERSION } from './version'

/**
 * jsdom does not implement matchMedia, AppShell and UserMenu both rely on it to determine the environment.
 * Hang a minimal implementation so that tests can specify which media queries are true (the rest of the tests remain "None"
 * matchMedia", that is, the desktop version).
 */
function stubMatchMedia(matches: (query: string) => boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

describe('App（本機模式煙霧測試）', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  afterEach(() => {
    // If you don’t restore it, the test that simulates the mobile phone will cause all subsequent tests to run on the mobile version.
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('啟動後自動建立預設工作區並顯示空狀態', async () => {
    render(<App />)
    // No need to log in in local mode, go directly to the main screen
    expect(await screen.findByText('本機模式')).toBeTruthy()
    expect(await screen.findByText(/目前沒有持股/)).toBeTruthy()
    // Default workspace: Starting from 0.6.5-dev.3, the name of the current workspace is directly displayed by the menu trigger button
    const wsTrigger = await screen.findByRole('button', { name: '工作區：我的投資組合' })
    expect(wsTrigger.textContent).toContain('我的投資組合')
  })

  it('版本標記固定於左下角徽章，只顯示版號本身', async () => {
    const { container } = render(<App />)
    await screen.findByText('本機模式')

    const badge = container.querySelector('.version-badge')
    expect(badge).toBeTruthy()
    // The badge only displays the version number itself: no v prefix, no author
    expect(badge!.textContent).toBe(APP_VERSION)
    expect(badge!.textContent).not.toMatch(/^v/)
    expect(badge!.textContent).not.toContain('Ivan')
  })

  it('服務狀態功能已移除；頁尾只剩免責聲明（GitHub 連結 0.6.19 移入帳號選單）', async () => {
    const { container } = render(<App />)
    await screen.findByText('本機模式')

    expect(screen.queryByRole('button', { name: /服務狀態/ })).toBeNull()
    expect(screen.queryByText('關於本專案')).toBeNull()

    const footer = container.querySelector('.app-footer')!
    expect(footer.textContent).toContain('僅供參考，不宜做為買賣依據')
    expect(footer.querySelector('a')).toBeNull()
  })

  it('GitHub 連結收在帳號選單裡，且是外開的', async () => {
    render(<App />)
    // The local mode menu trigger is the "local mode" badge itself
    fireEvent.click(await screen.findByRole('button', { name: /本機模式選單/ }))

    const link = screen.getByRole('menuitem', { name: /原始碼/ }) as HTMLAnchorElement
    expect(link.href).toContain('github.com/CTJ425/stock-pnl-web')
    expect(link.target).toBe('_blank')
    // If you are not logged in, there will be no administrator, and the backend entrance should not appear.
    expect(screen.queryByRole('menuitem', { name: /管理後台/ })).toBeNull()
  })

  it('本機模式沒有個股分析、總體經濟與外幣匯率分頁（資料源需要 Supabase）', async () => {
    render(<App />)
    await screen.findByText('本機模式')
    expect(screen.queryByRole('button', { name: /個股分析/ })).toBeNull()
    // The general manager agrees: fetchMacro always returns null in local mode, and the empty state says "will be added after the schedule is completed"
    // ——That is false in local mode. Keeping it will only make the user wait for something that will never come.
    expect(screen.queryByRole('button', { name: /總體經濟/ })).toBeNull()
    // The exchange rate is the same (0.6.7): fetchFx goes to the same reports bucket
    expect(screen.queryByRole('button', { name: /外幣匯率/ })).toBeNull()
    // The remaining three tabs are not affected
    expect(screen.getByRole('button', { name: /庫存總覽/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /年度收益/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /交易紀錄/ })).toBeTruthy()
  })

  it('分頁依「持股 → 市場」重排，抓取狀況不再是分頁（0.6.19）', async () => {
    const { container } = render(<App />)
    await screen.findByText('本機模式')

    const labels = [...container.querySelectorAll('.tabs .tab')].map((b) =>
      b.getAttribute('aria-label'),
    )
    // In the local mode, only the holding group is left, and the order is the announcement order.
    expect(labels).toEqual(['庫存總覽', '年度收益', '交易紀錄'])
    // No dividing lines are drawn within the same group
    expect(container.querySelector('.tabs .tab-div')).toBeNull()
    // The crawl status has been moved to the management background
    expect(screen.queryByRole('button', { name: /抓取狀況/ })).toBeNull()
  })

  it('手機（≤720px）主導覽改成固定底部列，頁首不再有分頁', async () => {
    const user = userEvent.setup()
    // jsdom does not have matchMedia, so AppShell defaults to the desktop version; here is a copy only for
    // Implementation of the establishment of "≤720px", simulating mobile phone windows
    stubMatchMedia((query) => query.includes('max-width: 720px'))

    const { container } = render(<App />)
    await screen.findByText('本機模式')

    const bottomNav = container.querySelector('nav.bottom-nav')
    expect(bottomNav).toBeTruthy()
    // The bottom column must be outside .app-header: the backdrop-filter at the top of the page will become a descendant of fixed
    // containing block, hanging in it will only be posted at the top and bottom of the page instead of the bottom of the window.
    expect(container.querySelector('.app-header nav.bottom-nav')).toBeNull()
    expect(container.querySelector('.app-header nav.tabs')).toBeNull()

    // The same navigation is only rendered once: there should not be a second set of buttons with the same name when the bottom column appears
    expect(screen.getAllByRole('button', { name: '交易紀錄' }).length).toBe(1)
    // Use a short two-word label for the bottom column (the full name is still aria-label/title)
    expect(bottomNav!.textContent).toContain('紀錄')
    expect(bottomNav!.textContent).not.toContain('交易紀錄')

    // Pagination can still be switched
    await user.click(screen.getByRole('button', { name: '年度收益' }))
    expect(screen.getByRole('button', { name: '年度收益' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('桌機頁首維持分頁橫列，不出現底部導覽列', async () => {
    const { container } = render(<App />)
    await screen.findByText('本機模式')

    expect(container.querySelector('.app-header nav.tabs')).toBeTruthy()
    expect(container.querySelector('nav.bottom-nav')).toBeNull()
  })

  it('未實現損益一律以「淨」命名，台股卡片不重複列出預扣說明', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    await user.click(screen.getByRole('button', { name: /庫存總覽/ }))
    // The unrealized gains and losses of both Taiwan stocks and US stocks cards are named "net" (card titles no longer have the market prefix starting from v0.3)
    const netLabels = await screen.findAllByText('未實現淨損益')
    expect(netLabels.length).toBe(2)
    // The description is changed to the tooltip of the card title, which no longer occupies a line.
    expect(screen.queryByText('主數字已預扣賣出手續費與證交稅')).toBeNull()
    // The tooltip of the Taiwan stock card (DOM appears first) indicates that the handling fee and securities tax have been withheld
    expect(netLabels[0].getAttribute('title')).toContain('手續費和證交稅都已經扣掉了')
  })

  it('新增台股買入交易 → 庫存總覽與年度收益同步呈現', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    // Switch to "Transaction Records" to open the form
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await user.click(await screen.findByRole('button', { name: /新增交易/ }))

    const dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    const form = within(dialog)

    await user.type(form.getByLabelText(/股票代號/), '2330')
    await user.type(form.getByLabelText('股票名稱'), '台積電')
    await user.type(form.getByLabelText('交易單價'), '500')
    await user.type(form.getByLabelText('交易股數'), '1') // 1 張 = 1000 股

    // Automatic fee estimation: floor(500 * 1000 * 0.001425) = 712
    await waitFor(() => {
      expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('712')
    })

    await user.click(form.getByRole('button', { name: '確認送出' }))
    expect(await form.findByText(/成功新增交易紀錄/)).toBeTruthy()
    await user.click(form.getByRole('button', { name: '關閉' }))

    // Transaction Record Form
    expect(await screen.findByText('台積電')).toBeTruthy()
    // Task 142: the 類型 cell is one chip carrying nature + side. TransactionForm writes
    // tx_nature 'SPOT' for every TPE row (TransactionForm.tsx:320), so a TPE BUY reads 現股買.
    expect(screen.getByText('現股買')).toBeTruthy()
    expect(screen.getByText('1,000')).toBeTruthy()

    // Dashboard: Holdings and average price (500712 / 1000 = 500.712 → NT$500.71)
    await user.click(screen.getByRole('button', { name: /庫存總覽/ }))
    expect(await screen.findByText('NT$500.71')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: /未實現淨損益/ })).toBeTruthy()

    // Annual Revenue: KPI vs. Year Column
    await user.click(screen.getByRole('button', { name: /年度收益/ }))
    expect(await screen.findByText('歷史累計交易筆數 (台美股合計)')).toBeTruthy()
    expect(screen.getByText(String(new Date().getFullYear()))).toBeTruthy()

    // Only buy but not sell: the denominator of the return rate is 0, the whole cell is "—" instead of NaN% / Infinity%
    expect(screen.getByRole('columnheader', { name: /報酬率/ })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('年度收益搜尋：只留下符合的股票，找不到時說明是搜尋而非沒紀錄（0.6.38）', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    for (const [ticker, name, price] of [
      ['2330', '台積電', '500'],
      ['2454', '聯發科', '900'],
    ] as const) {
      await user.click(await screen.findByRole('button', { name: /新增交易/ }))
      const dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
      const form = within(dialog)
      await user.type(form.getByLabelText(/股票代號/), ticker)
      await user.type(form.getByLabelText('股票名稱'), name)
      await user.type(form.getByLabelText('交易單價'), price)
      await user.type(form.getByLabelText('交易股數'), '1')
      await user.click(form.getByRole('button', { name: '確認送出' }))
      await form.findByText(/成功新增交易紀錄/)
      await user.click(form.getByRole('button', { name: '關閉' }))
    }

    await user.click(screen.getByRole('button', { name: /年度收益/ }))
    const year = String(new Date().getFullYear())
    await user.click(await screen.findByRole('button', { name: '全部展開' }))
    expect(screen.getByText(/2330/)).toBeTruthy()
    expect(screen.getByText(/2454/)).toBeTruthy()

    // Searching by name filters the aggregation itself, so the other stock leaves the table entirely
    const box = screen.getByLabelText('搜尋年度收益的股票')
    await user.type(box, '聯發科')
    expect(screen.queryByText(/2330/)).toBeNull()
    expect(screen.getByText(/2454/)).toBeTruthy()
    // The KPI cards stay lifetime totals —— the hint next to the box says so, and both stocks are still counted
    expect(screen.getByText(/上方四張卡是全部交易的累計/)).toBeTruthy()

    // No match is a different sentence from an empty ledger, per section
    await user.clear(box)
    await user.type(box, 'NVDA')
    expect(screen.getAllByText(/找不到符合「NVDA」的股票/).length).toBe(2)
    expect(screen.queryByText(year)).toBeNull()
  })

  it('編輯交易 → 修改單價後自動重算手續費並更新列表', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    // Add a new transaction using a global floating button
    await user.click(screen.getByRole('button', { name: /新增交易/ }))
    const addDialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    const addForm = within(addDialog)
    await user.type(addForm.getByLabelText(/股票代號/), '2330')
    await user.type(addForm.getByLabelText('股票名稱'), '台積電')
    await user.type(addForm.getByLabelText('交易單價'), '500')
    await user.type(addForm.getByLabelText('交易股數'), '1')
    await user.click(addForm.getByRole('button', { name: '確認送出' }))
    await addForm.findByText(/成功新增交易紀錄/)
    await user.click(addForm.getByRole('button', { name: '關閉' }))

    // Open editing: bring in the original content (the number of shares is presented as odd shares 1000, the handling fee retains the original record of 712 and will not be recalculated)
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    const editDialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    const editForm = within(editDialog)
    expect((editForm.getByLabelText('交易單價') as HTMLInputElement).value).toBe('500')
    expect((editForm.getByLabelText('交易股數') as HTMLInputElement).value).toBe('1000')
    expect((editForm.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('712')

    // Change unit price → Automatic recalculation of handling fee: floor(600 * 1000 * 0.001425) = 855
    const priceInput = editForm.getByLabelText('交易單價')
    await user.clear(priceInput)
    await user.type(priceInput, '600')
    await waitFor(() => {
      expect((editForm.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('855')
    })

    await user.click(editForm.getByRole('button', { name: '儲存變更' }))
    // After saving, the window closes and the new unit price appears in the list.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '編輯交易紀錄' })).toBeNull()
    })
    expect(await screen.findByText('NT$600.00')).toBeTruthy()
  })

  it('CSV 匯入舊試算表格式 → 正確拆解 TPE: 前綴並重算損益', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await user.click(await screen.findByRole('button', { name: /匯入 CSV/ }))

    const dialog = await screen.findByRole('dialog', { name: /匯入 CSV/ })
    const form = within(dialog)
    const csv = [
      '交易日期,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金,損益/收支',
      '2024/01/10,TPE:2330,台積電,買入,500,1000,712,-500712',
      '2025/02/01,TPE:2330,台積電,賣出,700,500,1548,348452',
    ].join('\n')

    const textarea = form.getByPlaceholderText(/交易日期,股票代號/)
    await user.click(textarea)
    await user.paste(csv)

    expect(await form.findByText(/共 2 筆有效交易/)).toBeTruthy()
    await user.click(form.getByRole('button', { name: /確認匯入 2 筆/ }))

    expect(await screen.findByText(/已匯入 2 筆交易/)).toBeTruthy()

    // Annual income: 2025 realized = (700*500-1548) - 500.712*500 = +NT$98,096 (+ sign, red increase)
    await user.click(screen.getByRole('button', { name: /年度收益/ }))
    const hits = await screen.findAllByText('+NT$98,096')
    expect(hits.length).toBeGreaterThan(0)

    // Return rate: 98096 / 250356 = +39.18% including fees; 100000 / 250000 = +40.00% without fees for the deputy bank
    expect(screen.getAllByText('+39.18%').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/未含費 \+40\.00%/).length).toBeGreaterThan(0)
  })

  it('工作區選單：切換在上、管理動作在下，刪除隔開且為危險樣式', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    await user.click(await screen.findByRole('button', { name: /^工作區：/ }))
    const menu = await screen.findByRole('menu', { name: '工作區選單' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((b) => b.textContent)).toEqual([
      '新增工作區',
      '重新命名',
      '預設手續費率',
      '刪除工作區',
    ])
    // The current workspace is presented with menuitemradio and checked
    const current = within(menu).getByRole('menuitemradio', { name: '我的投資組合' })
    expect(current.getAttribute('aria-checked')).toBe('true')
    // Deletion must be clearly seen as a dangerous action and cannot look the same as "rename".
    expect(items[3].className).toContain('is-danger')
  })

  it('選單按 Esc 關閉並把焦點還給觸發鈕', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    const trigger = await screen.findByRole('button', { name: /^工作區：/ })
    await user.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu', { name: '工作區選單' })).toBeNull())
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('本機模式的「本機模式」徽章本身就是帳號選單的觸發鈕（不藏進選單）', async () => {
    const user = userEvent.setup()
    render(<App />)
    // "Data only exists in this browser" should be visible at any time and should not be reduced to a line in the menu.
    const badge = await screen.findByRole('button', { name: '本機模式選單' })
    expect(badge.textContent).toContain('本機模式')

    await user.click(badge)
    const menu = await screen.findByRole('menu', { name: '帳號與外觀' })
    expect(within(menu).getByText(/資料儲存於此瀏覽器/)).toBeTruthy()
    // Local mode does not log out
    expect(within(menu).queryByRole('menuitem', { name: /登出/ })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: /外觀：/ })).toBeTruthy()
  })

  it('頁首右側只剩兩個控制項（0.6.5-dev.3 由 8 個收斂）', async () => {
    render(<App />)
    await screen.findByText('本機模式')
    // Workspace menu + Account menu. Originally: drop down + add + rename + rate + delete + subject + email + log out
    const wsTrigger = screen.getByRole('button', { name: /^工作區：/ })
    const userTrigger = screen.getByRole('button', { name: '本機模式選單' })
    const header = wsTrigger.closest('.app-header-inner')!
    const rightButtons = [...header.querySelectorAll('.ws-select button, .header-meta button')]
    expect(rightButtons).toEqual([wsTrigger, userTrigger])
  })

})