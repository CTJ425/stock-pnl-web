// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceFeeSettings } from './WorkspaceFeeSettings'

const { useWorkspace, setWorkspaceFeeRate, setWorkspaceFeeRebate, setWorkspaceFeeRounding } = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
  setWorkspaceFeeRate: vi.fn(async () => {}),
  setWorkspaceFeeRebate: vi.fn(async () => {}),
  setWorkspaceFeeRounding: vi.fn(async () => {}),
}))
vi.mock('../context/WorkspaceContext', () => ({ useWorkspace }))

function mount(current: Record<string, unknown>, rate: string | null) {
  if (rate === null) localStorage.removeItem('stock-pnl-web/fee-rate/ws-1')
  else localStorage.setItem('stock-pnl-web/fee-rate/ws-1', rate)
  useWorkspace.mockReturnValue({
    current: { id: 'ws-1', name: '玉山證券', ...current },
    setWorkspaceFeeRate,
    setWorkspaceFeeRebate,
    setWorkspaceFeeRounding,
  })
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<WorkspaceFeeSettings onClose={onClose} onSaved={onSaved} />)
  return { onClose, onSaved }
}

describe('WorkspaceFeeSettings', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('starts from the stored discount and rebate, and previews the derived basis', () => {
    mount({ fee_rebate: 'monthly' }, '0.000399')
    expect((screen.getByLabelText('手續費折扣') as HTMLSelectElement).value).toBe('0.000399')
    expect((screen.getByRole('radio', { name: /月退/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/牌告 0.1425% 預扣/)).toBeTruthy()
  })

  it('switching to 現折 previews the discounted rate and saves only the rebate', async () => {
    const user = userEvent.setup()
    const { onClose, onSaved } = mount({ fee_rebate: 'monthly' }, '0.000399')
    await user.click(screen.getByRole('radio', { name: /現折/ }))
    expect(screen.getByText(/折扣後 0.0399% 預扣/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(setWorkspaceFeeRate).not.toHaveBeenCalled()
    expect(setWorkspaceFeeRebate).toHaveBeenCalledWith('ws-1', 'instant')
    expect(onSaved).toHaveBeenCalledWith({ rateChanged: false })
    expect(onClose).toHaveBeenCalled()
  })

  it('a new rate is saved and reported so the caller can offer a recalculation', async () => {
    const user = userEvent.setup()
    const { onSaved } = mount({}, null)
    await user.selectOptions(screen.getByLabelText('手續費折扣'), '0.000285')
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(setWorkspaceFeeRate).toHaveBeenCalledWith('ws-1', 0.000285)
    expect(setWorkspaceFeeRebate).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith({ rateChanged: true })
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

  it('saving an unchanged form does not write the flooring', async () => {
    const user = userEvent.setup()
    mount({}, null)
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(setWorkspaceFeeRounding).not.toHaveBeenCalled()
  })
})
