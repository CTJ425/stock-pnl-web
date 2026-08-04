/**
 * 管理後台（0.6.19）。只有 `app_metadata.role === 'admin'` 的帳號進得來，
 * 入口在右上角的帳號選單，**不佔分頁列的位置** ——
 * 管理功能與日常看盤的分頁混在同一條導覽上，等於讓每個使用者都看到一個
 * 自己按不了的位置。
 *
 * 版面是「全頁 + 左側縱向導覽」而不是子分頁：後台是一個獨立的工作區，
 * 之後還會長出更多項目，橫向的子分頁列撐不住。
 *
 * ⚠️ 這裡的權限判斷**只是介面上的整理，不是安全邊界**。
 * 真正的把關在 Edge Function 的 `assertAdmin` 與資料表的 RLS ——
 * 任何人改一行 JS 都能把這一頁叫出來，但叫出來也只會拿到 403 與空資料。
 */
import { useState } from 'react'
import { Activity, ChevronLeft, FileText, KeyRound, Users } from 'lucide-react'
import { AccountsSection } from './AccountsSection'
import { AdminStatusPage } from './AdminStatusPage'
import { AiConnectionSection } from './AiConnectionSection'
import { PromptsSection } from './PromptsSection'

type Panel = 'accounts' | 'status' | 'ai' | 'prompts'

const PANELS: Array<{ id: Panel; label: string; icon: typeof Users }> = [
  { id: 'accounts', label: '帳號', icon: Users },
  { id: 'status', label: '抓取狀況', icon: Activity },
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
        {panel === 'ai' && <AiConnectionSection />}
        {panel === 'prompts' && <PromptsSection />}
      </div>
    </div>
  )
}
