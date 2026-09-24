import { Suspense, lazy, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Check,
  ChevronDown,
  Layers,
  Pencil,
  Percent,
  Plus,
  Trash2,
} from 'lucide-react'
import { useWorkspace } from '../context/WorkspaceContext'
import { getFeeRate } from '../utils/settings'
import { describeTwFeeRate } from '../utils/feeRateHint'
import { Modal } from './Common/Modal'
import { HeaderMenu } from './Common/HeaderMenu'
import { useToast } from './Common/Toast'
import { useConfirm } from './Common/useConfirm'

const RecalcFeesModal = lazy(() =>
  import('./Transactions/RecalcFeesModal').then((m) => ({ default: m.RecalcFeesModal })),
)

export function WorkspaceControls() {
  const {
    workspaces,
    current,
    selectWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setWorkspaceFeeRate,
  } = useWorkspace()
  const { show } = useToast()
  const confirm = useConfirm()
  const [modal, setModal] = useState<'create' | 'rename' | 'fee' | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [feeInput, setFeeInput] = useState('')
  // After the rate changes, batch recalculation preview is enabled so that historical records can be adjusted according to the new rate.
  const [showRecalc, setShowRecalc] = useState(false)

  const openCreate = () => {
    setNameInput('')
    setModal('create')
  }
  const openRename = () => {
    if (!current) return
    setNameInput(current.name)
    setModal('rename')
  }
  const openFee = () => {
    if (!current) return
    setFeeInput(String(getFeeRate(current.id)))
    setModal('fee')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (modal === 'fee') {
      const rate = parseFloat(feeInput)
      if (!Number.isFinite(rate) || rate < 0 || rate >= 1) return
      if (current) {
        const changed = rate !== getFeeRate(current.id)
        await setWorkspaceFeeRate(current.id, rate)
        // When the rates change, batch recalculation will be carried out for simultaneous adjustment of historical records (can be checked or cancelled)
        if (changed) setShowRecalc(true)
      }
      setModal(null)
      return
    }
    const name = nameInput.trim()
    if (!name) return
    if (modal === 'create') await createWorkspace(name)
    else if (modal === 'rename' && current) await renameWorkspace(current.id, name)
    setModal(null)
  }

  const handleDelete = async () => {
    if (!current) return
    if (workspaces.length <= 1) {
      show('至少需保留一個工作區。', 'error')
      return
    }
    const ok = await confirm({
      title: '刪除工作區',
      message: `確定刪除工作區「${current.name}」嗎？\n\n其中所有交易紀錄將一併刪除，此動作無法復原。`,
      confirmLabel: '刪除',
      danger: true,
    })
    if (ok) {
      await deleteWorkspace(current.id)
      show('工作區已刪除')
    }
  }

  return (
    <div className="ws-select">
      {/*
        Switching and managing share one menu: the management actions only ever act on "the workspace you are
        in", so putting them next to the workspace list means the target never has to be guessed.
        Delete is set off by a divider and coloured red —— it used to sit beside 重新命名, both 14px unlabelled icons.
      */}
      <HeaderMenu
        triggerLabel={`工作區：${current?.name ?? '未選擇'}`}
        triggerClass="hmenu-ws"
        triggerContent={
          <>
            <Layers size={14} />
            <span className="hmenu-ws-name">{current?.name ?? '未選擇'}</span>
            <ChevronDown size={12} className="hmenu-caret" />
          </>
        }
        menuLabel="工作區選單"
      >
        {(close) => (
          <>
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                role="menuitemradio"
                aria-checked={w.id === current?.id}
                className={w.id === current?.id ? 'hmenu-item is-current' : 'hmenu-item'}
                onClick={() => {
                  selectWorkspace(w.id)
                  close()
                }}
              >
                <Check size={14} className="hmenu-check" aria-hidden="true" />
                <span>{w.name}</span>
              </button>
            ))}
            <div className="hmenu-sep" />
            <button
              type="button"
              role="menuitem"
              className="hmenu-item"
              onClick={() => {
                close()
                openCreate()
              }}
            >
              <Plus size={14} />
              <span>新增工作區</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="hmenu-item"
              onClick={() => {
                close()
                openRename()
              }}
            >
              <Pencil size={14} />
              <span>重新命名</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="hmenu-item"
              onClick={() => {
                close()
                openFee()
              }}
            >
              <Percent size={14} />
              <span>預設手續費率</span>
            </button>
            <div className="hmenu-sep" />
            <button
              type="button"
              role="menuitem"
              className="hmenu-item is-danger"
              onClick={() => {
                close()
                void handleDelete()
              }}
            >
              <Trash2 size={14} />
              <span>刪除工作區</span>
            </button>
          </>
        )}
      </HeaderMenu>

      {modal && (
        <Modal
          title={
            modal === 'create'
              ? '新增工作區'
              : modal === 'rename'
                ? '重新命名工作區'
                : `工作區設定 — ${current?.name ?? ''}`
          }
          onClose={() => setModal(null)}
        >
          <form onSubmit={(e) => void submit(e)}>
            {modal === 'fee' ? (
              <div className="field">
                <label htmlFor="ws-fee-rate">預設手續費率</label>
                <input
                  id="ws-fee-rate"
                  type="number"
                  step="any"
                  min="0"
                  max="0.99"
                  value={feeInput}
                  autoFocus
                  placeholder="例如 0.001425"
                  onChange={(e) => setFeeInput(e.target.value)}
                />
                {(() => {
                  const hint = describeTwFeeRate(parseFloat(feeInput))
                  return (
                    <>
                      {hint.discount && <span className="fee-rate-hint">{hint.discount}</span>}
                      {hint.warning && <span className="fee-rate-warning">{hint.warning}</span>}
                    </>
                  )
                })()}
                <div className="field-hint">
                  台股標準是 0.001425。券商有折扣就填折扣後的數字（例如 0.0004275）。
                  只套用在「{current?.name ?? '目前'}」工作區，新增交易時會自動帶入；
                  改了費率會問你要不要把舊紀錄一起重算。
                </div>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="ws-name">工作區名稱</label>
                <input
                  id="ws-name"
                  value={nameInput}
                  autoFocus
                  placeholder="例如：長期投資、退休帳戶"
                  onChange={(e) => setNameInput(e.target.value)}
                />
              </div>
            )}
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
              {modal === 'create' ? '建立' : '儲存'}
            </button>
          </form>
        </Modal>
      )}

      {showRecalc && (
        <Suspense fallback={null}>
          <RecalcFeesModal onClose={() => setShowRecalc(false)} />
        </Suspense>
      )}
    </div>
  )
}
