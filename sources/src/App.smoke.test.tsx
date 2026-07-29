// @vitest-environment jsdom
/**
 * UI 煙霧測試（本機模式）：
 * 走過「啟動 → 新增交易 → Dashboard / 年度收益 / 交易紀錄呈現」的完整使用流程，
 * 驗證 Context、資料層（LocalProvider）與各頁面的實際接線。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { APP_VERSION } from './version'

/**
 * jsdom 沒有實作 matchMedia，AppShell 與 UserMenu 都靠它判斷環境。
 * 掛一份最小實作，讓測試能指定哪些 media query 成立（其餘測試維持「沒有
 * matchMedia」的原狀，也就是桌機版）。
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
    // 不還原的話，模擬手機的那個測試會讓後面所有測試都跑在手機版
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('啟動後自動建立預設工作區並顯示空狀態', async () => {
    render(<App />)
    // 本機模式免登入，直接進入主畫面
    expect(await screen.findByText('本機模式')).toBeTruthy()
    expect(await screen.findByText(/目前沒有持股/)).toBeTruthy()
    // 預設工作區：0.6.5-dev.3 起由選單觸發鈕直接顯示目前工作區名稱
    const wsTrigger = await screen.findByRole('button', { name: '工作區：我的投資組合' })
    expect(wsTrigger.textContent).toContain('我的投資組合')
  })

  it('版本標記固定於左下角徽章，只顯示版號本身', async () => {
    const { container } = render(<App />)
    await screen.findByText('本機模式')

    const badge = container.querySelector('.version-badge')
    expect(badge).toBeTruthy()
    // 徽章只顯示版號本身：不帶 v 前綴、不顯示作者
    expect(badge!.textContent).toBe(APP_VERSION)
    expect(badge!.textContent).not.toMatch(/^v/)
    expect(badge!.textContent).not.toContain('Ivan')
  })

  it('服務狀態功能已移除；GitHub 連結改置於頁尾免責聲明下方', async () => {
    const { container } = render(<App />)
    await screen.findByText('本機模式')

    expect(screen.queryByRole('button', { name: /服務狀態/ })).toBeNull()
    expect(screen.queryByText('關於本專案')).toBeNull()

    const footer = container.querySelector('.app-footer')!
    expect(footer.textContent).toContain('僅供參考，不宜做為買賣依據')
    const link = footer.querySelector('a.footer-link') as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.href).toContain('github.com/CTJ425/stock-pnl-web')
    // 連結在免責聲明「下方」：DOM 順序上 <p> 在 <a> 之前
    expect(footer.querySelector('p')!.compareDocumentPosition(link)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('本機模式沒有個股分析、總體經濟與外幣匯率分頁（資料源需要 Supabase）', async () => {
    render(<App />)
    await screen.findByText('本機模式')
    expect(screen.queryByRole('button', { name: /個股分析/ })).toBeNull()
    // 總經同理：fetchMacro 在本機模式永遠回 null，而空狀態寫「排程完成後會補上」
    // ——那在本機模式是假的，留著只會讓使用者等一個不會來的東西
    expect(screen.queryByRole('button', { name: /總體經濟/ })).toBeNull()
    // 匯率同理（0.6.6）：fetchFx 走同一個 reports bucket
    expect(screen.queryByRole('button', { name: /外幣匯率/ })).toBeNull()
    // 其餘三個分頁不受影響
    expect(screen.getByRole('button', { name: /庫存總覽/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /年度收益/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /交易紀錄/ })).toBeTruthy()
  })

  it('手機（≤720px）主導覽改成固定底部列，頁首不再有分頁', async () => {
    const user = userEvent.setup()
    // jsdom 沒有 matchMedia，AppShell 因此預設走桌機版；這裡補一份只讓
    // 「≤720px」成立的實作，模擬手機視窗
    stubMatchMedia((query) => query.includes('max-width: 720px'))

    const { container } = render(<App />)
    await screen.findByText('本機模式')

    const bottomNav = container.querySelector('nav.bottom-nav')
    expect(bottomNav).toBeTruthy()
    // 底部列必須在 .app-header 之外：頁首的 backdrop-filter 會成為 fixed 子孫的
    // containing block，掛在裡面只會貼在頁首底部而不是視窗底部
    expect(container.querySelector('.app-header nav.bottom-nav')).toBeNull()
    expect(container.querySelector('.app-header nav.tabs')).toBeNull()

    // 同一份導覽只渲染一次：底部列出現時不該還有第二組同名按鈕
    expect(screen.getAllByRole('button', { name: '交易紀錄' }).length).toBe(1)
    // 底部列用兩字短標籤（完整名稱仍在 aria-label / title）
    expect(bottomNav!.textContent).toContain('紀錄')
    expect(bottomNav!.textContent).not.toContain('交易紀錄')

    // 仍可切換分頁
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
    // 台股、美股兩張卡片的未實現損益皆以「淨」命名（v0.3 起卡片標題不再帶市場前綴）
    const netLabels = await screen.findAllByText('未實現淨損益')
    expect(netLabels.length).toBe(2)
    // 說明改為卡片標題的 tooltip，不再佔一行
    expect(screen.queryByText('主數字已預扣賣出手續費與證交稅')).toBeNull()
    // 台股卡片（DOM 先出現）的 tooltip 說明已預扣手續費與證交稅
    expect(netLabels[0].getAttribute('title')).toContain('手續費和證交稅都已經扣掉了')
  })

  it('新增台股買入交易 → 庫存總覽與年度收益同步呈現', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    // 切到「交易紀錄」開啟表單
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await user.click(await screen.findByRole('button', { name: /新增交易/ }))

    const dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    const form = within(dialog)

    await user.type(form.getByLabelText(/股票代號/), '2330')
    await user.type(form.getByLabelText('股票名稱'), '台積電')
    await user.type(form.getByLabelText('交易單價'), '500')
    await user.type(form.getByLabelText('交易股數'), '1') // 1 張 = 1000 股

    // 手續費自動估算：floor(500 * 1000 * 0.001425) = 712
    await waitFor(() => {
      expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('712')
    })

    await user.click(form.getByRole('button', { name: '確認送出' }))
    expect(await form.findByText(/成功新增交易紀錄/)).toBeTruthy()
    await user.click(form.getByRole('button', { name: '關閉' }))

    // 交易紀錄表格
    expect(await screen.findByText('台積電')).toBeTruthy()
    expect(screen.getByText('買入')).toBeTruthy()
    expect(screen.getByText('1,000')).toBeTruthy()

    // Dashboard：持股與均價 (500712 / 1000 = 500.712 → NT$500.71)
    await user.click(screen.getByRole('button', { name: /庫存總覽/ }))
    expect(await screen.findByText('NT$500.71')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: /未實現淨損益/ })).toBeTruthy()

    // 年度收益：KPI 與年度列
    await user.click(screen.getByRole('button', { name: /年度收益/ }))
    expect(await screen.findByText('歷史累計交易筆數 (台美股合計)')).toBeTruthy()
    expect(screen.getByText(String(new Date().getFullYear()))).toBeTruthy()

  })

  it('編輯交易 → 修改單價後自動重算手續費並更新列表', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    // 以全域浮動按鈕新增一筆交易
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

    // 開啟編輯：帶入原內容（股數以零股 1000 呈現、手續費保留原記錄 712 不被重算）
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    const editDialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    const editForm = within(editDialog)
    expect((editForm.getByLabelText('交易單價') as HTMLInputElement).value).toBe('500')
    expect((editForm.getByLabelText('交易股數') as HTMLInputElement).value).toBe('1000')
    expect((editForm.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('712')

    // 改單價 → 手續費自動重算：floor(600 * 1000 * 0.001425) = 855
    const priceInput = editForm.getByLabelText('交易單價')
    await user.clear(priceInput)
    await user.type(priceInput, '600')
    await waitFor(() => {
      expect((editForm.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('855')
    })

    await user.click(editForm.getByRole('button', { name: '儲存變更' }))
    // 儲存後視窗關閉，列表呈現新單價
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

    // 年度收益：2025 已實現 = (700*500-1548) - 500.712*500 = +NT$98,096（+號、紅漲）
    await user.click(screen.getByRole('button', { name: /年度收益/ }))
    const hits = await screen.findAllByText('+NT$98,096')
    expect(hits.length).toBeGreaterThan(0)
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
    // 目前工作區以 menuitemradio 呈現並打勾
    const current = within(menu).getByRole('menuitemradio', { name: '我的投資組合' })
    expect(current.getAttribute('aria-checked')).toBe('true')
    // 刪除要看得出是危險動作，不能與「重新命名」長得一樣
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
    // 「資料只存在這個瀏覽器」要隨時看得到，不該降級成選單裡的一行
    const badge = await screen.findByRole('button', { name: '本機模式選單' })
    expect(badge.textContent).toContain('本機模式')

    await user.click(badge)
    const menu = await screen.findByRole('menu', { name: '帳號與外觀' })
    expect(within(menu).getByText(/資料儲存於此瀏覽器/)).toBeTruthy()
    // 本機模式沒有登出
    expect(within(menu).queryByRole('menuitem', { name: /登出/ })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: /外觀：/ })).toBeTruthy()
  })

  it('頁首右側只剩兩個控制項（0.6.5-dev.3 由 8 個收斂）', async () => {
    render(<App />)
    await screen.findByText('本機模式')
    // 工作區選單 + 帳號選單。原本是：下拉 + 新增 + 重新命名 + 費率 + 刪除 + 主題 + email + 登出
    const wsTrigger = screen.getByRole('button', { name: /^工作區：/ })
    const userTrigger = screen.getByRole('button', { name: '本機模式選單' })
    const header = wsTrigger.closest('.app-header-inner')!
    const rightButtons = [...header.querySelectorAll('.ws-select button, .header-meta button')]
    expect(rightButtons).toEqual([wsTrigger, userTrigger])
  })

})