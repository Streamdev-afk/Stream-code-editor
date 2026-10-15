import { useState, useRef, useEffect } from 'react'

const MODES = [
  { id: 'professional', label: 'Professional', icon: '💼', hint: 'Direct, efficient, no fluff' },
  { id: 'friendly',     label: 'Friendly',     icon: '😊', hint: 'Warm, encouraging, casual' },
  { id: 'teacher',      label: 'Teacher',      icon: '🎓', hint: 'Explains the why, patient' },
  { id: 'concise',      label: 'Concise',      icon: '⚡', hint: 'Shortest accurate answers' },
  { id: 'creative',     label: 'Creative',     icon: '✨', hint: 'Explores alternatives, tradeoffs' },
]

export default function BehaviorSwitcher({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  const current = MODES.find((m) => m.id === value) || MODES[1]

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="behavior-switcher" ref={wrapRef}>
      <button
        className={`topbar-btn behavior-btn ${open ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="How should the AI talk to you?"
      >
        <span className="behavior-icon">{current.icon}</span>
        {current.label}
        <span className="behavior-caret">▾</span>
      </button>

      {open && (
        <div className="behavior-menu">
          <div className="behavior-menu-header">Behavioral mode</div>
          {MODES.map((m) => (
            <div
              key={m.id}
              className={`behavior-item ${m.id === value ? 'active' : ''}`}
              onClick={() => { onChange(m.id); setOpen(false) }}
            >
              <div className="behavior-item-head">
                <span className="behavior-item-icon">{m.icon}</span>
                <span className="behavior-item-label">{m.label}</span>
              </div>
              <div className="behavior-item-hint">{m.hint}</div>
            </div>
          ))}
          <div className="behavior-menu-note">
            Only changes tone. Code quality is the same.
          </div>
        </div>
      )}
    </div>
  )
}