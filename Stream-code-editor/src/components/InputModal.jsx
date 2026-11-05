import { useState, useEffect, useRef } from 'react'

export default function InputModal({ title, defaultValue = '', placeholder, onSubmit, onCancel }) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = () => {
    if (!value.trim()) return
    onSubmit(value.trim())
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onCancel} title="Cancel (Esc)">✕</button>
        </div>
        <div className="modal-body-simple">
          <input
            ref={inputRef}
            className="modal-input"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') onCancel()
            }}
          />
        </div>
        <div className="modal-footer">
          <span className="modal-hint">Enter to confirm · Esc to cancel</span>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-accept" onClick={submit} disabled={!value.trim()}>
            Create
          </button>
        </div>
      </div>
    </div>
  )
}