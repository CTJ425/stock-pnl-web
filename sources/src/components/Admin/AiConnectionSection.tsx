/**
 * 管理後台「AI 連線」：全站共用的 AI 供應商設定。
 *
 * 0.6.19 從個股分析的「AI 分析」分頁搬過來。搬的理由是**權限而不是版面** ——
 * 那份表單只有管理員看得到，卻長在一個所有人每天都會開的分頁裡，
 * 等於讓每個使用者都看到一個自己按不了的按鈕。設定類的東西集中在後台，
 * `AiTab` 只負責讀設定去發請求。
 *
 * ⚠️ 金鑰以明文存放且所有登入帳號可讀，那是「前端直連 AI 供應商」的必然結果 ——
 * 金鑰終究得回到瀏覽器才發得出請求（schema.sql §4.1 有完整說明）。
 * 這不是疏忽，但畫面上要講出來，否則會被誤會成疏忽。
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, Trash2 } from 'lucide-react'
import {
  clearAiSettings,
  loadAiSettings,
  saveAiSettings,
  validateAiSettings,
  type AiProviderKind,
  type AiSettings,
} from '../../services/aiSettings'

export function AiConnectionSection() {
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<AiSettings | null>(null)

  const [provider, setProvider] = useState<AiProviderKind>('google')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [okMsg, setOkMsg] = useState('')

  useEffect(() => {
    let alive = true
    void loadAiSettings().then((s) => {
      if (!alive) return
      setSaved(s)
      if (s) {
        setProvider(s.provider)
        setBaseUrl(s.baseUrl)
        setModel(s.model)
        setApiKey(s.apiKey)
      }
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  /** 切換供應商時帶入該供應商的範例值，省得每次都要查一次型號怎麼寫 */
  function changeProvider(kind: AiProviderKind) {
    setProvider(kind)
    setErr('')
    if (kind === 'google') {
      if (!model || model === 'llama3' || model === 'qwen2.5') setModel('gemini-2.5-flash')
    } else {
      if (!baseUrl) setBaseUrl('http://localhost:11434/v1')
      if (!model || model.startsWith('gemini')) setModel('llama3')
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setOkMsg('')
    const candidate: AiSettings = { provider, baseUrl, model, apiKey }
    const valErr = validateAiSettings(candidate)
    if (valErr) {
      setErr(valErr)
      return
    }
    setBusy(true)
    const res = await saveAiSettings(candidate)
    setBusy(false)
    if (res.error) {
      setErr(res.error)
      return
    }
    setSaved(candidate)
    setOkMsg('AI 設定已儲存')
  }

  async function handleClear() {
    if (!confirm('確定要清除 AI 設定嗎？清除後所有使用者都無法產生 AI 分析。')) return
    setBusy(true)
    const res = await clearAiSettings()
    setBusy(false)
    if (res.error) {
      setErr(res.error)
      return
    }
    setSaved(null)
    setOkMsg('AI 設定已清除')
  }

  return (
    <section className="section glass adm-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">AI 連線</h3>
        <span className="source-tag section-stamp">
          全站共用，不分帳號與工作區・僅管理員可修改
        </span>
      </div>

      {loading ? (
        <p className="hint" style={{ marginTop: 12 }}>
          正在讀取設定…
        </p>
      ) : (
        <form className="ai-form" onSubmit={(e) => void handleSave(e)} style={{ marginTop: 14 }}>
          <div className="ai-form-group">
            <label htmlFor="adm-ai-provider">AI 服務供應商</label>
            <select
              id="adm-ai-provider"
              className="ai-select"
              value={provider}
              onChange={(e) => changeProvider(e.target.value as AiProviderKind)}
            >
              <option value="google">Google AI (Gemini)</option>
              <option value="openai-compatible">OpenAI 相容 (Ollama / vLLM / 其它)</option>
            </select>
          </div>

          {provider === 'openai-compatible' && (
            <div className="ai-form-group">
              <label htmlFor="adm-ai-url">Base URL</label>
              <input
                id="adm-ai-url"
                type="text"
                className="ai-input"
                placeholder="e.g. http://localhost:11434/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <span className="hint" style={{ fontSize: 11 }}>
                將自動補上 /v1，Ollama 本機請填 http://localhost:11434，並確認設定 OLLAMA_ORIGINS。
              </span>
            </div>
          )}

          <div className="ai-form-group">
            <label htmlFor="adm-ai-model">Model (模型名稱)</label>
            <input
              id="adm-ai-model"
              type="text"
              className="ai-input"
              placeholder={provider === 'google' ? 'e.g. gemini-2.5-flash' : 'e.g. llama3'}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>

          <div className="ai-form-group">
            <label htmlFor="adm-ai-key">
              API Key {provider === 'openai-compatible' && '(選填，本機 Ollama 免填)'}
            </label>
            <input
              id="adm-ai-key"
              type="password"
              className="ai-input"
              placeholder={provider === 'google' ? '請輸入 Google API Key' : '選填 API Key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <span className="hint" style={{ fontSize: 11 }}>
              金鑰會下發到每個登入者的瀏覽器 —— 前端直接發請求給供應商，這是必然的。
            </span>
          </div>

          {err && (
            <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 13 }}>
              <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              {err}
            </div>
          )}
          {okMsg && (
            <div className="notice notice-info" style={{ padding: '8px 12px', fontSize: 13 }}>
              <CheckCircle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              {okMsg}
            </div>
          )}

          <div className="ai-actions">
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
              {busy ? '儲存中…' : '儲存 AI 設定'}
            </button>
            {saved && (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void handleClear()}
                disabled={busy}
              >
                <Trash2 size={14} />
                清除設定
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  )
}
