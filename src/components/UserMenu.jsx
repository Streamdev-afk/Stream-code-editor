import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../lib/auth'

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
          <div
            className="user-menu-item"
            onClick={async () => {
              setOpen(false)
              await signOut()
            }}
          >
            <span className="user-menu-item-icon">↪</span>
            Sign out
          </div>
        </div>
      )}
    </div>
  )
}