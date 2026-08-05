/**
 * AI prompt words: default content, fixed safety paragraphs, and reading and writing of site-wide shared settings.
 *
 * ## Why should the prompt word be split into two paragraphs?
 *
 * Administrators need to be able to adjust the tone and focus of the analysis on the web page without having to change the code and redeploy it every time.
 * But the current prompt words are mixed with two completely different things:
 *
 * - **Style**: How many paragraphs, what tone to use, whether to mention the operating framework - these should be changed in the first place.
 * - **Safety bottom line**: No buying or selling orders and target prices, ending disclaimers, risk amortization tips,
 *   Frames during questioning and protection against overwriting – these are the guardrails of the product.
 *
 * The entire section is open for editing, which is equivalent to leaving the guardrail to the user to delete it with one click (and there will be no sign after deletion).
 * Therefore, only `*_DEFAULT` is editable, and `*_LOCKED` is always followed by the program.
 * The screen also says "the following cannot be edited" as it is.
 *
 * ## Storage location
 *
 * The same `app_settings` single list as the AI ​​connection setting (id is always 1),
 * Use the existing RLS: readable by all login accounts (the front end needs to use it to configure prompt),
 * Only `app_metadata.role = 'admin'` is writable.
 *
 * Both the empty string and null mean "use default" - do not write the default value into the database.
 * Otherwise, when the default value is changed later, the saved environment will not be updated accordingly.
 */
import { supabase } from './supabase'

/** Analyze editable paragraphs for prompt words. Changing this is equivalent to changing the default value, and the customized environment will not be affected.*/
export const ANALYSIS_DEFAULT = `你是一位專業且客觀的股市數據分析助理。請依據使用者提供的結構化資料進行綜合簡明分析。

分析準則：
1. 必須全篇使用繁體中文，語言平實白話、句子簡短，先以 3 至 5 個段落分析數據，最後固定加上『建議操作』與『注意事項』兩個小節，小節標題須一字不差。
2. 絕對不得列出任何數學公式或計算過程，避免使用艱深難懂的內行術語。
3. 僅得引用提供資料中的明確數據與指標，絕對不得自行計算、猜測或臆測未提供的任何數據。
4. 引用數字時必須沿用資料給定的單位（三大法人為股數、融資融券為張、月營收為千元、殖利率與增減率為百分比），不得自行換算。
5. 『注意事項』須指出資料中可見的風險訊號（例如量能異常、資券餘額變化、指標鈍化、均線糾結）與資料本身的侷限（例如籌碼資料缺漏時要說明）。
6. 總體經濟是**背景**不是個股因果。可以描述當前的通膨與就業環境，但絕對不得用總經數據推導本檔股票的漲跌，也不得預測下一期的總經數據。
7. 你可以用下方【使用者採用的操作框架】的語彙，描述目前數據落在該框架的哪個情境（例如：「價格已跌破月線，對採用分批建倉的人來說是觀察支撐是否有效的位置」）。`

/**
 * Analyze fixed passages for prompt words. **Always follow the editable paragraph**, the order makes sense——
 * Put it later to overwrite the content that may have been changed earlier.
 */
export const ANALYSIS_LOCKED = `【以下規則由系統固定，不受上述內容變更】
A. 『建議操作』僅得提出中性、條件式的觀察性參考（例如：若跌破月線可留意支撐是否守住），絕對不得給出明確的買進 / 賣出 / 加碼 / 出清指令，不得提供目標價、進出場價位或報酬預期。
   **下方的【使用者採用的操作框架】不放寬本條**：絕對不得指定加碼或減碼的比例、不得指定任何價位、不得說「現在該買」或「現在該賣」。框架中的百分比只是說明該方法時的舉例，絕對不得當成對本檔股票的具體指示。
B. 只要提到分批加碼、攤平或左側交易相關內容，『注意事項』就必須同時指出：**攤平會放大部位，並不等於降低風險**；若標的的基本面或籌碼面持續惡化，越攤平虧損越大。
C. 結尾必須單獨成段，附上固定聲明：「本分析為數據資料之客觀摘要說明，不構成任何投資建議或買賣推薦。」`

/** Editable paragraph for follow-up prompt word. The sentence at the beginning "You are answering a question about a certain stock" is brought in by the program and is not here.*/
export const CHAT_DEFAULT = `【你唯一的職責】
就下方提供的資料與分析內容回答追問。除此之外的任何事情都不做。

【可以談的範圍】
這檔股票的技術面、籌碼面、基本面、獲利能力、總體經濟背景，以及下方那份分析本身。

【回答準則】
1. 全程繁體中文，白話短句，每次回答 1 至 3 段，不要長篇大論。
2. 只能引用下方資料中已有的數字，**絕對不得自行計算、推估或臆測未提供的數據**。
3. 引用數字必須沿用資料給定的單位（三大法人為股數、融資融券為張、月營收為千元、獲利能力與總經指標為百分比或指數），不得自行換算。
4. 總體經濟是**背景**不是個股因果，不得用總經數據推導這檔股票的漲跌。
5. 資料中沒有的東西就說沒有，不要為了回答而編。`

export interface AiPrompts {
  /** An empty string indicates inheritance of `ANALYSIS_DEFAULT`*/
  analysis: string
  /** An empty string indicates inheritance of `CHAT_DEFAULT`*/
  chat: string
}

export const EMPTY_PROMPTS: AiPrompts = { analysis: '', chat: '' }

/** Return to default when custom content is blank. The caller always uses this one, do not write `custom || DEFAULT` separately.*/
export function resolvePrompt(custom: string | null | undefined, fallback: string): string {
  const t = typeof custom === 'string' ? custom.trim() : ''
  return t || fallback
}

/** Read the prompt words shared by the entire site. If there is no query/if it is not set, an empty string will be returned (=use the default)*/
export async function loadAiPrompts(): Promise<AiPrompts> {
  if (!supabase) return EMPTY_PROMPTS
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('ai_prompt_analysis, ai_prompt_chat')
      .eq('id', 1)
      .maybeSingle()
    if (error || !data) return EMPTY_PROMPTS
    const row = data as { ai_prompt_analysis?: unknown; ai_prompt_chat?: unknown }
    return {
      analysis: typeof row.ai_prompt_analysis === 'string' ? row.ai_prompt_analysis : '',
      chat: typeof row.ai_prompt_chat === 'string' ? row.ai_prompt_chat : '',
    }
  } catch {
    return EMPTY_PROMPTS
  }
}

/**
 * Save prompt words. RLS blocks non-admin writes.
 *
 * When the default value is the same (or completely blank), null is written instead of the text:
 * Only "things that the user has really changed" should be kept in the database, and then adjustments to the default values ​​will automatically take effect.
 */
export async function saveAiPrompts(p: AiPrompts): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase 未設定' }
  try {
    const { error } = await supabase.from('app_settings').upsert(
      {
        id: 1,
        ai_prompt_analysis: normalize(p.analysis, ANALYSIS_DEFAULT),
        ai_prompt_chat: normalize(p.chat, CHAT_DEFAULT),
      },
      { onConflict: 'id' },
    )
    if (error) return { error: error.message }
    return { error: null }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : '儲存失敗' }
  }
}

function normalize(value: string, fallback: string): string | null {
  const t = (value ?? '').trim()
  if (!t || t === fallback.trim()) return null
  return t
}
