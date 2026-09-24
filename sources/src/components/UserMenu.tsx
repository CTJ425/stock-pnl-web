import { useEffect, useState } from 'react'
import {
  ExternalLink,
  HardDrive,
  KeyRound,
  LogOut,
  MessageCircle,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import type { ThemePref } from '../utils/settings'
import { applyTheme, getThemePref, setThemePref } from '../utils/settings'
import { HeaderMenu } from './Common/HeaderMenu'
import { useToast } from './Common/Toast'
import { ChangePasswordModal } from './Auth/PasswordModals'

const GITHUB_URL = 'https://github.com/CTJ425/stock-pnl-web'

/**
 * GitHub official mark.
 *
 * Embed a path yourself instead of using an icon library: **lucide 1.x has removed all brand icons**
 * (`lucide-react@1.24.0` does not have `Github`), it is not cost-effective to install one more package for one icon.
 * Size and stroke alignment lucide: 24×24 viewBox, `currentColor` coloring (this is solid not line art).
 */
function GithubMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      style={{ flex: '0 0 auto' }}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

/**
 * Modern flat user avatar icon (Contemporary Architect Arc).
 * Solid circular head + elegant dual-arc minimalist shoulder contours.
 * Replaces the old account number / email initials with a clean modern flat persona.
 */
function AvatarIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: '0 0 auto' }}
    >
      <circle cx="12" cy="7" r="4.2" fill="currentColor" stroke="none" />
      <path d="M4 21c.6-4.5 4-7.8 8-7.8s7.4 3.3 8 7.8" strokeWidth="2.2" />
      <path d="M7 21c.5-2.8 2.5-4.8 5-4.8s4.5 2 5 4.8" strokeWidth="1.8" />
    </svg>
  )
}

const THEME_ORDER: ThemePref[] = ['system', 'dark', 'light']
const THEME_LABEL: Record<ThemePref, string> = {
  system: '跟隨系統',
  dark: '深色',
  light: '淺色',
}

/**
 * User menu: appearance switching, management background, source code, identity, logout.
 *
 * Local mode** deliberately retains the "local mode" badge as a trigger button** instead of replacing it with an avatar——
 * "Data only exists in this browser" is a fact that users need to see at all times. Hiding it in the menu is equivalent to downgrading it.
 *
 * 0.6.19 Collect two things:
 * - **Admin Backstage** (Administrator only). Originally it was "crawl status" on the paginated column, but the management function is the same as
 *   The paginations for daily viewing are mixed into the same navigation, which means that every user sees a location that they cannot click on.
 * - **Source Code** (for everyone). Originally a line of text link at the end of the page; a disclaimer at the end of the page,
 *   The link is included here, and there is no need to make room for it at the top or bottom of the page.
 */
export function UserMenu({
  admin,
  onOpenAdmin,
  onOpenDiscord,
}: {
  admin: boolean
  onOpenAdmin: () => void
  onOpenDiscord: () => void
}) {
  const { mode, user, signOut } = useAuth()
  const { show } = useToast()
  const [pref, setPref] = useState<ThemePref>(() => getThemePref())
  const [showChangePassword, setShowChangePassword] = useState(false)

  useEffect(() => {
    applyTheme(pref)
  }, [pref])

  useEffect(() => {
    // The existence check of matchMedia cannot be omitted: jsdom has not implemented it. Without this test, the whole batch will explode.
    if (pref !== 'system' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const cycleTheme = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(pref) + 1) % THEME_ORDER.length]
    setPref(next)
    setThemePref(next)
  }

  const ThemeIcon = pref === 'system' ? Monitor : pref === 'dark' ? Moon : Sun
  const email = user?.email ?? ''
  const isLocal = mode === 'local'

  return (
    <>
      <HeaderMenu
        triggerLabel={isLocal ? '本機模式選單' : `帳號選單（${email}）`}
        triggerClass={isLocal ? 'badge hmenu-badge' : 'hmenu-avatar'}
        triggerContent={
          isLocal ? (
            <>
              <HardDrive size={12} />
              本機模式
            </>
          ) : (
            <AvatarIcon size={16} />
          )
        }
        menuLabel="帳號與外觀"
      >
        {(close) => (
          <>
            <div className="hmenu-head">
              {isLocal ? '資料儲存於此瀏覽器，未連線 Supabase' : email}
            </div>
            <div className="hmenu-sep" />
            <button type="button" role="menuitem" className="hmenu-item" onClick={cycleTheme}>
              <ThemeIcon size={14} />
              <span>外觀：{THEME_LABEL[pref]}</span>
            </button>
            <div className="hmenu-sep" />
            {/*
              Hiding the admin console is **housekeeping in the interface, not a security boundary** —— the real
              gate is `assertAdmin` in the Edge Function plus RLS on the tables (anything the frontend hides can
              be summoned by editing one line of JS). Bypassing this check to open the console only earns a 403
              and a page with no data in it.
            */}
            {admin && (
              <button
                type="button"
                role="menuitem"
                className="hmenu-item hmenu-item-admin"
                onClick={() => {
                  close()
                  onOpenAdmin()
                }}
              >
                <ShieldCheck size={14} />
                <span>管理後台</span>
              </button>
            )}
            <a
              role="menuitem"
              className="hmenu-item"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              onClick={close}
            >
              <GithubMark />
              <span>原始碼</span>
              <ExternalLink size={12} className="hmenu-item-ext" />
            </a>
            {!isLocal && (
              <>
                <div className="hmenu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="hmenu-item"
                  onClick={() => {
                    close()
                    onOpenDiscord()
                  }}
                >
                  <MessageCircle size={14} />
                  <span>Discord 通知設定</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="hmenu-item"
                  onClick={() => {
                    close()
                    setShowChangePassword(true)
                  }}
                >
                  <KeyRound size={14} />
                  <span>變更密碼</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="hmenu-item"
                  onClick={() => {
                    close()
                    void signOut().then((err) => {
                      if (err) show(err, 'error')
                    })
                  }}
                >
                  <LogOut size={14} />
                  <span>登出</span>
                </button>
              </>
            )}
          </>
        )}
      </HeaderMenu>
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </>
  )
}
