/**
 * "Prompt words" in the management background: The criteria for analysis and inquiry can be changed directly by the administrator on the web page without having to touch the code.
 *
 * Two things are deliberately done on the screen:
 * 1. **List the locked paragraphs truthfully**. Security rules are fixed by the program after user input.
 *    Print it out here so that the administrator can know "what is written in the parts that I cannot change".
 *    Instead of guessing which one is blocking based on the model's response after making the changes.
 * 2. **"Restore to Default" does not write back to the database**, but only fills the text box back with the default value - it will take effect only when you click Save.
 *    Misclicking will not directly erase other people's settings.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, FileText, Lock, MessageSquare } from 'lucide-react'
import {
  ANALYSIS_DEFAULT,
  ANALYSIS_LOCKED,
  CHAT_DEFAULT,
  EMPTY_PROMPTS,
  loadAiPrompts,
  resolvePrompt,
  saveAiPrompts,
  type AiPrompts,
} from '../../services/aiPrompts'
import { CHAT_LOCKED } from '../StockDetail/aiChat'

type Kind = keyof AiPrompts

const KINDS: Array<{
  id: Kind
  label: string
  hint: string
  fallback: string
  locked: string
  icon: typeof FileText
}> = [
  {
    id: 'analysis',
    label: '個股分析',
    hint: '產生分析全文時使用',
    fallback: ANALYSIS_DEFAULT,
    locked: ANALYSIS_LOCKED,
    icon: FileText,
  },
  {
    id: 'chat',
    label: '追問對話',
    hint: '使用者針對分析追問時',
    fallback: CHAT_DEFAULT,
    locked: CHAT_LOCKED,
    icon: MessageSquare,
  },
]

export function PromptsSection() {
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<Kind>('analysis')
  const [draft, setDraft] = useState<AiPrompts>(EMPTY_PROMPTS)
  const [saved, setSaved] = useState<AiPrompts>(EMPTY_PROMPTS)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void loadAiPrompts().then((p) => {
      if (!alive) return
      // The data stored in the database is "has it been modified?". The text box needs to be able to see the actual effective content, so it will be parsed into complete text.
      const filled: AiPrompts = {
        analysis: resolvePrompt(p.analysis, ANALYSIS_DEFAULT),
        chat: resolvePrompt(p.chat, CHAT_DEFAULT),
      }
      setDraft(filled)
      setSaved(filled)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const spec = KINDS.find((k) => k.id === kind)!
  const text = draft[kind]
  const dirty = draft.analysis !== saved.analysis || draft.chat !== saved.chat
  const customized = text.trim() !== spec.fallback.trim()

  async function handleSave() {
    setErr('')
    setOkMsg('')
    setBusy(true)
    const res = await saveAiPrompts(draft)
    setBusy(false)
    if (res.error) {
      setErr(res.error)
      return
    }
    setSaved(draft)
    setOkMsg('提示詞已儲存，之後產生的分析都會套用')
  }

  return (
    <section className="section glass adm-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">提示詞</h3>
        <span className="source-tag section-stamp">
          全站共用・僅管理員可修改・儲存後立刻對所有使用者生效
        </span>
        <button className="btn btn-sm btn-primary" onClick={() => void handleSave()} disabled={busy || !dirty}>
          {busy ? '儲存中…' : '儲存變更'}
        </button>
      </div>

      {loading ? (
        <p className="hint" style={{ marginTop: 12 }}>
          正在讀取提示詞…
        </p>
      ) : (
        <div className="adm-prompt">
          <div className="adm-prompt-list">
            {KINDS.map(({ id, label, hint, icon: Icon, fallback }) => (
              <button
                key={id}
                type="button"
                className={kind === id ? 'adm-prompt-item active' : 'adm-prompt-item'}
                onClick={() => setKind(id)}
                aria-current={kind === id ? 'true' : undefined}
              >
                <b>
                  <Icon size={14} />
                  {label}
                </b>
                <span>{hint}</span>
                {draft[id].trim() !== fallback.trim() && (
                  <span className="badge badge-warn">已改動</span>
                )}
              </button>
            ))}
          </div>

          <div className="adm-prompt-editor">
            <label className="adm-prompt-label" htmlFor="adm-prompt-text">
              {spec.label}準則
              <span>
                可編輯・{text.length} 字{customized ? '・已與預設不同' : ''}
              </span>
            </label>
            <textarea
              id="adm-prompt-text"
              className="adm-prompt-text"
              value={text}
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, [kind]: e.target.value })}
            />

            <div className="adm-prompt-locked">
              <b>
                <Lock size={13} />
                以下由系統固定接在後面，改不了
              </b>
              <pre>{spec.locked}</pre>
            </div>

            {err && (
              <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 13, marginTop: 12 }}>
                <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                {err}
              </div>
            )}
            {okMsg && (
              <div className="notice notice-info" style={{ padding: '8px 12px', fontSize: 13, marginTop: 12 }}>
                <CheckCircle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                {okMsg}
              </div>
            )}

            <div className="ai-actions" style={{ marginTop: 12 }}>
              <button
                className="btn btn-sm"
                onClick={() => setDraft({ ...draft, [kind]: spec.fallback })}
                disabled={!customized}
              >
                還原成預設
              </button>
              <span className="hint">
                股價、籌碼、月營收與總經由程式在送出前自動接上，不必寫進這裡。
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
