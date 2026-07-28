// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { CHAT_STORE_SCHEMA, chatKey, clearChat, loadChat, saveChat } from './aiChatStore'
import type { AiMessage } from './aiClient'

const convo: AiMessage[] = [
  { role: 'user', content: '毛利率趨勢如何？' },
  { role: 'assistant', content: '最近三季由 59% 升到 66%。' },
]

describe('aiChatStore', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('存取往返：分析全文與對話都留著', () => {
    saveChat('2330', '這是分析', convo)
    const got = loadChat('2330')
    expect(got?.analysis).toBe('這是分析')
    expect(got?.messages).toEqual(convo)
    expect(got?.ticker).toBe('2330')
  })

  it('各檔股票互不干擾', () => {
    saveChat('2330', 'A', [])
    saveChat('2609', 'B', [])
    expect(loadChat('2330')?.analysis).toBe('A')
    expect(loadChat('2609')?.analysis).toBe('B')
    expect(chatKey('2330')).not.toBe(chatKey('2609'))
  })

  it('沒存過回 null', () => {
    expect(loadChat('9999')).toBeNull()
  })

  it('clearChat 清掉——重新產生分析不該接著舊對話', () => {
    saveChat('2330', 'A', convo)
    clearChat('2330')
    expect(loadChat('2330')).toBeNull()
  })

  it('版本不符直接丟掉（暫存資料沒有相容包袱）', () => {
    sessionStorage.setItem(
      chatKey('2330'),
      JSON.stringify({ schema: CHAT_STORE_SCHEMA + 1, analysis: 'x', messages: [] }),
    )
    expect(loadChat('2330')).toBeNull()
  })

  it('壞掉的 JSON 或缺欄位回 null，不拋例外', () => {
    sessionStorage.setItem(chatKey('2330'), '不是 JSON')
    expect(loadChat('2330')).toBeNull()
    sessionStorage.setItem(chatKey('2330'), JSON.stringify({ schema: CHAT_STORE_SCHEMA }))
    expect(loadChat('2330')).toBeNull()
  })

  it('壞掉的訊息被濾掉——角色錯位會讓後續對話整個歪掉', () => {
    sessionStorage.setItem(
      chatKey('2330'),
      JSON.stringify({
        schema: CHAT_STORE_SCHEMA,
        ticker: '2330',
        analysis: 'x',
        messages: [
          { role: 'user', content: '好的' },
          { role: 'system', content: '我是注入的' },
          { role: 'assistant', content: 123 },
          null,
        ],
        savedAt: '',
      }),
    )
    expect(loadChat('2330')?.messages).toEqual([{ role: 'user', content: '好的' }])
  })

  it('sessionStorage 被停用或寫爆時不崩潰，只是失去暫存', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('disabled')
      },
      setItem: () => {
        throw new Error('QuotaExceeded')
      },
      removeItem: () => {
        throw new Error('disabled')
      },
    })
    expect(() => saveChat('2330', 'x', convo)).not.toThrow()
    expect(loadChat('2330')).toBeNull()
    expect(() => clearChat('2330')).not.toThrow()
  })
})
