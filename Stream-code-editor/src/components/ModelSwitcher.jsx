import { useState, useRef, useEffect } from 'react'
import { AVAILABLE_MODELS } from '../lib/settings'

export default function ModelSwitcher({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  const current = AVAILABLE_MODELS.find((m) => m.id === value) || AVAILABLE_MODELS[0]

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="model-switcher" ref={wrapRef}>
      <button
        className={`topbar-btn model-btn ${open ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="Change AI model"
      >
        <span className="model-dot" />
        {current.label}
        <span className="model-caret">▾</span>
      </button>
      {open && (
        <div className="model-menu">
          <div className="model-menu-header">AI Model</div>
          {AVAILABLE_MODELS.map((m) => (
            <div
              key={m.id}
              className={`model-item ${m.id === value ? 'active' : ''}`}
              onClick={() => {
                onChange(m.id)
                setOpen(false)
              }}
            >
              <div className="model-item-head">
                <span className="model-item-label">{m.label}</span>
                {m.badge !== 'default' && (
                  <span className={`model-badge badge-${m.badge}`}>{m.badge}</span>
                )}
              </div>
              <div className="model-item-hint">{m.hint}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}