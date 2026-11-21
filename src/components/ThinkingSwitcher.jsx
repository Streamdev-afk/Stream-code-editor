import Icon from './Icon'
import { useState, useRef, useEffect } from 'react'
import { THINKING_LEVELS } from '../lib/settings'
import { usePlan, PLAN_NAME, THINK_MIN } from '../lib/plan'

export default function ThinkingSwitcher({ value, onChange, disabled, compact = false, up = false }) {
  const [open, setOpen] = useState(false)
  const plan = usePlan()
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
    <div className={`thinking-switcher ${compact ? 'is-compact' : ''} ${up ? 'menu-up' : ''}`} ref={wrapRef}>
      <button
        className={`topbar-btn thinking-btn ${open ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="How hard should the AI think? Higher = better answers, more usage."
      >
        <span className={`thinking-icon thinking-icon-${current.id}`}>◆</span>
        <span className="switch-label">{current.label}</span>
        <span className="thinking-caret"><Icon name="chevronDown" size={12} strokeWidth={2.4} /></span>
      </button>

      {open && (
        <div className="thinking-menu">
          <div className="thinking-menu-header">Thinking level</div>
          {THINKING_LEVELS.map((lvl) => (
            <div
              key={lvl.id}
              className={`thinking-item ${lvl.id === value ? 'active' : ''}`}
              onClick={() => {
                if (THINK_MIN[lvl.id] && !plan.canThink(lvl.id)) { window.dispatchEvent(new CustomEvent('qoders-toast', { detail: `${lvl.label} thinking needs the ${PLAN_NAME[THINK_MIN[lvl.id]]} plan. Buy it in the ION app (Plans page) with the same login.` })); return }
                onChange(lvl.id)
                setOpen(false)
              }}
            >
              <div className="thinking-item-head">
                <span className={`thinking-icon thinking-icon-${lvl.id}`}>◆</span>
                <span className="thinking-item-label">{THINK_MIN[lvl.id] && !plan.canThink(lvl.id) ? '👑 ' : ''}{lvl.label}</span>
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