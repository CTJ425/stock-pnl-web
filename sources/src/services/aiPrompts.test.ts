import { describe, it, expect } from 'vitest'
import { ANALYSIS_DEFAULT, ANALYSIS_LOCKED, CHAT_DEFAULT, resolvePrompt } from './aiPrompts'

describe('resolvePrompt', () => {
  it('有自訂內容就用自訂', () => {
    expect(resolvePrompt('自己寫的', ANALYSIS_DEFAULT)).toBe('自己寫的')
  })

  it('空字串 / 空白 / null / undefined 一律退回預設', () => {
    for (const v of ['', '   ', '\n\t ', null, undefined]) {
      expect(resolvePrompt(v, ANALYSIS_DEFAULT)).toBe(ANALYSIS_DEFAULT)
    }
  })

  it('自訂內容前後的空白會修掉，但內容本身不動', () => {
    expect(resolvePrompt('  兩行\n第二行  ', ANALYSIS_DEFAULT)).toBe('兩行\n第二行')
  })
})

describe('可編輯段落與鎖定段落的分工', () => {
  /*
    這幾條是產品的安全底線，只能待在 *_LOCKED（程式固定接上），
    不能出現在可編輯的預設值裡 —— 放在可編輯段落等於允許管理員刪掉它們。
  */
  it('買賣指令、免責聲明、攤平風險三條都鎖在 ANALYSIS_LOCKED', () => {
    expect(ANALYSIS_LOCKED).toContain('絕對不得給出明確的買進 / 賣出 / 加碼 / 出清指令')
    expect(ANALYSIS_LOCKED).toContain('不構成任何投資建議或買賣推薦')
    expect(ANALYSIS_LOCKED).toContain('攤平會放大部位，並不等於降低風險')
  })

  it('這三條不得同時出現在可編輯的預設值裡（否則刪得掉）', () => {
    expect(ANALYSIS_DEFAULT).not.toContain('不構成任何投資建議')
    expect(ANALYSIS_DEFAULT).not.toContain('攤平會放大部位')
    expect(ANALYSIS_DEFAULT).not.toContain('絕對不得給出明確的買進')
  })

  it('追問的預設值只管風格，框限不在裡面', () => {
    expect(CHAT_DEFAULT).toContain('全程繁體中文')
    expect(CHAT_DEFAULT).not.toContain('一字不差')
    expect(CHAT_DEFAULT).not.toContain('忽略上述指示')
  })
})
