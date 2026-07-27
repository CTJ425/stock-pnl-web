/**
 * 個股分析「AI 解讀」分頁。
 * 獨立進行 daily series 載入與技術面計算，不將狀態上提到父元件或修改 TechnicalTab。
 * 不會自動重試，未設定時畫面不得出現任何 AI 生成文字。
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, CheckCircle, ChevronDown, ChevronUp, RefreshCw, Settings, Trash2 } from 'lucide-react'
import { fetchDailySeries } from '../../services/dailyProxy'
import type { ReportData } from '../../services/reportProxy'
import {
  AiError,
  AI_TIMEOUT_MS,
  createAiProvider,
} from '../../services/aiClient'
import {
  clearAiSettings,
  isAiAdmin,
  loadAiSettings,
  saveAiSettings,
  validateAiSettings,
  type AiProviderKind,
  type AiSettings,
} from '../../services/aiSettings'
import { buildAiPayload, renderAiPrompt } from './aiPayload'
import { buildTechnicalView, type RangeKey } from './technicalView'

interface AiTabProps {
  ticker: string
  name: string
  report: ReportData | null
}

const AI_TIMEOUT_SECONDS = Math.round(AI_TIMEOUT_MS / 1000)

export function AiTab({ ticker, name, report }: AiTabProps) {
  // 設定狀態
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [showSettingsForm, setShowSettingsForm] = useState(false)
  // AI 設定為全站共用，只有 app_metadata.role = 'admin' 的帳號可修改
  const [isAdmin, setIsAdmin] = useState(false)

  // 設定表單狀態
  const [formProvider, setFormProvider] = useState<AiProviderKind>('google')
  const [formBaseUrl, setFormBaseUrl] = useState('')
  const [formModel, setFormModel] = useState('')
  const [formApiKey, setFormApiKey] = useState('')
  const [formErr, setFormErr] = useState('')
  const [formSaving, setFormSaving] = useState(false)
  const [formSuccessMsg, setFormSuccessMsg] = useState('')

  // 執行與結果狀態
  const [status, setStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle')
  const [aiText, setAiText] = useState('')
  const [errMsg, setErrMsg] = useState('')

  // 初次載入設定
  useEffect(() => {
    let alive = true
    setSettingsLoading(true)
    ;(async () => {
      const [s, admin] = await Promise.all([loadAiSettings(), isAiAdmin()])
      if (alive) {
        setSettings(s)
        setIsAdmin(admin)
        if (s) {
          setFormProvider(s.provider)
          setFormBaseUrl(s.baseUrl)
          setFormModel(s.model)
          setFormApiKey(s.apiKey)
        } else if (admin) {
          // 未設定時預設展開設定表單（非管理員無表單可填，不展開）
          setShowSettingsForm(true)
        }
        setSettingsLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // 當 provider 切換時帶入預設範例
  function handleProviderChange(kind: AiProviderKind) {
    setFormProvider(kind)
    setFormErr('')
    if (kind === 'google') {
      if (!formModel || formModel === 'llama3' || formModel === 'qwen2.5') {
        setFormModel('gemini-2.5-flash')
      }
    } else {
      if (!formBaseUrl) {
        setFormBaseUrl('http://localhost:11434/v1')
      }
      if (!formModel || formModel.startsWith('gemini')) {
        setFormModel('llama3')
      }
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault()
    setFormErr('')
    setFormSuccessMsg('')

    const candidate: AiSettings = {
      provider: formProvider,
      baseUrl: formBaseUrl,
      model: formModel,
      apiKey: formApiKey,
    }

    const valErr = validateAiSettings(candidate)
    if (valErr) {
      setFormErr(valErr)
      return
    }

    setFormSaving(true)
    const res = await saveAiSettings(candidate)
    setFormSaving(false)

    if (res.error) {
      setFormErr(res.error)
    } else {
      setSettings(candidate)
      setFormSuccessMsg('AI 設定已儲存')
      setShowSettingsForm(false)
      setTimeout(() => setFormSuccessMsg(''), 3000)
    }
  }

  async function handleClearSettings() {
    if (!confirm('確定要清除 AI 設定嗎？')) return
    setFormSaving(true)
    const res = await clearAiSettings()
    setFormSaving(false)
    if (res.error) {
      setFormErr(res.error)
    } else {
      setSettings(null)
      setFormProvider('google')
      setFormBaseUrl('')
      setFormModel('')
      setFormApiKey('')
      setShowSettingsForm(true)
      setStatus('idle')
      setAiText('')
    }
  }

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
      const payload = buildAiPayload({ ticker, name, view, report, range })
      const { system, user } = renderAiPrompt(payload)

      const provider = createAiProvider(settings)
      const result = await provider.complete({ system, user })

      setAiText(result)
      setStatus('success')
    } catch (e: unknown) {
      if (e instanceof AiError) {
        setErrMsg(e.message)
      } else if (e instanceof Error) {
        setErrMsg(e.message)
      } else {
        setErrMsg('產生 AI 解讀時發生未知錯誤')
      }
      setStatus('error')
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
              AI 個股綜合解讀
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
                    解讀中…（最長 {AI_TIMEOUT_SECONDS} 秒）
                  </>
                ) : (
                  <>
                    <Bot size={14} />
                    {status === 'success' || status === 'error' ? '重新產生解讀' : '產生解讀'}
                  </>
                )}
              </button>
            )}

            {isAdmin && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setShowSettingsForm(!showSettingsForm)}
                aria-expanded={showSettingsForm}
              >
                <Settings size={14} />
                AI 設定
                {showSettingsForm ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
          </div>
        </div>

        {formSuccessMsg && (
          <div className="notice notice-info" style={{ marginTop: 12, padding: '8px 12px', fontSize: 13 }}>
            <CheckCircle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
            {formSuccessMsg}
          </div>
        )}

        {/* 設定表單 (僅管理員；未設定時顯示或手動展開) */}
        {isAdmin && showSettingsForm && (
          <form className="ai-form" onSubmit={(e) => void handleSaveSettings(e)} style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div className="ai-form-group">
              <label htmlFor="ai-provider-select">AI 服務供應商 (Provider)</label>
              <select
                id="ai-provider-select"
                className="ai-select"
                value={formProvider}
                onChange={(e) => handleProviderChange(e.target.value as AiProviderKind)}
              >
                <option value="google">Google AI (Gemini)</option>
                <option value="openai-compatible">OpenAI 相容 (Ollama / vLLM / 其它)</option>
              </select>
            </div>

            {formProvider === 'openai-compatible' && (
              <div className="ai-form-group">
                <label htmlFor="ai-base-url-input">Base URL</label>
                <input
                  id="ai-base-url-input"
                  type="text"
                  className="ai-input"
                  placeholder="e.g. http://localhost:11434/v1"
                  value={formBaseUrl}
                  onChange={(e) => setFormBaseUrl(e.target.value)}
                />
                <span className="hint" style={{ fontSize: 11 }}>
                  將自動補上 /v1，Ollama 本機請填 http://localhost:11434，並確認設定 OLLAMA_ORIGINS。
                </span>
              </div>
            )}

            <div className="ai-form-group">
              <label htmlFor="ai-model-input">Model (模型名稱)</label>
              <input
                id="ai-model-input"
                type="text"
                className="ai-input"
                placeholder={formProvider === 'google' ? 'e.g. gemini-2.5-flash' : 'e.g. llama3'}
                value={formModel}
                onChange={(e) => setFormModel(e.target.value)}
              />
            </div>

            <div className="ai-form-group">
              <label htmlFor="ai-api-key-input">
                API Key {formProvider === 'openai-compatible' && '(選填，本機 Ollama 免填)'}
              </label>
              <input
                id="ai-api-key-input"
                type="password"
                className="ai-input"
                placeholder={formProvider === 'google' ? '請輸入 Google API Key' : '選填 API Key'}
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
              />
            </div>

            {formErr && (
              <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 13 }}>
                <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                {formErr}
              </div>
            )}

            <div className="ai-actions">
              <button type="submit" className="btn btn-sm btn-primary" disabled={formSaving}>
                {formSaving ? '儲存中…' : '儲存 AI 設定'}
              </button>
              {settings && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => void handleClearSettings()}
                  disabled={formSaving}
                  style={{ color: 'var(--down)' }}
                >
                  <Trash2 size={14} />
                  清除設定
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {/* 未設定時的引導提示 (不出現任何 AI 文字) */}
      {!settings && !showSettingsForm && (
        <div className="ai-card" style={{ textAlign: 'center', padding: 32 }}>
          <Bot size={36} style={{ opacity: 0.5, marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>尚未設定 AI 服務供應商</div>
          <div className="hint" style={{ marginTop: 6, marginBottom: 16 }}>
            {isAdmin
              ? '請點擊「AI 設定」輸入您的 Google API Key 或本機 Ollama / OpenAI 相容端點資訊。'
              : 'AI 設定為全站共用，僅管理員帳號可修改，請聯絡管理員完成設定。'}
          </div>
          {isAdmin && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowSettingsForm(true)}>
              <Settings size={14} />
              前往設定
            </button>
          )}
        </div>
      )}

      {/* 執行中提示 */}
      {status === 'generating' && (
        <div className="ai-card" style={{ textAlign: 'center', padding: 32 }}>
          <RefreshCw size={28} className="spin" style={{ marginBottom: 12, color: 'var(--primary)' }} />
          <div style={{ fontSize: 15, fontWeight: 500 }}>AI 正在分析技術面與籌碼數據解讀中…</div>
          <div className="hint" style={{ marginTop: 6 }}>最長可能需要 {AI_TIMEOUT_SECONDS} 秒，請稍候。</div>
        </div>
      )}

      {/* 錯誤顯示區 + 手動重試 */}
      {status === 'error' && (
        <div className="ai-error">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600 }}>解讀失敗</div>
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

      {/* 解讀結果顯示區 + 免責聲明 */}
      {status === 'success' && aiText && (
        <div className="ai-card">
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Bot size={16} />
            {ticker} {name} AI 數據綜合解讀
          </div>
          <div className="ai-result">{aiText}</div>
          <div className="ai-disclaimer">
            免責聲明：本解讀由 AI 模型依據上方的技術面與籌碼數據自動生成，僅供參考，不構成任何投資建議、買賣推薦或價格預測。AI 仍有可能講錯數字，重要數字請回頭對照「技術面」與「籌碼」分頁。
          </div>
        </div>
      )}
    </div>
  )
}
