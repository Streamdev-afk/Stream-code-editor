import { useState, useEffect, useMemo, useRef } from 'react'

export default function CommandPalette({ mode, files, activeFile, commands, onSelectFile, onRunCommand, onClose }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  // Build items list based on mode
  const items = useMemo(() => {
    if (mode === 'files') {
      return Object.keys(files)
        .sort()
        .map((path) => ({
          id: path,
          label: path.split('/').pop(),
          sub: path,
          path,
          kind: 'file',
        }))
    }
    return commands.map((c) => ({
      id: c.id,
      label: c.label,
      sub: c.hint || '',
      action: c.action,
      kind: 'command',
    }))
  }, [mode, files, commands])

  // Filter + rank
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items.slice(0, 200)
    // Simple scoring: exact match in label > starts with > includes
    const scored = items
      .map((item) => {
        const label = item.label.toLowerCase()
        const sub = (item.sub || '').toLowerCase()
        let score = -1
        if (label === q) score = 1000
        else if (label.startsWith(q)) score = 500
        else if (label.includes(q)) score = 250
        else if (sub.includes(q)) score = 100
        else if (fuzzyMatch(label, q)) score = 50
        return { item, score }
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
      .map((s) => s.item)
    return scored
  }, [items, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, mode])

  // Scroll active into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex]
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const select = (item) => {
    if (!item) return
    if (item.kind === 'file') onSelectFile?.(item.path)
    else if (item.kind === 'command') onRunCommand?.(item.action)
    onClose?.()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      select(filtered[activeIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
    }
  }

  return (
    <div className="cmd-backdrop" onClick={onClose}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-header">
          <span className="cmd-prefix">{mode === 'files' ? '📄' : '⌘'}</span>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder={mode === 'files' ? 'Go to file…' : 'Type a command…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="cmd-count">{filtered.length}</span>
        </div>
        <div className="cmd-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="cmd-empty">No results</div>
          ) : (
            filtered.map((item, i) => (
              <div
                key={item.id}
                className={`cmd-item ${i === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => select(item)}
              >
                <div className="cmd-item-main">
                  <div className="cmd-item-label">{item.label}</div>
                  {item.sub && <div className="cmd-item-sub">{item.sub}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// Very simple fuzzy match: every char of query appears in order in target
function fuzzyMatch(target, query) {
  let ti = 0
  for (const c of query) {
    ti = target.indexOf(c, ti)
    if (ti === -1) return false
    ti++
  }
  return true
}