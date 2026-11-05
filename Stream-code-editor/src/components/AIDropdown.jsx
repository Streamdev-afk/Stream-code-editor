import { useState, useRef, useEffect } from 'react'

export default function AIDropdown({ disabled, onAction }) {
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

  const items = [
    { action: 'complete', label: '✨ Complete', hint: 'Continue unfinished code' },
    { action: 'fix',      label: '🔧 Fix bugs', hint: 'Find and fix errors' },
    { action: 'refactor', label: '♻️ Refactor', hint: 'Clean up and improve' },
    { action: 'comment',  label: '💬 Comment',  hint: 'Add helpful comments' },
  ]

  return (
    <div className="ai-dropdown" ref={wrapRef}>
      <button
        className={`topbar-btn ${open ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="Quick AI actions on the current file"
      >
        🤖 AI ▾
      </button>
      {open && (
        <div className="ai-menu">
          {items.map((it) => (
            <div
              key={it.action}
              className="ai-menu-item"
              onClick={() => {
                setOpen(false)
                onAction?.(it.action, it.label)
              }}
            >
              <div className="ai-menu-label">{it.label}</div>
              <div className="ai-menu-hint">{it.hint}</div>
            </div>
          ))}
          <div className="ai-menu-sep" />
          <div className="ai-menu-note">
            For real changes, use Agent mode in the chat.
          </div>
        </div>
      )}
    </div>
  )
}