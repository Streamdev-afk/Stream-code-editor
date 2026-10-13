import { useState, useRef, useEffect } from 'react'

function SessionRow({ session, isActive, onClick, onRename, onDelete }) {
  const [menu, setMenu] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(session.title)
  const inputRef = useRef(null)

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renaming])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const handleContext = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const commitRename = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== session.title) {
      onRename(session.id, trimmed)
    }
    setRenaming(false)
  }

  // Message count indicator
  const msgCount = Array.isArray(session.messages)
    ? session.messages.filter((m) => m.role === 'user').length
    : 0

  const fileCount = session.files ? Object.keys(session.files).length : 0

  const fmtTime = (t) => {
    if (!t) return ''
    const d = new Date(t)
    const now = new Date()
    const diff = Math.floor((now - d) / 1000)
    if (diff < 60) return 'now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`
    return d.toLocaleDateString()
  }

  return (
    <>
      <div
        className={`session-row ${isActive ? 'active' : ''}`}
        onClick={() => !renaming && onClick(session.id)}
        onContextMenu={handleContext}
      >
        <div className="session-row-icon">💬</div>
        <div className="session-row-body">
          {renaming ? (
            <input
              ref={inputRef}
              className="session-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') { setRenaming(false); setRenameValue(session.title) }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="session-row-title">{session.title}</div>
          )}
          <div className="session-row-meta">
            <span>{msgCount} msg</span>
            <span className="session-row-dot">·</span>
            <span>{fileCount} files</span>
            <span className="session-row-dot">·</span>
            <span>{fmtTime(session.updatedAt)}</span>
          </div>
        </div>
      </div>

      {menu && (
        <div
          className="tree-context-menu"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="menu-item" onClick={() => { setRenaming(true); setMenu(null) }}>
            <span className="menu-icon">✎</span> Rename
          </div>
          <div className="menu-item danger" onClick={() => {
            if (confirm(`Delete "${session.title}"? This removes all its files and chat.`)) {
              onDelete(session.id)
            }
            setMenu(null)
          }}>
            <span className="menu-icon">🗑</span> Delete
          </div>
        </div>
      )}
    </>
  )
}

export default function SessionsPanel({ sessions, activeSessionId, onSelect, onNew, onRename, onDelete }) {
  return (
    <div className="sessions-panel">
      <div className="sessions-header">
        <span>Chats</span>
        <button
          className="sessions-new-btn"
          onClick={onNew}
          title="New chat"
        >
          ＋
        </button>
      </div>
      <div className="sessions-list">
        {sessions.length === 0 ? (
          <div className="sessions-empty">
            <div className="sessions-empty-icon">💬</div>
            <div className="sessions-empty-title">No chats yet</div>
            <div className="sessions-empty-hint">Click ＋ to start</div>
          </div>
        ) : (
          sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              isActive={s.id === activeSessionId}
              onClick={onSelect}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  )
}