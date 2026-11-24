import Icon from './Icon'
import { useState, useRef, useEffect } from 'react'
import { AVAILABLE_MODELS } from '../lib/settings'
import { byokActive, getByok } from '../lib/byok'
import { usePlan, PLAN_NAME, PLAN_RANK } from '../lib/plan'

import { GROUPS, groupOf, useCatalog, dots } from '../lib/modelGroups'

export default function ModelSwitcher({ value, onChange, disabled, compact = false, up = false }) {
  const [open, setOpen] = useState(false)
  const plan = usePlan()
  const wrapRef = useRef(null)
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    window.addEventListener('byok-changed', f)
    return () => window.removeEventListener('byok-changed', f)
  }, [])
  const own = byokActive() ? getByok() : null
  const cat = useCatalog()
  const ALL = [...cat, ...AVAILABLE_MODELS]
  const lockOf = (m) => m.tier === 'free' ? null : (m.id.startsWith('cat::') || m.tier ? ((PLAN_RANK[m.tier] ?? 0) > plan.rank ? m.tier : null) : plan.modelLock(m.id)) || (m.tier && m.tier !== 'free' ? plan.modelLock(m.id) : null)

  const current = ALL.find((m) => m.id === value) || AVAILABLE_MODELS[0]

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className={`model-switcher ${compact ? 'is-compact' : ''} ${up ? 'menu-up' : ''}`} ref={wrapRef}>
      <button
        className={`topbar-btn model-btn ${open ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="Change AI model"
      >
        <span className="model-dot" />
        <span className="switch-label">{own ? `My key · ${own.model.split('/').pop()}` : current.label}</span>
        <span className="model-caret"><Icon name="chevronDown" size={12} strokeWidth={2.4} /></span>
      </button>
      {open && (
        <div className="model-menu">
          <div className="model-menu-header">AI Model</div>
          {GROUPS.map((g) => (ALL.some((m) => groupOf(m) === g.id) && (
            <div key={g.id} className="model-group">
              <div className="model-group-title">{g.title}<span>{g.sub}</span></div>
            {ALL.filter((m) => groupOf(m) === g.id).map((m) => (
            <div
              key={m.id}
              className={`model-item ${m.id === value ? 'active' : ''}`}
              onClick={() => {
                const lock = lockOf(m)
                if (lock) { window.dispatchEvent(new CustomEvent('qoders-toast', { detail: `${m.label} needs the ${PLAN_NAME[lock] || lock} plan. Buy it in the ION app (Plans page) with the same login.` })); return }
                onChange(m.id)
                setOpen(false)
              }}
            >
              <div className="model-item-head">
                <span className="model-item-label">{lockOf(m) ? '👑 ' : ''}{m.label}</span>
                {m.badge !== 'default' && (
                  <span className={`model-badge badge-${m.badge}`}>{m.badge}</span>
                )}
              </div>
              <div className="model-item-hint">{m.hint}</div>
              {m.best && (
                <div className="model-item-meta">
                  <div className="mi-meters"><span title="How fast">⚡ {dots(m.speed || 3)}</span><span title="How strong">🧠 {dots(m.power || 3)}</span></div>
                  <div className="mi-good">✓ {m.best}</div>
                  <div className="mi-weak">Limits: {m.weak}</div>
                </div>
              )}
            </div>
          ))}
            </div>
          )))}
        </div>
      )}
    </div>
  )
}