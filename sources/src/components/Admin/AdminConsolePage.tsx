/**
 * Management backend (0.6.19). Only accounts with `app_metadata.role === 'admin'` can enter.
 * The entrance is in the account menu in the upper right corner, **does not occupy the position of the paging bar**——
 * The management functions and the tabs for daily viewing are mixed on the same navigation, which is equivalent to allowing every user to see one
 * A position that I can't press.
 *
 * The layout is "full page + left vertical navigation" instead of sub-pages: the background is an independent workspace.
 * More items will grow later, and the horizontal sub-page column will not be able to support it.
 *
 * ⚠️ The permission judgment here** is just an arrangement on the interface, not a security boundary**.
 * The real key lies in the `assertAdmin` of Edge Function and the RLS of the data table——
 * Anyone who changes a line of JS can call this page out, but calling it out will only get 403 and empty data.
 */
import { useState } from 'react'
import { Activity, ChevronLeft, FileText, KeyRound, Play, Users } from 'lucide-react'
import { AccountsSection } from './AccountsSection'
import { AdminStatusPage } from './AdminStatusPage'
import { AiConnectionSection } from './AiConnectionSection'
import { ManualRunSection } from './ManualRunSection'
import { PromptsSection } from './PromptsSection'

type Panel = 'accounts' | 'status' | 'run' | 'ai' | 'prompts'

const PANELS: Array<{ id: Panel; label: string; icon: typeof Users }> = [
  { id: 'accounts', label: '帳號', icon: Users },
  { id: 'status', label: '抓取狀況', icon: Activity },
  { id: 'run', label: '手動更新', icon: Play },
  { id: 'ai', label: 'AI 連線', icon: KeyRound },
  { id: 'prompts', label: '提示詞', icon: FileText },
]

export function AdminConsolePage({ onExit }: { onExit: () => void }) {
  const [panel, setPanel] = useState<Panel>('status')

  return (
    <div className="adm-console">
      <aside className="adm-side">
        <button type="button" className="adm-back" onClick={onExit}>
          <ChevronLeft size={14} />
          回到庫存總覽
        </button>
        <span className="adm-side-label">管理後台</span>
        <nav aria-label="管理後台頁面">
          {PANELS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={panel === id ? 'adm-side-item active' : 'adm-side-item'}
              onClick={() => setPanel(id)}
              aria-current={panel === id ? 'page' : undefined}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="adm-main">
        {panel === 'accounts' && <AccountsSection />}
        {panel === 'status' && <AdminStatusPage />}
        {panel === 'run' && <ManualRunSection />}
        {panel === 'ai' && <AiConnectionSection />}
        {panel === 'prompts' && <PromptsSection />}
      </div>
    </div>
  )
}
