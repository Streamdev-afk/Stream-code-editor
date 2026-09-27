import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/supabase'
import { API_BASE } from '../lib/api'

function formatMs(ms) {
  if (!ms || ms <= 0) return 'soon'
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function TierBadge({ tier, label }) {
  return (
    <span className={`usage-tier usage-tier-${tier}`}>
      {tier === 'anonymous' ? '👤' : tier === 'free' ? '⭐' : '💎'} {label}
    </span>
  )
}

function WindowBar({ label, windowData, windowLabel }) {
  const percent = windowData.percent
  const isWarning = percent >= 70
  const isDanger = percent >= 90

  const barClass = isDanger
    ? 'usage-bar-fill danger'
    : isWarning
      ? 'usage-bar-fill warning'
      : 'usage-bar-fill'

  return (
    <div className="usage-window">
      <div className="usage-window-head">
        <span className="usage-window-label">{label}</span>
        <span className="usage-window-reset">
          resets in {formatMs(windowData.windowEndsAt - Date.now())}
        </span>
      </div>
      <div className="usage-bar">
        <div className={barClass} style={{ width: `${percent}%` }} />
      </div>
      <div className="usage-window-stats">
        <span className="usage-window-count">
          <strong>{windowData.used}</strong> / {windowData.limit}
        </span>
        <span className="usage-window-percent">
          {percent}% used
        </span>
      </div>
    </div>
  )
}

export default function UsageDropdown() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [usage, setUsage] = useState(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const fetchUsage = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/usage`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setUsage(data)
      } catch {}
    }
    fetchUsage()
    const interval = setInterval(fetchUsage, 30000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [user])

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  useEffect(() => {
    if (!open) return
    const fetchUsage = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/usage`)
        if (res.ok) setUsage(await res.json())
      } catch {}
    }
    fetchUsage()
  }, [open])

  if (!usage) {
    return (
      <div className="usage-dropdown" ref={wrapRef}>
        <button className="usage-btn loading" disabled>
          <span className="usage-btn-dot" />
          <span className="usage-btn-label">…</span>
        </button>
      </div>
    )
  }

  // The "primary" percentage shown on the button is the highest of the two windows
  const shortPercent = usage.short.percent
  const longPercent = usage.long.percent
  const primaryPercent = Math.max(shortPercent, longPercent)
  const isDanger = primaryPercent >= 90
  const isWarning = primaryPercent >= 70

  return (
    <div className="usage-dropdown" ref={wrapRef}>
      <button
        className={`usage-btn ${open ? 'active' : ''} ${isDanger ? 'danger' : isWarning ? 'warning' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={`${usage.short.used}/${usage.short.limit} this window · ${usage.long.used}/${usage.long.limit} overall`}
      >
        <span className="usage-btn-dot" />
        <span className="usage-btn-label">
          {usage.short.used}/{usage.short.limit}
        </span>
      </button>

      {open && (
        <div className="usage-menu">
          <div className="usage-menu-header">
            <div className="usage-menu-title">
              <TierBadge tier={usage.tier} label={usage.tierLabel} />
            </div>
          </div>

          <div className="usage-menu-body">
            <WindowBar
              label="5-hour window"
              windowData={usage.short}
            />
            <WindowBar
              label="2-week window"
              windowData={usage.long}
            />
          </div>

          {usage.tier === 'anonymous' && (
            <div className="usage-menu-cta">
              <div className="usage-cta-text">
                Sign in to unlock <strong>20 per 5h</strong> and <strong>500 per 2 weeks</strong>
              </div>
            </div>
          )}

          {usage.tier === 'free' && (
            <div className="usage-menu-cta upgrade">
              <div className="usage-cta-text">
                Upgrade for <strong>3×</strong> · <strong>5×</strong> · <strong>10×</strong> limits
              </div>
              <div className="usage-cta-hint">
                Coming soon
              </div>
            </div>
          )}

          {usage.tier !== 'anonymous' && usage.tier !== 'free' && (
            <div className="usage-menu-cta pro">
              <div className="usage-cta-text">
                💎 You're on <strong>{usage.tierLabel}</strong>
              </div>
              <div className="usage-cta-hint">
                Thanks for supporting Stream
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}