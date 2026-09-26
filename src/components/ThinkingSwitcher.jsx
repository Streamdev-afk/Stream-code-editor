import { useState, useRef, useEffect } from 'react'
import { THINKING_LEVELS } from '../lib/settings'

export default function ThinkingSwitcher({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  const current = THINKING_LEVELS.find((l) => l.id === value) || THINKING_LEVELS[1]

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="thinking-switcher" ref={wrapRef}>
      <button
        className={`topbar-btn thinking-btn ${open ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="How hard should the AI think? Higher = better answers, more usage."
      >
        <span className={`thinking-icon thinking-icon-${current.id}`}>◆</span>
        {current.label}
        <span className="thinking-caret">▾</span>
      </button>

      {open && (
        <div className="thinking-menu">
          <div className="thinking-menu-header">Thinking level</div>
          {THINKING_LEVELS.map((lvl) => (
            <div
              key={lvl.id}
              className={`thinking-item ${lvl.id === value ? 'active' : ''}`}
              onClick={() => {
                onChange(lvl.id)
                setOpen(false)
              }}
            >
              <div className="thinking-item-head">
                <span className={`thinking-icon thinking-icon-${lvl.id}`}>◆</span>
                <span className="thinking-item-label">{lvl.label}</span>
                <span className={`thinking-cost thinking-cost-${lvl.badge}`}>
                  {lvl.multiplier}×
                </span>
              </div>
              <div className="thinking-item-hint">{lvl.hint}</div>
            </div>
          ))}
          <div className="thinking-menu-note">
            Higher levels use more of your request budget per message.
          </div>
        </div>
      )}
    </div>
  )
}