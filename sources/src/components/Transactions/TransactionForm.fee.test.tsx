// @vitest-environment jsdom
/**
 * The fee rate and the minimum fee in the transaction form seed from the workspace default,
 * but an edit belongs to that one transaction. The form must not write the value back
 * into the workspace default — the workspace fee dialog owns that value.
 */
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'

/** Every localStorage key the workspace fee defaults live under. */
/**
 * These fee tests record a sell with no shares behind it, which since BUG-105 asks first
 * (「超過當時的庫存」). The question is not what they test, so answer it and carry on.
 */
async function confirmOversell(user: ReturnType<typeof userEvent.setup>) {
  const ask = await screen.findByRole('dialog', { name: '超過當時的庫存' })
  await user.click(within(ask).getByRole('button', { name: '仍要存檔' }))
}

function storedFeeKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)
    if (key && (key.startsWith('stock-pnl-web/fee-rate') || key.startsWith('stock-pnl-web/min-fee')))
      keys.push(key)
  }
  return keys
}

async function openNewTransactionForm(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await screen.findByText('本機模式')
  await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
  await user.click(await screen.findByRole('button', { name: /新增交易/ }))
  const dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
  return within(dialog)
}

/**
 * The rebate decides the dashboard's headline basis only (user's call, 2026-10-01). A recorded fee
 * is what the trade ends up costing you, so the form fills the discount either way.
 */
describe('TransactionForm 折扣怎麼退不影響帶入的費率', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  const seed = (rebate: 'instant' | 'monthly') => {
    window.localStorage.setItem(
      'stock-pnl-web/local-store-v1',
      JSON.stringify({
        workspaces: [
          {
            id: 'ws-fee',
            name: '玉山證券',
            created_at: '2026-01-01T00:00:00Z',
            fee_rate: 0.0005415,
            fee_rebate: rebate,
          },
        ],
        transactions: [],
      }),
    )
    window.localStorage.setItem('stock-pnl-web/current-workspace', 'ws-fee')
    window.localStorage.setItem('stock-pnl-web/fee-rate/ws-fee', '0.0005415')
  }

  it.each(['monthly', 'instant'] as const)('%s：都帶入折扣後的費率', async (rebate) => {
    const user = userEvent.setup()
    seed(rebate)
    const form = await openNewTransactionForm(user)
    expect((form.getByLabelText('手續費率') as HTMLInputElement).value).toBe('0.0005415')
  })
})

describe('TransactionForm 手續費欄位不連動全域預設', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('F1: 修改手續費率不會寫回工作區預設值', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    const rate = form.getByLabelText('手續費率')
    await user.clear(rate)
    await user.type(rate, '0.0004275')

    expect((rate as HTMLInputElement).value).toBe('0.0004275')
    expect(storedFeeKeys()).toEqual([])
  })

  it('F2: 修改最低手續費不會寫回工作區預設值', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    const minFee = form.getByLabelText('最低手續費')
    await user.clear(minFee)
    await user.type(minFee, '5')

    expect((minFee as HTMLInputElement).value).toBe('5')
    expect(storedFeeKeys()).toEqual([])
  })

  it('F3: 手續費率提示列出原價與常見折扣的費率數字', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    // The numbers must be present verbatim so the user can copy one into the field.
    const hint = form.getByTestId('fee-rate-hint').textContent ?? ''
    expect(hint).toContain('0.001425')
    expect(hint).toContain('0.00092625')
    expect(hint).toContain('0.0004275')
    expect(hint).toContain('6.5')
    expect(hint).toContain('3')
  })
  it('F4: 切換張/零股不會洗掉手動輸入的最低手續費', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    const minFee = form.getByLabelText('最低手續費')
    await user.clear(minFee)
    await user.type(minFee, '7')

    // 單位切走再切回：手動輸入的值沒有其他副本，被覆蓋就永久遺失
    await user.selectOptions(form.getByLabelText('股數單位'), '零股')
    await user.selectOptions(form.getByLabelText('股數單位'), '張')

    expect((form.getByLabelText('最低手續費') as HTMLInputElement).value).toBe('7')
  })

  it('F5: 未手動輸入時，切到零股仍帶入零股的預設最低手續費', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    expect((form.getByLabelText('最低手續費') as HTMLInputElement).value).toBe('20')
    await user.selectOptions(form.getByLabelText('股數單位'), '零股')
    expect((form.getByLabelText('最低手續費') as HTMLInputElement).value).toBe('1')
  })

  /**
   * 建一筆現股當沖賣出後重開編輯，回傳編輯視窗。
   * `strict` 為 true 時整個 App 包在 StrictMode 下 —— 正式進入點 main.tsx 就是這樣掛的，
   * 而 StrictMode 會把 effect 的 setup 跑兩次，用「跳過第一次」的旗標擋不住第二次。
   */
  async function editSavedDayTradeFee(strict: boolean) {
    const user = userEvent.setup()
    render(<App />, strict ? { wrapper: StrictMode } : undefined)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    let dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    let form = within(dialog)
    await user.selectOptions(form.getByLabelText('交易類型'), 'SELL')
    await user.type(form.getByLabelText(/股票代號/), '2344')
    await user.type(form.getByLabelText('股票名稱'), '華邦電')
    await user.selectOptions(form.getByLabelText('股數單位'), '零股')
    await user.type(form.getByLabelText('交易單價'), '188.5')
    await user.type(form.getByLabelText('交易股數'), '1000')
    const rate = form.getByLabelText('手續費率')
    await user.clear(rate)
    await user.type(rate, '0.0004275')
    const tax = form.getByLabelText('證交稅率')
    await user.clear(tax)
    await user.type(tax, '0.0015')
    expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('362')
    await user.click(form.getByRole('button', { name: '確認送出' }))
    await confirmOversell(user)
    await form.findByText(/成功新增交易紀錄/)
    await user.click(form.getByRole('button', { name: '關閉' }))

    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    dialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    return within(dialog)
  }

  it('F6: 編輯既有交易時，載入當下不得依現行費率覆蓋原本的手續費 / 稅金', async () => {
    const form = await editSavedDayTradeFee(false)
    expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('362')
    expect(form.queryByText(/已依目前費率重算/)).toBeNull()
  })

  it('F6b: StrictMode 下 effect 跑兩次，原紀錄同樣不得被覆蓋', async () => {
    const form = await editSavedDayTradeFee(true)
    expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('362')
    expect(form.queryByText(/已依目前費率重算/)).toBeNull()
  })

  it('F7: 編輯模式下使用者改動單價後，手續費才重新計算', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    let dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    let form = within(dialog)
    await user.type(form.getByLabelText(/股票代號/), '2330')
    await user.type(form.getByLabelText('股票名稱'), '台積電')
    await user.type(form.getByLabelText('交易單價'), '500')
    await user.type(form.getByLabelText('交易股數'), '1')
    await user.click(form.getByRole('button', { name: '確認送出' }))
    await form.findByText(/成功新增交易紀錄/)
    await user.click(form.getByRole('button', { name: '關閉' }))

    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    dialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    form = within(dialog)
    // 買進 500 × 1000 股，原價費率 → floor(500000*0.001425) = 712
    const fee = form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement
    expect(fee.value).toBe('712')

    const price = form.getByLabelText('交易單價')
    await user.clear(price)
    await user.type(price, '600')
    // floor(600000*0.001425) = 855
    expect(fee.value).toBe('855')
  })

  it('F8: 選「當沖」會帶入減半證交稅率，存檔後重開編輯仍記得', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    let dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    let form = within(dialog)
    await user.selectOptions(form.getByLabelText('交易類型'), 'SELL')
    await user.type(form.getByLabelText(/股票代號/), '2344')
    await user.type(form.getByLabelText('股票名稱'), '華邦電')
    await user.selectOptions(form.getByLabelText('股數單位'), '零股')
    await user.type(form.getByLabelText('交易單價'), '188.5')
    await user.type(form.getByLabelText('交易股數'), '1000')

    // 選了當沖，證交稅率就該是減半的 0.0015 —— 這是使用者本來要手動改的那一步
    await user.selectOptions(form.getByLabelText('交易性質'), 'DAY_TRADE')
    expect((form.getByLabelText('證交稅率') as HTMLInputElement).value).toBe('0.0015')

    await user.click(form.getByRole('button', { name: '確認送出' }))
    await confirmOversell(user)
    await form.findByText(/成功新增交易紀錄/)
    await user.click(form.getByRole('button', { name: '關閉' }))

    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    dialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    form = within(dialog)
    expect((form.getByLabelText('交易性質') as HTMLSelectElement).value).toBe('DAY_TRADE')
    // BUG-091: 重開編輯時稅率也要記得是減半的。原本這裡會顯示 0.003，而且只要動到任何一個
    // 核心欄位，手續費就會用全額稅率重算，把當初存進去的半稅金額蓋掉。
    expect((form.getByLabelText('證交稅率') as HTMLInputElement).value).toBe('0.0015')
    const fee = form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement
    const before = fee.value
    const qty = form.getByLabelText('交易股數')
    await user.clear(qty)
    await user.type(qty, '1000')
    expect(fee.value).toBe(before)
  })

  // BUG-093: 證交稅條例 §2-2 把千分之1.5 寫給「上市或上櫃股票」，排除的是 §2 第一款的 0.3%。
  // ETF 走第二款的 0.1%，這條沒碰到它，所以 ETF 當沖**沒有**降稅，稅率不動。
  it('F8b: ETF 當沖仍是 0.1%，不是 0.15% 也不是 0.05%（BUG-093）', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)
    await user.selectOptions(form.getByLabelText('交易類型'), 'SELL')
    await user.type(form.getByLabelText(/股票代號/), '0050')
    await user.type(form.getByLabelText('股票名稱'), '元大台灣50')
    expect((form.getByLabelText('證交稅率') as HTMLInputElement).value).toBe('0.001')
    await user.selectOptions(form.getByLabelText('交易性質'), 'DAY_TRADE')
    expect((form.getByLabelText('證交稅率') as HTMLInputElement).value).toBe('0.001')
    await user.selectOptions(form.getByLabelText('交易性質'), 'SPOT')
    expect((form.getByLabelText('證交稅率') as HTMLInputElement).value).toBe('0.001')
  })

  // BUG-094: `taxRateManual` exists to mean "the user set this number". Changing 交易性質 is a
  // change of classification, not a request to re-price, so it must not discard that number.
  // On a 股票 the overwrite was invisible (現股 and a hand-set 0.3% are the same value); an ETF
  // is where it shows, because the derived rate (0.1%) differs from what the user typed.
  it('F8d: 手動設過的稅率，改交易性質時不會被蓋掉（BUG-094）', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)
    await user.selectOptions(form.getByLabelText('交易類型'), 'SELL')
    await user.type(form.getByLabelText(/股票代號/), '0050')
    await user.type(form.getByLabelText('股票名稱'), '元大台灣50')
    await user.selectOptions(form.getByLabelText('交易性質'), 'DAY_TRADE')
    expect((form.getByLabelText('證交稅率') as HTMLInputElement).value).toBe('0.001')

    // 使用者自己把稅率改成一般 0.3%
    await user.selectOptions(form.getByLabelText('證交稅率快選'), '0.003')
    expect((form.getByLabelText('證交稅率') as HTMLInputElement).value).toBe('0.003')

    // 改回現股：分類變了，使用者設的數字不該跟著被推導掉
    await user.selectOptions(form.getByLabelText('交易性質'), 'SPOT')
    expect((form.getByLabelText('證交稅率') as HTMLInputElement).value).toBe('0.003')

    // 自動推導仍然可用：快選選回 ETF 0.1% 就回到那個值
    await user.selectOptions(form.getByLabelText('證交稅率快選'), '0.001')
    expect((form.getByLabelText('證交稅率') as HTMLInputElement).value).toBe('0.001')
  })

  it('F8c: 一般股票當沖才降到 0.15%（BUG-093）', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)
    await user.selectOptions(form.getByLabelText('交易類型'), 'SELL')
    await user.type(form.getByLabelText(/股票代號/), '2303')
    await user.type(form.getByLabelText('股票名稱'), '聯電')
    expect((form.getByLabelText('證交稅率') as HTMLInputElement).value).toBe('0.003')
    await user.selectOptions(form.getByLabelText('交易性質'), 'DAY_TRADE')
    expect((form.getByLabelText('證交稅率') as HTMLInputElement).value).toBe('0.0015')
  })

  it('F9: 美股沒有交易性質欄位', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)
    expect(form.getByLabelText('交易性質')).toBeTruthy()
    await user.selectOptions(form.getByLabelText('交易市場'), 'US')
    expect(form.queryByLabelText('交易性質')).toBeNull()
  })

  it('F10: 儲存自訂手續費率後，重開編輯表單完整保留該費率', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    let dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    let form = within(dialog)
    await user.type(form.getByLabelText(/股票代號/), '2330')
    await user.type(form.getByLabelText('股票名稱'), '台積電')
    await user.type(form.getByLabelText('交易單價'), '500')
    await user.type(form.getByLabelText('交易股數'), '1')
    const rate = form.getByLabelText('手續費率')
    await user.clear(rate)
    await user.type(rate, '0.0004275') // 3 折
    // 500 * 1000 * 0.0004275 = 213.75 -> 213
    expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('213')

    await user.click(form.getByRole('button', { name: '確認送出' }))
    await form.findByText(/成功新增交易紀錄/)
    await user.click(form.getByRole('button', { name: '關閉' }))

    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    dialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    form = within(dialog)
    expect((form.getByLabelText('手續費率') as HTMLInputElement).value).toBe('0.0004275')
    expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('213')
  })

  it('F11: 編輯自訂費率交易時，修改單價依自訂費率重算（而非全域費率）', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    let dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    let form = within(dialog)
    await user.type(form.getByLabelText(/股票代號/), '2330')
    await user.type(form.getByLabelText('股票名稱'), '台積電')
    await user.type(form.getByLabelText('交易單價'), '500')
    await user.type(form.getByLabelText('交易股數'), '1')
    const rate = form.getByLabelText('手續費率')
    await user.clear(rate)
    await user.type(rate, '0.0004275') // 3 折

    await user.click(form.getByRole('button', { name: '確認送出' }))
    await form.findByText(/成功新增交易紀錄/)
    await user.click(form.getByRole('button', { name: '關閉' }))

    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    dialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    form = within(dialog)

    // 修改單價為 600
    const price = form.getByLabelText('交易單價')
    await user.clear(price)
    await user.type(price, '600')

    // 600 * 1000 * 0.0004275 = 256.5 -> 256（若被全域 0.001425 覆蓋會是 855）
    expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('256')
  })

  it('F12: 手動編輯手續費率為 0.00092625（6.5折）並儲存後，再次開啟編輯依然保留 0.00092625', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

    // 新增標準費率交易（單價 100，1 張）
    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    let dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    let form = within(dialog)
    await user.type(form.getByLabelText(/股票代號/), '2330')
    await user.type(form.getByLabelText('股票名稱'), '台積電')
    await user.type(form.getByLabelText('交易單價'), '100')
    await user.type(form.getByLabelText('交易股數'), '1')
    await user.click(form.getByRole('button', { name: '確認送出' }))
    await form.findByText(/成功新增交易紀錄/)
    await user.click(form.getByRole('button', { name: '關閉' }))

    // 第一次編輯：將手續費率修改為 0.00092625（6.5折）
    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    dialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    form = within(dialog)
    const rateInput = form.getByLabelText('手續費率')
    await user.clear(rateInput)
    await user.type(rateInput, '0.00092625')
    // 100 * 1000 * 0.00092625 = 92.625 -> 92
    expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('92')
    await user.click(form.getByRole('button', { name: '儲存變更' }))

    // 第二次編輯：驗證再次開啟時，手續費率精確為 0.00092625，手續費依然為 92
    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    dialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    form = within(dialog)
    expect((form.getByLabelText('手續費率') as HTMLInputElement).value).toBe('0.00092625')
    expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('92')
  })
})

// Task 187: 當沖 is a relationship between two trades, so at the moment the buy is recorded the
// answer does not exist yet. The sell is the first point where it can be known — and only
// sometimes for certain, which is why the form decides in one case and asks in the other.
describe('TransactionForm 當沖偵測（Task 187）', () => {
  const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())

  // Each case builds its own ledger, and the local store survives a `cleanup()` — without this a
  // later case still sees the earlier one's same-day buy and the detector fires when it should not.
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  async function sellForm(user: ReturnType<typeof userEvent.setup>, buys: Array<[string, number, number, number]>) {
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    for (const [txDate, price, qty, fee] of buys) {
      await user.click(await screen.findByRole('button', { name: /新增交易/ }))
      const dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
      const f = within(dialog)
      const dateInput = f.getByLabelText('交易日期')
      await user.clear(dateInput)
      await user.type(dateInput, txDate)
      await user.type(f.getByLabelText(/股票代號/), '2303')
      await user.type(f.getByLabelText('股票名稱'), '聯電')
      await user.selectOptions(f.getByLabelText('股數單位'), '零股')
      await user.type(f.getByLabelText('交易單價'), String(price))
      await user.type(f.getByLabelText('交易股數'), String(qty))
      const feeField = f.getByLabelText(/手續費 \/ 稅金/)
      await user.clear(feeField)
      await user.type(feeField, String(fee))
      await user.click(f.getByRole('button', { name: '確認送出' }))
      await f.findByText(/成功新增交易紀錄/)
      await user.click(f.getByRole('button', { name: '關閉' }))
    }
    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    const dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    const f = within(dialog)
    await user.selectOptions(f.getByLabelText('交易類型'), 'SELL')
    await user.type(f.getByLabelText(/股票代號/), '2303')
    await user.selectOptions(f.getByLabelText('股數單位'), '零股')
    await user.type(f.getByLabelText('交易單價'), '166')
    await user.type(f.getByLabelText('交易股數'), '1000')
    return f
  }

  it('之前沒有庫存、今天才買進：自動記成當沖，稅率減半，而且可以改回去', async () => {
    const user = userEvent.setup()
    const f = await sellForm(user, [[TODAY, 164.5, 1000, 70]])

    expect((f.getByLabelText('交易性質') as HTMLSelectElement).value).toBe('DAY_TRADE')
    expect((f.getByRole('spinbutton', { name: '證交稅率' }) as HTMLInputElement).value).toBe('0.0015')
    // 166,000 以工作區預設費率 0.1425%：手續費 236 + 當沖半稅 249
    expect((f.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('485')

    await user.click(f.getByRole('button', { name: '改回現股' }))
    expect((f.getByLabelText('交易性質') as HTMLSelectElement).value).toBe('SPOT')
    // 全額稅：236 + 498
    expect((f.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('734')
    // 改回去之後不會被自動邏輯再搶走
    expect((f.getByLabelText('交易性質') as HTMLSelectElement).value).toBe('SPOT')
  })

  it('有舊庫存時只提示，不自己決定（猜錯就寫進一個券商沒收過的稅）', async () => {
    const user = userEvent.setup()
    const f = await sellForm(user, [['2026-05-05', 100, 2000, 85], [TODAY, 164.5, 1000, 70]])

    expect((f.getByLabelText('交易性質') as HTMLSelectElement).value).toBe('SPOT')
    expect((f.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('734')

    await user.click(f.getByRole('button', { name: '改成當沖' }))
    expect((f.getByLabelText('交易性質') as HTMLSelectElement).value).toBe('DAY_TRADE')
    expect((f.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('485')
  })

  /** Records one TW odd-lot trade through the real form; `nature` / `taxRate` are set before submit. */
  async function addTrade(
    user: ReturnType<typeof userEvent.setup>,
    o: { sell?: boolean; date: string; ticker: string; name: string; price: number; qty: number; fee?: number },
  ) {
    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    const f = within(await screen.findByRole('dialog', { name: '新增交易紀錄' }))
    if (o.sell) await user.selectOptions(f.getByLabelText('交易類型'), 'SELL')
    const dateInput = f.getByLabelText('交易日期')
    await user.clear(dateInput)
    await user.type(dateInput, o.date)
    await user.type(f.getByLabelText(/股票代號/), o.ticker)
    await user.type(f.getByLabelText('股票名稱'), o.name)
    await user.selectOptions(f.getByLabelText('股數單位'), '零股')
    await user.type(f.getByLabelText('交易單價'), String(o.price))
    await user.type(f.getByLabelText('交易股數'), String(o.qty))
    if (o.fee !== undefined) {
      const feeField = f.getByLabelText(/手續費 \/ 稅金/)
      await user.clear(feeField)
      await user.type(feeField, String(o.fee))
    }
    return f
  }
  async function submitTrade(user: ReturnType<typeof userEvent.setup>, f: ReturnType<typeof within>) {
    await user.click(f.getByRole('button', { name: '確認送出' }))
    await f.findByText(/成功新增交易紀錄/)
    await user.click(f.getByRole('button', { name: '關閉' }))
  }

  // BUG-095: in edit mode the ledger already contains the sell being edited. Selling the *old*
  // 1,000 shares consumes the old lot by FIFO, so only today's lot is left open — which used to
  // read as "no older position" and flip the saved 現股 sell to 當沖 the moment it was opened.
  it('BUG-095: 打開一筆普通賣出來編輯，不會被自動改成當沖、費用不變', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await submitTrade(user, await addTrade(user, { date: '2026-05-05', ticker: '2303', name: '聯電', price: 100, qty: 1000, fee: 85 }))
    await submitTrade(user, await addTrade(user, { date: TODAY, ticker: '2303', name: '聯電', price: 164.5, qty: 1000, fee: 70 }))
    const sell = await addTrade(user, { sell: true, date: TODAY, ticker: '2303', name: '聯電', price: 166, qty: 1000 })
    // An older position exists, so the new-sell form only offers: 現股, full tax 236 + 498.
    expect((sell.getByLabelText('交易性質') as HTMLSelectElement).value).toBe('SPOT')
    expect((sell.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('734')
    await submitTrade(user, sell)

    let opened = false
    for (const button of await screen.findAllByRole('button', { name: '編輯這筆交易' })) {
      await user.click(button)
      const f = within(await screen.findByRole('dialog', { name: '編輯交易紀錄' }))
      if ((f.getByLabelText('交易類型') as HTMLSelectElement).value === 'SELL') {
        opened = true
        expect((f.getByLabelText('交易性質') as HTMLSelectElement).value).toBe('SPOT')
        expect((f.getByRole('spinbutton', { name: '證交稅率' }) as HTMLInputElement).value).toBe('0.003')
        expect((f.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('734')
        expect(f.queryByRole('button', { name: '改回現股' })).toBeNull()
        break
      }
      await user.click(f.getByRole('button', { name: '關閉' }))
    }
    expect(opened).toBe(true)
  })

  // BUG-096: the automatic label goes through the same rule as the 交易性質 drop-down (BUG-094):
  // a rate the user set survives a change of classification.
  it('BUG-096: 先自己設定證交稅率再輸入代號，自動記成當沖也不會蓋掉它', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await submitTrade(user, await addTrade(user, { date: TODAY, ticker: '2303', name: '聯電', price: 164.5, qty: 1000, fee: 70 }))

    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    const f = within(await screen.findByRole('dialog', { name: '新增交易紀錄' }))
    await user.selectOptions(f.getByLabelText('交易類型'), 'SELL')
    const tax = f.getByRole('spinbutton', { name: '證交稅率' }) as HTMLInputElement
    await user.clear(tax)
    await user.type(tax, '0.002')
    await user.type(f.getByLabelText(/股票代號/), '2303')

    expect((f.getByLabelText('交易性質') as HTMLSelectElement).value).toBe('DAY_TRADE')
    expect(tax.value).toBe('0.002')
    expect(f.getByRole('status').textContent).toContain('你自己設定的 0.2%')
    await user.click(f.getByRole('button', { name: '改回現股' }))
    expect(tax.value).toBe('0.002')
  })

  // BUG-097: 證券交易稅條例 §2-2 sets 千分之1.5 for 上市或上櫃「股票」only and displaces §2 第一款
  // (0.3%); an ETF is taxed under 第二款 (0.1%), which §2-2 does not touch. So an ETF day trade
  // is still labelled — it decides how the cost is netted — but the notice must not promise a cut.
  it('BUG-097: ETF 當天買賣記成當沖，提示寫稅率仍是 0.1%，不說減半', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await submitTrade(user, await addTrade(user, { date: TODAY, ticker: '0050', name: '元大台灣50', price: 180, qty: 1000, fee: 70 }))
    const f = await addTrade(user, { sell: true, date: TODAY, ticker: '0050', name: '元大台灣50', price: 181, qty: 1000 })

    expect((f.getByLabelText('交易性質') as HTMLSelectElement).value).toBe('DAY_TRADE')
    expect((f.getByRole('spinbutton', { name: '證交稅率' }) as HTMLInputElement).value).toBe('0.001')
    const notice = f.getByRole('status').textContent ?? ''
    expect(notice).toContain('這檔當沖沒有降稅，證交稅仍是 0.1%')
    expect(notice).not.toMatch(/減半|一半|0\.05%/)
  })

  it('同一天沒有買進就完全不出現', async () => {
    const user = userEvent.setup()
    const f = await sellForm(user, [['2026-05-05', 100, 2000, 85]])
    expect(f.queryByRole('button', { name: '改成當沖' })).toBeNull()
    expect(f.queryByRole('button', { name: '改回現股' })).toBeNull()
    expect((f.getByLabelText('交易性質') as HTMLSelectElement).value).toBe('SPOT')
  })
})
