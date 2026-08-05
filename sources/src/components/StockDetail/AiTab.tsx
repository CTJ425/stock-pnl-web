/**
 * Individual stock analysis "AI Analysis" page.
 * Carry out daily series loading and technical calculation independently without mentioning the status to the parent component or modifying the TechnicalTab.
 * There will be no automatic retry, and no AI-generated text should appear on the screen when not set.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, MessageSquare, RefreshCw, ShieldCheck } from 'lucide-react'
import { fetchDailySeries } from '../../services/dailyProxy'
import type { FundamentalData } from '../../services/fundamentalProxy'
import { fetchMacro } from '../../services/macroProxy'
import type { ReportData } from '../../services/reportProxy'
import {
  AiError,
  AI_TIMEOUT_MS,
  createAiProvider,
  type AiMessage,
} from '../../services/aiClient'
import { clearChat, loadChat, saveChat } from '../../services/aiChatStore'
import { isAiAdmin, loadAiSettings, type AiSettings } from '../../services/aiSettings'
import { EMPTY_PROMPTS, loadAiPrompts, type AiPrompts } from '../../services/aiPrompts'
import { buildAiPayload, renderAiPrompt, type AiPayload } from './aiPayload'
import {
  MAX_CHAT_TURNS,
  MAX_INPUT_CHARS,
  buildChatMessages,
  buildChatSystem,
  canAsk,
  turnsUsed,
} from './aiChat'
import { buildTechnicalView, type RangeKey } from './technicalView'

interface AiTabProps {
  ticker: string
  name: string
  report: ReportData | null
  /** Loaded and distributed by StockDetailPage (title badge / fundamental paging / share the same copy here)*/
  fundamental: FundamentalData | null
}

const AI_TIMEOUT_SECONDS = Math.round(AI_TIMEOUT_MS / 1000)

export function AiTab({ ticker, name, report, fundamental }: AiTabProps) {
  // Set status
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  // The settings are maintained in the management background (0.6.19). This is only used to determine which sentence should be shown to whom when "not set".
  const [isAdmin, setIsAdmin] = useState(false)
  // The prompt word changed by the administrator in the background. If it cannot be obtained, it will be an empty string, and `resolvePrompt` will return to the default
  const [prompts, setPrompts] = useState<AiPrompts>(EMPTY_PROMPTS)

  // Execution and result status
  const [status, setStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle')
  const [aiText, setAiText] = useState('')
  const [errMsg, setErrMsg] = useState('')

  // Follow-up dialogue (0.6.5). The payload is retained because complete information and frame limits must be re-sent in each round.
  // Don't just rely on the first round - see instructions for aiChat.ts.
  const [payload, setPayload] = useState<AiPayload | null>(null)
  const [chat, setChat] = useState<AiMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatErr, setChatErr] = useState('')

  // Restore the last analysis and conversation from sessionStorage.
  // This also fixes the pain point of "the AI ​​result of splitting pages disappears and you have to press it again (re-billing)".
  useEffect(() => {
    const saved = loadChat(ticker)
    if (saved) {
      setAiText(saved.analysis)
      setChat(saved.messages)
      setStatus('success')
    } else {
      setAiText('')
      setChat([])
      setStatus('idle')
    }
    setPayload(null)
    setChatInput('')
    setChatErr('')
  }, [ticker])

  // First time loading settings
  useEffect(() => {
    let alive = true
    setSettingsLoading(true)
    ;(async () => {
      const [s, admin, ps] = await Promise.all([loadAiSettings(), isAiAdmin(), loadAiPrompts()])
      if (alive) {
        setSettings(s)
        setIsAdmin(admin)
        setPrompts(ps)
        setSettingsLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  async function handleGenerate() {
    if (!settings) return
    setStatus('generating')
    setErrMsg('')
    try {
      // Load the daily line yourself and calculate the technical level
      const daily = await fetchDailySeries(ticker)
      if (!daily || !daily.rows) {
        throw new AiError('bad-response', '無法讀取該個股之日線資料')
      }
      // Indicators are always calculated based on the complete sequence (last year), and the range label must be passed along so that the model knows which range the extreme value of the range is.
      const range: RangeKey = '1y'
      const view = buildTechnicalView(daily.rows, range)
      if (!view) {
        throw new AiError('bad-response', '無法計算個股之技術面指標 (歷史股價資料不存在或為空)')
      }
      // General background. 0.6.5-dev.2 Catch it yourself - it is no longer in the page of individual stock analysis, and the parent component has no reason to load it for it.
      // Same as daily: press "generate analysis" to grab, not for something you may never read
      // It is downloaded every time you open the individual stock page. Does not block when there is lack of material (buildMacroBlock returns hasData: false).
      const macro = await fetchMacro()
      const built = buildAiPayload({ ticker, name, view, report, range, fundamental, macro })
      const { system, user } = renderAiPrompt(built, prompts.analysis)

      const provider = createAiProvider(settings)
      const result = await provider.complete({
        system,
        messages: [{ role: 'user', content: user }],
      })

      // Regenerate analysis = start a new conversation. The old questioning is asked against the old analysis, and then it becomes inconsistent.
      setPayload(built)
      setAiText(result)
      setChat([])
      setChatErr('')
      setChatInput('')
      clearChat(ticker)
      saveChat(ticker, result, [])
      setStatus('success')
    } catch (e: unknown) {
      if (e instanceof AiError) {
        setErrMsg(e.message)
      } else if (e instanceof Error) {
        setErrMsg(e.message)
      } else {
        setErrMsg('產生 AI 分析時發生未知錯誤')
      }
      setStatus('error')
    }
  }

  /**
   * Send a follow-up question.
   *
   * `payload` only has a value if "this session has been clicked to generate analysis"; from sessionStorage
   * It is null when restored back because the payload is not saved together (it is large and can be reconstructed).
   * At that time, the user is required to re-generate an analysis - without the payload, there is no data on which to base the frame.
   * Hard feeding is equivalent to letting the model answer out of thin air without data.
   */
  async function handleAsk() {
    if (!settings || !payload) return
    const next = buildChatMessages(chat, chatInput)
    if (next.length === chat.length) return // 空白輸入

    setChat(next)
    setChatInput('')
    setChatBusy(true)
    setChatErr('')
    try {
      const provider = createAiProvider(settings)
      // system resends every round, and the frame limit will not be diluted as the conversation becomes longer (see aiChat.ts)
      const reply = await provider.complete({
        system: buildChatSystem(payload, aiText, prompts.chat),
        messages: next,
      })
      const withReply: AiMessage[] = [...next, { role: 'assistant', content: reply }]
      setChat(withReply)
      saveChat(ticker, aiText, withReply)
    } catch (e: unknown) {
      // When it fails, leave the sentence you just sent on the screen so that the user can know which sentence failed to be sent successfully.
      setChatErr(e instanceof Error ? e.message : '追問時發生未知錯誤')
    } finally {
      setChatBusy(false)
    }
  }

  if (settingsLoading) {
    return (
      <div className="empty-state" style={{ padding: 32 }}>
        <RefreshCw size={28} className="spin" />
        <div style={{ marginTop: 10 }}>正在載入 AI 設定…</div>
      </div>
    )
  }

  return (
    <div className="ai-container">
      {/* 頂端操作列與設定摺疊區 */}
      <div className="ai-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bot size={18} />
              AI 個股綜合分析
            </h3>
            <span className="hint" style={{ fontSize: 12 }}>
              {settings
                ? `使用 ${settings.provider === 'google' ? 'Google AI' : 'OpenAI 相容端點'} (${settings.model})`
                : '未設定 AI 服務供應商'}
              {!isAdmin && '｜全站共用，僅管理員可修改'}
            </span>
          </div>

          <div className="ai-actions">
            {settings && (
              <button
                className="btn btn-primary"
                onClick={() => void handleGenerate()}
                disabled={status === 'generating'}
              >
                {status === 'generating' ? (
                  <>
                    <RefreshCw size={14} className="spin" />
                    分析中…（最長 {AI_TIMEOUT_SECONDS} 秒）
                  </>
                ) : (
                  <>
                    <Bot size={14} />
                    {status === 'success' || status === 'error' ? '重新產生分析' : '產生分析'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 未設定時的引導提示 (不出現任何 AI 文字) */}
      {!settings && (
        <div className="ai-card" style={{ textAlign: 'center', padding: 32 }}>
          <Bot size={36} style={{ opacity: 0.5, marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>尚未設定 AI 服務供應商</div>
          {/*
            0.6.19 起設定表單移到管理後台，所以這裡只能指路、不能就地填。
            管理員與一般使用者看到的是同一個事實的兩種說法。
          */}
          <div className="hint" style={{ marginTop: 6 }}>
            {isAdmin ? (
              <>
                請從右上角帳號選單進入<b>管理後台 → AI 連線</b>，填入 Google API Key
                或本機 Ollama / OpenAI 相容端點。
              </>
            ) : (
              'AI 設定為全站共用，僅管理員帳號可修改，請聯絡管理員完成設定。'
            )}
          </div>
          {isAdmin && (
            <div className="hint" style={{ marginTop: 10, display: 'flex', justifyContent: 'center', gap: 6, alignItems: 'center' }}>
              <ShieldCheck size={14} />
              設定是全站共用的，改一次所有使用者都會套用。
            </div>
          )}
        </div>
      )}

      {/* 執行中提示 */}
      {status === 'generating' && (
        <div className="ai-card" style={{ textAlign: 'center', padding: 32 }}>
          <RefreshCw size={28} className="spin" style={{ marginBottom: 12, color: 'var(--primary)' }} />
          <div style={{ fontSize: 15, fontWeight: 500 }}>AI 正在解讀技術面與籌碼數據…</div>
          <div className="hint" style={{ marginTop: 6 }}>最長可能需要 {AI_TIMEOUT_SECONDS} 秒，請稍候。</div>
        </div>
      )}

      {/* 錯誤顯示區 + 手動重試 */}
      {status === 'error' && (
        <div className="ai-error">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600 }}>分析失敗</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{errMsg}</div>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={() => void handleGenerate()}>
              <RefreshCw size={14} />
              重試
            </button>
          </div>
        </div>
      )}

      {/* 分析結果顯示區 + 免責聲明 */}
      {status === 'success' && aiText && (
        <div className="ai-card">
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Bot size={16} />
            {ticker} {name} AI 數據綜合分析
          </div>
          <div className="ai-result">{aiText}</div>
          <div className="ai-disclaimer">
            免責聲明：本分析由 AI 模型依據上方的技術面與籌碼數據自動生成，僅供參考，不構成任何投資建議、買賣推薦或價格預測。AI 仍有可能講錯數字，重要數字請回頭對照「技術面」與「籌碼」分頁。
          </div>
        </div>
      )}

      {/*
        追問對話（0.6.5）。只在已有分析時出現 —— 沒有分析就沒有可討論的脈絡，
        也沒有框限所依據的資料。
      */}
      {status === 'success' && aiText && (
        <div className="ai-card">
          <div className="ai-chat-head">
            <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
              <MessageSquare size={16} />
              繼續討論
            </div>
            <span className="hint">
              {turnsUsed(chat)} / {MAX_CHAT_TURNS} 輪
            </span>
          </div>

          {/*
            對話紀錄**一律顯示**（含從 sessionStorage 還原的）。
            能不能「繼續問」才取決於 payload —— 兩件事分開，
            否則重新整理後看得到分析卻看不到自己剛才問過什麼。
          */}
          {chat.length === 0 && payload && (
            <p className="hint">
              可以針對上面的分析追問，例如「毛利率的趨勢說明一下」。
              只能討論這檔股票的數據，範圍外的問題不會回答。
            </p>
          )}

          {chat.length > 0 && (
            <div className="ai-chat-log">
              {chat.map((m, i) => (
                <div
                  key={`${m.role}-${i}`}
                  className={m.role === 'user' ? 'ai-chat-msg user' : 'ai-chat-msg bot'}
                >
                  <div className="ai-chat-role">{m.role === 'user' ? '你' : 'AI'}</div>
                  <div className="ai-chat-text">{m.content}</div>
                </div>
              ))}
              {chatBusy && (
                <div className="ai-chat-msg bot">
                  <div className="ai-chat-role">AI</div>
                  <div className="ai-chat-text hint">
                    <RefreshCw size={13} className="spin" style={{ verticalAlign: -2 }} /> 思考中…（最長{' '}
                    {AI_TIMEOUT_SECONDS} 秒）
                  </div>
                </div>
              )}
            </div>
          )}

          {chatErr && (
            <div className="notice notice-warn" role="alert" style={{ marginTop: 8 }}>
              <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              {chatErr}
            </div>
          )}

          {/*
            payload 只在「這次 session 按過產生分析」時才有值。從 sessionStorage
            還原的情況下是 null（payload 很大且可重建，故沒有一起存）。
            沒有它就沒有框限所依據的資料，硬送等於讓模型憑空作答。
          */}
          {!payload ? (
            <p className="hint">
              這份分析是從先前的瀏覽還原的。請按上方「重新產生分析」後即可繼續討論。
            </p>
          ) : canAsk(chat) ? (
            <form
              className="ai-chat-form"
              onSubmit={(e) => {
                e.preventDefault()
                void handleAsk()
              }}
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="針對這份分析提問…"
                maxLength={MAX_INPUT_CHARS}
                disabled={chatBusy}
                aria-label="追問內容"
              />
              <button className="btn" type="submit" disabled={chatBusy || !chatInput.trim()}>
                {chatBusy ? '傳送中…' : '送出'}
              </button>
            </form>
          ) : (
            <p className="hint">
              已達 {MAX_CHAT_TURNS} 輪上限。每一輪都會重送完整資料，
              再往上疊只會增加費用；需要繼續討論請重新產生一份分析。
            </p>
          )}
        </div>
      )}
    </div>
  )
}
