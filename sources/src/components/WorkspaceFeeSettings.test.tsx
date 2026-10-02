// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceFeeSettings } from './WorkspaceFeeSettings'

const {
  useWorkspace,
  setWorkspaceFeeRate,
  setWorkspaceFeeRateHistory,
  setWorkspaceFeeRebate,
  setWorkspaceFeeRounding,
  setWorkspaceDayTradeTaxEstimate,
  setWorkspaceSellFeeBasis,
} = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
  // Mirrors `saveWorkspaceFeeRate`, which writes the localStorage cache the form reads its base
  // rate back from; without it the base row would never show what was just saved.
  setWorkspaceFeeRate: vi.fn(async (_id: string, rate: number) => {
    localStorage.setItem('stock-pnl-web/fee-rate/ws-1', String(rate))
  }),
  setWorkspaceFeeRateHistory: vi.fn(async () => {}),
  setWorkspaceFeeRebate: vi.fn(async () => {}),
  setWorkspaceFeeRounding: vi.fn(async () => {}),
  setWorkspaceDayTradeTaxEstimate: vi.fn(async () => {}),
  setWorkspaceSellFeeBasis: vi.fn(async () => {}),
}))
vi.mock('../context/WorkspaceContext', () => ({ useWorkspace }))

function mount(current: Record<string, unknown>, rate: string | null, onPreview?: (d: unknown) => void) {
  if (rate === null) localStorage.removeItem('stock-pnl-web/fee-rate/ws-1')
  else localStorage.setItem('stock-pnl-web/fee-rate/ws-1', rate)
  useWorkspace.mockReturnValue({
    current: { id: 'ws-1', name: '玉山證券', ...current },
    setWorkspaceFeeRate,
    setWorkspaceFeeRateHistory,
    setWorkspaceFeeRebate,
    setWorkspaceFeeRounding,
    setWorkspaceDayTradeTaxEstimate,
    setWorkspaceSellFeeBasis,
  })
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const view = render(<WorkspaceFeeSettings onClose={onClose} onSaved={onSaved} onPreview={onPreview} />)
  return { onClose, onSaved, unmount: view.unmount }
}

describe('WorkspaceFeeSettings', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    localStorage.removeItem('stock-pnl-web/fee-rate-history/ws-1')
  })

  it('starts from the stored discount and rebate, and previews the derived basis', () => {
    mount({ fee_rebate: 'monthly' }, '0.000399')
    expect((screen.getByLabelText('手續費折扣') as HTMLSelectElement).value).toBe('0.000399')
    expect((screen.getByRole('radio', { name: /月退/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/牌告 0.1425% 預扣/)).toBeTruthy()
  })

  // Task 189: the rebate and the sell-fee basis are separate facts. 元大 is 日退 and still withholds
  // the posted rate, so switching the rebate of a saved workspace leaves the sell basis where it was.
  it('switching to 現折 keeps the sell basis and pins it on save', async () => {
    const user = userEvent.setup()
    const { onClose, onSaved } = mount({ fee_rebate: 'monthly' }, '0.000399')
    expect(screen.getByText(/成本裡的買進手續費也用牌告 0.1425% 算/)).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: /現折/ }))
    expect((screen.getByRole('radio', { name: /牌告 0.1425%/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/牌告 0.1425% 預扣賣出手續費，再扣證交稅；成本用你記錄的手續費/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(setWorkspaceFeeRate).not.toHaveBeenCalled()
    expect(setWorkspaceFeeRebate).toHaveBeenCalledWith('ws-1', 'instant')
    expect(setWorkspaceSellFeeBasis).toHaveBeenCalledWith('ws-1', 'list')
    expect(onSaved).toHaveBeenCalledWith({ rateChanged: false })
    expect(onClose).toHaveBeenCalled()
  })

  it('a new rate is saved and reported so the caller can offer a recalculation', async () => {
    const user = userEvent.setup()
    const { onSaved } = mount({}, null)
    await user.selectOptions(screen.getByLabelText('手續費折扣'), '0.000285')
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(setWorkspaceFeeRate).toHaveBeenCalledWith('ws-1', 0.000285)
    // Picking a discount also writes the 月退 default (see the 折扣怎麼退 describe below): the
    // Edge holdings card reads fee_rebate from the row, so a default only the form knows about
    // would make the nightly card disagree with the dashboard.
    expect(setWorkspaceFeeRebate).toHaveBeenCalledWith('ws-1', 'monthly')
    expect(onSaved).toHaveBeenCalledWith({ rateChanged: true })
  })

  it('a workspace that never saved fee settings pairs a discount with the posted sell rate (Task 189)', async () => {
    const user = userEvent.setup()
    mount({}, null)
    expect((screen.getByRole('radio', { name: /^折扣後/ }) as HTMLInputElement).checked).toBe(true)
    await user.selectOptions(screen.getByLabelText('手續費折扣'), '0.000285')
    expect((screen.getByRole('radio', { name: /牌告 0.1425%/ }) as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(setWorkspaceSellFeeBasis).toHaveBeenCalledWith('ws-1', 'list')
  })

  it('a stored rate outside the list opens as a custom rate', () => {
    mount({}, '0.0004')
    expect((screen.getByLabelText('手續費折扣') as HTMLSelectElement).value).toBe('custom')
    expect((screen.getByLabelText('自訂手續費率') as HTMLInputElement).value).toBe('0.0004')
  })

  it('no discount disables the rebate choice', () => {
    mount({}, '0.001425')
    expect(screen.getByRole('radio', { name: /月退/ }).matches(':disabled')).toBe(true)
  })

  it('fee/tax flooring defaults to per lot and saves only when changed (BUG-088)', async () => {
    const user = userEvent.setup()
    mount({ fee_rebate: 'monthly' }, '0.0004275')
    expect((screen.getByRole('radio', { name: /每一批分開算/ }) as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole('radio', { name: /整筆一起算/ }))
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(setWorkspaceFeeRounding).toHaveBeenCalledWith('ws-1', 'position')
    expect(setWorkspaceFeeRate).not.toHaveBeenCalled()
    expect(setWorkspaceFeeRebate).not.toHaveBeenCalled()
  })

  it('the flooring choice stays available without a discount', () => {
    mount({ fee_rounding: 'position' }, '0.001425')
    const whole = screen.getByRole('radio', { name: /整筆一起算/ }) as HTMLInputElement
    expect(whole.checked).toBe(true)
    expect(whole.matches(':disabled')).toBe(false)
  })

  it('previews every unsaved change and ends the preview on close', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    const { unmount } = mount({ fee_rebate: 'monthly' }, '0.0004275', onPreview)
    const base = { rate: 0.0004275, rebate: 'monthly', rounding: 'lot', dayTradeTax: true, sellBasis: 'list' }
    expect(onPreview).toHaveBeenLastCalledWith(base)
    await user.click(screen.getByRole('radio', { name: /整筆一起算/ }))
    expect(onPreview).toHaveBeenLastCalledWith({ ...base, rounding: 'position' })
    await user.selectOptions(screen.getByLabelText('手續費折扣'), '0.000285')
    expect(onPreview).toHaveBeenLastCalledWith({ ...base, rate: 0.000285, rounding: 'position' })
    // BUG-090: the 當沖 tax estimate previews like the rest, and saves nothing until 儲存.
    await user.click(screen.getByRole('radio', { name: /一律用完整稅率/ }))
    expect(onPreview).toHaveBeenLastCalledWith({
      ...base,
      rate: 0.000285,
      rounding: 'position',
      dayTradeTax: false,
    })
    // Task 189: so does the sell-fee basis.
    await user.click(screen.getByRole('radio', { name: /^折扣後/ }))
    expect(onPreview).toHaveBeenLastCalledWith({
      ...base,
      rate: 0.000285,
      rounding: 'position',
      dayTradeTax: false,
      sellBasis: 'net',
    })
    expect(setWorkspaceFeeRounding).not.toHaveBeenCalled()
    expect(setWorkspaceDayTradeTaxEstimate).not.toHaveBeenCalled()
    expect(setWorkspaceSellFeeBasis).not.toHaveBeenCalled()
    unmount()
    expect(onPreview).toHaveBeenLastCalledWith(null)
  })

  it('an invalid custom rate previews nothing', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    mount({}, '0.0004', onPreview)
    await user.clear(screen.getByLabelText('自訂手續費率'))
    expect(onPreview).toHaveBeenLastCalledWith(null)
  })

  it('saving an unchanged form does not write the flooring', async () => {
    const user = userEvent.setup()
    mount({}, null)
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(setWorkspaceFeeRounding).not.toHaveBeenCalled()
  })
})

// Task 182: 玉山 moved from 6.5 折 to 3.8 折 on 2026-10-01. Changing the discount must open a new
// period from a date, not overwrite what the broker charged before it.
describe('WorkspaceFeeSettings 費率生效日（Task 182）', () => {
  const R65 = '0.00092625'
  const R38 = '0.0005415'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
  /**
   * A date the user typed that is **not** today, for the tests about "動過生效日".
   * It must be in the past: a literal equal to today makes the form take the "date untouched"
   * branch, and the test then asserts the opposite of what runs. This bit on 2026-10-02 at
   * 00:00 Asia/Taipei, when a hardcoded '2026-10-02' silently became today and one of these
   * tests went red with no code change behind it.
   */
  const PAST = '2026-09-15'

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    localStorage.removeItem('stock-pnl-web/fee-rate-history/ws-1')
  })

  it('已經有費率的工作區改折扣時，寫的是新的一段，不是覆蓋舊費率', async () => {
    const user = userEvent.setup()
    mount({ fee_rate: 0.00092625 }, R65)
    await user.selectOptions(screen.getByLabelText('手續費折扣'), R38)
    await user.clear(screen.getByLabelText('從哪天開始用這個折扣'))
    await user.type(screen.getByLabelText('從哪天開始用這個折扣'), PAST)
    await user.click(screen.getByRole('button', { name: '儲存' }))

    expect(setWorkspaceFeeRate).not.toHaveBeenCalled()
    expect(setWorkspaceFeeRateHistory).toHaveBeenCalledWith('ws-1', [
      { from: PAST, rate: 0.0005415 },
    ])
  })

  it('生效日預設是今天', () => {
    mount({ fee_rate: 0.00092625 }, R65)
    expect((screen.getByLabelText('從哪天開始用這個折扣') as HTMLInputElement).value).toBe(today)
  })

  it('還沒有費率的工作區，日期沒動時存的是基準費率，套用到全部交易', async () => {
    const user = userEvent.setup()
    mount({}, null)
    await user.selectOptions(screen.getByLabelText('手續費折扣'), R38)
    await user.click(screen.getByRole('button', { name: '儲存' }))

    expect(setWorkspaceFeeRate).toHaveBeenCalledWith('ws-1', 0.0005415)
    expect(setWorkspaceFeeRateHistory).not.toHaveBeenCalled()
  })

  // The trap this closes: on a workspace with no rate yet, the chosen date used to be ignored and
  // the discount became the base, so a batch recalculation re-priced every trade ever made at it.
  it('還沒有費率的工作區，動過生效日就寫成一段，更早之前記成不打折', async () => {
    const user = userEvent.setup()
    mount({}, null)
    await user.selectOptions(screen.getByLabelText('手續費折扣'), R38)
    await user.clear(screen.getByLabelText('從哪天開始用這個折扣'))
    await user.type(screen.getByLabelText('從哪天開始用這個折扣'), PAST)
    await user.click(screen.getByRole('button', { name: '儲存' }))

    expect(setWorkspaceFeeRate).toHaveBeenCalledWith('ws-1', 0.001425)
    expect(setWorkspaceFeeRateHistory).toHaveBeenCalledWith('ws-1', [
      { from: PAST, rate: 0.0005415 },
    ])
  })

  // The other half of the same trap: the base is already the discounted rate and no segment can be
  // added, because saving the same rate from a date is not a change at all.
  it('基準費率可以直接改，不用繞路；重複的段落會一起收掉', async () => {
    const user = userEvent.setup()
    mount({ fee_rate: 0.0005415 }, R38)
    await user.click(screen.getByRole('button', { name: '改' }))
    await user.selectOptions(screen.getByLabelText('更早之前的費率'), '0.001425')
    await user.click(screen.getByRole('button', { name: '確定' }))
    // BUG-108: 確定 only edits the draft; nothing is written until 儲存.
    expect(screen.getByText('不打折')).toBeTruthy()
    expect(setWorkspaceFeeRate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(setWorkspaceFeeRate).toHaveBeenCalledWith('ws-1', 0.001425)
  })

  it('自訂的基準費率也看得到，不會開在空白選項', async () => {
    const user = userEvent.setup()
    mount({ fee_rate: 0.0004 }, '0.0004')
    await user.click(screen.getByRole('button', { name: '改' }))
    expect((screen.getByLabelText('更早之前的費率') as HTMLSelectElement).value).toBe('0.0004')
  })

  it('改完基準費率後，同樣的折扣就能記成新的一段', async () => {
    const user = userEvent.setup()
    mount({ fee_rate: 0.001425 }, '0.001425')
    await user.selectOptions(screen.getByLabelText('手續費折扣'), R38)
    await user.clear(screen.getByLabelText('從哪天開始用這個折扣'))
    await user.type(screen.getByLabelText('從哪天開始用這個折扣'), PAST)
    await user.click(screen.getByRole('button', { name: '儲存' }))

    expect(setWorkspaceFeeRateHistory).toHaveBeenCalledWith('ws-1', [
      { from: PAST, rate: 0.0005415 },
    ])
  })

  it('列出變更紀錄，最新的在上面，最早那段標成基準費率；選單開在今天實際在用的費率', () => {
    localStorage.setItem(
      'stock-pnl-web/fee-rate-history/ws-1',
      JSON.stringify([{ from: '2020-01-01', rate: 0.0005415 }]),
    )
    mount({ fee_rate: 0.00092625 }, R65)
    expect(screen.getByText('2020-01-01 起')).toBeTruthy()
    expect(screen.getByText('2020-01-01 之前')).toBeTruthy()
    expect((screen.getByLabelText('手續費折扣') as HTMLSelectElement).value).toBe(R38)
  })

  it('還沒生效的那一段不影響今天：選單仍是舊折扣，並說明何時才會改', () => {
    localStorage.setItem(
      'stock-pnl-web/fee-rate-history/ws-1',
      JSON.stringify([{ from: '2099-01-01', rate: 0.0005415 }]),
    )
    mount({ fee_rate: 0.00092625 }, R65)
    expect((screen.getByLabelText('手續費折扣') as HTMLSelectElement).value).toBe(R65)
    expect(screen.getByText('2099-01-01 起')).toBeTruthy()
  })

  it('刪掉一段就回到上一個折扣', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'stock-pnl-web/fee-rate-history/ws-1',
      JSON.stringify([{ from: '2020-01-01', rate: 0.0005415 }]),
    )
    const { onSaved } = mount({ fee_rate: 0.00092625 }, R65)
    await user.click(screen.getByRole('button', { name: '刪除' }))
    // The select follows the draft to the rate now in force, so 儲存 does not re-open the period.
    expect((screen.getByLabelText('手續費折扣') as HTMLSelectElement).value).toBe(R65)
    expect(screen.getByRole('status').textContent).toMatch(/按「儲存」才會生效/)
    expect(setWorkspaceFeeRateHistory).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(setWorkspaceFeeRateHistory).toHaveBeenCalledTimes(1)
    expect(setWorkspaceFeeRateHistory).toHaveBeenCalledWith('ws-1', [])
    expect(onSaved).toHaveBeenCalledWith({ rateChanged: true })
  })

  // BUG-108, reported on PROD: 刪除 wrote to the database at once, so closing without saving still
  // lost the period, although the panel says 取消 restores the old settings.
  it('刪除後按取消，什麼都不會寫入', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'stock-pnl-web/fee-rate-history/ws-1',
      JSON.stringify([{ from: '2020-01-01', rate: 0.0005415 }]),
    )
    const { onClose } = mount({ fee_rate: 0.001425 }, '0.001425')
    await user.click(screen.getByRole('button', { name: '刪除' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalled()
    expect(setWorkspaceFeeRateHistory).not.toHaveBeenCalled()
    expect(setWorkspaceFeeRate).not.toHaveBeenCalled()
    expect(setWorkspaceFeeRebate).not.toHaveBeenCalled()
  })

  it('改基準費率後按取消，同樣不寫入', async () => {
    const user = userEvent.setup()
    mount({ fee_rate: 0.0005415 }, R38)
    await user.click(screen.getByRole('button', { name: '改' }))
    await user.selectOptions(screen.getByLabelText('更早之前的費率'), '0.001425')
    await user.click(screen.getByRole('button', { name: '確定' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(setWorkspaceFeeRate).not.toHaveBeenCalled()
    expect(setWorkspaceFeeRateHistory).not.toHaveBeenCalled()
  })
})

// A negotiated discount is normally refunded monthly, and that is the only setting under which the
// dashboard agrees with the broker's own app (the app withholds the list price).
describe('WorkspaceFeeSettings 折扣怎麼退的預設值', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    localStorage.removeItem('stock-pnl-web/fee-rate-history/ws-1')
  })

  it('選了折扣就預設月退', async () => {
    const user = userEvent.setup()
    mount({}, '0.001425')
    expect((screen.getByRole('radio', { name: /現折/ }) as HTMLInputElement).checked).toBe(true)
    await user.selectOptions(screen.getByLabelText('手續費折扣'), '0.0005415')
    expect((screen.getByRole('radio', { name: /月退/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('改回不打折就回到現折', async () => {
    const user = userEvent.setup()
    mount({}, '0.0005415')
    expect((screen.getByRole('radio', { name: /月退/ }) as HTMLInputElement).checked).toBe(true)
    await user.selectOptions(screen.getByLabelText('手續費折扣'), '0.001425')
    expect((screen.getByRole('radio', { name: /現折/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('使用者自己選了現折，換折扣也不會被改回月退', async () => {
    const user = userEvent.setup()
    mount({}, '0.00092625')
    await user.click(screen.getByRole('radio', { name: /現折/ }))
    await user.selectOptions(screen.getByLabelText('手續費折扣'), '0.0005415')
    expect((screen.getByRole('radio', { name: /現折/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('以前存過、而且和預設不一樣的選擇會留著', () => {
    mount({ fee_rebate: 'instant' }, '0.0005415')
    expect((screen.getByRole('radio', { name: /現折/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('以前存的只是當時的預設值，不會把工作區鎖在現折', async () => {
    const user = userEvent.setup()
    mount({ fee_rebate: 'instant' }, '0.001425')
    await user.selectOptions(screen.getByLabelText('手續費折扣'), '0.0005415')
    expect((screen.getByRole('radio', { name: /月退/ }) as HTMLInputElement).checked).toBe(true)
  })
})

// BUG-090: the 當沖 tax estimate is broker behaviour, so it is a per-workspace choice. 玉山 halves
// the tax on a lot bought today (that is what BUG-087 measured); RON withheld the full 0.3% on a
// position opened the same morning. An absent column must keep the 玉山 behaviour, or every
// workspace already reconciled against it would move the day this column ships.
describe('WorkspaceFeeSettings 當沖稅率估算（BUG-090）', () => {
  it('沒設定過時預設沿用 BUG-087 的減半估算', () => {
    mount({}, '0.0004275')
    expect((screen.getByRole('radio', { name: /當天用當沖稅率/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('讀回已存的「一律用完整稅率」', () => {
    mount({ day_trade_tax_estimate: false }, '0.0004275')
    expect((screen.getByRole('radio', { name: /一律用完整稅率/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('沒改就不寫入（儲存一個沒動過的表單）', async () => {
    const user = userEvent.setup()
    mount({}, '0.0004275')
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(setWorkspaceDayTradeTaxEstimate).not.toHaveBeenCalled()
  })

  it('改成完整稅率後儲存才寫入', async () => {
    const user = userEvent.setup()
    mount({}, '0.0004275')
    await user.click(screen.getByRole('radio', { name: /一律用完整稅率/ }))
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(setWorkspaceDayTradeTaxEstimate).toHaveBeenCalledWith('ws-1', false)
  })
})
