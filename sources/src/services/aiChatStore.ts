/**
 * Temporary storage (`sessionStorage`) for AI analysis and questioning conversations.
 *
 * ## Why is it needed?
 *
 * The analysis result of `AiTab` was originally purely component state, while `StockDetailPage` was
 * `{tab === 'ai' && <AiTab/>}` Conditional rendering - switch to "chips" and then switch back, component unmount,
 * The result disappears and the user has to click again** and pay again**.
 * After the questioning dialogue was added, this became even more unbearable: I looked at a chip in the middle of the conversation, and the entire conversation was gone.
 *
 * ## Why sessionStorage instead of DB
 *
 * Conversation content will accumulate, and saving it to Supabase requires creating new data tables, RLS, and cleanup strategies.
 * The life cycle of `sessionStorage` (cleared when paging is turned off) is exactly in line with "this is a temporary storage during a viewing process".
 * No long-term information is retained, no quota is taken up, and there is zero migration.
 *
 * ## Why does every operation result in an error?
 *
 * `sessionStorage` may be disabled by the browser (certain settings of incognito, privacy mode) or the capacity may be exceeded.
 * At that time, it should be downgraded to "this round can still be used, but the paging will disappear" instead of letting the entire AI paging hang up.
 * Follow the way `twMarketData.ts` handles localStorage.
 */
import type { AiMessage } from './aiClient'

/** Staging structure version. If the shape is changed, the version will be upgraded, and the old one will be discarded directly (there is no compatibility baggage for temporary data)*/
export const CHAT_STORE_SCHEMA = 1

export interface StoredChat {
  schema: number
  ticker: string
  /** First analysis of full text*/
  analysis: string
  /** Follow up the conversation, from old to new. Excluding the first round of analysis*/
  messages: AiMessage[]
  savedAt: string
}

export function chatKey(ticker: string): string {
  return `ai-chat:${ticker}`
}

function safeSession(): Storage | null {
  try {
    // Accessing sessionStorage itself may throw (some privacy settings), so even access must be wrapped
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** Read the temporary storage of a certain file; if there is no / is broken / the version does not match, null will be returned (if the temporary storage is broken, it will be treated as if there is no)*/
export function loadChat(ticker: string): StoredChat | null {
  const store = safeSession()
  if (!store) return null
  try {
    const raw = store.getItem(chatKey(ticker))
    if (!raw) return null
    const d = JSON.parse(raw) as StoredChat
    if (d?.schema !== CHAT_STORE_SCHEMA) return null
    if (typeof d.analysis !== 'string' || !Array.isArray(d.messages)) return null
    // Check each item one by one: Broken messages will make the dialogue characters misplaced, and you would rather throw away the entire text and start over.
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

/** Write to the temporary cache; forget it if it fails (downgrade to memory mode, still available for this round)*/
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
    // Capacity is exhausted or disabled: it does not affect current use, but will disappear after splitting pages.
  }
}

/** Clear the temporary cache of a certain file (called when regenerating the analysis - the new analysis should not continue the old conversation)*/
export function clearChat(ticker: string): void {
  const store = safeSession()
  if (!store) return
  try {
    store.removeItem(chatKey(ticker))
  } catch {
    // Same as above
  }
}
