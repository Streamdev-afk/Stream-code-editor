import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/supabase'
import { API_BASE } from '../lib/api'

function formatTimeRemaining(ms) {
  if (!ms || ms <= 0) return 'soon'
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  if (days > 0) return `${days}d ${hours}h`
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export default function UsageDropdown() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [usage, setUsage] = useState(null)
  const wrapRef = useRef(null)

  // Fetch usage on mount + when user changes + every 30s while dropdown closed
  useEffect(() => {
    let cancelled = false

    const fetchUsage = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/usage`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setUsage(data)
      } catch {
        // silent
      }
    }

    fetchUsage()
    const interval = setInterval(fetchUsage, 30000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [user])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  // Refetch on open for freshness
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

  const percent = usage.percent
  const isWarning = percent >= 70
  const isDanger = percent >= 90

  const resetIn = formatTimeRemaining(usage.windowEndsAt - Date.now())

  const barClass = isDanger
    ? 'usage-bar-fill danger'
    : isWarning
      ? 'usage-bar-fill warning'
      : 'usage-bar-fill'

  return (
    <div className="usage-dropdown" ref={wrapRef}>
      <button
        className={`usage-btn ${open ? 'active' : ''} ${isDanger ? 'danger' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={`${usage.used} of ${usage.limit} requests used`}
      >
        <span className="usage-btn-dot" />
        <span className="usage-btn-label">
          {usage.used}/{usage.limit}
        </span>
      </button>

      {open && (
        <div className="usage-menu">
          <div className="usage-menu-header">
            <div className="usage-menu-title">
              {usage.tier === 'anonymous' ? '👤 Guest' : `⭐ ${usage.tierLabel}`}
            </div>
            <div className="usage-menu-sub">
              Resets in {resetIn}
            </div>
          </div>

          <div className="usage-menu-body">
            <div className="usage-stats">
              <span className="usage-stat-used">{usage.used}</span>
              <span className="usage-stat-sep">/</span>
              <span className="usage-stat-total">{usage.limit}</span>
              <span className="usage-stat-label">requests used</span>
            </div>

            <div className="usage-bar">
              <div className={barClass} style={{ width: `${percent}%` }} />
            </div>

            <div className="usage-percent">
              {percent}% used · {usage.remaining} left
            </div>
          </div>

          {usage.tier === 'anonymous' && (
            <div className="usage-menu-cta">
              <div className="usage-cta-text">
                Sign in for <strong>50×</strong> more requests
              </div>
            </div>
          )}

          {usage.tier === 'free' && (
            <div className="usage-menu-cta upgrade">
              <div className="usage-cta-text">
                Want <strong>3×</strong> · <strong>5×</strong> · <strong>10×</strong> limits?
              </div>
              <div className="usage-cta-hint">
                Upgrade coming soon
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}