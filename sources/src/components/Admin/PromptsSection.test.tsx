// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { loadAiPrompts, saveAiPrompts } = vi.hoisted(() => ({
  loadAiPrompts: vi.fn(),
  saveAiPrompts: vi.fn(),
}))
vi.mock('../../services/aiPrompts', async (importOriginal) => {
  // 預設值與 resolvePrompt 用真的，只換掉會打網路的兩支
  const actual = await importOriginal<typeof import('../../services/aiPrompts')>()
  return { ...actual, loadAiPrompts, saveAiPrompts }
})

import { PromptsSection } from './PromptsSection'
import { ANALYSIS_DEFAULT } from '../../services/aiPrompts'

describe('PromptsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadAiPrompts.mockResolvedValue({ analysis: '', chat: '' })
    saveAiPrompts.mockResolvedValue({ error: null })
  })
  afterEach(cleanup)

  it('沒有自訂時，文字框顯示實際生效的預設內容（不是空白）', async () => {
    render(<PromptsSection />)
    const box = (await screen.findByLabelText(/個股分析準則/)) as HTMLTextAreaElement
    expect(box.value).toBe(ANALYSIS_DEFAULT)
  })

  it('鎖定段落照實印出來，管理員才知道自己改不到什麼', async () => {
    render(<PromptsSection />)
    await screen.findByLabelText(/個股分析準則/)
    expect(screen.getByText(/以下由系統固定接在後面，改不了/)).toBeTruthy()
    expect(screen.getByText(/不構成任何投資建議或買賣推薦/)).toBeTruthy()
  })

  it('沒有改動時「儲存變更」是停用的', async () => {
    render(<PromptsSection />)
    await screen.findByLabelText(/個股分析準則/)
    expect(screen.getByRole('button', { name: '儲存變更' }).hasAttribute('disabled')).toBe(true)
  })

  it('改動後可儲存，兩種提示詞一起送出', async () => {
    render(<PromptsSection />)
    const box = await screen.findByLabelText(/個股分析準則/)
    fireEvent.change(box, { target: { value: '只講重點就好。' } })

    const save = screen.getByRole('button', { name: '儲存變更' })
    expect(save.hasAttribute('disabled')).toBe(false)
    fireEvent.click(save)

    await waitFor(() =>
      expect(saveAiPrompts).toHaveBeenCalledWith(
        expect.objectContaining({ analysis: '只講重點就好。' }),
      ),
    )
    expect(await screen.findByText(/提示詞已儲存/)).toBeTruthy()
  })

  it('改動過的那一種掛「已改動」徽章', async () => {
    render(<PromptsSection />)
    const box = await screen.findByLabelText(/個股分析準則/)
    expect(screen.queryByText('已改動')).toBeNull()
    fireEvent.change(box, { target: { value: '改過了' } })
    expect(screen.getByText('已改動')).toBeTruthy()
  })

  it('「還原成預設」只填回文字框，不直接寫資料庫', async () => {
    render(<PromptsSection />)
    const box = (await screen.findByLabelText(/個股分析準則/)) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '改過了' } })
    fireEvent.click(screen.getByRole('button', { name: '還原成預設' }))

    expect(box.value).toBe(ANALYSIS_DEFAULT)
    expect(saveAiPrompts).not.toHaveBeenCalled()
  })

  it('可切換到追問對話，載入它自己的內容', async () => {
    loadAiPrompts.mockResolvedValue({ analysis: '', chat: '追問時請簡短。' })
    render(<PromptsSection />)
    await screen.findByLabelText(/個股分析準則/)
    fireEvent.click(screen.getByRole('button', { name: /追問對話/ }))

    const box = (await screen.findByLabelText(/追問對話準則/)) as HTMLTextAreaElement
    expect(box.value).toBe('追問時請簡短。')
    // 追問的鎖定段落是框限那一段
    expect(screen.getByText(/使用者無權變更本段規則/)).toBeTruthy()
  })
})
