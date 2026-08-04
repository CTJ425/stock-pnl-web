/**
 * 個股分析「AI 分析」分頁。
 * 獨立進行 daily series 載入與技術面計算，不將狀態上提到父元件或修改 TechnicalTab。
 * 不會自動重試，未設定時畫面不得出現任何 AI 生成文字。
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
  /** 由 StockDetailPage 載入分發（標題 badge / 基本面分頁 / 此處共用同一份） */
  fundamental: FundamentalData | null
}

const AI_TIMEOUT_SECONDS = Math.round(AI_TIMEOUT_MS / 1000)

export function AiTab({ ticker, name, report, fundamental }: AiTabProps) {
  // 設定狀態
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  // 設定改在管理後台維護（0.6.19），這裡只用來決定「未設定」時該給誰看哪一句話
  const [isAdmin, setIsAdmin] = useState(false)
  // 管理員在後台改過的提示詞。取不到就是空字串，`resolvePrompt` 會退回預設
  const [prompts, setPrompts] = useState<AiPrompts>(EMPTY_PROMPTS)

  // 執行與結果狀態
  const [status, setStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle')
  const [aiText, setAiText] = useState('')
  const [errMsg, setErrMsg] = useState('')

  // 追問對話（0.6.5）。payload 留著是因為每一輪都要重送完整資料與框限，
  // 不能只靠第一輪 —— 見 aiChat.ts 的說明。
  const [payload, setPayload] = useState<AiPayload | null>(null)
  const [chat, setChat] = useState<AiMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatErr, setChatErr] = useState('')

  // 從 sessionStorage 還原上次的分析與對話。
  // 這順便修掉「切分頁 AI 結果就消失、要重按一次（重新計費）」那個痛點。
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

  // 初次載入設定
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
      // 自己載入日線並計算技術面
      const daily = await fetchDailySeries(ticker)
      if (!daily || !daily.rows) {
        throw new AiError('bad-response', '無法讀取該個股之日線資料')
      }
      // 指標一律以完整序列（近 1 年）計算，範圍標籤要跟著傳，模型才知道區間極值是哪段區間的
      const range: RangeKey = '1y'
      const view = buildTechnicalView(daily.rows, range)
      if (!view) {
        throw new AiError('bad-response', '無法計算個股之技術面指標 (歷史股價資料不存在或為空)')
      }
      // 總經背景。0.6.5-dev.2 起自己抓 —— 它已不在個股分析的分頁裡，父元件沒理由替它載。
      // 與 daily 同款：按下「產生分析」才抓，不必為了可能永遠不看的東西
      // 在每次開啟個股頁時都下載一次。缺料不阻斷（buildMacroBlock 回 hasData: false）。
      const macro = await fetchMacro()
      const built = buildAiPayload({ ticker, name, view, report, range, fundamental, macro })
      const { system, user } = renderAiPrompt(built, prompts.analysis)

      const provider = createAiProvider(settings)
      const result = await provider.complete({
        system,
        messages: [{ role: 'user', content: user }],
      })

      // 重新產生分析＝開一段新對話。舊的追問是針對舊分析問的，接著它會前後矛盾。
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
   * 送出一則追問。
   *
   * `payload` 只在「這次 session 有按過產生分析」時才有值；從 sessionStorage
   * 還原回來的情況下是 null，因為 payload 沒有一起存（它很大，且可以重建）。
   * 那時要求使用者重新產生一次分析 —— 沒有 payload 就沒有框限所依據的資料，
   * 硬送等於讓模型在沒有數據的情況下憑空作答。
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
      // system 每一輪都重送，框限不會隨對話變長被稀釋（見 aiChat.ts）
      const reply = await provider.complete({
        system: buildChatSystem(payload, aiText, prompts.chat),
        messages: next,
      })
      const withReply: AiMessage[] = [...next, { role: 'assistant', content: reply }]
      setChat(withReply)
      saveChat(ticker, aiText, withReply)
    } catch (e: unknown) {
      // 失敗時把剛送出的那則留在畫面上，使用者才知道是哪一句沒送成功
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
