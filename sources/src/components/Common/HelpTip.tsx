/**
 * 欄位說明提示：表頭旁的「?」圖示，滑鼠移入或鍵盤聚焦即顯示說明。
 *
 * 氣泡以 position: fixed 配合實際座標渲染——表格外層是 overflow: auto 的捲動容器，
 * 用 absolute 會被裁掉。且必須 portal 到 body：表格容器 .glass 有 backdrop-filter，
 * 會成為 fixed 定位的包含區塊，留在原地會以玻璃容器而非視窗為基準而偏移。
 * 觸控裝置沒有 hover，因此點擊亦可開合。
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface HelpTipProps {
  /** 欄位說明內容 */
  text: string
  /** 無障礙標籤用的欄位名稱（如「現價」） */
  label: string
}

const BUBBLE_WIDTH = 260
const GAP = 8

export function HelpTip({ text, label }: HelpTipProps) {
  const [pos, setPos] = useState<{ top: number; left: number; flipTop: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const id = useId()

  const show = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // 預設顯示在圖示下方並向左對齊；靠近視窗右緣時往內收，避免超出畫面
    const left = Math.max(
      GAP,
      Math.min(r.left, window.innerWidth - BUBBLE_WIDTH - GAP),
    )
    setPos({ top: r.bottom + 6, left, flipTop: r.top - 6 })
  }, [])

  const hide = useCallback(() => setPos(null), [])

  // 下方空間不足時翻到圖示上方（高度要等實際渲染後才量得到）
  useLayoutEffect(() => {
    const el = bubbleRef.current
    if (!pos || !el) return
    const h = el.offsetHeight
    if (pos.top + h > window.innerHeight - GAP) {
      el.style.top = `${Math.max(GAP, pos.flipTop - h)}px`
    }
  }, [pos])

  // 捲動或改變視窗大小時關閉：fixed 氣泡不會跟著表格捲動
  useEffect(() => {
    if (!pos) return
    const onDismiss = () => setPos(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPos(null)
    }
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [pos])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="help-tip"
        aria-label={`${label}欄位說明`}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation()
          if (pos) hide()
          else show()
        }}
      >
        ?
      </button>
      {pos &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            className="help-bubble"
            style={{ top: pos.top, left: pos.left, width: BUBBLE_WIDTH }}
          >
            <div className="help-bubble-title">{label}</div>
            {text}
          </div>,
          document.body,
        )}
    </>
  )
}
