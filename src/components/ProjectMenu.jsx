import { useState, useRef, useEffect } from 'react'

// The "File" menu in the top bar: save, revert, export and import live here instead of
// taking up room as separate buttons.
export default function ProjectMenu({ canSave, canRevert, onSave, onRevert, onExport, onImport }) {
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
    { label: 'Save', hint: 'Ctrl+S', icon: '💾', disabled: !canSave, run: onSave },
    { label: 'Revert last AI change', icon: '↺', disabled: !canRevert, run: onRevert },
    { sep: true },
    { label: 'Export project as .zip', icon: '📦', run: onExport },
    { label: 'Import project from .zip', icon: '📥', run: onImport },
  ]

  return (
    <div className="pm-wrap" ref={wrapRef}>
      <button className={`topbar-btn pm-btn ${open ? 'active' : ''}`} onClick={() => setOpen((o) => !o)}>
        File <span className="pm-caret">▾</span>
      </button>
      {open && (
        <div className="pm-menu">
          {items.map((it, i) =>
            it.sep ? (
              <div key={i} className="pm-sep" />
            ) : (
              <button
                key={i}
                className="pm-item"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false)
                  it.run?.()
                }}
              >
                <span className="pm-icon">{it.icon}</span>
                <span className="pm-label">{it.label}</span>
                {it.hint && <span className="pm-hint">{it.hint}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
