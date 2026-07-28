/**
 * AI 分析與追問對話的暫存（`sessionStorage`）。
 *
 * ## 為什麼需要它
 *
 * `AiTab` 的分析結果原本純為 component state，而 `StockDetailPage` 是
 * `{tab === 'ai' && <AiTab/>}` 條件渲染 —— 切到「籌碼」再切回來，元件 unmount，
 * 結果就消失了，使用者得重按一次**並重新付費**。
 * 加了追問對話之後這件事更難忍：聊到一半去看個籌碼，整串對話就沒了。
 *
 * ## 為什麼是 sessionStorage 而不是 DB
 *
 * 對話內容會累積，存進 Supabase 就要新建資料表、RLS 與清理策略。
 * `sessionStorage` 的生命週期（關掉分頁就清）剛好符合「這是一次查看過程中的暫存」，
 * 不留長期資料、不佔額度、零 migration。
 *
 * ## 為什麼每個操作都吞錯
 *
 * `sessionStorage` 可能被瀏覽器停用（無痕的某些設定、隱私模式）或寫爆容量。
 * 那時應該降級成「這一輪還能用，只是切分頁會消失」，而不是讓整個 AI 分頁掛掉。
 * 沿用 `twMarketData.ts` 對 localStorage 的處理方式。
 */
import type { AiMessage } from './aiClient'

/** 暫存結構版本。改了形狀就升版，舊的直接丟掉（暫存資料沒有相容包袱） */
export const CHAT_STORE_SCHEMA = 1

export interface StoredChat {
  schema: number
  ticker: string
  /** 初次分析全文 */
  analysis: string
  /** 追問對話，由舊到新。不含初次分析那一輪 */
  messages: AiMessage[]
  savedAt: string
}

export function chatKey(ticker: string): string {
  return `ai-chat:${ticker}`
}

function safeSession(): Storage | null {
  try {
    // 存取 sessionStorage 本身就可能拋（某些隱私設定），故連取用都要包起來
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** 讀某檔的暫存；沒有 / 壞掉 / 版本不符一律回 null（暫存壞了就當作沒有） */
export function loadChat(ticker: string): StoredChat | null {
  const store = safeSession()
  if (!store) return null
  try {
    const raw = store.getItem(chatKey(ticker))
    if (!raw) return null
    const d = JSON.parse(raw) as StoredChat
    if (d?.schema !== CHAT_STORE_SCHEMA) return null
    if (typeof d.analysis !== 'string' || !Array.isArray(d.messages)) return null
    // 逐則檢查：壞掉的訊息會讓對話角色錯位，寧可整份丟掉重來
    const messages = d.messages.filter(
      (m): m is AiMessage =>
        !!m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string',
    )
    return { ...d, messages }
  } catch {
    return null
  }
}

/** 寫入暫存；失敗就算了（降級為記憶體模式，這一輪仍可用） */
export function saveChat(ticker: string, analysis: string, messages: AiMessage[]): void {
  const store = safeSession()
  if (!store) return
  try {
    const payload: StoredChat = {
      schema: CHAT_STORE_SCHEMA,
      ticker,
      analysis,
      messages,
      savedAt: new Date().toISOString(),
    }
    store.setItem(chatKey(ticker), JSON.stringify(payload))
  } catch {
    // 容量爆掉或被停用：不影響當下的使用，只是切分頁後會消失
  }
}

/** 清掉某檔的暫存（重新產生分析時呼叫——新分析不該接著舊對話） */
export function clearChat(ticker: string): void {
  const store = safeSession()
  if (!store) return
  try {
    store.removeItem(chatKey(ticker))
  } catch {
    // 同上
  }
}
