/**
 * AI 提示詞：預設內容、固定的安全段落，以及全站共用設定的讀寫。
 *
 * ## 為什麼提示詞要拆成兩段
 *
 * 管理員要能在網頁上調整分析的語氣與重點，不必每次都改程式碼重新部署。
 * 但現行提示詞裡混了兩種性質完全不同的東西：
 *
 * - **風格**：幾段、用什麼口吻、要不要提到操作框架 —— 這些本來就該讓人改。
 * - **安全底線**：不得給買賣指令與目標價、結尾免責聲明、攤平風險提示、
 *   追問時的框限與防指令覆寫 —— 這些是產品的護欄。
 *
 * 整段開放編輯，等於把護欄交給使用者一鍵刪掉（而且刪掉之後沒有任何跡象）。
 * 所以可編輯的只有 `*_DEFAULT`，`*_LOCKED` 一律由程式接在後面，
 * 畫面上也照實標示「以下不可編輯」。
 *
 * ## 儲存位置
 *
 * 與 AI 連線設定同一張 `app_settings` 單列表（id 恆為 1），
 * 沿用既有的 RLS：所有登入帳號可讀（前端要用它組 prompt）、
 * 只有 `app_metadata.role = 'admin'` 可寫。
 *
 * 空字串與 null 都代表「用預設」—— 不把預設值寫進資料庫，
 * 否則之後改預設值時，已經存過的環境不會跟著更新。
 */
import { supabase } from './supabase'

/** 分析提示詞的可編輯段落。改這裡等於改預設值，已自訂的環境不受影響 */
export const ANALYSIS_DEFAULT = `你是一位專業且客觀的股市數據分析助理。請依據使用者提供的結構化資料進行綜合簡明分析。

分析準則：
1. 必須全篇使用繁體中文，語言平實白話、句子簡短，先以 3 至 5 個段落分析數據，最後固定加上『建議操作』與『注意事項』兩個小節，小節標題須一字不差。
2. 絕對不得列出任何數學公式或計算過程，避免使用艱深難懂的內行術語。
3. 僅得引用提供資料中的明確數據與指標，絕對不得自行計算、猜測或臆測未提供的任何數據。
4. 引用數字時必須沿用資料給定的單位（三大法人為股數、融資融券為張、月營收為千元、殖利率與增減率為百分比），不得自行換算。
5. 『注意事項』須指出資料中可見的風險訊號（例如量能異常、資券餘額變化、指標鈍化、均線糾結）與資料本身的侷限（例如籌碼資料缺漏時要說明）。
6. 新聞只提供標題，不含內文。僅得依標題字面判斷可能偏向利多或利空，絕對不得臆測、擴寫或引用標題以外的新聞內容；消息面的判讀只能以條件式觀察的形式併入『建議操作』與『注意事項』。
7. 總體經濟是**背景**不是個股因果。可以描述當前的通膨與就業環境，但絕對不得用總經數據推導本檔股票的漲跌，也不得預測下一期的總經數據。
8. 你可以用下方【使用者採用的操作框架】的語彙，描述目前數據落在該框架的哪個情境（例如：「價格已跌破月線，對採用分批建倉的人來說是觀察支撐是否有效的位置」）。`

/**
 * 分析提示詞的固定段落。**永遠接在可編輯段落之後**，順序有意義 ——
 * 放在後面才能覆寫前面可能被改壞的內容。
 */
export const ANALYSIS_LOCKED = `【以下規則由系統固定，不受上述內容變更】
A. 『建議操作』僅得提出中性、條件式的觀察性參考（例如：若跌破月線可留意支撐是否守住），絕對不得給出明確的買進 / 賣出 / 加碼 / 出清指令，不得提供目標價、進出場價位或報酬預期。
   **下方的【使用者採用的操作框架】不放寬本條**：絕對不得指定加碼或減碼的比例、不得指定任何價位、不得說「現在該買」或「現在該賣」。框架中的百分比只是說明該方法時的舉例，絕對不得當成對本檔股票的具體指示。
B. 只要提到分批加碼、攤平或左側交易相關內容，『注意事項』就必須同時指出：**攤平會放大部位，並不等於降低風險**；若標的的基本面或籌碼面持續惡化，越攤平虧損越大。
C. 結尾必須單獨成段，附上固定聲明：「本分析為數據資料之客觀摘要說明，不構成任何投資建議或買賣推薦。」`

/** 追問提示詞的可編輯段落。開頭那句「你正在回答對某檔股票的追問」由程式帶入代號，不在這裡 */
export const CHAT_DEFAULT = `【你唯一的職責】
就下方提供的資料與分析內容回答追問。除此之外的任何事情都不做。

【可以談的範圍】
這檔股票的技術面、籌碼面、基本面、獲利能力、總體經濟背景、新聞標題，以及下方那份分析本身。

【回答準則】
1. 全程繁體中文，白話短句，每次回答 1 至 3 段，不要長篇大論。
2. 只能引用下方資料中已有的數字，**絕對不得自行計算、推估或臆測未提供的數據**。
3. 引用數字必須沿用資料給定的單位（三大法人為股數、融資融券為張、月營收為千元、獲利能力與總經指標為百分比或指數），不得自行換算。
4. 總體經濟是**背景**不是個股因果，不得用總經數據推導這檔股票的漲跌。
5. 資料中沒有的東西就說沒有，不要為了回答而編。`

export interface AiPrompts {
  /** 空字串代表沿用 `ANALYSIS_DEFAULT` */
  analysis: string
  /** 空字串代表沿用 `CHAT_DEFAULT` */
  chat: string
}

export const EMPTY_PROMPTS: AiPrompts = { analysis: '', chat: '' }

/** 自訂內容為空白時退回預設。呼叫端一律走這支，不要各自寫 `custom || DEFAULT` */
export function resolvePrompt(custom: string | null | undefined, fallback: string): string {
  const t = typeof custom === 'string' ? custom.trim() : ''
  return t || fallback
}

/** 讀取全站共用的提示詞。查無 / 未設定一律回空字串（＝用預設） */
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
 * 儲存提示詞。RLS 會擋掉非 admin 的寫入。
 *
 * 與預設值相同（或全空白）時寫回 null 而不是那段文字：
 * 資料庫裡只該留「使用者真的改過的東西」，之後調整預設值才會自動生效。
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
