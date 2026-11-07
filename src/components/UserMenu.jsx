import Icon from './Icon'
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../lib/auth'

const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
// Android: open the installed ION app, fall back to VITE_ION_URL if it is not installed.
// Desktop has no ION app, so there it offers VITE_ION_APK_URL (download link) instead.
const ionIntent = `intent://#Intent;package=com.streamdevafk.ion;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;S.browser_fallback_url=${encodeURIComponent(import.meta.env.VITE_ION_URL || '')};end`

export default function UserMenu() {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  if (!user) return null

  const name =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.user_metadata?.user_name ||
    user.email?.split('@')[0] ||
    'User'

  const avatar =
    user.user_metadata?.avatar_url ||
    user.user_metadata?.picture ||
    null

  const initials = name
    .split(/[\s._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        className={`user-avatar-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={name}
      >
        {avatar ? (
          <img src={avatar} alt="" className="user-avatar-img" />
        ) : (
          <span className="user-avatar-initials">{initials}</span>
        )}
      </button>

      {open && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header">
            <div className="user-menu-name">{name}</div>
            {user.email && <div className="user-menu-email">{user.email}</div>}
          </div>
          <div className="user-menu-sep" />
          {import.meta.env.VITE_ION_URL && isAndroid && (
            <a
              className="user-menu-item"
              href={ionIntent}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
            >
              <span className="user-menu-item-icon"><Icon name="back" size={15} /></span>
              Back to ION
            </a>
          )}
          {!isAndroid && import.meta.env.VITE_ION_APK_URL && (
            <a
              className="user-menu-item"
              href={import.meta.env.VITE_ION_APK_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
            >
              <span className="user-menu-item-icon"><Icon name="download" size={15} /></span>
              Get the ION app
            </a>
          )}
          <div
            className="user-menu-item"
            onClick={async () => {
              setOpen(false)
              await signOut()
            }}
          >
            <span className="user-menu-item-icon"><Icon name="logout" size={15} /></span>
            Sign out
          </div>
        </div>
      )}
    </div>
  )
}